import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { TAG_FEATURE_NAME } from '../../../../features/tag/store/tag.reducer';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-today-task';
const PROJECT_ID = 'INBOX_PROJECT';

interface Snapshot {
  task: Task;
  todayList: string[];
  plannerDays: Record<string, string[]>;
}

describe('adding an unscheduled task to Today, undo and redo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;
  let today: string;

  const snapshotOf = (device: FuzzDevice): Promise<Snapshot> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return {
        task: (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID],
        todayList: (
          state[TAG_FEATURE_NAME] as { entities: Record<string, { taskIds: string[] }> }
        ).entities['TODAY'].taskIds,
        plannerDays: (state['planner'] as { days: Record<string, string[]> }).days,
      };
    });

  // The actions the undo queue dispatches for this intent.
  const addToToday = async (device: FuzzDevice): Promise<void> => {
    const planned = (await snapshotOf(device)).task;
    await harness.as(device, () =>
      harness.dispatch(
        TaskSharedActions.planTasksForToday({
          taskIds: [TASK_ID],
          today,
          startOfNextDayDiffMs: 0,
          parentTaskMap: { [TASK_ID]: undefined },
          plannedTask: planned,
        }),
      ),
    );
  };
  const removeFromToday = (device: FuzzDevice): Promise<void> =>
    harness.as(device, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({
          task: { id: TASK_ID, changes: { dueDay: null } },
          isIgnoreShortSyntax: true,
        }),
      ),
    );
  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes },
        isIgnoreShortSyntax: true,
      }),
    );
  const syncRounds = async (order: FuzzDevice[]): Promise<void> => {
    for (let round = 0; round < 2; round++) {
      for (const device of order) expect(await harness.sync(device)).toBeTrue();
    }
  };

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

  const expectScheduled = (
    snapshot: Snapshot,
    isScheduled: boolean,
    label: string,
  ): void => {
    expect(snapshot.task.dueDay ?? null)
      .withContext(`${label} dueDay`)
      .toBe(isScheduled ? today : null);
    expect(snapshot.todayList.includes(TASK_ID))
      .withContext(`${label} Today list`)
      .toBe(isScheduled);
    expect(Object.values(snapshot.plannerDays).some((ids) => ids.includes(TASK_ID)))
      .withContext(`${label} planner days`)
      .toBeFalse();
  };

  it('undoes and redoes locally with the Today list following the task', async () => {
    harness.tick();
    await addToToday(a);
    expectScheduled(await snapshotOf(a), true, 'planned');
    await removeFromToday(a);
    expectScheduled(await snapshotOf(a), false, 'undone');
    await addToToday(a);
    expectScheduled(await snapshotOf(a), true, 'redone');
  }, 60_000);

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const editNewer of [false, true]) {
      for (const redo of [false, true]) {
        it(`keeps a concurrent title edit beside add/undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first and the edit is ${editNewer ? 'newer' : 'older'}`, async () => {
          const schedule = async (): Promise<void> => {
            await addToToday(a);
            await removeFromToday(a);
            if (redo) await addToToday(a);
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
            expect(snapshot.task.title).withContext(device.name).toBe('Edited on B');
            expectScheduled(snapshot, redo, device.name);
          }
          await harness.restart(a);
          expectScheduled(await snapshotOf(a), redo, 'after restart');
        }, 60_000);
      }
    }

    it(`keeps a concurrent completion beside add/undo/redo (${uploadFirst} uploads first)`, async () => {
      harness.tick();
      await addToToday(a);
      await removeFromToday(a);
      await addToToday(a);
      harness.tick();
      await harness.as(b, () => update({ isDone: true }));
      await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

      for (const device of [a, b]) {
        const snapshot = await snapshotOf(device);
        expect(snapshot.task.isDone).withContext(device.name).toBeTrue();
        expect(snapshot.task.dueDay).withContext(device.name).toBe(today);
        expect(snapshot.todayList.includes(TASK_ID)).withContext(device.name).toBeTrue();
      }
    }, 60_000);
  }
});
