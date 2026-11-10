import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { hasManualDoneTaskOrder } from '../../../../features/tasks/done-task-order';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'done-order-undo-task';
const PROJECT_ID = 'INBOX_PROJECT';
const ORDER = { projectId: PROJECT_ID, doneOn: 3000, key: 'aV' };

describe('completed-task order undo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(TaskSharedActions.updateTask({ task: { id: TASK_ID, changes } }));
  const taskOn = (device: FuzzDevice): Promise<Task> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID];
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    await harness.as(a, () =>
      harness.dispatch(
        TaskSharedActions.addTask({
          task: {
            ...DEFAULT_TASK,
            id: TASK_ID,
            title: 'Original',
            projectId: PROJECT_ID,
            created: Date.now(),
            isDone: true,
            doneOn: 3000,
          },
          workContextId: PROJECT_ID,
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

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const redo of [false, true]) {
      it(`preserves another title after reorder/undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first`, async () => {
        harness.tick();
        await harness.as(a, async () => {
          await update({ doneOrder: ORDER });
          await update({ doneOrder: null });
          if (redo) await update({ doneOrder: ORDER });
        });
        harness.tick();
        await harness.as(b, () => update({ title: 'Changed elsewhere' }));
        const devices = uploadFirst === 'A' ? [a, b] : [b, a];
        for (let round = 0; round < 2; round++) {
          for (const device of devices) expect(await harness.sync(device)).toBeTrue();
        }
        for (const device of devices) {
          const task = await taskOn(device);
          expect(task.title).toBe('Changed elsewhere');
          expect(task.doneOn).toBe(3000);
          expect(task.doneOrder ?? null).toEqual(redo ? ORDER : null);
        }
        await harness.restart(a);
        expect((await taskOn(a)).doneOrder ?? null).toEqual(redo ? ORDER : null);
      }, 60_000);
    }

    it(`ignores an old order after a concurrent recompletion when ${uploadFirst} uploads first`, async () => {
      harness.tick();
      await harness.as(a, async () => {
        await update({ doneOrder: ORDER });
        await update({ doneOrder: null });
        await update({ doneOrder: ORDER });
      });
      harness.tick();
      await harness.as(b, () => update({ isDone: true, doneOn: 4000 }));
      const devices = uploadFirst === 'A' ? [a, b] : [b, a];
      for (let round = 0; round < 2; round++) {
        for (const device of devices) expect(await harness.sync(device)).toBeTrue();
      }
      for (const device of devices) {
        const task = await taskOn(device);
        expect(task.doneOn).toBe(4000);
        expect(hasManualDoneTaskOrder(task)).toBeFalse();
      }
    }, 60_000);
  }
});
