import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { doneTaskOrderBetween, doneTaskOrderKey } from './done-task-order';
import { selectTaskEntities } from './store/task.selectors';
import { Task } from './task.model';
import { TaskUndoService } from './task-undo.service';

type Direction = 'up' | 'down' | 'top' | 'bottom';

/** Reorders completed tasks in their project without changing when they were completed. */
@Injectable({ providedIn: 'root' })
export class TaskDoneOrderService {
  private readonly _store = inject(Store);
  private readonly _context = inject(WorkContextService);
  private readonly _undo = inject(TaskUndoService);
  private readonly _entities = this._store.selectSignal(selectTaskEntities);

  /** True if the completed task was handled, including date-sorted views. */
  moveRelative(id: string, direction: Direction): boolean {
    return this._withDoneTasks(id, (tasks, index) => {
      const destination =
        direction === 'up'
          ? Math.max(0, index - 1)
          : direction === 'down'
            ? Math.min(tasks.length - 1, index + 1)
            : direction === 'top'
              ? 0
              : tasks.length - 1;
      if (destination === index) return;
      const remaining = tasks.filter((task) => task.id !== id);
      this._place(tasks[index], remaining, destination);
    });
  }

  /** Place a dragged task after the supplied visible neighbour, or at the top. */
  moveAfter(id: string, afterId: string | null): boolean {
    return this._withDoneTasks(id, (tasks, index) => {
      if (afterId === id) return;
      const remaining = tasks.filter((task) => task.id !== id);
      const anchorIndex =
        afterId === null ? -1 : remaining.findIndex((t) => t.id === afterId);
      if (afterId !== null && anchorIndex < 0) return;
      const destination = anchorIndex + 1;
      if (destination === index) return;
      this._place(tasks[index], remaining, destination);
    });
  }

  private _withDoneTasks(
    id: string,
    move: (tasks: Task[], index: number) => void,
  ): boolean {
    const task = this._entities()[id];
    const projectId = this._context.activeWorkContextId;
    if (!task?.isDone || task.parentId) return false;
    if (
      this._context.activeWorkContextType !== WorkContextType.PROJECT ||
      !projectId ||
      task.projectId !== projectId
    ) {
      // Today and tag Done lists retain completion-date order. Consume their
      // movement commands without emitting a useless project-list operation.
      return true;
    }
    this._context.doneTasks$.pipe(take(1)).subscribe((tasks) => {
      // The context can change before an asynchronous source emits.
      if (
        this._context.activeWorkContextType !== WorkContextType.PROJECT ||
        this._context.activeWorkContextId !== projectId
      )
        return;
      const index = tasks.findIndex((item) => item.id === id);
      if (index >= 0) move(tasks, index);
    });
    return true;
  }

  private _place(task: Task, remaining: Task[], index: number): void {
    const lower = index ? doneTaskOrderKey(remaining[index - 1]) : null;
    const upper = remaining[index] ? doneTaskOrderKey(remaining[index]) : null;
    const doneOrder = {
      projectId: task.projectId!,
      doneOn: task.doneOn ?? null,
      key: doneTaskOrderBetween(lower, upper, task.id),
    };
    if (!this._undo.updateDoneOrder(task.id, task.doneOrder, doneOrder)) {
      this._store.dispatch(
        TaskSharedActions.updateTask({
          task: { id: task.id, changes: { doneOrder } },
          isIgnoreShortSyntax: true,
        }),
      );
    }
  }
}
