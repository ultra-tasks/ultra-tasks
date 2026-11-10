import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { WorkContextType } from '../work-context/work-context.model';
import { WorkContextService } from '../work-context/work-context.service';
import { doneTaskOrderKey } from './done-task-order';
import { DEFAULT_TASK, Task } from './task.model';
import { TaskDoneOrderService } from './task-done-order.service';
import { TaskUndoService } from './task-undo.service';

describe('TaskDoneOrderService', () => {
  let service: TaskDoneOrderService;
  let dispatch: jasmine.Spy;
  let undo: jasmine.Spy;
  let context: {
    activeWorkContextId: string;
    activeWorkContextType: WorkContextType;
    doneTasks$: Observable<Task[]>;
  };
  let tasks: Task[];

  beforeEach(() => {
    tasks = ['first', 'middle', 'last'].map((id, index) => ({
      ...DEFAULT_TASK,
      id,
      projectId: 'project',
      isDone: true,
      doneOn: [3000, 2000, 1000][index],
    }));
    dispatch = jasmine.createSpy('dispatch');
    undo = jasmine.createSpy('updateDoneOrder').and.returnValue(false);
    context = {
      activeWorkContextId: 'project',
      activeWorkContextType: WorkContextType.PROJECT,
      doneTasks$: of(tasks),
    };
    TestBed.configureTestingModule({
      providers: [
        TaskDoneOrderService,
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: () => signal(Object.fromEntries(tasks.map((t) => [t.id, t]))),
          },
        },
        { provide: WorkContextService, useValue: context },
        { provide: TaskUndoService, useValue: { updateDoneOrder: undo } },
      ],
    });
    service = TestBed.inject(TaskDoneOrderService);
  });

  it('moves down between neighbours without changing the completion timestamp', () => {
    expect(service.moveRelative('first', 'down')).toBeTrue();
    const action = dispatch.calls.mostRecent().args[0] as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    expect(action.task.id).toBe('first');
    const order = action.task.changes.doneOrder!;
    expect(order.doneOn).toBe(3000);
    expect(order.key > doneTaskOrderKey(tasks[1])).toBeTrue();
    expect(order.key < doneTaskOrderKey(tasks[2])).toBeTrue();
    expect(undo).toHaveBeenCalled();
  });

  it('moves to the top or bottom and records the change for undo', () => {
    undo.and.returnValue(true);
    service.moveRelative('last', 'top');
    const topOrder = undo.calls.mostRecent().args[2] as NonNullable<Task['doneOrder']>;
    expect(topOrder.key < doneTaskOrderKey(tasks[0])).toBeTrue();
    service.moveRelative('first', 'bottom');
    const bottomOrder = undo.calls.mostRecent().args[2] as NonNullable<Task['doneOrder']>;
    expect(bottomOrder.key > doneTaskOrderKey(tasks[2])).toBeTrue();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses the drag anchor and ignores unchanged placements', () => {
    service.moveAfter('first', 'last');
    const order = undo.calls.mostRecent().args[2] as NonNullable<Task['doneOrder']>;
    expect(order.key > doneTaskOrderKey(tasks[2])).toBeTrue();
    undo.calls.reset();
    dispatch.calls.reset();
    service.moveAfter('middle', 'first');
    service.moveRelative('first', 'up');
    expect(undo).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps date-sorted contexts unchanged without dispatching a move', () => {
    context.activeWorkContextType = WorkContextType.TAG;
    expect(service.moveRelative('first', 'down')).toBeTrue();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
