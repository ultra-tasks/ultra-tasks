import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { TaskService } from './task.service';
import { selectAllSections } from '../section/store/section.selectors';
import { Section } from '../section/section.model';
import { WorkContextType } from '../work-context/work-context.model';
import { undoTaskDeleteMetaReducer } from '../../root-store/meta/undo-task-delete.meta-reducer';
import { TaskUndoService } from './task-undo.service';
import { selectTaskEntities } from './store/task.selectors';
import { IssueProvider } from '../issue/issue.model';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { LocalExternalSyncSuppressionService } from '../integrations/local-external-sync-suppression.service';
import { DateService } from '../../core/date/date.service';

describe('TaskUndoService', () => {
  const actions = new Subject<Action>();
  let tasks: ReturnType<typeof signal<Record<string, Task>>>;
  let service: TaskUndoService;
  let dispatch: jasmine.Spy;
  let issueProviders: ReturnType<typeof signal<IssueProvider[]>>;
  let todayStr: string;
  let sections: ReturnType<typeof signal<Section[]>>;
  let remove: jasmine.Spy;

  const task = (id: string, timeEstimate: number): Task => ({
    ...DEFAULT_TASK,
    id,
    projectId: 'project',
    timeEstimate,
  });

  beforeEach(() => {
    todayStr = '2026-11-10';
    tasks = signal({ a: task('a', 10), b: task('b', 20) });
    issueProviders = signal<IssueProvider[]>([]);
    sections = signal<Section[]>([]);
    dispatch = jasmine.createSpy('dispatch').and.callFake((action: Action) => {
      if (action.type === TaskSharedActions.updateTask.type) {
        const update = action as ReturnType<typeof TaskSharedActions.updateTask>;
        const id = String(update.task.id);
        tasks.update((current) => ({
          ...current,
          [id]: {
            ...current[id],
            ...update.task.changes,
          },
        }));
      }
      if (action.type === TaskSharedActions.planTasksForToday.type) {
        const plan = action as ReturnType<typeof TaskSharedActions.planTasksForToday>;
        tasks.update((current) => ({
          ...current,
          [plan.taskIds[0]]: { ...current[plan.taskIds[0]], dueDay: plan.today },
        }));
      }
      if (action.type === TaskSharedActions.deleteTask.type) {
        const deleted = action as ReturnType<typeof TaskSharedActions.deleteTask>;
        // The real capture, as the store's meta-reducer chain runs it.
        undoTaskDeleteMetaReducer((state) => state)(
          {
            tasks: { entities: tasks() },
            projects: { entities: {} },
            tag: { entities: {} },
          } as never,
          action,
        );
        tasks.update((current) => {
          const next = { ...current };
          [deleted.task.id, ...deleted.task.subTaskIds].forEach((id) => delete next[id]);
          return next;
        });
      }
      if (action.type === TaskSharedActions.restoreDeletedTask.type) {
        const restore = action as ReturnType<typeof TaskSharedActions.restoreDeletedTask>;
        tasks.update((current) => ({
          ...current,
          ...(restore.deletedTaskEntities as Record<string, Task>),
        }));
      }
      actions.next(action);
    });
    remove = jasmine
      .createSpy('remove')
      .and.callFake((deleted: TaskWithSubTasks) =>
        dispatch(TaskSharedActions.deleteTask({ task: deleted })),
      );
    TestBed.configureTestingModule({
      providers: [
        TaskUndoService,
        { provide: TaskService, useValue: { remove } },
        { provide: DateService, useValue: { todayStr: () => todayStr } },
        {
          provide: Store,
          useValue: {
            selectSignal: (selector: unknown) => {
              if (selector === selectTaskEntities) return tasks;
              if (selector === selectEnabledIssueProviders) return issueProviders;
              if (selector === selectAllSections) return sections;
              throw new Error('Unexpected selector');
            },
            dispatch,
          },
        },
        { provide: ALL_ACTIONS, useValue: actions },
      ],
    });
    service = TestBed.inject(TaskUndoService);
  });

  it('undoes and redoes estimates in order with ordinary persistent updates', () => {
    expect(service.updateEstimate('a', 10, 11)).toBeTrue();
    expect(service.updateEstimate('b', 20, 22)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().b.timeEstimate).toBe(20);
    expect(service.undo()).toBeTrue();
    expect(tasks().a.timeEstimate).toBe(10);
    expect(service.redo()).toBeTrue();
    expect(tasks().a.timeEstimate).toBe(11);
    expect(dispatch.calls.mostRecent().args[0]).toEqual(
      TaskSharedActions.updateTask({
        task: { id: 'a', changes: { timeEstimate: 11 } },
        isIgnoreShortSyntax: true,
      }),
    );
  });

  it('clears redo after a new estimate edit', () => {
    service.updateEstimate('a', 10, 11);
    service.undo();
    service.updateEstimate('b', 20, 21);
    expect(service.canRedo()).toBeFalse();
  });

  it('undoes mixed note, priority and estimate edits in user order', () => {
    expect(service.updateNotes('a', '', 'First note')).toBeTrue();
    expect(service.updatePriority('a', null, 2)).toBeTrue();
    expect(service.updateEstimate('a', 10, 15)).toBeTrue();
    expect(service.undoField()).toBe('timeEstimate');
    expect(service.undo()).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.priority ?? null).toBeNull();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.notes ?? '').toBe('');
    expect(service.redo()).toBeTrue();
    expect(tasks().a.notes).toBe('First note');
    expect(service.redo()).toBeTrue();
    expect(tasks().a.priority).toBe(2);
    expect(service.redo()).toBeTrue();
    expect(tasks().a.timeEstimate).toBe(15);
  });

  it('refuses to record a stale note without overwriting newer content', () => {
    tasks.update((current) => ({ ...current, a: { ...current.a, notes: 'newer' } }));
    expect(service.updateNotes('a', 'old', 'edited')).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('allows timed title and estimate edits when automatic calendar blocks are disabled', () => {
    tasks.update((current) => ({ ...current, a: { ...current.a, dueWithTime: 123 } }));
    expect(service.updateEstimate('a', 10, 11)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(service.updateTitle('a', tasks().a.title, 'Edited title')).toBeTrue();
    service.resolveTitleChange(dispatch.calls.mostRecent().args[0], false);
    expect(service.undo()).toBeTrue();
  });

  it('leaves timed title and estimate edits to the calendar-aware paths when blocks are enabled', () => {
    tasks.update((current) => ({ ...current, a: { ...current.a, dueWithTime: 123 } }));
    issueProviders.set([
      {
        id: 'provider',
        isEnabled: true,
        issueProviderKey: 'plugin:calendar',
        pluginId: 'calendar',
        pluginConfig: { isAutoTimeBlock: true },
      } as IssueProvider,
    ]);
    expect(service.updateTitle('a', tasks().a.title, 'Edited title')).toBeFalse();
    expect(service.updateEstimate('a', 10, 11)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
    expect(service.updateNotes('a', '', 'note')).toBeTrue();
    expect(service.updatePriority('a', null, 1)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(service.undo()).toBeTrue();
  });

  it('refuses a timed undo if an automatic calendar provider becomes enabled', () => {
    tasks.update((current) => ({ ...current, a: { ...current.a, dueWithTime: 123 } }));
    expect(service.updateEstimate('a', 10, 11)).toBeTrue();
    issueProviders.set([
      {
        id: 'provider',
        isEnabled: true,
        issueProviderKey: 'plugin:calendar',
        pluginId: 'calendar',
        pluginConfig: { isAutoTimeBlock: true },
      } as IssueProvider,
    ]);
    expect(service.undo()).toBeFalse();
    expect(tasks().a.timeEstimate).toBe(11);
    expect(service.canUndo()).toBeFalse();
  });

  it('records a title only after the existing parser confirms there are no derived changes', () => {
    const original = tasks().a.title;
    service.updateEstimate('a', 10, 11);
    expect(service.updateTitle('a', original, 'Edited title')).toBeTrue();
    const titleAction = dispatch.calls.mostRecent().args[0];
    expect(titleAction.isIgnoreShortSyntax).toBeUndefined();
    expect(service.canUndo()).toBeFalse();
    expect(service.undo()).toBeFalse();
    service.resolveTitleChange(titleAction, false);
    expect(service.undoField()).toBe('title');
    expect(service.undo()).toBeTrue();
    expect(tasks().a.title).toBe(original);
    expect(dispatch.calls.mostRecent().args[0].isIgnoreShortSyntax).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.timeEstimate).toBe(10);
    expect(service.redo()).toBeTrue();
    expect(service.redo()).toBeTrue();
    expect(tasks().a.title).toBe('Edited title');
  });

  it('treats a title with parsed changes as a history barrier', () => {
    service.updateEstimate('a', 10, 11);
    expect(service.updateTitle('a', tasks().a.title, 'Title #tag')).toBeTrue();
    const titleAction = dispatch.calls.mostRecent().args[0];
    service.resolveTitleChange(titleAction, true);
    expect(service.canUndo()).toBeFalse();
    expect(tasks().a.title).toBe('Title #tag');
  });

  it('never revives a title entry after a remote edit invalidates it', () => {
    expect(service.updateTitle('a', tasks().a.title, 'Edited title')).toBeTrue();
    const titleAction = dispatch.calls.mostRecent().args[0];
    actions.next(bulkApplyOperations({ operations: [] }));
    service.resolveTitleChange(titleAction, false);
    expect(service.canUndo()).toBeFalse();
  });

  it('drops pending history if title parsing never settles', fakeAsync(() => {
    service.updateEstimate('a', 10, 11);
    expect(service.updateTitle('a', tasks().a.title, 'Edited title')).toBeTrue();
    tick(5000);
    expect(service.canUndo()).toBeFalse();
    expect(service.canRedo()).toBeFalse();
  }));

  it('undoes and redoes notes and priorities of a non-repeating subtask', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, parentId: 'b' },
    }));
    expect(service.updateNotes('a', '', 'Subtask note')).toBeTrue();
    expect(service.updatePriority('a', null, 1)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.notes ?? '').toBe('');
    expect(tasks().a.priority ?? null).toBeNull();
    expect(service.redo()).toBeTrue();
    expect(service.redo()).toBeTrue();
    expect(tasks().a.notes).toBe('Subtask note');
    expect(tasks().a.priority).toBe(1);
  });

  it('leaves subtask edits of linked or repeating parents to the existing save path', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, parentId: 'b' },
      b: { ...current.b, repeatCfgId: 'repeat' },
    }));
    expect(service.updateNotes('a', '', 'note')).toBeFalse();
    tasks.update((current) => ({
      ...current,
      b: { ...current.b, repeatCfgId: undefined, issueId: 'issue' },
    }));
    expect(service.updateNotes('a', '', 'note')).toBeFalse();
    expect(service.updatePriority('a', null, 1)).toBeTrue();
    expect(service.undo()).toBeTrue();
  });

  it('undoes a linked task priority without changing its provider link', () => {
    tasks.update((current) => ({
      ...current,
      a: {
        ...current.a,
        issueId: 'issue',
        issueProviderId: 'provider',
        issueType: 'JIRA',
      },
    }));
    expect(service.updatePriority('a', null, 2)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.priority).toBeNull();
    expect(tasks().a.issueId).toBe('issue');
    expect(tasks().a.issueProviderId).toBe('provider');
    expect(service.redo()).toBeTrue();
    expect(tasks().a.priority).toBe(2);
  });

  for (const readOnly of ['import', 'stopped'] as const) {
    it(`undoes local field edits on a ${readOnly} integration without changing its link`, () => {
      tasks.update((current) => ({
        ...current,
        a: {
          ...current.a,
          issueId: 'issue',
          issueProviderId: 'provider',
          issueType: 'JIRA',
          dueWithTime: 123,
          integration: {
            providerId: 'provider',
            providerKey: 'JIRA',
            remoteId: 'issue',
            mode: readOnly === 'import' ? 'import' : 'sync',
            stopped: readOnly === 'stopped',
          },
        },
      }));
      issueProviders.set([
        {
          id: 'calendar',
          isEnabled: true,
          issueProviderKey: 'plugin:calendar',
          pluginId: 'calendar',
          pluginConfig: { isAutoTimeBlock: true },
        } as IssueProvider,
      ]);
      const title = tasks().a.title;
      const suppression = TestBed.inject(LocalExternalSyncSuppressionService);
      expect(service.updateNotes('a', '', 'note')).toBeTrue();
      expect(suppression.isSuppressed(dispatch.calls.mostRecent().args[0])).toBeTrue();
      expect(service.updateEstimate('a', 10, 11)).toBeTrue();
      expect(suppression.isSuppressed(dispatch.calls.mostRecent().args[0])).toBeTrue();
      expect(service.updateTitle('a', title, 'Title')).toBeTrue();
      expect(suppression.isSuppressed(dispatch.calls.mostRecent().args[0])).toBeTrue();
      service.resolveTitleChange(dispatch.calls.mostRecent().args[0], false);
      expect(service.undo()).toBeTrue();
      expect(suppression.isSuppressed(dispatch.calls.mostRecent().args[0])).toBeTrue();
      expect(service.undo()).toBeTrue();
      expect(service.undo()).toBeTrue();
      expect(tasks().a.title).toBe(title);
      expect(tasks().a.timeEstimate).toBe(10);
      expect(tasks().a.notes ?? '').toBe('');
      expect(tasks().a.integration?.remoteId).toBe('issue');
    });
  }

  it('invalidates a linked priority entry if its provider identity changes', () => {
    tasks.update((current) => ({
      ...current,
      a: {
        ...current.a,
        issueId: 'issue-1',
        issueProviderId: 'provider',
        issueType: 'JIRA',
      },
    }));
    expect(service.updatePriority('a', null, 2)).toBeTrue();
    tasks.update((current) => ({ ...current, a: { ...current.a, issueId: 'issue-2' } }));
    expect(service.undo()).toBeFalse();
    expect(tasks().a.priority).toBe(2);
  });

  it('refuses to undo a subtask edit after it has been reparented', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, parentId: 'b' },
      c: task('c', 20),
    }));
    expect(service.updateNotes('a', '', 'note')).toBeTrue();
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, parentId: 'c' },
    }));
    expect(service.undo()).toBeFalse();
    expect(tasks().a.notes).toBe('note');
    expect(service.canUndo()).toBeFalse();
  });

  it('undoes and redoes a completed task reorder without changing its completion', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, isDone: true, doneOn: 123, issueId: 'issue', issueType: 'JIRA' },
    }));
    const order = { projectId: 'project', doneOn: 123, key: 'aV' };
    expect(service.updateDoneOrder('a', undefined, order)).toBeTrue();
    expect(service.undoField()).toBe('doneOrder');
    expect(service.undo()).toBeTrue();
    expect(tasks().a.doneOrder).toBeNull();
    expect(tasks().a.doneOn).toBe(123);
    expect(tasks().a.isDone).toBeTrue();
    expect(service.redo()).toBeTrue();
    expect(tasks().a.doneOrder).toEqual(order);
    expect(tasks().a.doneOn).toBe(123);
  });

  it('refuses completed-task ordering if the completion or project changes', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, isDone: true, doneOn: 123 },
    }));
    const order = { projectId: 'project', doneOn: 123, key: 'aV' };
    expect(service.updateDoneOrder('a', null, { ...order, key: 'bad!' })).toBeFalse();
    expect(
      service.updateDoneOrder('a', null, { ...order, projectId: 'other' }),
    ).toBeFalse();
    expect(service.updateDoneOrder('a', null, order)).toBeTrue();
    tasks.update((current) => ({ ...current, a: { ...current.a, doneOn: 456 } }));
    expect(service.undo()).toBeFalse();
    expect(tasks().a.doneOrder).toEqual(order);
    expect(tasks().a.doneOn).toBe(456);
  });

  it('clears previous history when a task is completed or reopened', () => {
    service.updateEstimate('a', 10, 11);
    actions.next(
      TaskSharedActions.updateTask({ task: { id: 'a', changes: { isDone: true } } }),
    );
    expect(service.canUndo()).toBeFalse();
    expect(service.undo()).toBeFalse();
    service.updateEstimate('a', 11, 12);
    actions.next(
      TaskSharedActions.updateTask({ task: { id: 'a', changes: { isDone: false } } }),
    );
    expect(service.canUndo()).toBeFalse();
  });

  it('clears history when an unrelated persistent change or remote batch arrives', () => {
    service.updateEstimate('a', 10, 11);
    actions.next(
      TaskSharedActions.updateTask({ task: { id: 'b', changes: { title: 'x' } } }),
    );
    expect(service.canUndo()).toBeFalse();
    service.updateEstimate('a', 11, 12);
    actions.next(bulkApplyOperations({ operations: [] }));
    expect(service.canUndo()).toBeFalse();
  });

  it('invalidates history on explicitly remote actions', () => {
    service.updateEstimate('a', 10, 11);
    const remoteUpdate = {
      ...TaskSharedActions.updateTask({
        task: { id: 'b', changes: { title: 'remote' } },
      }),
      meta: { isPersistent: true, isRemote: true },
    };
    actions.next(remoteUpdate);
    expect(service.canUndo()).toBeFalse();
    service.updateEstimate('a', 11, 12);
    const remoteReplacement = { type: loadAllData.type, meta: { isRemote: true } };
    actions.next(remoteReplacement);
    expect(service.canUndo()).toBeFalse();
  });

  it('refuses stale changes without overwriting another value', () => {
    service.updateEstimate('a', 10, 11);
    tasks.update((current) => ({ ...current, a: { ...current.a, timeEstimate: 12 } }));
    expect(service.undo()).toBeFalse();
    expect(tasks().a.timeEstimate).toBe(12);
    expect(service.canUndo()).toBeFalse();
  });

  it('undoes ordinary field edits on an instance of a repeating root task', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, repeatCfgId: 'repeat' },
    }));
    expect(service.updateEstimate('a', 10, 11)).toBeTrue();
    expect(service.updateNotes('a', '', 'note')).toBeTrue();
    expect(service.updatePriority('a', null, 2)).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(service.undo()).toBeTrue();
    expect(tasks().a.timeEstimate).toBe(10);
    expect(tasks().a.notes ?? '').toBe('');
    expect(tasks().a.priority ?? null).toBeNull();
  });

  it('leaves linked and child estimates to their existing save paths', () => {
    tasks.update((current) => ({
      ...current,
      a: { ...current.a, parentId: 'parent' },
      c: { ...task('c', 30), issueId: 'issue' },
    }));
    expect(service.updateEstimate('a', 10, 11)).toBeFalse();
    expect(service.updateEstimate('c', 30, 31)).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('completing and reopening one task', () => {
    it('undoes and redoes a completion through ordinary persistent updates', () => {
      expect(service.updateDone('a', false, true)).toBeTrue();
      expect(tasks().a.isDone).toBeTrue();
      expect(service.undoField()).toBe('isDone');

      expect(service.undo()).toBeTrue();
      expect(tasks().a.isDone).toBeFalse();
      expect(service.redoField()).toBe('isDone');
      expect(service.redo()).toBeTrue();
      expect(tasks().a.isDone).toBeTrue();
      expect(dispatch.calls.mostRecent().args[0]).toEqual(
        TaskSharedActions.updateTask({
          task: { id: 'a', changes: { isDone: true } },
          isIgnoreShortSyntax: true,
        }),
      );
    });

    it('undoes reopening a completed task', () => {
      tasks.update((current) => ({ ...current, a: { ...current.a, isDone: true } }));

      expect(service.updateDone('a', true, false)).toBeTrue();
      expect(service.undo()).toBeTrue();

      expect(tasks().a.isDone).toBeTrue();
    });

    it('keeps completion in order with other task edits', () => {
      expect(service.updateEstimate('a', 10, 11)).toBeTrue();
      expect(service.updateDone('a', false, true)).toBeTrue();

      expect(service.undo()).toBeTrue();
      expect(tasks().a.isDone).toBeFalse();
      expect(tasks().a.timeEstimate).toBe(11);
      expect(service.undo()).toBeTrue();
      expect(tasks().a.timeEstimate).toBe(10);
    });

    it('refuses a change the task does not show', () => {
      expect(service.updateDone('a', true, false)).toBeFalse();
      expect(service.updateDone('missing', false, true)).toBeFalse();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('leaves tasks whose completion does more to the existing path', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, repeatCfgId: 'repeat' },
        b: { ...current.b, remindAt: 1000 },
        c: { ...task('c', 30), wontDoOn: 5 },
        d: { ...task('d', 40), issueId: 'issue' },
      }));

      for (const id of ['a', 'b', 'c', 'd']) {
        expect(service.updateDone(id, false, true))
          .withContext(id)
          .toBeFalse();
      }
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('leaves a timed task to the existing path while a calendar block provider can write', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, dueWithTime: 5000 },
      }));
      issueProviders.set([
        {
          id: 'p',
          issueProviderKey: 'plugin:calendar',
          isEnabled: true,
          pluginConfig: { isAutoTimeBlock: true },
        } as unknown as IssueProvider,
      ]);

      expect(service.updateDone('a', false, true)).toBeFalse();
    });

    it('records a subtask of an ordinary parent', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, parentId: 'b' },
      }));

      expect(service.updateDone('a', false, true)).toBeTrue();
      expect(service.undo()).toBeTrue();
      expect(tasks().a.isDone).toBeFalse();
    });

    it('does not record a completion that also dispatched another persistent action', () => {
      dispatch.and.callFake((action: Action) => {
        const update = action as ReturnType<typeof TaskSharedActions.updateTask>;
        tasks.update((current) => ({
          ...current,
          a: { ...current.a, ...update.task.changes },
        }));
        actions.next(action);
        // For example the parent that completes with its last subtask.
        actions.next(
          TaskSharedActions.updateTask({
            task: { id: 'b', changes: { isDone: true } },
          }),
        );
      });
      service.updateEstimate('b', 20, 21);

      expect(service.updateDone('a', false, true)).toBeTrue();

      expect(service.canUndo()).toBeFalse();
    });

    it('refuses to undo after the done state changed elsewhere', () => {
      expect(service.updateDone('a', false, true)).toBeTrue();
      tasks.update((current) => ({ ...current, a: { ...current.a, isDone: false } }));

      expect(service.undo()).toBeFalse();
      expect(service.canUndo()).toBeFalse();
    });
  });

  describe('adding an unscheduled task to Today', () => {
    const add = (id = 'a', isShowSnack = false): boolean =>
      service.addToToday(tasks()[id], todayStr, 0, isShowSnack);

    it('dispatches the Today plan with its declaration, then undoes and redoes it', () => {
      expect(add('a', true)).toBeTrue();
      expect(tasks().a.dueDay).toBe(todayStr);
      expect(service.undoField()).toBe('dueDay');
      const plan = dispatch.calls.mostRecent().args[0] as ReturnType<
        typeof TaskSharedActions.planTasksForToday
      >;
      expect(plan.type).toBe(TaskSharedActions.planTasksForToday.type);
      expect(plan.taskIds).toEqual(['a']);
      expect(plan.today).toBe(todayStr);
      expect(plan.isShowSnack).toBeTrue();
      expect(plan.task).toEqual({ id: 'a', changes: { dueDay: todayStr } });

      expect(service.undo()).toBeTrue();
      expect(tasks().a.dueDay).toBeNull();
      expect(dispatch.calls.mostRecent().args[0]).toEqual(
        TaskSharedActions.updateTask({
          task: { id: 'a', changes: { dueDay: null } },
          isIgnoreShortSyntax: true,
        }),
      );
      expect(service.redo()).toBeTrue();
      expect(tasks().a.dueDay).toBe(todayStr);
      expect(dispatch.calls.mostRecent().args[0].type).toBe(
        TaskSharedActions.planTasksForToday.type,
      );
    });

    it('keeps its place among other edits', () => {
      expect(service.updateEstimate('a', 10, 11)).toBeTrue();
      expect(add()).toBeTrue();

      expect(service.undo()).toBeTrue();
      expect(tasks().a.dueDay).toBeNull();
      expect(tasks().a.timeEstimate).toBe(11);
      expect(service.undo()).toBeTrue();
      expect(tasks().a.timeEstimate).toBe(10);
    });

    it('leaves a task that already has a schedule, a reminder or a time to the existing path', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, dueDay: '2026-11-20' },
        b: { ...current.b, remindAt: 1000 },
        c: { ...task('c', 30), dueWithTime: 5000 },
      }));

      for (const id of ['a', 'b', 'c']) {
        expect(add(id)).withContext(id).toBeFalse();
      }
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('leaves finished, child, repeating and linked tasks to the existing path', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, isDone: true },
        b: { ...current.b, parentId: 'a' },
        c: { ...task('c', 30), repeatCfgId: 'repeat' },
        d: { ...task('d', 40), issueId: 'issue' },
      }));

      for (const id of ['a', 'b', 'c', 'd']) {
        expect(add(id)).withContext(id).toBeFalse();
      }
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('leaves a task that is already planned for today', () => {
      tasks.update((current) => ({ ...current, a: { ...current.a, dueDay: todayStr } }));

      expect(add()).toBeFalse();
    });

    it('does not redo on a later day, so it never schedules a day the user did not pick', () => {
      expect(add()).toBeTrue();
      expect(service.undo()).toBeTrue();
      todayStr = '2026-11-11';

      expect(service.redo()).toBeFalse();
      expect(tasks().a.dueDay).toBeNull();
      expect(service.canRedo()).toBeFalse();
    });

    it('still undoes after the logical day changed', () => {
      expect(add()).toBeTrue();
      todayStr = '2026-11-11';

      expect(service.undo()).toBeTrue();
      expect(tasks().a.dueDay).toBeNull();
    });

    it('refuses to undo after the task was scheduled elsewhere', () => {
      expect(add()).toBeTrue();
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, dueDay: '2026-11-20' },
      }));

      expect(service.undo()).toBeFalse();
      expect(service.canUndo()).toBeFalse();
    });
  });
  describe('deleting one task', () => {
    const withSubTasks = (id = 'a'): TaskWithSubTasks => ({
      ...tasks()[id],
      subTasks: tasks()[id].subTaskIds.map((subId) => tasks()[subId]),
    });
    const del = (id = 'a'): boolean => {
      const target = withSubTasks(id);
      return service.removeTask(target, () => remove(target));
    };

    it('deletes through the existing path, then restores and deletes again', () => {
      expect(del()).toBeTrue();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(tasks().a).toBeUndefined();
      expect(service.undoField()).toBe('delete');

      expect(service.undo()).toBeTrue();
      expect(tasks().a).toBeDefined();
      const restore = dispatch.calls.mostRecent().args[0] as ReturnType<
        typeof TaskSharedActions.restoreDeletedTask
      >;
      expect(restore.type).toBe(TaskSharedActions.restoreDeletedTask.type);
      expect(restore.task.id).toBe('a');
      expect('subTasks' in (restore.deletedTaskEntities['a'] as object)).toBeFalse();
      expect(service.redoField()).toBe('delete');

      expect(service.redo()).toBeTrue();
      expect(tasks().a).toBeUndefined();
      expect(remove).toHaveBeenCalledTimes(2);
      expect(service.undo()).toBeTrue();
      expect(tasks().a).toBeDefined();
    });

    it('restores a task together with its subtasks', () => {
      tasks.update((current) => ({
        ...current,
        a: { ...current.a, subTaskIds: ['s1', 's2'] },
        s1: { ...task('s1', 1), parentId: 'a' },
        s2: { ...task('s2', 2), parentId: 'a' },
      }));

      expect(del()).toBeTrue();
      expect(Object.keys(tasks())).toEqual(['b']);
      expect(service.undo()).toBeTrue();
      expect(Object.keys(tasks()).sort()).toEqual(['a', 'b', 's1', 's2']);
      expect(service.redo()).toBeTrue();
      expect(Object.keys(tasks())).toEqual(['b']);
    });

    it('keeps its place among other edits', () => {
      expect(service.updateEstimate('b', 20, 21)).toBeTrue();
      expect(del()).toBeTrue();

      expect(service.undo()).toBeTrue();
      expect(tasks().a).toBeDefined();
      expect(tasks().b.timeEstimate).toBe(21);
      expect(service.undo()).toBeTrue();
      expect(tasks().b.timeEstimate).toBe(20);
      expect(service.redo()).toBeTrue();
      expect(service.redo()).toBeTrue();
      expect(tasks().a).toBeUndefined();
    });

    it('leaves a linked, repeating, reminded, timed, sectioned or child task to the existing path', () => {
      tasks.update((current) => ({
        ...current,
        linked: { ...task('linked', 1), issueId: 'issue', issueType: 'GITHUB' },
        repeating: { ...task('repeating', 1), repeatCfgId: 'repeat' },
        reminded: { ...task('reminded', 1), remindAt: 1000 },
        timed: { ...task('timed', 1), dueWithTime: 5000 },
        sectioned: task('sectioned', 1),
        child: { ...task('child', 1), parentId: 'a' },
        parent: { ...task('parent', 1), subTaskIds: ['linkedChild'] },
        linkedChild: { ...task('linkedChild', 1), parentId: 'parent', issueId: 'issue' },
      }));
      sections.set([
        {
          id: 's',
          contextId: 'project',
          contextType: WorkContextType.PROJECT,
          title: 's',
          taskIds: ['sectioned'],
        },
      ]);

      for (const id of [
        'linked',
        'repeating',
        'reminded',
        'timed',
        'sectioned',
        'child',
        'parent',
      ]) {
        expect(del(id)).withContext(id).toBeFalse();
      }
      expect(remove).not.toHaveBeenCalled();
      expect(service.canUndo()).toBeFalse();
    });

    it('is cleared by another persistent change', () => {
      expect(del()).toBeTrue();
      expect(service.canUndo()).toBeTrue();

      actions.next(
        TaskSharedActions.updateTask({ task: { id: 'b', changes: { title: 'x' } } }),
      );
      expect(service.canUndo()).toBeFalse();
    });

    it('is cleared by a remote delete', () => {
      expect(del()).toBeTrue();
      const remoteDelete = TaskSharedActions.deleteTask({ task: withSubTasks('b') });
      actions.next({
        ...remoteDelete,
        meta: { ...remoteDelete.meta, isRemote: true },
      } as Action);

      expect(service.canUndo()).toBeFalse();
    });

    it('refuses to undo when the task is already back, for example from the snackbar', () => {
      expect(del()).toBeTrue();
      tasks.update((current) => ({ ...current, a: task('a', 10) }));

      expect(service.undo()).toBeFalse();
      expect(service.canUndo()).toBeFalse();
    });

    it('refuses to redo when the task no longer qualifies', () => {
      expect(del()).toBeTrue();
      expect(service.undo()).toBeTrue();
      tasks.update((current) => ({ ...current, a: { ...current.a, remindAt: 1000 } }));

      expect(service.redo()).toBeFalse();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(service.canRedo()).toBeFalse();
    });

    it('clears redo when another task is deleted after an undo', () => {
      expect(del()).toBeTrue();
      expect(service.undo()).toBeTrue();
      expect(del('b')).toBeTrue();

      expect(service.canRedo()).toBeFalse();
    });
  });
});
