import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import {
  canonical,
  randomKey,
  seal,
  personalRecords,
  type SyncClient,
} from '@sp/sync-providers/ultra-tasks';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { ValidateStateService } from '../../op-log/validation/validate-state.service';

describe('NativePersonalBridgeService', () => {
  const identity = { serverId: 'test-server', accountId: 'test-account' };
  const namespace = 'native-sync:' + canonical(identity);
  let service: NativePersonalBridgeService;
  let saved: { data: { namespace: string; envelope: unknown } } | undefined;
  let snapshot: jasmine.Spy;
  let client: SyncClient;
  beforeEach(() => {
    saved = undefined;
    snapshot = jasmine.createSpy().and.resolveTo({
      task: { ids: [], entities: {} },
      globalConfig: { sync: { isEnabled: false } },
    });
    client = {
      account: { identity: () => identity, unlocked: { masterKey: randomKey() } },
      state: {
        device: { id: 'device' },
        scopes: { personal: { info: { id: 'personal', kind: 'personal' } } },
      },
      records: () => ({}),
      edit: jasmine.createSpy().and.resolveTo(),
    } as unknown as SyncClient;
    TestBed.configureTestingModule({
      providers: [
        NativePersonalBridgeService,
        { provide: Store, useValue: { selectSignal: () => signal(null) } },
        {
          provide: StateSnapshotService,
          useValue: { getStateSnapshotForOperationLogAsync: snapshot },
        },
        {
          provide: OperationLogStoreService,
          useValue: { loadNativeSyncBaseline: () => Promise.resolve(saved) },
        },
        { provide: OperationLogSyncService, useValue: {} },
        { provide: BackupService, useValue: {} },
        { provide: ValidateStateService, useValue: {} },
      ],
    });
    service = TestBed.inject(NativePersonalBridgeService);
  });
  const baseline = async (): Promise<void> => {
    saved = {
      data: {
        namespace,
        envelope: await seal(
          client.account.unlocked!.masterKey,
          JSON.stringify({ source: {}, records: {} }),
          namespace,
        ),
      },
    };
  };
  it('does not automatically link another account to this device’s existing dataset', async () => {
    await baseline();
    saved!.data.namespace = 'another-account';
    expect(await service.bind(client)).toBeFalse();
    await service.capture();
    expect(client.edit).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('captures only the operation-log-aligned snapshot, keeping batched timer deltas out of a replacement baseline', async () => {
    await baseline();
    expect(await service.bind(client)).toBeTrue();
    await service.capture();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(client.edit).toHaveBeenCalled();
  });
  it('retains local changes and refuses to dual-write while a legacy provider is enabled', async () => {
    await baseline();
    await service.bind(client);
    snapshot.and.resolveTo({
      task: { entities: {} },
      globalConfig: { sync: { isEnabled: true } },
    });
    await expectAsync(service.capture()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_LEGACY',
    );
    expect(client.edit).not.toHaveBeenCalled();
  });
  it('permits undo/archive restoration only after the deleted task was absent from the applied baseline', async () => {
    await baseline();
    const source = {
      task: {
        ids: ['restored'],
        entities: { restored: { id: 'restored', title: 'restored' } },
      },
      globalConfig: { sync: { isEnabled: false } },
    };
    const records = await personalRecords(source, 'device');
    const entityId = Object.values(records.records).find(
      (record) =>
        (record.value as { path: string[] }).path.join('/') === 'task/entities/restored',
    )!.entityId;
    snapshot.and.resolveTo(source);
    spyOn(client, 'records').and.returnValue({
      [entityId]: {
        entityId,
        entityType: 'personal.document',
        deleted: true,
        revision: 5,
        value: null,
      },
    });
    await service.bind(client);
    await service.capture();
    const changes = (client.edit as jasmine.Spy).calls.mostRecent().args[1] as {
      entityId: string;
      restore?: boolean;
    }[];
    expect(changes.find((change) => change.entityId === entityId)?.restore).toBeTrue();
    saved = {
      data: {
        namespace,
        envelope: await seal(
          client.account.unlocked!.masterKey,
          JSON.stringify(records),
          namespace,
        ),
      },
    };
    await service.bind(client);
    snapshot.and.resolveTo({
      ...source,
      task: {
        ...source.task,
        entities: { restored: { id: 'restored', title: 'stale edit' } },
      },
    });
    await service.capture();
    const stale = (client.edit as jasmine.Spy).calls.mostRecent().args[1] as {
      entityId: string;
      restore?: boolean;
    }[];
    expect(stale.find((change) => change.entityId === entityId)?.restore).toBeUndefined();
  });
});
