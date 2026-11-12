import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-scheduling-task';
const FIRST_DAY = '2099-06-14';
const SECOND_DAY = '2099-06-15';

describe('generic scheduling updates and undo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(TaskSharedActions.updateTask({ task: { id: TASK_ID, changes } }));

  const stateOf = (
    device: FuzzDevice,
  ): Promise<{
    dueDay: string | null | undefined;
    title: string;
    first: string[];
    second: string[];
  }> =>
    harness.as(device, async () => {
      const state = await harness.state();
      const task = (state['tasks'] as { entities: Record<string, Task> }).entities[
        TASK_ID
      ];
      const days = (state['planner'] as { days: Record<string, string[]> }).days;
      return {
        dueDay: task.dueDay,
        title: task.title,
        first: days[FIRST_DAY] ?? [],
        second: days[SECOND_DAY] ?? [],
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
    it(`preserves an unrelated title across plan/undo when ${uploadFirst} uploads first`, async () => {
      harness.tick();
      await harness.as(a, async () => {
        await update({ dueDay: FIRST_DAY });
        await update({ dueDay: null });
      });
      harness.tick();
      await harness.as(b, () => update({ title: 'Edited on B' }));

      const order = uploadFirst === 'A' ? [a, b] : [b, a];
      for (let round = 0; round < 2; round++) {
        for (const device of order) expect(await harness.sync(device)).toBeTrue();
      }
      const expected = {
        dueDay: null,
        title: 'Edited on B',
        first: [],
        second: [],
      };
      expect(await stateOf(a)).toEqual(expected);
      expect(await stateOf(b)).toEqual(expected);
      await harness.restart(a);
      expect(await stateOf(a)).toEqual(expected);
    }, 60_000);
  }

  it('keeps planner.days in step after redo and a concurrent title edit', async () => {
    harness.tick();
    await harness.as(a, async () => {
      await update({ dueDay: FIRST_DAY });
      await update({ dueDay: null });
      await update({ dueDay: FIRST_DAY });
    });
    harness.tick();
    await harness.as(b, () => update({ title: 'Edited on B' }));
    for (let round = 0; round < 2; round++) {
      expect(await harness.sync(b)).toBeTrue();
      expect(await harness.sync(a)).toBeTrue();
    }
    const expected = {
      dueDay: FIRST_DAY,
      title: 'Edited on B',
      first: [TASK_ID],
      second: [],
    };
    expect(await stateOf(a)).toEqual(expected);
    // The LWW patch that carries the redone day also lists the task under it.
    expect(await stateOf(b)).toEqual(expected);
    await harness.restart(b);
    expect(await stateOf(b)).toEqual(expected);
  }, 60_000);
});
