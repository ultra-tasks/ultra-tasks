import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 'undo-field-sync-task';
const PROJECT_ID = 'INBOX_PROJECT';

describe('task field undo across two clients', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  const update = (changes: Partial<Task>): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes },
        isIgnoreShortSyntax: true,
      }),
    );
  const taskOn = (device: FuzzDevice): Promise<Task> =>
    harness.as(device, async () => {
      const state = await harness.state();
      return (state['tasks'] as { entities: Record<string, Task> }).entities[TASK_ID];
    });
  const syncInOrder = async (uploadFirst: 'A' | 'B'): Promise<void> => {
    const devices = uploadFirst === 'A' ? [a, b] : [b, a];
    for (let round = 0; round < 2; round++) {
      for (const device of devices) expect(await harness.sync(device)).toBeTrue();
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
            notes: 'Original note',
            timeEstimate: 10,
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

  const cases: Array<{
    name: string;
    before: Partial<Task>;
    after: Partial<Task>;
    other: Partial<Task>;
  }> = [
    {
      name: 'title',
      before: { title: 'Original' },
      after: { title: 'New title' },
      other: { notes: 'Edited elsewhere' },
    },
    {
      name: 'notes',
      before: { notes: 'Original note' },
      after: { notes: 'New note' },
      other: { title: 'Edited elsewhere' },
    },
    {
      name: 'estimate',
      before: { timeEstimate: 10 },
      after: { timeEstimate: 20 },
      other: { title: 'Edited elsewhere' },
    },
  ];

  for (const { name, before, after, other } of cases) {
    for (const uploadFirst of ['A', 'B'] as const) {
      for (const redo of [false, true]) {
        it(`keeps an unrelated edit after ${name} undo${redo ? '/redo' : ''} when ${uploadFirst} uploads first`, async () => {
          harness.tick();
          await harness.as(a, async () => {
            await update(after);
            await update(before);
            if (redo) await update(after);
          });
          harness.tick();
          await harness.as(b, () => update(other));
          await syncInOrder(uploadFirst);

          for (const device of [a, b]) {
            const actual = await taskOn(device);
            for (const [field, value] of Object.entries({
              ...(redo ? after : before),
              ...other,
            })) {
              expect(actual[field as keyof Task])
                .withContext(field)
                .toEqual(value);
            }
          }
          await harness.restart(a);
          const restored = await taskOn(a);
          for (const [field, value] of Object.entries({
            ...(redo ? after : before),
            ...other,
          })) {
            expect(restored[field as keyof Task])
              .withContext(field)
              .toEqual(value);
          }
        }, 60_000);
      }
    }
  }

  for (const uploadFirst of ['A', 'B'] as const) {
    for (const remoteNewer of [false, true]) {
      it(`resolves a competing title edit by timestamp when ${uploadFirst} uploads first and the remote edit is ${remoteNewer ? 'newer' : 'older'}`, async () => {
        const localEditAndUndo = (): Promise<void> =>
          harness.as(a, async () => {
            await update({ title: 'Temporary title' });
            harness.tick();
            await update({ title: 'Original' });
          });
        const remoteEdit = (): Promise<void> =>
          harness.as(b, () => update({ title: 'Concurrent title' }));
        harness.tick();
        if (remoteNewer) {
          await localEditAndUndo();
          harness.tick();
          await remoteEdit();
        } else {
          await remoteEdit();
          harness.tick();
          await localEditAndUndo();
        }
        await syncInOrder(uploadFirst);
        const expected = remoteNewer ? 'Concurrent title' : 'Original';
        expect((await taskOn(a)).title).toBe(expected);
        expect((await taskOn(b)).title).toBe(expected);
        await harness.restart(a);
        expect((await taskOn(a)).title).toBe(expected);
      }, 60_000);
    }
  }
});
