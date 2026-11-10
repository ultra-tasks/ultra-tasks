import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-completion-scheduling-task';
const PROJECT_ID = 'INBOX_PROJECT';

describe('completion undo against concurrent Add to Today', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let today: string;

  const taskOn = (device: FuzzDevice): Promise<Task> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID];
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    await harness.as(a, async () => {
      const state = await harness.state();
      today = (state['appState'] as { todayStr: string }).todayStr;
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
    });
    expect(await harness.sync(a)).toBeTrue();
    expect(await harness.sync(b)).toBeTrue();
  }, 60_000);
  afterEach(() => SyncFuzzHarness.dispose());

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const planNewer of [false, true]) {
      for (const redo of [false, true]) {
        it(`records the current conflict outcome after undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first and planning is ${planNewer ? 'newer' : 'older'}`, async () => {
          const completeAndUndo = (): Promise<void> =>
            harness.as(a, async () => {
              await harness.dispatch(
                TaskSharedActions.updateTask({
                  task: { id: TASK_ID, changes: { isDone: true, doneOn: 3000 } },
                  isIgnoreShortSyntax: true,
                }),
              );
              await harness.dispatch(
                TaskSharedActions.updateTask({
                  task: { id: TASK_ID, changes: { isDone: false } },
                  isIgnoreShortSyntax: true,
                }),
              );
              if (redo) {
                await harness.dispatch(
                  TaskSharedActions.updateTask({
                    task: { id: TASK_ID, changes: { isDone: true, doneOn: 3000 } },
                    isIgnoreShortSyntax: true,
                  }),
                );
              }
            });
          const plan = (): Promise<void> =>
            harness.as(b, () =>
              harness.dispatch(
                TaskSharedActions.planTasksForToday({
                  taskIds: [TASK_ID],
                  today,
                  startOfNextDayDiffMs: 0,
                }),
              ),
            );
          harness.tick();
          if (planNewer) {
            await completeAndUndo();
            harness.tick();
            await plan();
          } else {
            await plan();
            harness.tick();
            await completeAndUndo();
          }
          const order = uploadFirst === 'A' ? [a, b] : [b, a];
          for (let round = 0; round < 2; round++) {
            for (const device of order) expect(await harness.sync(device)).toBeTrue();
          }
          const tasks = [await taskOn(a), await taskOn(b)];
          if (!planNewer) {
            // The newer completion snapshot can discard the unrelated plan.
            expect(tasks.some((task) => task.dueDay !== today)).toBeTrue();
          } else if (redo) {
            // A newer plan can instead discard the redone completion.
            expect(tasks.some((task) => !task.isDone)).toBeTrue();
          } else {
            expect(
              tasks.every((task) => task.dueDay === today && !task.isDone),
            ).toBeTrue();
          }
          const beforeRestart = await taskOn(a);
          await harness.restart(a);
          const afterRestart = await taskOn(a);
          expect(afterRestart.dueDay).toBe(beforeRestart.dueDay);
          expect(afterRestart.isDone).toBe(beforeRestart.isDone);
        }, 60_000);
      }
    }
  }
});
