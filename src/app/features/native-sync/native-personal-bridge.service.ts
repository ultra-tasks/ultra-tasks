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
import { hasPendingPersonalSetup } from './native-personal-recovery';
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

type TaskLists = Partial<Record<'taskIds' | 'backlogTaskIds', string[]>>;
interface TaskListDocument {
  path: string[];
  data: TaskLists;
}
const TASK_LIST_KEYS = ['taskIds', 'backlogTaskIds'] as const;

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
  private client?: SyncClient;
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
    const snapshot = stripLocalOnlySyncSettingsFromAppData(
      structuredClone(await this.snapshots.getStateSnapshotForOperationLogAsync()),
    ) as unknown as Record<string, unknown>;
    const config = snapshot['globalConfig'] as { sync?: { isEnabled?: boolean } };
    if (config.sync?.isEnabled) throw new Error('NATIVE_SYNC.ERROR_LEGACY');
    const task = snapshot['task'] as Record<string, unknown>;
    task['currentTaskId'] = null;
    task['selectedTaskId'] = null;
    return snapshot;
  }
  async bind(client: SyncClient): Promise<boolean> {
    this.client = client;
    this.scopeId = Object.values(client.state.scopes).find(
      (s) => s.info.kind === 'personal' && !s.revoked,
    )?.info.id;
    const saved = (await this.opStore.loadNativeSyncBaseline('native-sync-active')) as
      | { data: { namespace: string; envelope: Envelope } }
      | undefined;
    this.baseline =
      saved?.data.namespace === this.namespace(client)
        ? (JSON.parse(
            await open(
              client.account.unlocked!.masterKey,
              saved.data.envelope,
              this.namespace(client),
            ),
          ) as PersonalBaseline)
        : undefined;
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
    const validation = await this.validation.validateAndRepair(
      this.withLocalSettings(withDefaultModelSlices(source)),
    );
    if (!validation.isValid) throw new Error('NATIVE_SYNC.ERROR_DATA');
    await this.backups.captureRecoveryPointUnlessCovered('LOCAL_IMPORT');
    const baseline = await personalRecords(source, client.state.device.id);
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
    this.baseline = baselineFromHeads(imported, restorePersonal(imported));
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
    await this.backups.captureRecoveryPointUnlessCovered('REMOTE_IMPORT');
    const scope = this.client!.state.scopes[this.scopeId];
    if (scope.intents.length || scope.uncertain)
      throw new Error('NATIVE_SYNC.ERROR_PENDING_ACCOUNT_CHANGES');
    onStage?.('downloading');
    await this.client!.syncScope(this.scopeId);
    if (this.client!.state.scopes[this.scopeId].info.state !== 'active')
      throw new Error('Personal migration is still in progress on another device');
    // The user explicitly chose the account's existing dataset; the recovery copy retains this device's data.
    this.baseline = undefined;
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
    const next = await personalRecords(source, this.client.state.device.id, baseline);
    const projection = this.client.records(this.scopeId, true);
    const pending = new Map<string, RecordChange>();
    for (const change of personalChanges(baseline, next)) {
      const intent = this.preserveTaskLists(
        change,
        baseline,
        projection[change.entityId],
      );
      if (intent) pending.set(intent.entityId, intent);
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
    for (let offset = 0; offset < changes.length; offset += 100)
      await this.client.edit(this.scopeId, changes.slice(offset, offset + 100));
  }
  private preserveTaskLists(
    change: RecordChange,
    baseline: PersonalBaseline,
    head?: PlainHead,
  ): RecordChange | null {
    if (change.entityType !== 'personal.document' || change.deleted) return change;
    const document = change.value as TaskListDocument;
    const [model, collection, id] = document.path;
    if (
      (model !== 'project' && model !== 'tag') ||
      collection !== 'entities' ||
      document.path.length !== 3
    )
      return change;
    const signed = (
      baseline.records[change.entityId]?.value as TaskListDocument | undefined
    )?.data;
    const applied = (
      baseline.source[model] as { entities?: Record<string, TaskLists> } | undefined
    )?.entities?.[id];
    if (
      !signed ||
      !applied ||
      !TASK_LIST_KEYS.some(
        (key) => canonical(applied[key] ?? null) !== canonical(signed[key] ?? null),
      )
    )
      return change;

    // The local projection can repair missing references while a peer is still uploading.
    // Keep that repair local, and merge deliberate edits into the latest account document.
    if (canonical(document.data) === canonical(applied)) return null;
    const latest = (head?.value as TaskListDocument | undefined)?.data ?? signed;
    const data = mergeRecord(applied, latest, document.data).value;
    return { ...change, value: { ...document, data } };
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
      committed = baselineFromHeads(heads, source as unknown as Record<string, unknown>);
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
      return {
        snapshotState,
        nativeBaseline: {
          id: 'native-sync-active',
          data: {
            namespace: this.namespace(client),
            envelope: await seal(
              client.account.unlocked!.masterKey,
              JSON.stringify(committed),
              this.namespace(client),
            ),
          },
        },
      };
    });
    this.baseline = committed;
  }
  async unlink(): Promise<void> {
    await this.opStore.clearNativeSyncBaseline('native-sync-active');
    this.clear();
  }
  clear(): void {
    this.client = undefined;
    this.baseline = undefined;
    this.scopeId = undefined;
  }
}
