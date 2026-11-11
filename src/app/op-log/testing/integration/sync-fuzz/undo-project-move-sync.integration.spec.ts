import { DEFAULT_PROJECT } from '../../../../features/project/project.const';
import { addProject } from '../../../../features/project/store/project.actions';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const SOURCE = 'INBOX_PROJECT';
const TARGET = 'undo-move-target';
const TASK_ID = 'undo-move-task';
const OTHER_ID = 'concurrent-add-task';

describe('generic project moves and undo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const add = (id: string, projectId: string): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.addTask({
        task: {
          ...DEFAULT_TASK,
          id,
          title: id,
          projectId,
          created: Date.now(),
        },
        workContextId: projectId,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: true,
      }),
    );

  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(TaskSharedActions.updateTask({ task: { id: TASK_ID, changes } }));

  const stateOf = (device: FuzzDevice): Promise<{ task: Task; targetIds: string[] }> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return {
        task: (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID],
        targetIds: (
          state['projects'] as { entities: Record<string, { taskIds: string[] }> }
        ).entities[TARGET].taskIds,
      };
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    await harness.as(a, async () => {
      await harness.dispatch(
        addProject({ project: { ...DEFAULT_PROJECT, id: TARGET, title: 'Target' } }),
      );
      await add(TASK_ID, SOURCE);
    });
    expect(await harness.sync(a)).toBeTrue();
    expect(await harness.sync(b)).toBeTrue();
  }, 60_000);
  afterEach(() => SyncFuzzHarness.dispose());

  for (const uploadFirst of ['A', 'B'] as const) {
    it(`preserves a concurrent title across move/undo/redo when ${uploadFirst} uploads first`, async () => {
      harness.tick();
      await harness.as(a, async () => {
        await update({ projectId: TARGET });
        await update({ projectId: SOURCE });
        await update({ projectId: TARGET });
      });
      harness.tick();
      await harness.as(b, () => update({ title: 'Edited elsewhere' }));
      const order = uploadFirst === 'A' ? [a, b] : [b, a];
      for (let round = 0; round < 2; round++) {
        for (const device of order) expect(await harness.sync(device)).toBeTrue();
      }
      for (const device of order) {
        const state = await stateOf(device);
        expect(state.task.title).toBe('Edited elsewhere');
        expect(state.task.projectId).toBe(TARGET);
        expect(state.targetIds).toEqual([TASK_ID]);
      }
      await harness.restart(a);
      expect((await stateOf(a)).targetIds).toEqual([TASK_ID]);
    }, 60_000);
  }

  it('keeps the known order-only divergence when another task is concurrently added', async () => {
    harness.tick();
    await harness.as(a, async () => {
      await update({ projectId: TARGET });
      await update({ projectId: SOURCE });
      await update({ projectId: TARGET });
    });
    await harness.as(b, () => add(OTHER_ID, TARGET));
    for (let round = 0; round < 2; round++) {
      expect(await harness.sync(a)).toBeTrue();
      expect(await harness.sync(b)).toBeTrue();
    }
    // Same members, opposite order, and it persists through further syncs and a
    // restart. project.taskIds is a stored order list that task reducers append
    // to, so two independent appends replay in opposite orders. Order-only
    // differences do not qualify for a sync fix (contributor-sync-model.md, Fix
    // intake); the options are in order-and-membership-options.md. Keep this
    // reproduction so a deterministic order is noticed if it ever lands.
    expect((await stateOf(a)).targetIds).toEqual([TASK_ID, OTHER_ID]);
    expect((await stateOf(b)).targetIds).toEqual([OTHER_ID, TASK_ID]);
  }, 60_000);
});
