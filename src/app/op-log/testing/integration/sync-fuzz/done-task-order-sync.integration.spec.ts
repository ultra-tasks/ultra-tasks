import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import {
  doneTaskOrderBetween,
  doneTaskOrderKey,
} from '../../../../features/tasks/done-task-order';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const ID = 'done-order-task';
const PROJECT_ID = 'INBOX_PROJECT';

describe('completed task order across devices', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  const initial: Task = {
    ...DEFAULT_TASK,
    id: ID,
    title: 'Original',
    projectId: PROJECT_ID,
    isDone: true,
    doneOn: 3000,
  };
  const target: Task = { ...initial, id: 'target', doneOn: 2000 };
  const rank = doneTaskOrderBetween(doneTaskOrderKey(target), null, ID);

  const taskOn = (device: FuzzDevice): Promise<Partial<Task>> =>
    harness.as(device, async () => {
      const state = await harness.state();
      const task = (state['tasks'] as { entities: Record<string, Task> }).entities[ID];
      return {
        title: task.title,
        isDone: task.isDone,
        doneOn: task.doneOn,
        doneOrder: task.doneOrder,
      };
    });

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
    await harness.as(a, async () => {
      for (const task of [initial, target]) {
        await harness.dispatch(
          TaskSharedActions.addTask({
            task,
            workContextId: PROJECT_ID,
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
          }),
        );
      }
    });
    expect(await harness.sync(a)).toBeTrue();
    expect(await harness.sync(b)).toBeTrue();
  }, 60_000);
  afterEach(() => SyncFuzzHarness.dispose());

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const titleNewer of [false, true]) {
      it(`preserves title and order when ${uploadFirst} uploads first and title is ${titleNewer ? 'newer' : 'older'}`, async () => {
        const writeOrder = async (): Promise<void> =>
          harness.as(a, () =>
            harness.dispatch(
              TaskSharedActions.updateTask({
                task: {
                  id: ID,
                  changes: {
                    doneOrder: { projectId: PROJECT_ID, doneOn: 3000, key: rank },
                  },
                },
                isIgnoreShortSyntax: true,
              }),
            ),
          );
        const writeTitle = async (): Promise<void> =>
          harness.as(b, () =>
            harness.dispatch(
              TaskSharedActions.updateTask({
                task: { id: ID, changes: { title: 'Changed remotely' } },
                isIgnoreShortSyntax: true,
              }),
            ),
          );
        if (titleNewer) {
          await writeOrder();
          harness.tick();
          await writeTitle();
        } else {
          await writeTitle();
          harness.tick();
          await writeOrder();
        }
        const devices = uploadFirst === 'A' ? [a, b] : [b, a];
        for (let round = 0; round < 2; round++)
          for (const device of devices) expect(await harness.sync(device)).toBeTrue();
        const expected = {
          title: 'Changed remotely',
          isDone: true,
          doneOn: 3000,
          doneOrder: { projectId: PROJECT_ID, doneOn: 3000, key: rank },
        };
        expect(await taskOn(a)).toEqual(expected);
        expect(await taskOn(b)).toEqual(expected);
        await harness.restart(a);
        expect(await taskOn(a)).toEqual(expected);
      }, 60_000);
    }
  }
});
