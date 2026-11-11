import { signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { Subject } from 'rxjs';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task } from './task.model';
import { TaskUndoService } from './task-undo.service';
import { selectTaskEntities } from './store/task.selectors';
import { IssueProvider } from '../issue/issue.model';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { LocalExternalSyncSuppressionService } from '../integrations/local-external-sync-suppression.service';

describe('TaskUndoService', () => {
  const actions = new Subject<Action>();
  let tasks: ReturnType<typeof signal<Record<string, Task>>>;
  let service: TaskUndoService;
  let dispatch: jasmine.Spy;
  let issueProviders: ReturnType<typeof signal<IssueProvider[]>>;

  const task = (id: string, timeEstimate: number): Task => ({
    ...DEFAULT_TASK,
    id,
    projectId: 'project',
    timeEstimate,
  });

  beforeEach(() => {
    tasks = signal({ a: task('a', 10), b: task('b', 20) });
    issueProviders = signal<IssueProvider[]>([]);
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
      actions.next(action);
    });
    TestBed.configureTestingModule({
      providers: [
        TaskUndoService,
        {
          provide: Store,
          useValue: {
            selectSignal: (selector: unknown) => {
              if (selector === selectTaskEntities) return tasks;
              if (selector === selectEnabledIssueProviders) return issueProviders;
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
});
