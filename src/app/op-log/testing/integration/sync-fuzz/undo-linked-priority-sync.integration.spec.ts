import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'linked-priority-task';

describe('linked task priority undo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(TaskSharedActions.updateTask({ task: { id: TASK_ID, changes } }));

  const taskOn = (device: FuzzDevice): Promise<Partial<Task>> =>
    harness.as(device, async () => {
      const state = await harness.state();
      const task = (state['tasks'] as { entities: Record<string, Task> }).entities[
        TASK_ID
      ];
      return {
        priority: task.priority ?? null,
        title: task.title,
        issueId: task.issueId,
        issueProviderId: task.issueProviderId,
        issueType: task.issueType,
      };
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
            projectId: 'INBOX_PROJECT',
            created: Date.now(),
            issueId: 'issue-1',
            issueProviderId: 'provider-1',
            issueType: 'JIRA',
          },
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

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const redo of [false, true]) {
      it(`preserves a concurrent provider title after undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first`, async () => {
        harness.tick();
        await harness.as(a, async () => {
          await update({ priority: 3 });
          await update({ priority: null });
          if (redo) await update({ priority: 3 });
        });
        harness.tick();
        await harness.as(b, () => update({ title: 'Changed elsewhere' }));

        const order = uploadFirst === 'A' ? [a, b] : [b, a];
        for (let round = 0; round < 2; round++) {
          for (const device of order) expect(await harness.sync(device)).toBeTrue();
        }
        const expected: Partial<Task> = {
          priority: redo ? 3 : null,
          title: 'Changed elsewhere',
          issueId: 'issue-1',
          issueProviderId: 'provider-1',
          issueType: 'JIRA',
        };
        expect(await taskOn(a)).toEqual(expected);
        expect(await taskOn(b)).toEqual(expected);
        await harness.restart(a);
        expect(await taskOn(a)).toEqual(expected);
      }, 60_000);
    }
  }
});
