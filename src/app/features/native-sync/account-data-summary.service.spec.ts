import { TestBed } from '@angular/core/testing';
import {
  AccountDataSummaryService,
  summarizeAccountData,
} from './account-data-summary.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { SyncLocalStateService } from '../../op-log/sync/sync-local-state.service';
import {
  ActionType,
  OpType,
  type OperationLogEntry,
} from '../../op-log/core/operation.types';
import { DEFAULT_SIMPLE_COUNTERS } from '../simple-counter/simple-counter.const';
import { DEFAULT_BOARDS } from '../boards/boards.const';
import { SYSTEM_TAG_IDS } from '../tag/tag.const';

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

  it('does not let a remote operation vouch for a task: only local pending ops are read', async () => {
    snapshots.getStateSnapshotAsync.and.resolveTo({
      ...freshState(),
      task: entities(['imported']),
    } as never);
    const remote = exampleOp('imported');
    (remote as { source: string }).source = 'remote';
    // getUnsynced never returns remote ops; a synced one is simply not in its result.
    opStore.getUnsynced.and.resolveTo([]);
    expect((await service.local()).hasUserData).toBeTrue();
    void remote;
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
