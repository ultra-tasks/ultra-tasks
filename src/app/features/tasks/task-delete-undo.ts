import { Dictionary } from '@ngrx/entity';
import { RestoreDeletedTaskPayload } from '../../root-store/meta/undo-task-delete.meta-reducer';
import { Task, TaskWithSubTasks } from './task.model';

/**
 * Whether deleting this task can be taken back exactly by `restoreDeletedTask`.
 *
 * The restore returns the task, its subtasks, and its place in the project, the
 * backlog, tags, Today and the planner. It does not return a section membership,
 * and it cannot undo what a delete sends outside the app or cancels on the
 * device: a linked remote item (deleted after a short grace period), a calendar
 * time block, a native reminder, or a repeating task's bookkeeping. Subtasks stay
 * out because deleting one recalculates its parent's times, which a restore does
 * not.
 */
export const isDeleteUndoable = (
  task: Task | undefined,
  entities: Dictionary<Task>,
  sectionTaskIds: ReadonlySet<string>,
): boolean => {
  if (!task || task.parentId) return false;
  const family = [task, ...task.subTaskIds.map((id) => entities[id])];
  return family.every(
    (member) =>
      !!member &&
      !sectionTaskIds.has(member.id) &&
      !member.issueId &&
      !member.issueProviderId &&
      !member.issueType &&
      !member.integration &&
      !member.repeatCfgId &&
      !member.remindAt &&
      member.dueWithTime == null,
  );
};

/** The captured payload without the derived `subTasks` field on its entities. */
export const toRestorePayload = (
  payload: RestoreDeletedTaskPayload,
): RestoreDeletedTaskPayload => {
  const withoutSubTasks = (task: Task | TaskWithSubTasks): Task =>
    Object.fromEntries(
      Object.entries(task).filter(([key]) => key !== 'subTasks'),
    ) as Task;
  return {
    ...payload,
    task: { ...payload.task, subTasks: payload.task.subTasks ?? [] },
    deletedTaskEntities: Object.fromEntries(
      Object.entries(payload.deletedTaskEntities).map(([id, task]) => [
        id,
        task && withoutSubTasks(task),
      ]),
    ),
  };
};
