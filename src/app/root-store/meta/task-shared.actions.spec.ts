import { SUPER_SYNC_MAX_ENTITY_IDS_PER_OP } from '@sp/shared-schema';
import { collectArchivedTaskEntityIds, TaskSharedActions } from './task-shared.actions';
import { TaskWithSubTasks } from '../../features/tasks/task.model';

describe('TaskSharedActions.moveToArchive entityIds', () => {
  const createParent = (id: string, subTaskIds: string[]): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds,
      subTasks: subTaskIds.map((subTaskId) => ({ id: subTaskId, parentId: id })),
    }) as unknown as TaskWithSubTasks;

  it('declares the subtasks the archive cascades to, parents first', () => {
    const action = TaskSharedActions.moveToArchive({
      tasks: [createParent('parent-1', ['sub-1', 'sub-2']), createParent('parent-2', [])],
    });

    expect(action.meta.entityIds).toEqual(['parent-1', 'parent-2', 'sub-1', 'sub-2']);
  });

  it('deduplicates ids carried by both subTaskIds and subTasks', () => {
    const ids = collectArchivedTaskEntityIds([
      { id: 'parent-1', subTaskIds: ['sub-1'], subTasks: [{ id: 'sub-1' }] },
    ]);

    expect(ids).toEqual(['parent-1', 'sub-1']);
  });

  it('drops non-string and empty ids — entityIds goes on the wire', () => {
    const ids = collectArchivedTaskEntityIds([
      { id: 'parent-1', subTaskIds: [null, 42, '', 'sub-1'], subTasks: [{}, null] },
      null,
      'not-a-task',
    ]);

    expect(ids).toEqual(['parent-1', 'sub-1']);
  });

  it('tolerates a task without subtask fields (old snapshots)', () => {
    expect(collectArchivedTaskEntityIds([{ id: 'parent-1' }])).toEqual(['parent-1']);
  });

  it('falls back to top-level ids when the cascade would exceed the server cap', () => {
    // A rejected upload (INVALID_ENTITY_ID) would strand the archive unsynced;
    // receivers re-derive the cascade from the payload, so this degrades safely.
    const tasks = Array.from({ length: SUPER_SYNC_MAX_ENTITY_IDS_PER_OP }, (_, i) => ({
      id: `parent-${i}`,
      subTaskIds: [`sub-${i}`],
    }));

    const ids = collectArchivedTaskEntityIds(tasks);

    expect(ids.length).toBe(SUPER_SYNC_MAX_ENTITY_IDS_PER_OP);
    expect(ids).not.toContain('sub-0');
  });
});

describe('TaskSharedActions.planTasksForToday readable declaration', () => {
  const TODAY = '2026-11-10';
  const OTHER_DAY = '2026-11-12';
  const base = { today: TODAY, startOfNextDayDiffMs: 0 };
  const plan = (
    plannedTask: Parameters<typeof TaskSharedActions.planTasksForToday>[0]['plannedTask'],
    extra: Partial<Parameters<typeof TaskSharedActions.planTasksForToday>[0]> = {},
  ): ReturnType<typeof TaskSharedActions.planTasksForToday> =>
    TaskSharedActions.planTasksForToday({
      taskIds: [plannedTask!.id],
      ...base,
      plannedTask,
      ...extra,
    });

  it('states only dueDay for an unscheduled root task', () => {
    const action = plan({ id: 't1' });

    expect(action.task).toEqual({ id: 't1', changes: { dueDay: TODAY } });
    expect(action.clearedFields).toBeUndefined();
  });

  it('keeps the ids, flags and meta of the undeclared action', () => {
    const action = plan({ id: 't1' }, { isShowSnack: true });

    expect(action.taskIds).toEqual(['t1']);
    expect(action.isShowSnack).toBeTrue();
    expect(action.meta.entityIds).toEqual(['t1']);
    expect((action as unknown as Record<string, unknown>)['plannedTask']).toBeUndefined();
  });

  it('lists a set reminder and a time of another day as cleared keys', () => {
    const action = plan({
      id: 't1',
      dueDay: undefined,
      dueWithTime: new Date(2026, 10, 12, 9).getTime(),
      remindAt: 123,
    });

    expect(action.task!.changes).toEqual({
      dueDay: TODAY,
      remindAt: undefined,
      dueWithTime: undefined,
    });
    expect(action.clearedFields).toEqual(['remindAt', 'dueWithTime']);
  });

  it('keeps a time that is already today', () => {
    const action = plan({
      id: 't1',
      dueDay: undefined,
      dueWithTime: new Date(2026, 10, 10, 15).getTime(),
    });

    expect(action.task!.changes).toEqual({ dueDay: TODAY });
  });

  it('clears any time when isClearScheduledTime is set', () => {
    const action = plan(
      {
        id: 't1',
        dueDay: TODAY,
        dueWithTime: new Date(2026, 10, 10, 15).getTime(),
      },
      { isClearScheduledTime: true },
    );

    expect(action.task!.changes).toEqual({ dueWithTime: undefined });
    expect(action.clearedFields).toEqual(['dueWithTime']);
  });

  it('moves a task planned for another day to today', () => {
    expect(plan({ id: 't1', dueDay: OTHER_DAY }).task!.changes).toEqual({
      dueDay: TODAY,
    });
  });

  it('declares nothing when the plan changes nothing', () => {
    expect(plan({ id: 't1', dueDay: TODAY }).task).toBeUndefined();
  });

  it('declares nothing for a subtask, whose plan depends on its parent', () => {
    expect(plan({ id: 't1', parentId: 'parent' }).task).toBeUndefined();
  });

  it('declares nothing for a bulk plan or a mismatched task', () => {
    const bulk = TaskSharedActions.planTasksForToday({
      taskIds: ['t1', 't2'],
      ...base,
      plannedTask: { id: 't1' },
    });
    const mismatched = TaskSharedActions.planTasksForToday({
      taskIds: ['t2'],
      ...base,
      plannedTask: { id: 't1' },
    });

    expect(bulk.task).toBeUndefined();
    expect(mismatched.task).toBeUndefined();
  });

  it('declares nothing without a plannedTask or a logical day', () => {
    expect(
      TaskSharedActions.planTasksForToday({ taskIds: ['t1'], today: TODAY }).task,
    ).toBeUndefined();
    expect(
      TaskSharedActions.planTasksForToday({
        taskIds: ['t1'],
        plannedTask: { id: 't1' },
      }).task,
    ).toBeUndefined();
  });
});
