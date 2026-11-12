import {
  DEFAULT_TASK,
  Task,
  TaskWithSubTasks,
} from '../../../../features/tasks/task.model';
import { DEFAULT_TAG } from '../../../../features/tag/tag.const';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { getLastDeletePayload } from '../../../../root-store/meta/undo-task-delete.meta-reducer';
import { addTag } from '../../../../features/tag/store/tag.actions';
import { addSubTask } from '../../../../features/tasks/store/task.actions';
import { moveProjectTaskToBacklogList } from '../../../../features/project/store/project.actions';
import {
  addSection,
  addTaskToSection,
} from '../../../../features/section/store/section.actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const PROJECT_ID = 'INBOX_PROJECT';
const TAG_ID = 'round-trip-tag';
const SECTION_ID = 'round-trip-section';

type Slices = Record<string, unknown>;

/** Everything a delete can touch, without volatile timestamps. */
const slicesOf = (state: Record<string, unknown>): Slices => {
  const tasks = (state['tasks'] as { entities: Record<string, Task | undefined> })
    .entities;
  const stableTasks = Object.fromEntries(
    Object.entries(tasks).map(([id, task]) => [
      id,
      task && { ...task, modified: undefined, subTasks: undefined },
    ]),
  );
  const project = (
    state['projects'] as {
      entities: Record<string, { taskIds: string[]; backlogTaskIds: string[] }>;
    }
  ).entities[PROJECT_ID];
  return {
    tasks: stableTasks,
    projectTaskIds: project.taskIds,
    projectBacklogTaskIds: project.backlogTaskIds,
    tags: Object.fromEntries(
      Object.entries(
        (state['tag'] as { entities: Record<string, { taskIds: string[] }> }).entities,
      ).map(([id, tag]) => [id, tag.taskIds]),
    ),
    plannerDays: (state['planner'] as { days: Record<string, string[]> }).days,
    sections: Object.fromEntries(
      Object.entries(
        (state['section'] as { entities: Record<string, { taskIds: string[] }> })
          .entities,
      ).map(([id, section]) => [id, section.taskIds]),
    ),
  };
};

describe('delete then restore from the captured payload', () => {
  let harness: SyncFuzzHarness;
  let today: string;
  let device: FuzzDevice;
  const run = <T>(fn: () => Promise<T>): Promise<T> => harness.as(device, fn);

  const newTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    projectId: PROJECT_ID,
    created: Date.now(),
    ...overrides,
  });
  const add = (task: Task): Promise<void> =>
    harness.dispatch(
      TaskSharedActions.addTask({
        task,
        workContextId: PROJECT_ID,
        workContextType: WorkContextType.PROJECT,
        isAddToBacklog: false,
        isAddToBottom: false,
      }),
    );
  const withSubTasks = async (id: string): Promise<TaskWithSubTasks> => {
    const tasks = ((await harness.state())['tasks'] as { entities: Record<string, Task> })
      .entities;
    const task = tasks[id];
    return { ...task, subTasks: task.subTaskIds.map((subId) => tasks[subId]) };
  };
  const roundTrip = async (id: string): Promise<{ before: Slices; after: Slices }> => {
    const before = slicesOf(await harness.state());
    await harness.dispatch(
      TaskSharedActions.deleteTask({ task: await withSubTasks(id) }),
    );
    const payload = getLastDeletePayload();
    expect(payload).withContext('captured payload').not.toBeNull();
    await harness.dispatch(TaskSharedActions.restoreDeletedTask(payload!));
    return { before, after: slicesOf(await harness.state()) };
  };

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    device = await harness.addDevice('A');
    await run(async () => {
      today = ((await harness.state())['appState'] as { todayStr: string }).todayStr;
      await add(newTask('before'));
      await add(newTask('target'));
      await add(newTask('after'));
    });
  }, 60_000);
  afterEach(() => SyncFuzzHarness.dispose());

  const shapes: [string, () => Promise<void>][] = [
    ['an ordinary project task between others', async () => undefined],
    [
      'a task planned for today',
      () =>
        harness.dispatch(
          TaskSharedActions.planTasksForToday({
            taskIds: ['target'],
            today,
            startOfNextDayDiffMs: 0,
            parentTaskMap: { target: undefined },
          }),
        ),
    ],
    [
      'a task planned for a later day',
      () =>
        harness.dispatch(
          TaskSharedActions.updateTask({
            task: { id: 'target', changes: { dueDay: '2099-01-01' } },
          }),
        ),
    ],
    [
      'a task with a tag',
      async () => {
        await harness.dispatch(
          addTag({ tag: { ...DEFAULT_TAG, id: TAG_ID, title: 't' } }),
        );
        await harness.dispatch(
          TaskSharedActions.updateTask({
            task: { id: 'target', changes: { tagIds: [TAG_ID] } },
          }),
        );
      },
    ],
    [
      'a backlog task',
      () =>
        harness.dispatch(
          moveProjectTaskToBacklogList({
            taskId: 'target',
            afterTaskId: null,
            workContextId: PROJECT_ID,
          }),
        ),
    ],
    [
      'a task with subtasks',
      async () => {
        await harness.dispatch(
          addSubTask({
            task: newTask('child-1', { parentId: 'target', projectId: PROJECT_ID }),
            parentId: 'target',
          }),
        );
        await harness.dispatch(
          addSubTask({
            task: newTask('child-2', { parentId: 'target', projectId: PROJECT_ID }),
            parentId: 'target',
          }),
        );
      },
    ],
  ];

  for (const [name, arrange] of shapes) {
    it(
      `restores ${name} exactly`,
      () =>
        run(async () => {
          await arrange();
          const { before, after } = await roundTrip('target');
          for (const key of Object.keys(before)) {
            expect(after[key]).withContext(key).toEqual(before[key]);
          }
        }),
      60_000,
    );
  }

  // Why the history leaves a task in a section to the existing delete path.
  it(
    'does not return a section membership',
    () =>
      run(async () => {
        await harness.dispatch(
          addSection({
            section: {
              id: SECTION_ID,
              contextId: PROJECT_ID,
              contextType: WorkContextType.PROJECT,
              title: 's',
              taskIds: [],
            },
          }),
        );
        await harness.dispatch(
          addTaskToSection({
            sectionId: SECTION_ID,
            taskId: 'target',
            afterTaskId: null,
            sourceSectionId: null,
          }),
        );
        const { before, after } = await roundTrip('target');
        expect(before['sections']).toEqual({ [SECTION_ID]: ['target'] });
        expect(after['sections']).toEqual({ [SECTION_ID]: [] });
        expect(after['tasks']).toEqual(before['tasks']);
      }),
    60_000,
  );

  it(
    'restores a subtask between its siblings exactly',
    () =>
      run(async () => {
        for (const id of ['child-1', 'child-2', 'child-3']) {
          await harness.dispatch(
            addSubTask({
              task: newTask(id, { parentId: 'target', projectId: PROJECT_ID }),
              parentId: 'target',
            }),
          );
        }
        const { before, after } = await roundTrip('child-2');
        for (const key of Object.keys(before)) {
          expect(after[key]).withContext(key).toEqual(before[key]);
        }
      }),
    60_000,
  );
});
