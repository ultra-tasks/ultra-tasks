import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectTaskEntities } from './store/task.selectors';
import { Task } from './task.model';
import { isPluginIssueProvider } from '../issue/issue.model';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { allowsIntegrationWrites } from '../integrations/integration.model';
import { LocalExternalSyncSuppressionService } from '../integrations/local-external-sync-suppression.service';
import { hasManualDoneTaskOrder } from './done-task-order';
import { DateService } from '../../core/date/date.service';

type UndoField = 'timeEstimate' | 'notes' | 'priority' | 'title' | 'isDone' | 'dueDay';
type UndoValue = number | string | boolean | null;

interface TaskFieldChange {
  id: string;
  field: UndoField;
  parentId?: string | null;
  repeatCfgId?: string | null;
  integrationIdentity?: string;
  before: UndoValue;
  after: UndoValue;
  /** Only for `dueDay`: what redo needs to plan the task for the same day again. */
  startOfNextDayDiffMs?: number;
  isShowSnack?: boolean;
}

type DoneOrder = NonNullable<Task['doneOrder']>;

interface TaskDoneOrderChange {
  id: string;
  field: 'doneOrder';
  parentId?: string | null;
  repeatCfgId?: string | null;
  integrationIdentity?: string;
  projectId: string;
  doneOn: number | null;
  before: DoneOrder | null;
  after: DoneOrder | null;
}

type UndoEntry = TaskFieldChange | TaskDoneOrderChange;
type EntryValue = UndoValue | DoneOrder;
interface PendingTitle {
  action: ReturnType<typeof TaskSharedActions.updateTask>;
  entry: TaskFieldChange;
  generation: number;
}

const MAX_HISTORY = 50;

/** Session-only history for explicitly supported task edits. */
@Injectable({ providedIn: 'root' })
export class TaskUndoService {
  private readonly _store = inject(Store);
  // Observing remote/replayed actions is necessary to invalidate stale history;
  // entries are created only by the explicit user-intent methods below.
  private readonly _actions = inject(ALL_ACTIONS);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _date = inject(DateService);
  private readonly _externalSyncSuppression = inject(LocalExternalSyncSuppressionService);
  private readonly _tasks = this._store.selectSignal(selectTaskEntities);
  private readonly _issueProviders = this._store.selectSignal(
    selectEnabledIssueProviders,
  );
  private readonly _undo = signal<UndoEntry[]>([]);
  private readonly _redo = signal<UndoEntry[]>([]);
  private readonly _pendingTitle = signal<PendingTitle | null>(null);
  private readonly _ownActions = new WeakSet<object>();
  private _pendingTitleTimeout?: number;
  private _generation = 0;

  readonly canUndo = computed(() => !this._pendingTitle() && this._undo().length > 0);
  readonly canRedo = computed(() => !this._pendingTitle() && this._redo().length > 0);
  readonly undoField = computed(() => this._undo().at(-1)?.field ?? null);
  readonly redoField = computed(() => this._redo().at(-1)?.field ?? null);

  constructor() {
    this._destroyRef.onDestroy(() => window.clearTimeout(this._pendingTitleTimeout));
    this._actions.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((action) => {
      if (this._ownActions.has(action)) {
        this._ownActions.delete(action);
      } else if (
        isPersistentAction(action) ||
        action.type === bulkApplyOperations.type ||
        action.type === loadAllData.type
      ) {
        this.clear();
      }
    });
  }

  /**
   * Handles only an estimate-only edit of a local root task.
   * False means the caller must use the existing save path instead.
   */
  updateEstimate(id: string, expected: number, value: number): boolean {
    if (!Number.isFinite(expected) || !Number.isFinite(value)) return false;
    return this._record({ id, field: 'timeEstimate', before: expected, after: value });
  }

  updateNotes(id: string, expected: string, value: string): boolean {
    return this._record({ id, field: 'notes', before: expected, after: value });
  }

  updatePriority(
    id: string,
    expected: Task['priority'],
    value: Task['priority'],
  ): boolean {
    return this._record({
      id,
      field: 'priority',
      before: expected ?? null,
      after: value ?? null,
    });
  }

  /**
   * Handles only completing or reopening one ordinary local task. False means the
   * caller must use the existing path. A completion whose other effects write
   * more state (a reminder dismissal, a parent completed with its last subtask)
   * dispatches further persistent actions, which clear the history instead.
   */
  updateDone(id: string, expected: boolean, value: boolean): boolean {
    return this._record({ id, field: 'isDone', before: expected, after: value });
  }

  /**
   * Handles only adding one unscheduled, unfinished root task to Today. Undo takes
   * it off Today again (`updateTask` with `dueDay: null`, which the reducer
   * reconciles with the Today list and the planner); redo plans it again, for the
   * same day only. False means the caller must dispatch the plan itself.
   */
  addToToday(
    task: Task,
    today: string,
    startOfNextDayDiffMs: number,
    isShowSnack = false,
  ): boolean {
    return this._record({
      id: task.id,
      field: 'dueDay',
      before: task.dueDay ?? null,
      after: today,
      startOfNextDayDiffMs,
      isShowSnack,
    });
  }

  /** Records the manual order of one completed project task. */
  updateDoneOrder(
    id: string,
    expected: Task['doneOrder'],
    value: Task['doneOrder'],
  ): boolean {
    const task = this._tasks()[id];
    if (!task || !task.isDone || task.parentId || !task.projectId) return false;
    if (value && !hasManualDoneTaskOrder({ ...task, doneOrder: value })) return false;
    return this._record({
      id,
      field: 'doneOrder',
      projectId: task.projectId,
      doneOn: task.doneOn ?? null,
      before: expected ?? null,
      after: value ?? null,
    });
  }

  /**
   * Save the title through the normal syntax parser, then record it only if
   * the parser confirms it did not produce a compound change.
   */
  updateTitle(id: string, expected: string, value: string): boolean {
    if (this._pendingTitle()) this.clear();
    const entry: TaskFieldChange = {
      id,
      field: 'title',
      parentId: this._tasks()[id]?.parentId ?? null,
      repeatCfgId: this._tasks()[id]?.repeatCfgId ?? null,
      integrationIdentity: this._integrationIdentity(this._tasks()[id]),
      before: expected,
      after: value,
    };
    if (expected === value || !this._matches(entry, expected)) return false;
    const action = TaskSharedActions.updateTask({
      task: { id, changes: { title: value } },
    });
    this._suppressExternalSyncForReadOnly(action, this._tasks()[id]);
    const generation = this._generation;
    this._pendingTitle.set({ action, entry, generation });
    // If the parser cannot settle (for example during an incomplete load),
    // history must remain unavailable only temporarily and never skip the edit.
    this._pendingTitleTimeout = window.setTimeout(() => {
      if (this._pendingTitle()?.action === action) this.clear();
    }, 5000);
    this._ownActions.add(action);
    this._store.dispatch(action);
    if (this._generation !== generation || !this._matches(entry, value)) this.clear();
    return true;
  }

  /** Called only when the existing short-syntax effect has resolved this edit. */
  resolveTitleChange(action: object, hasShortSyntaxChanges: boolean): void {
    const pending = this._pendingTitle();
    if (!pending || pending.action !== action) return;
    this._cancelPendingTitle();
    if (
      hasShortSyntaxChanges ||
      this._generation !== pending.generation ||
      !this._matches(pending.entry, pending.entry.after)
    ) {
      this.clear();
      return;
    }
    this._push(pending.entry);
  }

  private _record(entry: UndoEntry): boolean {
    if (this._pendingTitle()) this.clear();
    entry = {
      ...entry,
      parentId: this._tasks()[entry.id]?.parentId ?? null,
      repeatCfgId: this._tasks()[entry.id]?.repeatCfgId ?? null,
      integrationIdentity: this._integrationIdentity(this._tasks()[entry.id]),
    };
    if (entry.field === 'doneOrder' && this._sameDoneOrder(entry.before, entry.after))
      return false;
    if (entry.field !== 'doneOrder' && entry.before === entry.after) return false;
    if (!this._matches(entry, entry.before)) return false;
    const generation = this._generation;
    this._dispatch(entry, entry.after);
    if (this._generation === generation && this._matches(entry, entry.after)) {
      this._push(entry);
    } else {
      this.clear();
    }
    return true;
  }

  undo(): boolean {
    if (this._pendingTitle()) return false;
    const entry = this._undo().at(-1);
    if (!entry) return false;
    if (!this._matches(entry, entry.after)) {
      this.clear();
      return false;
    }
    const generation = this._generation;
    this._dispatch(entry, entry.before);
    if (this._generation !== generation || !this._matches(entry, entry.before)) {
      this.clear();
      return false;
    }
    this._undo.update((items) => items.slice(0, -1));
    this._redo.update((items) => [...items, entry]);
    return true;
  }

  redo(): boolean {
    if (this._pendingTitle()) return false;
    const entry = this._redo().at(-1);
    if (!entry) return false;
    if (!this._matches(entry, entry.before)) {
      this.clear();
      return false;
    }
    // Planning again on a later day would schedule it for a day the user never chose.
    if (entry.field === 'dueDay' && entry.after !== this._date.todayStr()) {
      this.clear();
      return false;
    }
    const generation = this._generation;
    this._dispatch(entry, entry.after);
    if (this._generation !== generation || !this._matches(entry, entry.after)) {
      this.clear();
      return false;
    }
    this._redo.update((items) => items.slice(0, -1));
    this._undo.update((items) => [...items, entry]);
    return true;
  }

  clear(): void {
    this._generation++;
    this._cancelPendingTitle();
    this._undo.set([]);
    this._redo.set([]);
  }

  private _cancelPendingTitle(): void {
    window.clearTimeout(this._pendingTitleTimeout);
    this._pendingTitleTimeout = undefined;
    this._pendingTitle.set(null);
  }

  private _push(entry: UndoEntry): void {
    this._undo.update((items) => [...items.slice(-(MAX_HISTORY - 1)), entry]);
    this._redo.set([]);
  }

  private _matches(entry: UndoEntry, expected: EntryValue): boolean {
    const task = this._tasks()[entry.id];
    const isLocalOnlyField = entry.field === 'priority' || entry.field === 'doneOrder';
    // Planning for Today is only reversible for a task that had no schedule at all:
    // the plan also clears a reminder and a time for another day, which cannot be
    // restored, and an earlier planner day would return at the end of its list.
    if (entry.field === 'dueDay') {
      if (entry.before !== null) return false;
      if (
        task &&
        (task.isDone ||
          task.parentId ||
          task.repeatCfgId ||
          task.remindAt ||
          task.dueWithTime != null)
      )
        return false;
    }
    // Completing can start a recurrence, dismiss a reminder and finish the task
    // for an integration, and a won't-do mark is a different intent than done.
    if (
      entry.field === 'isDone' &&
      task &&
      (task.repeatCfgId || task.remindAt || task.wontDoOn)
    )
      return false;
    const isReadOnlyIntegration = !!task?.integration && !allowsIntegrationWrites(task);
    if (
      !task ||
      (!isLocalOnlyField &&
        !isReadOnlyIntegration &&
        (task.issueId || task.issueProviderId || task.issueType || task.integration))
    )
      return false;
    if ((task.parentId ?? null) !== entry.parentId) return false;
    if ((task.repeatCfgId ?? null) !== entry.repeatCfgId) return false;
    if (this._integrationIdentity(task) !== entry.integrationIdentity) return false;
    // Timed title and estimate updates can write an external calendar block.
    if (
      task.dueWithTime != null &&
      (entry.field === 'title' ||
        entry.field === 'timeEstimate' ||
        entry.field === 'isDone') &&
      allowsIntegrationWrites(task) &&
      this._issueProviders().some(
        (provider) =>
          isPluginIssueProvider(provider.issueProviderKey) &&
          'pluginConfig' in provider &&
          !!provider.pluginConfig?.['isAutoTimeBlock'],
      )
    ) {
      return false;
    }
    if (task.parentId) {
      const parent = this._tasks()[task.parentId];
      if (
        entry.field === 'timeEstimate' ||
        !parent ||
        parent.repeatCfgId ||
        (!isLocalOnlyField &&
          !(parent.integration && !allowsIntegrationWrites(parent)) &&
          (parent.issueId ||
            parent.issueProviderId ||
            parent.issueType ||
            parent.integration))
      )
        return false;
    }
    if (entry.field === 'doneOrder') {
      return (
        task.isDone &&
        !task.parentId &&
        task.projectId === entry.projectId &&
        (task.doneOn ?? null) === entry.doneOn &&
        this._sameDoneOrder(task.doneOrder ?? null, expected as DoneOrder | null)
      );
    }
    return (task[entry.field] ?? (entry.field === 'notes' ? '' : null)) === expected;
  }

  private _sameDoneOrder(a: DoneOrder | null, b: DoneOrder | null): boolean {
    return (
      a === b ||
      (!!a &&
        !!b &&
        a.projectId === b.projectId &&
        a.doneOn === b.doneOn &&
        a.key === b.key)
    );
  }

  private _integrationIdentity(task: Task | undefined): string {
    return JSON.stringify([
      task?.issueId ?? null,
      task?.issueProviderId ?? null,
      task?.issueType ?? null,
      task?.integration?.providerId ?? null,
      task?.integration?.providerKey ?? null,
      task?.integration?.remoteId ?? null,
      task?.integration?.mode ?? null,
      task?.integration?.stopped ?? null,
    ]);
  }

  private _suppressExternalSyncForReadOnly(action: object, task: Task | undefined): void {
    if (task?.integration && !allowsIntegrationWrites(task)) {
      this._externalSyncSuppression.suppress(action);
    }
  }

  private _dispatch(entry: UndoEntry, value: EntryValue): void {
    const task = this._tasks()[entry.id];
    // Planning is the original Today action (it also orders the Today list and
    // declares the fields it writes); only taking the task off Today is an update.
    const action =
      entry.field === 'dueDay' && typeof value === 'string' && task
        ? TaskSharedActions.planTasksForToday({
            taskIds: [entry.id],
            today: value,
            startOfNextDayDiffMs: entry.startOfNextDayDiffMs,
            parentTaskMap: { [entry.id]: undefined },
            isShowSnack: entry.isShowSnack,
            plannedTask: task,
          })
        : TaskSharedActions.updateTask({
            task: { id: entry.id, changes: { [entry.field]: value } as Partial<Task> },
            isIgnoreShortSyntax: true,
          });
    this._suppressExternalSyncForReadOnly(action, task);
    this._ownActions.add(action);
    this._store.dispatch(action);
  }
}
