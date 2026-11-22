import { TestBed } from '@angular/core/testing';
import {
  AccountDataSummaryService,
  summarizeAccountData,
  hasNativeRecoveryData,
} from './account-data-summary.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { SyncLocalStateService } from '../../op-log/sync/sync-local-state.service';
import {
  ActionType,
  OpType,
  type Operation,
  type OperationLogEntry,
} from '../../op-log/core/operation.types';
import { DEFAULT_SIMPLE_COUNTERS } from '../simple-counter/simple-counter.const';
import { DEFAULT_BOARDS } from '../boards/boards.const';
import { SYSTEM_TAG_IDS } from '../tag/tag.const';
import { personalRecords, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import { MODEL_CONFIGS } from '../../op-log/model/model-config';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  type ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { uuidv7 } from '../../util/uuid-v7';

const trackedDay = '2026-11-17';
const entities = (
  ids: string[],
): { ids: string[]; entities: Record<string, object> } => ({
  ids,
  entities: Object.fromEntries(ids.map((id) => [id, { id }])),
});

/** What a brand-new install holds: nothing of the person's own. */
const freshState = (): Record<string, unknown> => ({
  task: entities([]),
  project: entities(['INBOX_PROJECT']),
  tag: entities([...SYSTEM_TAG_IDS]),
  note: entities([]),
  taskRepeatCfg: entities([]),
  issueProvider: entities([]),
  metric: entities([]),
  simpleCounter: {
    ids: DEFAULT_SIMPLE_COUNTERS.map((counter) => counter.id),
    entities: Object.fromEntries(
      DEFAULT_SIMPLE_COUNTERS.map((counter) => [counter.id, { ...counter }]),
    ),
  },
  boards: { boardCfgs: DEFAULT_BOARDS },
  section: entities([]),
  menuTree: { projectTree: [], tagTree: [] },
  pluginMetadata: [],
  reminders: [],
  globalConfig: MODEL_CONFIGS.globalConfig.defaultData,
  timeTracking: { project: {}, tag: {} },
  pluginUserData: [],
  archiveYoung: { task: entities([]), timeTracking: { project: {}, tag: {} } },
  archiveOld: { task: entities([]), timeTracking: { project: {}, tag: {} } },
});

const exampleOp = (taskId: string): OperationLogEntry =>
  ({
    seq: 1,
    op: {
      id: 'op-' + taskId,
      clientId: 'client',
      actionType: ActionType.TASK_SHARED_ADD,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: taskId,
      payload: {
        actionPayload: { task: { id: taskId }, isExampleTask: true },
        entityChanges: [],
      },
      vectorClock: { client: 1 },
      timestamp: 1,
      schemaVersion: 1,
    },
    appliedAt: 1,
    source: 'local',
  }) as unknown as OperationLogEntry;

describe('summarizeAccountData', () => {
  it('reads a brand-new install as holding nothing of its own', () => {
    expect(summarizeAccountData(freshState())).toEqual({
      tasks: 0,
      projects: 0,
      notes: 0,
      archived: 0,
      hasUserData: false,
    });
  });

  it('does not count the first-run example task, and counts everything else', () => {
    const state = { ...freshState(), task: entities(['example']) };
    expect(summarizeAccountData(state, new Set(['example']))).toEqual(
      jasmine.objectContaining({ tasks: 0, hasUserData: false }),
    );
    // The same task without the example marker is the person's work.
    expect(summarizeAccountData(state)).toEqual(
      jasmine.objectContaining({ tasks: 1, hasUserData: true }),
    );
  });

  it('keeps a subtask added to the example task: that is real work', () => {
    const state = { ...freshState(), task: entities(['example', 'sub']) };
    expect(summarizeAccountData(state, new Set(['example']))).toEqual(
      jasmine.objectContaining({ tasks: 1, hasUserData: true }),
    );
  });

  it('counts projects (not the Inbox), notes, archived tasks and their time', () => {
    const state = {
      ...freshState(),
      project: entities(['INBOX_PROJECT', 'mine']),
      note: entities(['n1', 'n2']),
      archiveYoung: { task: entities(['a1']), timeTracking: { project: {}, tag: {} } },
      archiveOld: {
        task: entities(['a2', 'a3']),
        timeTracking: { project: {}, tag: {} },
      },
    };
    expect(summarizeAccountData(state)).toEqual({
      tasks: 0,
      projects: 1,
      notes: 2,
      archived: 3,
      hasUserData: true,
    });
  });

  it('treats work that exists only in the archive as real data', () => {
    const state = {
      ...freshState(),
      archiveOld: {
        task: entities(['done long ago']),
        timeTracking: { project: {}, tag: {} },
      },
    };
    expect(summarizeAccountData(state).hasUserData).toBeTrue();
  });

  it('counts tags, recurring configs, tracked time, issue providers and plugin data', () => {
    const withTag = { ...freshState(), tag: entities([...SYSTEM_TAG_IDS, 'my-tag']) };
    const withRepeat = { ...freshState(), taskRepeatCfg: entities(['repeat']) };
    const withTime = {
      ...freshState(),
      timeTracking: {
        project: { INBOX_PROJECT: { [trackedDay]: { s: 1, e: 2 } } },
        tag: {},
      },
    };
    const withProvider = { ...freshState(), issueProvider: entities(['provider']) };
    const withPlugin = { ...freshState(), pluginUserData: [{ id: 'p', data: 'x' }] };
    for (const state of [withTag, withRepeat, withTime, withProvider, withPlugin])
      expect(summarizeAccountData(state).hasUserData).toBeTrue();
  });

  it('counts a customised counter or a board of their own, but not the shipped ones', () => {
    const counter = { ...DEFAULT_SIMPLE_COUNTERS[0] };
    const touched = {
      ...freshState(),
      simpleCounter: {
        ids: [counter.id],
        entities: { [counter.id]: { ...counter, title: 'something else' } },
      },
    };
    expect(summarizeAccountData(touched).hasUserData).toBeTrue();
    const board = {
      ...freshState(),
      boards: { boardCfgs: [...DEFAULT_BOARDS, { id: 'mine' }] },
    };
    expect(summarizeAccountData(board).hasUserData).toBeTrue();
  });

  describe('the arrangements a download would erase', () => {
    const shippedBoards = (): typeof DEFAULT_BOARDS =>
      JSON.parse(JSON.stringify(DEFAULT_BOARDS));
    const cases: Record<string, Record<string, unknown>> = {
      section: { section: entities(['s1']) },
      projectFolder: {
        menuTree: {
          projectTree: [{ id: 'f', k: 'f', name: 'Work', children: [] }],
          tagTree: [],
        },
      },
      nestedTagFolder: {
        menuTree: {
          projectTree: [],
          tagTree: [
            {
              id: 'outer',
              k: 'f',
              name: 'Outer',
              children: [{ id: 'inner', k: 'f', name: 'Inner', children: [] }],
            },
          ],
        },
      },
      editedBoard: {
        boards: {
          boardCfgs: shippedBoards().map((board, i) =>
            i === 0 ? { ...board, title: 'My board' } : board,
          ),
        },
      },
      removedBoard: { boards: { boardCfgs: shippedBoards().slice(1) } },
      pluginSettings: { pluginMetadata: [{ id: 'my-plugin', isEnabled: true }] },
      reminders: { reminders: [{ id: 'r', remindAt: 1 }] },
    };

    it('counts each of them as real data on the device', () => {
      for (const [name, patch] of Object.entries(cases))
        expect(summarizeAccountData({ ...freshState(), ...patch }).hasUserData)
          .withContext(name)
          .toBeTrue();
    });

    it('counts each of them as real data in the account too', () => {
      for (const [name, patch] of Object.entries(cases))
        expect(
          summarizeAccountData({ ...freshState(), ...patch }, new Set(), {
            settings: true,
          }).hasUserData,
        )
          .withContext(name)
          .toBeTrue();
    });

    it('does not mistake what is only shipped, or only a project or tag in the menu, for them', () => {
      const plain = {
        ...freshState(),
        menuTree: {
          projectTree: [{ id: 'INBOX_PROJECT', k: 'p' }],
          tagTree: [{ id: 'my-tag', k: 't' }],
        },
        // A saved copy reads back without its `undefined` members.
        boards: { boardCfgs: shippedBoards() },
        globalConfig: JSON.parse(JSON.stringify(MODEL_CONFIGS.globalConfig.defaultData)),
      };
      expect(summarizeAccountData(plain).hasUserData).toBeFalse();
      expect(
        summarizeAccountData(plain, new Set(), { settings: true }).hasUserData,
      ).toBeFalse();
    });

    it('protects the exact non-task work the first connection could overwrite', () => {
      const pristine = { globalConfig: MODEL_CONFIGS.globalConfig.defaultData };
      expect(hasNativeRecoveryData(pristine)).toBeFalse();
      for (const extra of [
        { globalConfig: { ...pristine.globalConfig, customised: true } },
        { section: { ids: ['section'] } },
        { boards: { boardCfgs: [] } },
        { timeTracking: { project: { p1: { ['2026-11-22']: { b: 100 } } } } },
      ]) {
        expect(hasNativeRecoveryData({ ...pristine, ...extra })).toBeTrue();
      }
    });

    it('counts settings for the account only: a device with nothing else is still pristine', () => {
      const customised = {
        ...freshState(),
        globalConfig: { ...MODEL_CONFIGS.globalConfig.defaultData, customised: true },
      };
      expect(summarizeAccountData(customised).hasUserData).toBeFalse();
      expect(summarizeAccountData(customised, new Set(), { settings: true })).toEqual(
        jasmine.objectContaining({ hasUserData: true, tasks: 0 }),
      );
    });
  });

  it('never throws on partial or foreign data', () => {
    expect(summarizeAccountData(undefined).hasUserData).toBeFalse();
    expect(summarizeAccountData({ task: 'nope', project: 3 }).hasUserData).toBeFalse();
    expect(summarizeAccountData(null, new Set(['x'])).tasks).toBe(0);
  });
});

describe('AccountDataSummaryService', () => {
  let snapshots: jasmine.SpyObj<StateSnapshotService>;
  let opStore: jasmine.SpyObj<OperationLogStoreService>;
  let localState: jasmine.SpyObj<SyncLocalStateService>;
  let service: AccountDataSummaryService;

  beforeEach(() => {
    snapshots = jasmine.createSpyObj('StateSnapshotService', ['getStateSnapshotAsync']);
    opStore = jasmine.createSpyObj('OperationLogStoreService', ['getUnsynced']);
    localState = jasmine.createSpyObj('SyncLocalStateService', [
      'hasMeaningfulStoreData',
    ]);
    snapshots.getStateSnapshotAsync.and.resolveTo(freshState() as never);
    opStore.getUnsynced.and.resolveTo([]);
    localState.hasMeaningfulStoreData.and.resolveTo(false);
    TestBed.configureTestingModule({
      providers: [
        AccountDataSummaryService,
        { provide: StateSnapshotService, useValue: snapshots },
        { provide: OperationLogStoreService, useValue: opStore },
        { provide: SyncLocalStateService, useValue: localState },
      ],
    });
    service = TestBed.inject(AccountDataSummaryService);
  });

  it('calls a device with only the first-run example task pristine', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['example']),
    } as never);
    opStore.getUnsynced.and.resolveTo([exampleOp('example')]);
    expect(await service.local()).toEqual(
      jasmine.objectContaining({ tasks: 0, hasUserData: false }),
    );
    expect(localState.hasMeaningfulStoreData).toHaveBeenCalledWith(new Set(['example']));
  });

  describe('the account side, read from the records the account holds', () => {
    const clientHolding = async (state: Record<string, unknown>): Promise<SyncClient> => {
      const baseline = await personalRecords(state, 'device');
      const heads = Object.fromEntries(
        Object.values(baseline.records).map((record) => [
          record.entityId,
          { ...record, revision: 1, deleted: false },
        ]),
      );
      return { records: () => heads } as unknown as SyncClient;
    };

    it('reads an empty account as empty', async () => {
      expect(
        service.fromRecords(await clientHolding(freshState()), 'personal').hasUserData,
      ).toBeFalse();
    });

    it('never reads an account holding only a section, a folder, an edited board, plugin settings, reminders or customised settings as empty', async () => {
      const arrangements: Record<string, Record<string, unknown>> = {
        section: { section: entities(['s1']) },
        folder: {
          menuTree: {
            projectTree: [{ id: 'f', k: 'f', name: 'Work', children: [] }],
            tagTree: [],
          },
        },
        editedBoard: {
          boards: {
            boardCfgs: DEFAULT_BOARDS.map((board, i) =>
              i === 0 ? { ...board, title: 'My board' } : board,
            ),
          },
        },
        pluginSettings: { pluginMetadata: [{ id: 'my-plugin', isEnabled: true }] },
        reminders: { reminders: [{ id: 'r', remindAt: 1 }] },
        settings: {
          globalConfig: { ...MODEL_CONFIGS.globalConfig.defaultData, customised: true },
        },
      };
      for (const [name, patch] of Object.entries(arrangements))
        expect(
          service.fromRecords(
            await clientHolding({ ...freshState(), ...patch }),
            'personal',
          ).hasUserData,
        )
          .withContext(name)
          .toBeTrue();
    });
  });

  it('is never less careful than the fresh-client gate of the file providers', async () => {
    localState.hasMeaningfulStoreData.and.resolveTo(true);
    expect((await service.local()).hasUserData).toBeTrue();
  });

  it('fails closed: an unreadable snapshot is "has data", so nothing is replaced silently', async () => {
    snapshots.getStateSnapshotAsync.and.rejectWith(new Error('IndexedDB closed'));
    expect((await service.local()).hasUserData).toBeTrue();
  });
});

describe('AccountDataSummaryService with the real operation log', () => {
  const clientIds: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
    clearCache: () => undefined,
  };
  let store: OperationLogStoreService;
  let snapshots: jasmine.SpyObj<StateSnapshotService>;
  let service: AccountDataSummaryService;

  const taskOp = (
    taskId: string,
    over: Partial<Operation> = {},
    isExample = false,
  ): Operation =>
    ({
      id: uuidv7(),
      clientId: 'testClient',
      actionType: ActionType.TASK_SHARED_ADD,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: taskId,
      payload: {
        actionPayload: {
          task: { id: taskId },
          ...(isExample ? { isExampleTask: true } : {}),
        },
        entityChanges: [],
      },
      vectorClock: { testClient: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      ...over,
    }) as Operation;
  const renamed = (taskId: string): Operation =>
    taskOp(taskId, {
      actionType: '[Task Shared] Update Task' as ActionType,
      opType: OpType.Update,
      payload: { actionPayload: { task: { id: taskId, changes: { title: 'Mine' } } } },
    });

  beforeEach(async () => {
    snapshots = jasmine.createSpyObj('StateSnapshotService', ['getStateSnapshotAsync']);
    TestBed.configureTestingModule({
      providers: [
        AccountDataSummaryService,
        OperationLogStoreService,
        VectorClockService,
        { provide: CLIENT_ID_PROVIDER, useValue: clientIds },
        { provide: StateSnapshotService, useValue: snapshots },
        {
          provide: SyncLocalStateService,
          useValue: { hasMeaningfulStoreData: () => Promise.resolve(false) },
        },
      ],
    });
    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
    service = TestBed.inject(AccountDataSummaryService);
  });
  afterEach(async () => store._clearAllDataForTesting());

  it('calls a device holding only the example task its create op names pristine', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['example']),
    } as never);
    await store.append(taskOp('example', {}, true), 'local');
    expect(await service.local()).toEqual(
      jasmine.objectContaining({ tasks: 0, hasUserData: false }),
    );
  });

  it('does not let a remote operation vouch for a task: only local pending ops are read', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['imported']),
    } as never);
    // The same marker, but it arrived from the account: it must never exempt the task.
    await store.append(taskOp('imported', {}, true), 'remote');
    expect(await service.local()).toEqual(
      jasmine.objectContaining({ tasks: 1, hasUserData: true }),
    );
  });

  it('stops exempting the example task once the person edits it: it is their work now', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['example']),
    } as never);
    await store.append(taskOp('example', {}, true), 'local');
    await store.append(renamed('example'), 'local');
    expect(await service.local()).toEqual(
      jasmine.objectContaining({ tasks: 1, hasUserData: true }),
    );
  });

  it('keeps exempting an example task when other tasks are edited', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['example']),
    } as never);
    await store.append(taskOp('example', {}, true), 'local');
    await store.append(renamed('someone-elses-entity'), 'local');
    expect((await service.local()).hasUserData).toBeFalse();
  });
});
