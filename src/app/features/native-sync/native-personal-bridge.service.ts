import { hasNativeRecoveryData } from './account-data-summary.service';
import { normalizeGlobalConfigStartOfNextDay } from '../config/normalize-start-of-next-day-config';
import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  baselineFromHeads,
  canonical,
  mergeRecord,
  open,
  personalChanges,
  personalRecords,
  restorePersonal,
  seal,
  type Envelope,
  type PersonalBaseline,
  type PlainHead,
  type RecordChange,
  type SyncClient,
} from '@sp/sync-providers/ultra-tasks';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { withDefaultModelSlices } from '../../op-log/model/model-config';
import {
  applyLocalOnlySyncSettingsToAppData,
  stripLocalOnlySyncSettingsFromAppData,
} from '../config/local-only-sync-settings.util';
import type { GlobalConfigState } from '../config/global-config.model';
import { selectCurrentTaskId } from '../tasks/store/task.selectors';
import { ValidateStateService } from '../../op-log/validation/validate-state.service';
import { replacePersonalRecords } from './native-personal-replacement';
import { hasPendingPersonalSetup, HISTORY_CHANGED } from './native-personal-recovery';
import { TabSeqFrontierService } from '../../op-log/persistence/tab-seq-frontier.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { T } from '../../t.const';

/** Where an initial switch stands, so every surface can say "Downloading" and then "Applying". */
export type BridgeStage = 'downloading' | 'applying' | 'uploading';

// Debug builds can run with the last published SDK against a newer server.
type RestartableSyncClient = SyncClient & {
  restartPersonalMigration?(scopeId: string, records: RecordChange[]): Promise<string>;
  recoverUploadedPersonalSetup?(scopeId: string): Promise<void>;
  rejoinRecoveredPersonalSetup?(scopeId: string): Promise<void>;
};

interface TaskTimeBucket {
  path: string[];
  deviceId: string;
  positive: number;
  negative: number;
  foldedTime?: { path: string[]; elapsed: number };
}

const NATIVE_BASELINE = 'native-sync-active';
const CAPTURE_CHECKPOINT = 'native-sync-capture';

interface EncryptedBaseline {
  data: { namespace: string; envelope: Envelope };
}

interface EncryptedCheckpoint {
  data: { namespace: string; baselineNonce: string; envelope: Envelope };
}

interface CapturedDocuments {
  deviceId: string;
  scopeId: string;
  changes: RecordChange[];
}

// Applied state includes device-local settings that must not become document edits.
const captureSource = (source: Record<string, unknown>): Record<string, unknown> => {
  const snapshot = stripLocalOnlySyncSettingsFromAppData(source) as Record<
    string,
    unknown
  >;
  return snapshot['task']
    ? {
        ...snapshot,
        task: {
          ...(snapshot['task'] as object),
          currentTaskId: null,
          selectedTaskId: null,
        },
      }
    : snapshot;
};

const documentRecords = (
  records: PersonalBaseline['records'],
): PersonalBaseline['records'] =>
  Object.fromEntries(
    Object.entries(records).filter(
      ([, record]) => record.entityType === 'personal.document',
    ),
  );

const taskTimeBucket = (
  record?: Pick<RecordChange, 'entityType' | 'value' | 'deleted'>,
): TaskTimeBucket | undefined => {
  if (record?.deleted || record?.entityType !== 'personal.time' || !record.value)
    return undefined;
  const value = record.value as TaskTimeBucket;
  const path = value.path;
  if (
    Array.isArray(path) &&
    path.at(-5) === 'task' &&
    path.at(-4) === 'entities' &&
    path.at(-2) === 'timeSpentOnDay' &&
    (path.length === 5 ||
      (path.length === 6 && (path[0] === 'archiveYoung' || path[0] === 'archiveOld'))) &&
    typeof value.deviceId === 'string' &&
    Number.isFinite(value.positive) &&
    Number.isFinite(value.negative)
  )
    return value;
  return undefined;
};

/** Keeps the local op log as the durable intent source; only encrypted records leave the device. */
@Injectable({ providedIn: 'root' })
export class NativePersonalBridgeService {
  private readonly snapshots = inject(StateSnapshotService);
  private readonly opStore = inject(OperationLogStoreService);
  private readonly sync = inject(OperationLogSyncService);
  private readonly backups = inject(BackupService);
  private readonly validation = inject(ValidateStateService);
  private readonly tabFrontier = inject(TabSeqFrontierService);
  private readonly writeFlush = inject(OperationWriteFlushService);
  private readonly currentTaskId = inject(Store).selectSignal(selectCurrentTaskId);
  private baseline?: PersonalBaseline;
  // The local documents last durably queued, even if downloading or applying failed.
  // Unlike the applied baseline, this can move ahead before the app has hydrated.
  private capturedDocuments?: CapturedDocuments;
  private baselineNonce?: string;
  private appliedDocuments?: PersonalBaseline['records'];
  private client?: SyncClient;
  // A failed SDK edit can leave an intent visible in memory but absent on disk.
  // Do not let this exact client advance the durable capture checkpoint.
  private failedEditClient?: SyncClient;
  private requiresReload = false;
  scopeId?: string;

  private namespace(client: SyncClient): string {
    return 'native-sync:' + canonical(client.account.identity());
  }
  private withLocalSettings(
    source: ReturnType<typeof withDefaultModelSlices>,
  ): ReturnType<typeof withDefaultModelSlices> {
    const config = this.snapshots.getStateSnapshot().globalConfig as GlobalConfigState;
    return applyLocalOnlySyncSettingsToAppData(source, config.sync);
  }
  private async snapshot(): Promise<Record<string, unknown>> {
    const snapshot = captureSource(
      structuredClone(
        await this.snapshots.getStateSnapshotForOperationLogAsync(),
      ) as unknown as Record<string, unknown>,
    );
    const config = snapshot['globalConfig'] as { sync?: { isEnabled?: boolean } };
    if (config.sync?.isEnabled) throw new Error('NATIVE_SYNC.ERROR_LEGACY');
    return snapshot;
  }

  async bind(client: SyncClient): Promise<boolean> {
    if (client !== this.failedEditClient) this.failedEditClient = undefined;
    this.client = client;
    this.resetDocumentCapture();
    this.scopeId = Object.values(client.state.scopes).find(
      (s) => s.info.kind === 'personal' && !s.revoked,
    )?.info.id;
    const namespace = this.namespace(client);
    const saved = (await this.opStore.loadNativeSyncBaseline(NATIVE_BASELINE)) as
      | EncryptedBaseline
      | undefined;
    this.baseline =
      saved?.data.namespace === namespace
        ? (JSON.parse(
            await open(
              client.account.unlocked!.masterKey,
              saved.data.envelope,
              namespace,
            ),
          ) as PersonalBaseline)
        : undefined;
    if (this.baseline && saved && this.scopeId) {
      this.baselineNonce = saved.data.envelope.nonce;
      const checkpoint = (await this.opStore.loadNativeSyncBaseline(
        CAPTURE_CHECKPOINT,
      )) as EncryptedCheckpoint | undefined;
      if (
        checkpoint?.data.namespace === namespace &&
        checkpoint.data.baselineNonce === this.baselineNonce
      ) {
        this.capturedDocuments = JSON.parse(
          await open(
            client.account.unlocked!.masterKey,
            checkpoint.data.envelope,
            this.checkpointContext(namespace, this.baselineNonce),
          ),
        ) as CapturedDocuments;
      }
    }
    return !!this.baseline && !!this.scopeId;
  }
  canRecoverSetup(uploaded: boolean): boolean {
    const client: RestartableSyncClient | undefined = this.client;
    const features = client?.account.capabilities?.features;
    return uploaded
      ? features?.['personalMigrationRecovery'] === true &&
          typeof client?.recoverUploadedPersonalSetup === 'function'
      : features?.['personalMigrationRestart'] === true &&
          typeof client?.restartPersonalMigration === 'function';
  }
  async recoverUploadedPersonalSetup(scopeId: string): Promise<void> {
    const client: RestartableSyncClient | undefined = this.client;
    if (!client?.recoverUploadedPersonalSetup) throw new Error(T.NATIVE_SYNC.ERROR_SYNC);
    await client.recoverUploadedPersonalSetup(scopeId);
  }
  async rejoinRecoveredPersonalSetup(): Promise<void> {
    const client: RestartableSyncClient | undefined = this.client;
    if (this.scopeId) await client?.rejoinRecoveredPersonalSetup?.(this.scopeId);
  }
  async migrate(
    onStage?: (stage: BridgeStage) => void,
    restartScopeId?: string,
    confirmedRecoveryReplacement = false,
  ): Promise<void> {
    const client: RestartableSyncClient = this.client!;
    const source = await this.snapshot();
    const validationInput = this.withLocalSettings(withDefaultModelSlices(source));
    const normalizedConfig = normalizeGlobalConfigStartOfNextDay(
      validationInput.globalConfig,
    );
    const normalized = normalizedConfig
      ? { ...validationInput, globalConfig: normalizedConfig }
      : validationInput;
    const validation = await this.validation.validateAndRepair(normalized);
    if (!validation.isValid) throw new Error('NATIVE_SYNC.ERROR_DATA');
    await this.backups.captureRecoveryPointUnlessCovered(
      'LOCAL_IMPORT',
      hasNativeRecoveryData,
    );
    const wire = stripLocalOnlySyncSettingsFromAppData(
      validation.repairedState ?? normalized,
    ) as Record<string, unknown>;
    const baseline = await personalRecords(wire, client.state.device.id);
    const incomplete = this.scopeId && hasPendingPersonalSetup(client, this.scopeId);
    const records = Object.values(baseline.records);
    if (restartScopeId) {
      if (!client.restartPersonalMigration) throw new Error(T.NATIVE_SYNC.ERROR_SYNC);
      this.scopeId = await client.restartPersonalMigration(restartScopeId, records);
    } else if (this.scopeId && !incomplete) {
      await replacePersonalRecords(
        client,
        this.scopeId,
        records,
        confirmedRecoveryReplacement,
      );
    } else {
      this.scopeId = await client.migrate(records);
    }
    const imported = client.records(this.scopeId);
    // Account heads contain the repaired upload, while the app still shows the
    // original working copy. Diff late edits against that actual local copy so
    // a passive capture cannot upload repaired fields back in their old form.
    this.baseline = baselineFromHeads(imported, source);
    this.resetDocumentCapture();
    onStage?.('applying');
    await this.applySnapshot(T.NATIVE_SYNC.ERROR_LOCAL_CHANGED);
  }
  async useExisting(
    assertUnchanged?: () => void,
    onStage?: (stage: BridgeStage) => void,
  ): Promise<void> {
    if (!this.scopeId) throw new Error('NATIVE_SYNC.ERROR_NO_PERSONAL');
    await this.snapshot();
    // The recovery copy holds THIS device's data (archives included) before it is replaced.
    // It is saved on this device only: the account's own data is never copied anywhere.
    await this.backups.captureRecoveryPointUnlessCovered(
      'REMOTE_IMPORT',
      hasNativeRecoveryData,
    );
    const scope = this.client!.state.scopes[this.scopeId];
    if (scope.intents.length || scope.uncertain)
      throw new Error('NATIVE_SYNC.ERROR_PENDING_ACCOUNT_CHANGES');
    onStage?.('downloading');
    await this.client!.syncScope(this.scopeId);
    if (this.client!.state.scopes[this.scopeId].info.state !== 'active')
      throw new Error('Personal migration is still in progress on another device');
    // The user explicitly chose the account's existing dataset; the recovery copy retains this device's data.
    this.baseline = undefined;
    this.resetDocumentCapture();
    onStage?.('applying');
    await this.applySnapshot(T.NATIVE_SYNC.ERROR_LOCAL_CHANGED, assertUnchanged);
  }
  private async assertSafeTabFrontier(errorKey: string): Promise<void> {
    // Called under the operation-log lock. A different tab's durable writes
    // do not necessarily reach this tab's action stream or in-memory state.
    const [first, lastSeq] = await Promise.all([
      this.opStore.getFirstOpEntry(),
      this.opStore.getLastSeq(),
    ]);
    if (!this.tabFrontier.isReplacementSafeAt(first?.seq ?? null, lastSeq))
      throw new Error(errorKey);
  }
  async capture(): Promise<void> {
    if (!this.client || !this.scopeId || !this.baseline) return;
    const source = await this.writeFlush.flushThenRunExclusive(async () => {
      await this.assertSafeTabFrontier(T.NATIVE_SYNC.ERROR_RELOAD_TAB);
      return this.snapshot();
    });
    await this.captureSnapshot(source);
  }
  private async captureSnapshot(source: Record<string, unknown>): Promise<void> {
    const baseline = this.baseline;
    if (!this.client || !this.scopeId || !baseline) return;
    if (this.requiresReload || this.failedEditClient === this.client)
      throw new Error(T.NATIVE_SYNC.ERROR_CAPTURE_RELOAD);
    const deviceId = this.client.state.device.id;
    const next = await personalRecords(source, deviceId, baseline);
    const projection = this.client.records(this.scopeId, true);
    const pending = new Map<string, RecordChange>();
    const checkpoint = this.capturedDocuments;
    if (
      checkpoint &&
      (checkpoint.deviceId !== deviceId || checkpoint.scopeId !== this.scopeId)
    )
      throw new Error(HISTORY_CHANGED);
    const appliedDocuments = (this.appliedDocuments ??= documentRecords(
      (await personalRecords(captureSource(baseline.source), deviceId, baseline)).records,
    ));
    const observedDocuments = { ...appliedDocuments };
    for (const record of checkpoint?.changes ?? []) {
      if (record.deleted) delete observedDocuments[record.entityId];
      else observedDocuments[record.entityId] = record;
    }
    let changedDocuments = false;
    for (const change of personalChanges(
      {
        source: baseline.source,
        records: {
          ...Object.fromEntries(
            Object.entries(baseline.records).filter(
              ([, record]) => record.entityType !== 'personal.document',
            ),
          ),
          ...observedDocuments,
        },
      },
      next,
    )) {
      changedDocuments ||= change.entityType === 'personal.document';
      const observed = observedDocuments[change.entityId];
      const head = projection[change.entityId];
      const intent = this.rebaseDocument(change, observed, head);
      pending.set(intent.entityId, intent);
    }
    this.reconcileMovedTaskTime(baseline, next, projection, pending);
    const changes = [...pending.values()].filter((change) => {
      const current = projection[change.entityId];
      return (
        !current ||
        current.deleted !== !!change.deleted ||
        canonical(current.value) !== canonical(change.value)
      );
    });
    for (const change of changes) {
      if (
        !change.deleted &&
        projection[change.entityId]?.deleted &&
        !baseline.records[change.entityId]
      )
        change.restore = true;
    }
    try {
      for (let offset = 0; offset < changes.length; offset += 100)
        await this.client.edit(this.scopeId, changes.slice(offset, offset + 100));
    } catch (error) {
      this.failedEditClient = this.client;
      throw error;
    }
    if (changedDocuments) {
      const capture = {
        deviceId,
        scopeId: this.scopeId,
        changes: personalChanges(
          { source: baseline.source, records: appliedDocuments },
          { source: next.source, records: documentRecords(next.records) },
        ),
      };
      // Commit only after every SDK edit is durable, but before this call can return
      // to syncAll(). If queuing stops partway, the next attempt compares with the
      // queued projection; no account merge could have run from this failed pass.
      if (this.baselineNonce) {
        const namespace = this.namespace(this.client);
        await this.opStore.saveNativeSyncCheckpoint(CAPTURE_CHECKPOINT, {
          namespace,
          baselineNonce: this.baselineNonce,
          envelope: await seal(
            this.client.account.unlocked!.masterKey,
            JSON.stringify(capture),
            this.checkpointContext(namespace, this.baselineNonce),
          ),
        });
      }
      this.capturedDocuments = capture;
    }
  }

  private checkpointContext(namespace: string, nonce: string): string {
    return namespace + ':capture:' + nonce;
  }

  private resetDocumentCapture(): void {
    this.capturedDocuments = undefined;
    this.appliedDocuments = undefined;
    this.baselineNonce = undefined;
  }

  private rebaseDocument(
    change: RecordChange,
    observed?: RecordChange,
    head?: PlainHead,
  ): RecordChange {
    if (
      change.entityType !== 'personal.document' ||
      change.deleted ||
      !observed ||
      !head ||
      head.deleted
    )
      return change;
    // edit() uses the SDK projection as its intent base. Overlay only fields the
    // app changed since it last observed/queued the document; unchanged fields
    // from the pre-hydration app snapshot must not undo server changes.
    return {
      ...change,
      value: mergeRecord(observed.value, head.value, change.value).value,
    };
  }
  private reconcileMovedTaskTime(
    before: PersonalBaseline,
    next: PersonalBaseline,
    projection: Record<string, PlainHead>,
    pending: Map<string, RecordChange>,
  ): void {
    const deviceId = this.client!.state.device.id;
    for (const record of Object.values(next.records)) {
      const local = taskTimeBucket(record);
      if (local?.deviceId !== deviceId) continue;
      const { entityId } = record;
      const { path } = local;
      const current = taskTimeBucket(projection[entityId]);
      if (
        !current ||
        current.deviceId !== deviceId ||
        current.path[0] === path[0] ||
        current.path.at(-3) !== path.at(-3) ||
        current.path.at(-1) !== path.at(-1)
      )
        continue;
      const previous = taskTimeBucket(before.records[entityId]);
      if (previous && canonical(previous.path) !== canonical(path)) continue;

      // The SDK moved the counter while this tab still shows its pre-sync snapshot.
      // A legacy archive can have already folded part of this counter into its baseline.
      const folded = current.foldedTime;
      const elapsed =
        folded &&
        Array.isArray(folded.path) &&
        Number.isFinite(folded.elapsed) &&
        canonical(folded.path) === canonical(path)
          ? folded.elapsed
          : 0;
      const desired = local.positive - local.negative - elapsed;
      const delta = desired - (current.positive - current.negative);
      if (delta === 0) pending.delete(entityId);
      else
        pending.set(entityId, {
          entityId,
          entityType: 'personal.time',
          value: {
            ...current,
            positive: current.positive + Math.max(0, delta),
            negative: current.negative + Math.max(0, -delta),
          },
        });
    }
  }
  async apply(): Promise<void> {
    await this.applySnapshot(T.NATIVE_SYNC.ERROR_RELOAD_TAB);
  }
  private async applySnapshot(
    frontierError: string,
    assertUnchanged?: () => Promise<void> | void,
  ): Promise<void> {
    const client = this.client!;
    if (!this.scopeId) return;
    let committed: PersonalBaseline | undefined;
    let nextBaselineNonce: string | undefined;
    if (this.requiresReload) throw new Error(T.NATIVE_SYNC.ERROR_CAPTURE_RELOAD);
    try {
      await this.sync.applyNativeSnapshot(async () => {
        // Called inside the op-log cutoff with deferred capture already open.
        await this.assertSafeTabFrontier(frontierError);
        if (assertUnchanged) await assertUnchanged();
        if (this.baseline) await this.captureSnapshot(await this.snapshot());
        const heads = client.records(this.scopeId!);
        const restored = restorePersonal(heads);
        const data = this.withLocalSettings(withDefaultModelSlices(restored));
        const validation = await this.validation.validateAndRepair(data);
        if (!validation.isValid) throw new Error('NATIVE_SYNC.ERROR_DATA');
        const source = validation.repairedState ?? data;
        committed = baselineFromHeads(
          heads,
          source as unknown as Record<string, unknown>,
        );
        const currentTaskId = this.currentTaskId();
        const task = (source as typeof data).task;
        const snapshotState = {
          ...source,
          task: {
            ...task,
            currentTaskId:
              currentTaskId && task.entities[currentTaskId] ? currentTaskId : null,
          },
        } as unknown as Record<string, unknown>;
        const envelope = await seal(
          client.account.unlocked!.masterKey,
          JSON.stringify(committed),
          this.namespace(client),
        );
        nextBaselineNonce = envelope.nonce;
        return {
          snapshotState,
          nativeBaseline: {
            id: NATIVE_BASELINE,
            data: { namespace: this.namespace(client), envelope },
          },
        };
      });
    } catch (error) {
      if (nextBaselineNonce) {
        // A failure can happen before commit, or afterward but before NgRx loaded
        // that snapshot. If the durable baseline moved, only a full reload can
        // safely reestablish consistency between the persisted and running data.
        try {
          const saved = (await this.opStore.loadNativeSyncBaseline(NATIVE_BASELINE)) as
            | EncryptedBaseline
            | undefined;
          this.requiresReload = saved?.data.envelope.nonce === nextBaselineNonce;
        } catch {
          this.requiresReload = true;
        }
      }
      if (this.requiresReload) throw new Error(T.NATIVE_SYNC.ERROR_CAPTURE_RELOAD);
      throw error;
    }
    this.baseline = committed;
    // Hydration replaced the applied baseline atomically. Any previous capture
    // checkpoint now has a different nonce, including after an abrupt reload.
    this.resetDocumentCapture();
    this.baselineNonce = nextBaselineNonce;
  }
  async unlink(): Promise<void> {
    await this.opStore.clearNativeSyncBaseline(NATIVE_BASELINE);
    await this.opStore.clearNativeSyncBaseline(CAPTURE_CHECKPOINT);
    this.clear();
  }
  clear(): void {
    this.client = undefined;
    this.baseline = undefined;
    this.resetDocumentCapture();
    this.scopeId = undefined;
  }
}
