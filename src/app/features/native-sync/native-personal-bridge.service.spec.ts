import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import {
  canonical,
  randomKey,
  seal,
  personalRecords,
  type PersonalBaseline,
  type PlainHead,
  type RecordChange,
  type SyncClient,
} from '@sp/sync-providers/ultra-tasks';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { ValidateStateService } from '../../op-log/validation/validate-state.service';
import { TabSeqFrontierService } from '../../op-log/persistence/tab-seq-frontier.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';

describe('NativePersonalBridgeService', () => {
  const identity = { serverId: 'test-server', accountId: 'test-account' };
  const namespace = 'native-sync:' + canonical(identity);
  let service: NativePersonalBridgeService;
  let saved: { data: { namespace: string; envelope: unknown } } | undefined;
  let applied: Record<string, unknown> | undefined;
  let captureCheckpoint: unknown;
  let failApply: 'before commit' | 'after commit' | undefined;
  let snapshot: jasmine.Spy;
  let client: SyncClient;
  beforeEach(() => {
    saved = undefined;
    applied = undefined;
    captureCheckpoint = undefined;
    failApply = undefined;
    snapshot = jasmine.createSpy().and.resolveTo({
      task: { ids: [], entities: {} },
      globalConfig: { sync: { isEnabled: false } },
    });
    client = {
      account: { identity: () => identity, unlocked: { masterKey: randomKey() } },
      state: {
        device: { id: 'device' },
        scopes: {
          personal: {
            info: { id: 'personal', kind: 'personal', state: 'active', generation: 1 },
            intents: [],
          },
        },
      },
      records: () => ({}),
      edit: jasmine.createSpy().and.resolveTo(),
      syncScope: jasmine.createSpy().and.resolveTo(),
      migrate: jasmine.createSpy().and.resolveTo('personal'),
    } as unknown as SyncClient;
    TestBed.configureTestingModule({
      providers: [
        NativePersonalBridgeService,
        { provide: Store, useValue: { selectSignal: () => signal(null) } },
        {
          provide: OperationWriteFlushService,
          useValue: {
            flushThenRunExclusive: async (run: () => Promise<unknown>) => run(),
          },
        },
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotForOperationLogAsync: snapshot,
            getStateSnapshot: () => ({ globalConfig: { sync: { isEnabled: false } } }),
          },
        },
        {
          provide: OperationLogStoreService,
          useValue: {
            loadNativeSyncBaseline: (id: string) =>
              Promise.resolve(id === 'native-sync-capture' ? captureCheckpoint : saved),
            saveNativeSyncCheckpoint: jasmine
              .createSpy()
              .and.callFake(async (id: string, data: unknown) => {
                captureCheckpoint = { id, data };
              }),
            clearNativeSyncBaseline: async (id: string) => {
              if (id === 'native-sync-capture') captureCheckpoint = undefined;
              else saved = undefined;
            },
            getFirstOpEntry: jasmine
              .createSpy('getFirstOpEntry')
              .and.resolveTo(undefined),
            getLastSeq: jasmine.createSpy('getLastSeq').and.resolveTo(0),
          },
        },
        {
          provide: OperationLogSyncService,
          useValue: {
            applyNativeSnapshot: async (
              prepare: () => Promise<{
                snapshotState: Record<string, unknown>;
                nativeBaseline: { data: { namespace: string; envelope: unknown } };
              }>,
            ) => {
              const result = await prepare();
              if (failApply === 'before commit')
                throw new Error('simulated durable apply failure');
              saved = result.nativeBaseline;
              if (failApply === 'after commit')
                throw new Error('simulated durable apply failure');
              applied = result.snapshotState;
            },
          },
        },
        {
          provide: BackupService,
          useValue: {
            captureRecoveryPointUnlessCovered: jasmine.createSpy().and.resolveTo(null),
          },
        },
        {
          provide: ValidateStateService,
          useValue: {
            validateAndRepair: jasmine.createSpy().and.resolveTo({ isValid: true }),
          },
        },
      ],
    });
    service = TestBed.inject(NativePersonalBridgeService);
  });
  const baseline = async (
    records: PersonalBaseline = { source: {}, records: {} },
  ): Promise<void> => {
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
  it('requires an explicit connection after unlinking the same account', async () => {
    await baseline();
    expect(await service.bind(client)).toBeTrue();
    await service.unlink();
    expect(await service.bind(client)).toBeFalse();
    await service.capture();
    expect(client.edit).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('refuses an account snapshot if a different tab wrote beyond this tab’s frontier', async () => {
    await service.bind(client);
    TestBed.inject(TabSeqFrontierService).establishFrontier(4);
    (TestBed.inject(OperationLogStoreService).getLastSeq as jasmine.Spy).and.resolveTo(5);
    await expectAsync(service.useExisting()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_LOCAL_CHANGED',
    );
  });
  it('stops routine capture and apply before replacing unseen edits from another tab', async () => {
    await baseline();
    expect(await service.bind(client)).toBeTrue();
    TestBed.inject(TabSeqFrontierService).establishFrontier(4);
    (TestBed.inject(OperationLogStoreService).getLastSeq as jasmine.Spy).and.resolveTo(5);

    await expectAsync(service.capture()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_RELOAD_TAB',
    );
    await expectAsync(service.apply()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_RELOAD_TAB',
    );
    expect(client.edit).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(applied).toBeUndefined();
  });
  it('fails closed when the tab frontier is unknown and the operation log is nonempty', async () => {
    await service.bind(client);
    (
      TestBed.inject(OperationLogStoreService).getFirstOpEntry as jasmine.Spy
    ).and.resolveTo({
      seq: 5,
    });
    (TestBed.inject(OperationLogStoreService).getLastSeq as jasmine.Spy).and.resolveTo(5);
    await expectAsync(service.useExisting()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_LOCAL_CHANGED',
    );
  });
  it('allows a fresh profile when every stored operation was written by this tab', async () => {
    await service.bind(client);
    TestBed.inject(TabSeqFrontierService).observeOwnWrite(5);
    TestBed.inject(TabSeqFrontierService).observeOwnWrite(6);
    (
      TestBed.inject(OperationLogStoreService).getFirstOpEntry as jasmine.Spy
    ).and.resolveTo({
      seq: 5,
    });
    (TestBed.inject(OperationLogStoreService).getLastSeq as jasmine.Spy).and.resolveTo(6);
    await expectAsync(
      service.useExisting(() => {
        throw new Error('choice guard reached');
      }),
    ).toBeRejectedWithError('choice guard reached');
  });
  it('allows an empty unestablished log to reach the choice guard', async () => {
    await service.bind(client);
    await expectAsync(
      service.useExisting(() => {
        throw new Error('choice guard reached');
      }),
    ).toBeRejectedWithError('choice guard reached');
  });
  it('saves a recovery copy of THIS device first, then reports downloading and applying in order', async () => {
    await service.bind(client);
    const steps: string[] = [];
    const backups = TestBed.inject(BackupService)
      .captureRecoveryPointUnlessCovered as jasmine.Spy;
    backups.and.callFake(async () => {
      steps.push('recovery copy');
      return {};
    });
    (client.syncScope as jasmine.Spy).and.callFake(async () => {
      steps.push('fetch');
    });
    await expectAsync(
      service.useExisting(
        () => {
          throw new Error('choice guard reached');
        },
        (stage) => steps.push(stage),
      ),
    ).toBeRejectedWithError('choice guard reached');
    expect(backups).toHaveBeenCalledOnceWith('REMOTE_IMPORT', jasmine.any(Function));
    expect(steps).toEqual(['recovery copy', 'downloading', 'fetch', 'applying']);
  });
  it('publishes the repaired working copy without recapturing the old value', async () => {
    const s = (title: string): Record<string, unknown> => ({
      task: { ids: ['t1'], entities: { t1: { id: 't1', title } } },
      globalConfig: { sync: { isEnabled: false } },
    });
    snapshot.and.resolveTo(s('before repair'));
    const repaired = s('after repair');
    const validation = TestBed.inject(ValidateStateService)
      .validateAndRepair as jasmine.Spy;
    validation.and.resolveTo({ isValid: true, repairedState: repaired });
    const rawClient = client as unknown as {
      state: { scopes: SyncClient['state']['scopes'] };
    };
    const existing = rawClient.state.scopes;
    rawClient.state.scopes = {};
    expect(await service.bind(client)).toBeFalse();
    (client.migrate as jasmine.Spy).and.callFake(async (records: RecordChange[]) => {
      rawClient.state.scopes = existing;
      client.records = () =>
        Object.fromEntries(
          records.map((record) => [
            record.entityId,
            { ...record, revision: 1, deleted: false },
          ]),
        );
      return 'personal';
    });
    await service.migrate();
    const payload = (client.migrate as jasmine.Spy).calls.mostRecent().args[0];
    expect(JSON.stringify(payload)).toContain('after repair');
    expect(JSON.stringify(payload)).not.toContain('before repair');
    expect(client.edit).not.toHaveBeenCalled();
  });

  it('does not publish the deletion of a passive archive repair', async () => {
    const source = {
      task: { ids: [], entities: {} },
      globalConfig: { sync: { isEnabled: false, syncProvider: null } },
      archiveYoung: { task: { ids: [], entities: {} } },
    };
    const raw = await personalRecords(
      {
        ...source,
        archiveYoung: { task: { ids: ['child'], entities: { child: { id: 'child' } } } },
      },
      'device',
    );
    await baseline({ source, records: raw.records });
    snapshot.and.resolveTo(source);
    expect(await service.bind(client)).toBeTrue();
    await service.capture();
    expect(client.edit).not.toHaveBeenCalled();
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
  for (const rename of [false, true]) {
    const scenario = rename
      ? 'retains pending references when the project and tag are renamed locally'
      : 'does not overwrite newer project or tag heads after applying a partial upload';
    it(scenario, async () => {
      const project = {
        id: 'project',
        title: 'Project',
        taskIds: ['visible', 'pending-active'],
        backlogTaskIds: ['pending-backlog'],
      };
      const tag = { id: 'tag', title: 'Tag', taskIds: ['visible', 'pending-active'] };
      const source = (
        projectValue: typeof project,
        tagValue: typeof tag,
      ): Record<string, unknown> => ({
        project: { ids: ['project'], entities: { project: projectValue } },
        tag: { ids: ['tag'], entities: { tag: tagValue } },
        task: {
          ids: ['visible'],
          entities: { visible: { id: 'visible', projectId: 'project', tagIds: ['tag'] } },
          currentTaskId: null,
          selectedTaskId: null,
        },
        globalConfig: { sync: { isEnabled: false, syncProvider: null } },
      });
      const raw = await personalRecords(source(project, tag), 'writer-device');
      const localProject = { ...project, taskIds: ['visible'], backlogTaskIds: [] };
      const localTag = { ...tag, taskIds: ['visible'] };
      await baseline({ ...raw, source: source(localProject, localTag) });
      const remoteProject = {
        ...project,
        taskIds: [...project.taskIds, 'new-active'],
        backlogTaskIds: [...project.backlogTaskIds, 'new-backlog'],
      };
      const remoteTag = { ...tag, taskIds: [...tag.taskIds, 'new-active'] };
      const projection = await personalRecords(
        source(
          { ...remoteProject, title: 'Remote project title' },
          { ...remoteTag, title: 'Remote tag title' },
        ),
        'writer-device',
      );
      const heads: Record<string, PlainHead> = Object.fromEntries(
        Object.values(projection.records).map((record) => [
          record.entityId,
          { ...record, revision: 2, deleted: false },
        ]),
      );
      spyOn(client, 'records').and.returnValue(heads);
      expect(await service.bind(client)).toBeTrue();

      const projectTitle = 'Local project title';
      const tagTitle = 'Local tag title';
      snapshot.and.resolveTo(
        rename
          ? source(
              { ...localProject, title: projectTitle },
              { ...localTag, title: tagTitle },
            )
          : source(localProject, localTag),
      );
      await service.capture();

      if (rename) {
        const local = await personalRecords(
          source(
            { ...remoteProject, title: projectTitle },
            { ...remoteTag, title: tagTitle },
          ),
          'device',
        );
        const expected = Object.values(local.records).filter((record) => {
          const path = (record.value as { path: string[] }).path.join('/');
          return path === 'project/entities/project' || path === 'tag/entities/tag';
        });
        expect(expected.length).toBe(2);
        expect(client.edit).toHaveBeenCalledOnceWith('personal', expected);
      } else {
        expect(client.edit).not.toHaveBeenCalled();
      }
    });
  }
  it('captures an ordinary tag rename when task references are unchanged', async () => {
    const tag = { id: 'tag', title: 'Tag', taskIds: [] };
    const source = (tagValue: typeof tag): Record<string, unknown> => ({
      tag: { ids: ['tag'], entities: { tag: tagValue } },
      task: { ids: [], entities: {}, currentTaskId: null, selectedTaskId: null },
      globalConfig: { sync: { isEnabled: false, syncProvider: null } },
    });
    const original = await personalRecords(source(tag), 'device');
    await baseline(original);
    const heads: Record<string, PlainHead> = Object.fromEntries(
      Object.values(original.records).map((record) => [
        record.entityId,
        { ...record, revision: 1, deleted: false },
      ]),
    );
    spyOn(client, 'records').and.returnValue(heads);
    expect(await service.bind(client)).toBeTrue();

    const updated = source({ ...tag, title: 'Renamed tag' });
    snapshot.and.resolveTo(updated);
    await service.capture();

    const expected = await personalRecords(updated, 'device');
    const tagRecords = Object.values(expected.records).filter(
      (record) =>
        (record.value as { path: string[] }).path.join('/') === 'tag/entities/tag',
    );
    expect(tagRecords.length).toBe(1);
    expect(client.edit).toHaveBeenCalledOnceWith('personal', tagRecords);
  });
  for (const duringTransfer of [0, 60_000, -120_000]) {
    it(`keeps folded archive time after a ${duringTransfer / 60_000} minute adjustment during transfer`, async () => {
      const minute = 60_000;
      const day = '2026-11-18';
      const beforeTransfer = 17 * minute;
      const expectedTotal = beforeTransfer + duringTransfer;
      type TaskState = {
        ids: string[];
        entities: Record<
          string,
          { id: string; timeSpent: number; timeSpentOnDay: Record<string, number> }
        >;
      };
      const taskState = (elapsed?: number): TaskState => ({
        ids: elapsed === undefined ? [] : ['one'],
        entities:
          elapsed === undefined
            ? {}
            : {
                one: {
                  id: 'one',
                  timeSpent: elapsed,
                  timeSpentOnDay: { [day]: elapsed },
                },
              },
      });
      const source = (active?: number, archived?: number): Record<string, unknown> => ({
        task: { ...taskState(active), currentTaskId: null, selectedTaskId: null },
        archiveYoung: { task: taskState(archived) },
        globalConfig: { sync: { isEnabled: false, syncProvider: null } },
      });
      const initial = await personalRecords(source(10 * minute), 'device');
      const active = await personalRecords(source(15 * minute), 'device', initial);
      const heads = (records: Record<string, RecordChange>): Record<string, PlainHead> =>
        Object.fromEntries(
          Object.values(records).map((record) => [
            record.entityId,
            { ...record, revision: 1, deleted: false },
          ]),
        );
      let projection = heads(active.records);
      spyOn(client, 'records').and.callFake(() => projection);
      (client.edit as jasmine.Spy).and.callFake(
        async (_scopeId: string, changes: RecordChange[]) => {
          const incoming = Object.fromEntries(
            changes.map((record) => [record.entityId, record]),
          );
          projection = { ...projection, ...heads(incoming) };
        },
      );
      await baseline(active);
      await service.bind(client);
      snapshot.and.resolveTo(source(beforeTransfer));
      await service.capture();

      const changes = (client.edit as jasmine.Spy).calls.mostRecent()
        .args[1] as RecordChange[];
      const pending = changes.find((change) => change.entityType === 'personal.time')!;
      expect(pending.value).toEqual(jasmine.objectContaining({ positive: 7 * minute }));

      // The older archiver folded the first five minutes into the archived baseline.
      // The SDK acknowledged only the timer's two minutes beyond that baseline.
      const folded = await personalRecords(source(undefined, 15 * minute), 'archiver');
      projection = {
        ...heads(folded.records),
        [pending.entityId]: {
          entityId: pending.entityId,
          entityType: 'personal.time',
          deleted: false,
          revision: 3,
          value: {
            path: ['archiveYoung', 'task', 'entities', 'one', 'timeSpentOnDay', day],
            deviceId: 'device',
            positive: 2 * minute,
            negative: 0,
            foldedTime: {
              path: ['task', 'entities', 'one', 'timeSpentOnDay', day],
              elapsed: 5 * minute,
            },
          },
        },
      };

      // Reloading between upload and apply leaves the old local baseline on disk.
      await service.bind(client);
      snapshot.and.resolveTo(source(expectedTotal));
      await service.apply();

      const archived = (
        applied!['archiveYoung'] as { task: ReturnType<typeof taskState> }
      ).task.entities.one!;
      expect(archived.timeSpent).toBe(expectedTotal);
      expect(archived.timeSpentOnDay).toEqual({ [day]: expectedTotal });
      expect(client.edit).toHaveBeenCalledTimes(duringTransfer ? 2 : 1);
    });
  }
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
  for (const mode of [
    'late edit',
    'reload',
    'apply retry',
    'resolved overlap',
    'resolved overlap after reload',
    'server generation change',
  ] as const) {
    it(`preserves a remote completion during ${mode}`, async () => {
      type TestTask = { id: string; title: string; isDone: boolean };
      const make = (title: string, isDone: boolean): Record<string, unknown> => ({
        globalConfig: { sync: { isEnabled: false } },
        task: {
          ids: ['one'],
          entities: { one: { id: 'one', title, isDone } },
          currentTaskId: null,
          selectedTaskId: null,
        },
      });
      const asHeads = (records: PersonalBaseline['records']): Record<string, PlainHead> =>
        Object.fromEntries(
          Object.values(records).map((record) => [
            record.entityId,
            { ...record, revision: 1, deleted: false },
          ]),
        );
      const initial = await personalRecords(make('original', false), 'device');
      await baseline(initial);
      let heads = asHeads(initial.records);
      spyOn(client, 'records').and.callFake(() => heads);
      (client.edit as jasmine.Spy).and.callFake(
        async (_scopeId: string, changes: RecordChange[]) => {
          heads = {
            ...heads,
            ...asHeads(Object.fromEntries(changes.map((r) => [r.entityId, r]))),
          };
        },
      );
      await service.bind(client);
      snapshot.and.resolveTo(make('first rename', false));
      await service.capture();
      const overlap = mode.startsWith('resolved overlap');
      heads = asHeads(
        (
          await personalRecords(
            make(overlap ? 'committed rename' : 'first rename', true),
            'device',
          )
        ).records,
      );

      if (mode === 'server generation change')
        client.state.scopes['personal'].info.generation++;
      if (mode.endsWith('reload')) await service.bind(client);
      if (mode === 'apply retry') {
        failApply = 'before commit';
        await expectAsync(service.apply()).toBeRejectedWithError(
          'simulated durable apply failure',
        );
        failApply = undefined;
      }

      if (!overlap) snapshot.and.resolveTo(make('late rename', false));
      await service.apply();

      const readTask = (value: Record<string, unknown>): TestTask =>
        (value['task'] as { entities: Record<string, TestTask> }).entities['one'];
      expect(readTask(applied!)).toEqual({
        id: 'one',
        title: overlap ? 'committed rename' : 'late rename',
        isDone: true,
      });
      const expectedEdits = overlap ? 1 : 2;
      expect(client.edit).toHaveBeenCalledTimes(expectedEdits);

      // The newly hydrated source now reflects the merged document; a new pass is a no-op.
      snapshot.and.resolveTo(applied);
      await service.bind(client);
      await service.capture();
      expect(client.edit).toHaveBeenCalledTimes(expectedEdits);
    });
  }
  it('cannot checkpoint a volatile SDK intent after a partially failed capture batch', async () => {
    await baseline();
    await service.bind(client);
    const tasks = Array.from({ length: 105 }, (_value, n) => ({ id: String(n) }));
    snapshot.and.resolveTo({
      globalConfig: { sync: { isEnabled: false } },
      task: {
        ids: tasks.map(({ id }) => id),
        entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
      },
    });
    const edits = client.edit as jasmine.Spy;
    const volatile: Record<string, PlainHead> = {};
    spyOn(client, 'records').and.returnValue(volatile);
    edits.and.callFake(async (_scopeId: string, changes: RecordChange[]) => {
      for (const change of changes)
        volatile[change.entityId] = { ...change, revision: 1, deleted: false };
      if (edits.calls.count() === 2) throw new Error('failed to persist SDK queue');
    });
    await expectAsync(service.capture()).toBeRejectedWithError(
      'failed to persist SDK queue',
    );
    expect(edits.calls.first().args[1].length).toBe(100);
    expect(captureCheckpoint).toBeUndefined();
    // Even if a previous SDK edit is visible through records(), it might be absent on disk.
    await expectAsync(service.capture()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_CAPTURE_RELOAD',
    );
    expect(edits).toHaveBeenCalledTimes(2);
    expect(captureCheckpoint).toBeUndefined();
  });

  it('blocks a retry in the same renderer if durable apply committed before an error', async () => {
    await baseline();
    await service.bind(client);
    failApply = 'after commit';
    await expectAsync(service.apply()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_CAPTURE_RELOAD',
    );
    failApply = undefined;
    await service.bind(client);
    await expectAsync(service.capture()).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_CAPTURE_RELOAD',
    );
    expect(applied).toBeUndefined();
  });
});
