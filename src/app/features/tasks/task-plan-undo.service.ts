import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { SnackParams } from '../../core/snack/snack.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { T } from '../../t.const';
import { selectTaskEntities } from './store/task.selectors';
import { Task } from './task.model';
import { TaskUndoService } from './task-undo.service';

type SnackUndoAction = Pick<SnackParams, 'actionStr' | 'actionFn'>;

/**
 * The Undo button on the "Task planned for ..." snack, so a swipe-menu tap on
 * Tomorrow can be taken back without a keyboard (Ctrl+Z is the only other way).
 *
 * Planning a task for a day clears its time and reminder and moves it in the
 * planner and the Today list, so the button appears only where the day alone says
 * what it was: a plain, unfinished root task without a time, a reminder or subtasks.
 * It goes back to the day it had (or to none); within that day's list it returns at
 * the end. The same cases `TaskUndoService` supports, plus a task that already had a
 * day.
 */
@Injectable({ providedIn: 'root' })
export class TaskPlanUndoService {
  private readonly _store = inject(Store);
  // Looked up when a snack is built, not when this service is created: the effects
  // that own the snacks must not pull the whole task history in with them.
  private readonly _injector = inject(Injector);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);

  /**
   * Snack params for the plan that was just made: spread them into `open()`.
   * `before` is the task as it was before it was planned, `day` the day it was
   * planned for. Empty when the plan cannot be undone exactly.
   */
  getSnackAction(
    before: Task | undefined,
    day: string,
    taskId = before?.id,
  ): SnackUndoAction {
    // Planned through the task history (add to Today): the very Undo of Ctrl+Z.
    // Bind the exact entry: another supported edit can become newest while the
    // snack remains visible, or while its text is being prepared asynchronously.
    const taskUndoService = this._injector.get(TaskUndoService);
    if (taskUndoService.undoField() === 'dueDay') {
      const undo = taskId && taskUndoService.capturePlanUndo(taskId, day);
      if (!undo) return {};
      return {
        actionStr: T.G.UNDO,
        actionFn: () => {
          undo();
        },
      };
    }
    if (!before || !this._isRestorable(before)) {
      return {};
    }
    return {
      actionStr: T.G.UNDO,
      actionFn: () => this._restore(before.id, day, before.dueDay ?? null),
    };
  }

  private _isRestorable(task: Task): boolean {
    return (
      !task.isDone &&
      !task.parentId &&
      !task.repeatCfgId &&
      !task.subTaskIds?.length &&
      !task.remindAt &&
      task.dueWithTime == null &&
      !task.issueId &&
      !task.issueProviderId &&
      !task.issueType &&
      !task.integration
    );
  }

  private _restore(id: string, day: string, previousDay: string | null): void {
    const current = this._tasks()[id];
    // Only while it is still planned for that day: anything since is a newer choice.
    if (!current || !this._isRestorable(current) || current.dueDay !== day) {
      return;
    }
    // `updateTask` moves the task in the planner and the Today list with its day.
    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: { id, changes: { dueDay: previousDay } as Partial<Task> },
        isIgnoreShortSyntax: true,
      }),
    );
  }
}
