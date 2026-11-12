import {
  DEFAULT_TASK,
  Task,
  TaskWithSubTasks,
} from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { peekLastDeletePayload } from '../../../../root-store/meta/undo-task-delete.meta-reducer';
import { toRestorePayload } from '../../../../features/tasks/task-delete-undo';
import { TAG_FEATURE_NAME } from '../../../../features/tag/store/tag.reducer';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-delete-queue-task';
const PROJECT_ID = 'INBOX_PROJECT';

interface Snapshot {
  task: Task | undefined;
  projectTaskIds: string[];
  todayTaskIds: string[];
}

/**
 * The actions the history dispatches for deleting a task, undoing it and redoing
 * it: the delete, `restoreDeletedTask` from the payload captured by the delete,
 * and a second delete.
 */
describe('deleting a task, undo and redo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let today: string;

  const readSnapshot = async (): Promise<Snapshot> => {
    const state = await harness.state();
    const tasks = (state['tasks'] as { entities: Record<string, Task | undefined> })
      .entities;
    return {
      task: tasks[TASK_ID],
      projectTaskIds: (
        state['projects'] as { entities: Record<string, { taskIds: string[] }> }
      ).entities[PROJECT_ID].taskIds,
      todayTaskIds: (
        state[TAG_FEATURE_NAME] as { entities: Record<string, { taskIds: string[] }> }
      ).entities['TODAY'].taskIds,
    };
  };
  const snapshotOf = (device: FuzzDevice): Promise<Snapshot> =>
    harness.as(device, readSnapshot);
  const current = async (): Promise<TaskWithSubTasks> => {
    const task = (await readSnapshot()).task as Task;
    return { ...task, subTasks: [] };
  };

  let payload: ReturnType<typeof toRestorePayload>;
  const deleteTask = (device: FuzzDevice): Promise<void> =>
    harness.as(device, async () => {
      await harness.dispatch(TaskSharedActions.deleteTask({ task: await current() }));
      payload = toRestorePayload(peekLastDeletePayload()!);
    });
  const restore = (device: FuzzDevice): Promise<void> =>
    harness.as(device, () =>
      harness.dispatch(TaskSharedActions.restoreDeletedTask(payload)),
    );
  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes },
        isIgnoreShortSyntax: true,
      }),
    );
  const syncRounds = async (order: FuzzDevice[]): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      for (const device of order) expect(await harness.sync(device)).toBeTrue();
    }
  };

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    await harness.as(a, async () => {
      today = ((await harness.state())['appState'] as { todayStr: string }).todayStr;
      await harness.dispatch(
        TaskSharedActions.addTask({
          task: {
            ...DEFAULT_TASK,
            id: TASK_ID,
            title: 'Original',
            projectId: PROJECT_ID,
            created: Date.now(),
          },
          workContextId: PROJECT_ID,
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );
      await harness.dispatch(
        TaskSharedActions.planTasksForToday({
          taskIds: [TASK_ID],
          today,
          startOfNextDayDiffMs: 0,
          parentTaskMap: { [TASK_ID]: undefined },
        }),
      );
    });
    expect(await harness.sync(a)).toBeTrue();
    expect(await harness.sync(b)).toBeTrue();
  }, 60_000);
  afterEach(() => SyncFuzzHarness.dispose());

  const expectPresent = (snapshot: Snapshot, label: string): void => {
    expect(snapshot.task).withContext(`${label} task`).toBeDefined();
    expect(snapshot.projectTaskIds.filter((id) => id === TASK_ID))
      .withContext(`${label} project list`)
      .toEqual([TASK_ID]);
    expect(snapshot.todayTaskIds.filter((id) => id === TASK_ID))
      .withContext(`${label} Today list`)
      .toEqual([TASK_ID]);
  };
  const expectAbsent = (snapshot: Snapshot, label: string): void => {
    expect(snapshot.task).withContext(`${label} task`).toBeUndefined();
    expect(snapshot.projectTaskIds)
      .withContext(`${label} project list`)
      .not.toContain(TASK_ID);
    expect(snapshot.todayTaskIds)
      .withContext(`${label} Today list`)
      .not.toContain(TASK_ID);
  };

  it('restores locally with the project and Today lists following the task', async () => {
    harness.tick();
    await deleteTask(a);
    expectAbsent(await snapshotOf(a), 'deleted');
    await restore(a);
    expectPresent(await snapshotOf(a), 'restored');
    await deleteTask(a);
    expectAbsent(await snapshotOf(a), 'deleted again');
  }, 60_000);

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const editNewer of [false, true]) {
      it(`keeps a concurrent ${editNewer ? 'newer' : 'older'} title edit beside delete/undo when ${uploadFirst} uploads first`, async () => {
        const schedule = async (): Promise<void> => {
          await deleteTask(a);
          await restore(a);
        };
        const edit = (): Promise<void> =>
          harness.as(b, () => update({ title: 'Edited on B' }));
        harness.tick();
        if (editNewer) {
          await schedule();
          harness.tick();
          await edit();
        } else {
          await edit();
          harness.tick();
          await schedule();
        }
        await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

        for (const device of [a, b]) {
          const snapshot = await snapshotOf(device);
          expectPresent(snapshot, device.name);
          expect(snapshot.task?.title).withContext(device.name).toBe('Edited on B');
        }
        await harness.restart(a);
        expectPresent(await snapshotOf(a), 'after restart');
      }, 60_000);

      it(`settles delete/undo/redo against a concurrent ${editNewer ? 'newer' : 'older'} title edit when ${uploadFirst} uploads first`, async () => {
        const schedule = async (): Promise<void> => {
          await deleteTask(a);
          await restore(a);
          await deleteTask(a);
        };
        const edit = (): Promise<void> =>
          harness.as(b, () => update({ title: 'Edited on B' }));
        harness.tick();
        if (editNewer) {
          await schedule();
          harness.tick();
          await edit();
        } else {
          await edit();
          harness.tick();
          await schedule();
        }
        await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

        for (const device of [a, b]) {
          const snapshot = await snapshotOf(device);
          if (editNewer) {
            expectPresent(snapshot, device.name);
            expect(snapshot.task?.title).withContext(device.name).toBe('Edited on B');
          } else {
            expectAbsent(snapshot, device.name);
          }
        }
        await harness.restart(a);
        const restarted = await snapshotOf(a);
        if (editNewer) expectPresent(restarted, 'A after restart');
        else expectAbsent(restarted, 'A after restart');
      }, 60_000);
    }

    it(`keeps a concurrent completion beside delete/undo (${uploadFirst} uploads first)`, async () => {
      harness.tick();
      await deleteTask(a);
      await restore(a);
      harness.tick();
      await harness.as(b, () => update({ isDone: true }));
      await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

      for (const device of [a, b]) {
        const snapshot = await snapshotOf(device);
        expectPresent(snapshot, device.name);
        expect(snapshot.task?.isDone).withContext(device.name).toBeTrue();
      }
    }, 60_000);
  }

  // A delete older than a concurrent edit of the same task loses to it, whether
  // the delete is typed directly or is the redo that ends the history.
  for (const uploadFirst of ['A', 'B'] as const) {
    it(`a plain delete loses to a newer concurrent edit (${uploadFirst} uploads first)`, async () => {
      harness.tick();
      await deleteTask(a);
      harness.tick();
      await harness.as(b, () => update({ title: 'Edited on B' }));
      await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

      for (const device of [a, b]) {
        const snapshot = await snapshotOf(device);
        expectPresent(snapshot, device.name);
        expect(snapshot.task?.title).withContext(device.name).toBe('Edited on B');
      }
    }, 60_000);
  }

  it('keeps the latest of two concurrent edits across delete/undo with three clients', async () => {
    const c = await harness.addDevice('C');
    expect(await harness.sync(c)).toBeTrue();
    harness.tick();
    await harness.as(b, () => update({ title: 'First concurrent edit' }));
    harness.tick();
    await harness.as(c, () => update({ title: 'Later concurrent edit' }));
    harness.tick();
    await deleteTask(a);
    await restore(a);
    for (let round = 0; round < 3; round++) {
      for (const device of [a, b, c]) expect(await harness.sync(device)).toBeTrue();
    }
    for (const device of [a, b, c]) {
      const snapshot = await snapshotOf(device);
      expectPresent(snapshot, device.name);
      expect(snapshot.task?.title).withContext(device.name).toBe('Later concurrent edit');
    }
  }, 60_000);
});
