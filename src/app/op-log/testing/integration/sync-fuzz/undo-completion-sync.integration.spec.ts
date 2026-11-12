import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { hasManualDoneTaskOrder } from '../../../../features/tasks/done-task-order';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-completion-task';
const PROJECT_ID = 'INBOX_PROJECT';

describe('completion, undo and redo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const taskOn = (device: FuzzDevice): Promise<Task> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID];
    });
  // The action a completion gesture dispatches: no explicit doneOn.
  const setDone = (isDone: boolean): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { isDone } },
        isIgnoreShortSyntax: true,
      }),
    );
  const setTitle = (title: string): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { title } },
        isIgnoreShortSyntax: true,
      }),
    );
  // The completing device stamps doneOn when the reducer runs; the other derives it
  // from the operation timestamp, taken a few milliseconds later.
  const expectSameCompletion = (x: Task, y: Task): void => {
    expect(x.isDone).toBe(y.isDone);
    if (x.doneOn == null || y.doneOn == null) {
      expect(x.doneOn ?? null).toBe(y.doneOn ?? null);
    } else {
      expect(Math.abs(x.doneOn - y.doneOn)).toBeLessThan(1000);
    }
  };
  const syncRounds = async (order: FuzzDevice[]): Promise<void> => {
    for (let round = 0; round < 2; round++) {
      for (const device of order) expect(await harness.sync(device)).toBeTrue();
    }
  };

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

  it('keeps a manual completed order across devices after a plain completion', async () => {
    harness.tick();
    await harness.as(a, () => setDone(true));
    const completed = await taskOn(a);
    await harness.as(a, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({
          task: {
            id: TASK_ID,
            changes: {
              doneOrder: { projectId: PROJECT_ID, doneOn: completed.doneOn!, key: 'aV' },
            },
          },
          isIgnoreShortSyntax: true,
        }),
      ),
    );
    await syncRounds([a, b]);

    const [onA, onB] = [await taskOn(a), await taskOn(b)];
    expectSameCompletion(onA, onB);
    // B derived its own doneOn from the operation, so the order must still apply.
    expect(hasManualDoneTaskOrder(onA)).toBeTrue();
    expect(hasManualDoneTaskOrder(onB)).toBeTrue();
  }, 60_000);

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const editNewer of [false, true]) {
      for (const redo of [false, true]) {
        it(`keeps a concurrent title edit beside complete/undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first and the edit is ${editNewer ? 'newer' : 'older'}`, async () => {
          const completeAndUndo = (): Promise<void> =>
            harness.as(a, async () => {
              await setDone(true);
              await setDone(false);
              if (redo) await setDone(true);
            });
          const edit = (): Promise<void> => harness.as(b, () => setTitle('Edited on B'));
          harness.tick();
          if (editNewer) {
            await completeAndUndo();
            harness.tick();
            await edit();
          } else {
            await edit();
            harness.tick();
            await completeAndUndo();
          }
          await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

          const [onA, onB] = [await taskOn(a), await taskOn(b)];
          for (const task of [onA, onB]) {
            expect(task.title).toBe('Edited on B');
            expect(task.isDone).toBe(redo);
          }
          expectSameCompletion(onA, onB);
          await harness.restart(a);
          const restored = await taskOn(a);
          expect(restored.isDone).toBe(redo);
          expect(restored.title).toBe('Edited on B');
        }, 60_000);
      }
    }

    it(`converges when both devices change the done state (${uploadFirst} uploads first)`, async () => {
      harness.tick();
      await harness.as(a, async () => {
        await setDone(true);
        await setDone(false);
      });
      harness.tick();
      await harness.as(b, () => setDone(true));
      await syncRounds(uploadFirst === 'A' ? [a, b] : [b, a]);

      const [onA, onB] = [await taskOn(a), await taskOn(b)];
      // B's completion is the latest write of the field on either device.
      expect(onA.isDone).toBeTrue();
      expect(onB.isDone).toBeTrue();
      expectSameCompletion(onA, onB);
      await harness.restart(b);
      expect((await taskOn(b)).isDone).toBeTrue();
    }, 60_000);
  }
});
