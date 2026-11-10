import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-plan-conflict-task';
const PROJECT_ID = 'INBOX_PROJECT';
const ORDER = { projectId: PROJECT_ID, doneOn: 3000, key: 'aV' };

describe('field undo against concurrent Add to Today', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let today: string;

  const taskOn = (device: FuzzDevice): Promise<Task> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID];
    });
  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes },
        isIgnoreShortSyntax: true,
      }),
    );

  afterEach(() => SyncFuzzHarness.dispose());

  const cases: Array<{
    field: 'title' | 'notes' | 'priority' | 'doneOrder';
    before: Partial<Task>;
    after: Partial<Task>;
    isDone?: boolean;
  }> = [
    { field: 'title', before: { title: 'Original' }, after: { title: 'New title' } },
    { field: 'notes', before: { notes: '' }, after: { notes: 'New note' } },
    { field: 'priority', before: { priority: null }, after: { priority: 3 } },
    {
      field: 'doneOrder',
      before: { doneOrder: null },
      after: { doneOrder: ORDER },
      isDone: true,
    },
  ];

  for (const { field, before, after, isDone } of cases) {
    for (const uploadFirst of ['A', 'B'] as const) {
      for (const planNewer of [false, true]) {
        for (const withUndo of [false, true]) {
          it(`records the ${field} ${withUndo ? 'redo' : 'single edit'} conflict when ${uploadFirst} uploads first and planning is ${planNewer ? 'newer' : 'older'}`, async () => {
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
                    ...(isDone ? { isDone: true, doneOn: 3000 } : {}),
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

            const editAndUndo = (): Promise<void> =>
              harness.as(a, async () => {
                await update(after);
                if (withUndo) {
                  await update(before);
                  await update(after);
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
              await editAndUndo();
              harness.tick();
              await plan();
            } else {
              await plan();
              harness.tick();
              await editAndUndo();
            }
            const devices = uploadFirst === 'A' ? [a, b] : [b, a];
            for (let round = 0; round < 2; round++) {
              for (const device of devices) expect(await harness.sync(device)).toBeTrue();
            }
            const tasks = [await taskOn(a), await taskOn(b)];
            if (planNewer) {
              // Existing whole-task LWW can discard the unrelated field edit.
              expect(
                tasks.some(
                  (task) => JSON.stringify(task[field]) !== JSON.stringify(after[field]),
                ),
              ).toBeTrue();
            } else {
              // A newer field update can instead discard the plan.
              expect(tasks.some((task) => task.dueDay !== today)).toBeTrue();
            }
            const beforeRestart = await taskOn(a);
            await harness.restart(a);
            const restored = await taskOn(a);
            expect(restored.dueDay).withContext('restart').toBe(beforeRestart.dueDay);
            expect(restored[field]).withContext('restart').toEqual(beforeRestart[field]);
          }, 60_000);
        }
      }
    }
  }
});
