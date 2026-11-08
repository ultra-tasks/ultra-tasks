import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  baselineFromHeads,
  canonical,
  open,
  personalChanges,
  personalRecords,
  restorePersonal,
  seal,
  type Envelope,
  type PersonalBaseline,
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

/** Keeps the local op log as the durable intent source; only encrypted records leave the device. */
@Injectable({ providedIn: 'root' })
export class NativePersonalBridgeService {
  private readonly snapshots = inject(StateSnapshotService);
  private readonly opStore = inject(OperationLogStoreService);
  private readonly sync = inject(OperationLogSyncService);
  private readonly backups = inject(BackupService);
  private readonly validation = inject(ValidateStateService);
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
      (s) => s.info.kind === 'personal',
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
  async migrate(): Promise<void> {
    const client = this.client!;
    const source = await this.snapshot();
    const validation = await this.validation.validateAndRepair(
      this.withLocalSettings(withDefaultModelSlices(source)),
    );
    if (!validation.isValid) throw new Error('NATIVE_SYNC.ERROR_DATA');
    await this.backups.captureImportBackup('LOCAL_IMPORT');
    const baseline = await personalRecords(source, client.state.device.id);
    this.scopeId = await client.migrate(Object.values(baseline.records));
    const imported = client.records(this.scopeId);
    this.baseline = baselineFromHeads(imported, restorePersonal(imported));
    await this.apply();
  }
  async useExisting(): Promise<void> {
    if (!this.scopeId) throw new Error('NATIVE_SYNC.ERROR_NO_PERSONAL');
    await this.snapshot();
    await this.backups.captureImportBackup('REMOTE_IMPORT');
    await this.client!.syncScope(this.scopeId);
    if (this.client!.state.scopes[this.scopeId].info.state !== 'active')
      throw new Error('Personal migration is still in progress on another device');
    // The user explicitly chose the account's existing dataset; the recovery copy retains this device's data.
    this.baseline = undefined;
    await this.apply();
  }
  async capture(): Promise<void> {
    if (!this.client || !this.scopeId || !this.baseline) return;
    const source = await this.snapshot();
    const next = await personalRecords(
      source,
      this.client.state.device.id,
      this.baseline,
    );
    const projection = this.client.records(this.scopeId, true);
    const changes = personalChanges(this.baseline, next).filter((change) => {
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
        !this.baseline.records[change.entityId]
      )
        change.restore = true;
    }
    for (let offset = 0; offset < changes.length; offset += 100)
      await this.client.edit(this.scopeId, changes.slice(offset, offset + 100));
  }
  async apply(): Promise<void> {
    const client = this.client!;
    if (!this.scopeId) return;
    let committed: PersonalBaseline | undefined;
    await this.sync.applyNativeSnapshot(async () => {
      // Called inside the op-log cutoff with deferred capture already open.
      await this.capture();
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
