import {
  DEFAULT_TASK,
  Task,
  TaskWithSubTasks,
} from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-delete-task';

describe('existing delete and restore operations against concurrent edits', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let original: Task;

  const taskOn = (device: FuzzDevice): Promise<Task | undefined> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task | undefined> }).entities[
        TASK_ID
      ];
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    original = {
      ...DEFAULT_TASK,
      id: TASK_ID,
      title: 'Original',
      projectId: 'INBOX_PROJECT',
      created: Date.now(),
    };
    await harness.as(a, () =>
      harness.dispatch(
        TaskSharedActions.addTask({
          task: original,
          workContextId: 'INBOX_PROJECT',
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      ),
    );
    expect(await harness.sync(a)).toBeTrue();
    expect(await harness.sync(b)).toBeTrue();
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  for (const restoreKind of ['trash', 'snackbar'] as const) {
    for (const uploadFirst of ['A', 'B'] as const) {
      for (const editNewer of [false, true]) {
        it(`${restoreKind} restore ${editNewer ? 'preserves' : 'currently loses'} a concurrent ${editNewer ? 'newer' : 'older'} title when ${uploadFirst} uploads first`, async () => {
          const edit = (): Promise<void> =>
            harness.as(b, () =>
              harness.dispatch(
                TaskSharedActions.updateTask({
                  task: { id: TASK_ID, changes: { title: 'Edited on B' } },
                }),
              ),
            );
          const deleteAndRestore = (): Promise<void> =>
            harness.as(a, async () => {
              const task = { ...original, subTasks: [] } as TaskWithSubTasks;
              await harness.dispatch(TaskSharedActions.deleteTask({ task }));
              if (restoreKind === 'trash') {
                await harness.dispatch(
                  TaskSharedActions.restoreTask({ task, subTasks: [] }),
                );
              } else {
                await harness.dispatch(
                  TaskSharedActions.restoreDeletedTask({
                    task,
                    projectContext: {
                      projectId: 'INBOX_PROJECT',
                      taskIdsForProject: [TASK_ID],
                      taskIdsForProjectBacklog: [],
                    },
                    tagTaskIdMap: {},
                    deletedTaskEntities: { [TASK_ID]: task },
                  }),
                );
              }
            });
          harness.tick();
          if (editNewer) {
            await deleteAndRestore();
            harness.tick();
            await edit();
          } else {
            await edit();
            harness.tick();
            await deleteAndRestore();
          }

          const order = uploadFirst === 'A' ? [a, b] : [b, a];
          for (let round = 0; round < 2; round++) {
            for (const device of order) expect(await harness.sync(device)).toBeTrue();
          }
          // The old restore snapshot currently overwrites an unseen older edit.
          // Pin the limitation until restore can preserve original field clocks;
          // deletion must not be added to history while this control passes.
          const expectedTitle = editNewer ? 'Edited on B' : 'Original';
          expect((await taskOn(a))?.title).toBe(expectedTitle);
          expect((await taskOn(b))?.title).toBe(expectedTitle);
          await harness.restart(a);
          expect((await taskOn(a))?.title).toBe(expectedTitle);
        }, 60_000);
      }
    }
  }

  it('exposes the same loss with a third client editing after the first edit', async () => {
    const c = await harness.addDevice('C');
    expect(await harness.sync(c)).toBeTrue();
    harness.tick();
    await harness.as(b, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({
          task: { id: TASK_ID, changes: { title: 'First concurrent edit' } },
        }),
      ),
    );
    harness.tick();
    await harness.as(c, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({
          task: { id: TASK_ID, changes: { title: 'Later concurrent edit' } },
        }),
      ),
    );
    harness.tick();
    await harness.as(a, async () => {
      const task = { ...original, subTasks: [] } as TaskWithSubTasks;
      await harness.dispatch(TaskSharedActions.deleteTask({ task }));
      await harness.dispatch(TaskSharedActions.restoreTask({ task, subTasks: [] }));
    });
    for (let round = 0; round < 3; round++) {
      for (const device of [a, b, c]) expect(await harness.sync(device)).toBeTrue();
    }
    // The restore's snapshot is newer than both edits. A fix that merely
    // rewrites the first edit into a snapshot at restore time would similarly
    // defeat the later concurrent edit rather than preserving its timestamp.
    for (const device of [a, b, c])
      expect((await taskOn(device))?.title).toBe('Original');
  }, 60_000);
});
