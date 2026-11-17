import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { T } from '../../t.const';
import { TaskPlanUndoService } from './task-plan-undo.service';
import { DEFAULT_TASK, Task } from './task.model';
import { TaskUndoService } from './task-undo.service';

const DAY = '2026-11-16';

describe('TaskPlanUndoService', () => {
  let service: TaskPlanUndoService;
  let dispatch: jasmine.Spy;
  let undo: jasmine.Spy;
  let capturePlanUndo: jasmine.Spy;
  let undoField: WritableSignal<string | null>;
  let entities: WritableSignal<Record<string, Task>>;

  const task = (changes: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id: 'a',
    title: 'Plan me',
    projectId: 'INBOX_PROJECT',
    ...changes,
  });
  const run = (action: { actionFn?: unknown }): void => (action.actionFn as () => void)();

  beforeEach(() => {
    undoField = signal<string | null>(null);
    entities = signal<Record<string, Task>>({});
    dispatch = jasmine.createSpy('dispatch');
    undo = jasmine.createSpy('undo').and.returnValue(true);
    capturePlanUndo = jasmine
      .createSpy('capturePlanUndo')
      .and.callFake((id: string, day: string) =>
        id === 'a' && day === DAY ? undo : undefined,
      );
    TestBed.configureTestingModule({
      providers: [
        TaskPlanUndoService,
        { provide: Store, useValue: { dispatch, selectSignal: () => entities } },
        { provide: TaskUndoService, useValue: { undoField, capturePlanUndo } },
      ],
    });
    service = TestBed.inject(TaskPlanUndoService);
  });

  it('offers the task history Undo when it holds the plan just made', () => {
    undoField.set('dueDay');

    const action = service.getSnackAction(undefined, DAY, 'a');

    expect(action.actionStr).toBe(T.G.UNDO);
    run(action);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not offer history Undo without the identity of the planned task', () => {
    undoField.set('dueDay');
    expect(service.getSnackAction(undefined, DAY)).toEqual({});
  });

  it('does not fall through to direct restore for a different task or day in history', () => {
    undoField.set('dueDay');
    expect(service.getSnackAction(task({ id: 'b' }), DAY)).toEqual({});
    expect(service.getSnackAction(task(), '2026-11-17')).toEqual({});
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('puts a task that had a day back on that day', () => {
    entities.set({ a: task({ dueDay: DAY }) });

    const action = service.getSnackAction(task({ dueDay: '2026-11-15' }), DAY);

    run(action);
    expect(dispatch).toHaveBeenCalledOnceWith(
      TaskSharedActions.updateTask({
        task: { id: 'a', changes: { dueDay: '2026-11-15' } as Partial<Task> },
        isIgnoreShortSyntax: true,
      }),
    );
  });

  it('puts an unscheduled task back by clearing the day it was planned for', () => {
    entities.set({ a: task({ dueDay: DAY }) });

    const action = service.getSnackAction(task(), DAY);

    expect(action.actionStr).toBe(T.G.UNDO);
    run(action);
    expect(dispatch).toHaveBeenCalledOnceWith(
      TaskSharedActions.updateTask({
        task: { id: 'a', changes: { dueDay: null } as Partial<Task> },
        isIgnoreShortSyntax: true,
      }),
    );
    expect(undo).not.toHaveBeenCalled();
  });

  it('leaves the task alone when it was planned again since', () => {
    entities.set({ a: task({ dueDay: '2026-11-20' }) });

    run(service.getSnackAction(task(), DAY));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves the task alone when it was finished or deleted since', () => {
    entities.set({ a: task({ dueDay: DAY, isDone: true }) });
    run(service.getSnackAction(task(), DAY));
    entities.set({});
    run(service.getSnackAction(task(), DAY));

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves a newer time, reminder, family or integration change alone', () => {
    for (const changes of [
      { dueWithTime: 1_800_000_000_000 },
      { remindAt: 1_800_000_000_000 },
      { parentId: 'parent' },
      { subTaskIds: ['child'] },
      { repeatCfgId: 'repeat' },
      { issueId: '42', issueType: 'GITHUB' },
    ] as Partial<Task>[]) {
      entities.set({ a: task({ dueDay: DAY, ...changes }) });
      run(service.getSnackAction(task(), DAY));
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('offers nothing without the task as it was', () => {
    expect(service.getSnackAction(undefined, DAY)).toEqual({});
  });

  describe('offers nothing where the plan cannot be put back exactly', () => {
    const cases: [string, Partial<Task>][] = [
      ['scheduled with a time', { dueWithTime: 1_800_000_000_000 }],
      ['has subtasks', { subTaskIds: ['child'] }],
      ['has a reminder', { remindAt: 1_800_000_000_000 }],
      ['finished', { isDone: true }],
      ['a subtask', { parentId: 'parent' }],
      ['recurring', { repeatCfgId: 'cfg' }],
      ['linked to an issue', { issueId: '42', issueType: 'GITHUB' }],
    ];
    for (const [name, changes] of cases) {
      it(name, () => {
        expect(service.getSnackAction(task(changes), DAY)).toEqual({});
      });
    }
  });
});
