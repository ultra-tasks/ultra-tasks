import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, forkJoin } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { isInputElement } from '../../util/dom-element';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { TaskDuplicateService } from './task-duplicate.service';
import { TaskMoveToProjectService } from './task-move-to-project.service';
import { TaskMultiSelectService } from './task-multi-select.service';
import { TaskService } from './task.service';
import { Task, TaskWithSubTasks } from './task.model';
import { taskToMarkdownChecklist } from './task-to-markdown-checklist';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { KeyboardConfig } from '@sp/keyboard-config';
import { GlobalConfigService } from '../config/global-config.service';
import { checkStandardKeyCombo } from '../../util/check-key-combo';
import { IS_MAC } from '../../util/is-mac';
import { Store } from '@ngrx/store';
import { SectionService } from '../section/section.service';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { getTaskSectionMap } from './task-bulk-action.util';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import { moveSubTask } from './store/task.actions';
import { selectTaskEntities } from './store/task.selectors';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
} from '../project/store/project.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DateService } from '../../core/date/date.service';
import {
  doneTaskOrderBetween,
  doneTaskOrderKey,
  sortDoneTasksByProjectOrder,
} from './done-task-order';
import { Project } from '../project/project.model';
import { TaskUndoService } from './task-undo.service';

const TASK_CLIPBOARD_TYPE = 'application/x-ultratasks-task-clipboard';
const WEB_TASK_CLIPBOARD_TYPE = `web ${TASK_CLIPBOARD_TYPE}`;
const TEXT_CLIPBOARD_TYPE = 'text/plain';
const HTML_CLIPBOARD_TYPE = 'text/html';
const TASK_CLIPBOARD_ATTRIBUTE = 'data-ultratasks-task-clipboard';
const DEFAULT_CLIPBOARD_KEYS = {
  taskCopy: 'Ctrl+C',
  taskCut: 'Ctrl+X',
  taskPaste: 'Ctrl+V',
} as const;
type ClipboardKey = keyof typeof DEFAULT_CLIPBOARD_KEYS;
type ClipboardEntry = { token: string; cut: boolean; tasks: TaskWithSubTasks[] };

/** A session-local clipboard marker; the OS clipboard remains the authority. */
@Injectable({ providedIn: 'root' })
export class TaskClipboardService {
  private readonly _tasks = inject(TaskService);
  private readonly _selection = inject(TaskMultiSelectService);
  private readonly _duplicate = inject(TaskDuplicateService);
  private readonly _move = inject(TaskMoveToProjectService);
  private readonly _context = inject(WorkContextService);
  private readonly _dialog = inject(MatDialog);
  private readonly _snack = inject(SnackService);
  private readonly _config = inject(GlobalConfigService);
  private readonly _store = inject(Store);
  private readonly _sections = inject(SectionService);
  private readonly _date = inject(DateService);
  private readonly _undo = inject(TaskUndoService);
  private _entry: ClipboardEntry | null = null;
  private _pasting = false;
  private _generation = 0;

  constructor() {
    // Clipboard snapshots are ephemeral, so invalidate them for remote as well
    // as local hydration; no persisted action is emitted from this listener.
    inject(ALL_ACTIONS)
      .pipe(takeUntilDestroyed())
      .subscribe((action) => {
        if (
          action.type === bulkApplyOperations.type ||
          action.type === loadAllData.type
        ) {
          this._entry = null;
          this._generation++;
        }
      });
  }

  copy(event: ClipboardEvent, cut: boolean): void {
    if (!this._isNativeBinding(cut ? 'taskCut' : 'taskCopy') || !event.clipboardData)
      return;
    const entry = this._makeEntry(event.target, cut);
    if (!entry) return;
    try {
      event.clipboardData.setData('text/plain', this._markdown(entry));
      event.clipboardData.setData(HTML_CLIPBOARD_TYPE, this._html(entry));
    } catch {
      return;
    }
    // The HTML marker also works in browsers that reject custom MIME types.
    try {
      event.clipboardData.setData(TASK_CLIPBOARD_TYPE, entry.token);
    } catch {
      // HTML and plain text were already written.
    }
    this._generation++;
    this._entry = entry;
    event.preventDefault();
    if (cut) this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CUT_READY);
  }

  /** Native clipboard events keep working normally; remapped keys use the
   * browser clipboard API so the OS clipboard remains the source of truth. */
  handleKeyDown(event: KeyboardEvent, keys: KeyboardConfig): boolean {
    if (event.repeat || !this._canUseClipboard(event.target)) return false;
    for (const key of ['taskCopy', 'taskCut', 'taskPaste'] as const) {
      const binding = keys[key] === undefined ? DEFAULT_CLIPBOARD_KEYS[key] : keys[key];
      if (!checkStandardKeyCombo(event, binding, DEFAULT_CLIPBOARD_KEYS[key])) continue;
      const isNativeKey = IS_MAC
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (this._isNativeBinding(key, keys) && isNativeKey) return false;
      if (key === 'taskPaste') {
        event.preventDefault();
        this._pasteFromSystemClipboard(event.target);
        return true;
      }
      const entry = this._makeEntry(event.target, key === 'taskCut');
      if (!entry) return false;
      event.preventDefault();
      this._writeSystemClipboard(entry);
      return true;
    }
    return false;
  }

  private _isNativeBinding(
    key: ClipboardKey,
    keys = this._config.cfg()?.keyboard,
  ): boolean {
    const binding = keys?.[key] === undefined ? DEFAULT_CLIPBOARD_KEYS[key] : keys[key];
    return (
      binding === DEFAULT_CLIPBOARD_KEYS[key] ||
      (IS_MAC && binding === DEFAULT_CLIPBOARD_KEYS[key].replace('Ctrl+', 'Meta+'))
    );
  }

  private _canUseClipboard(target: EventTarget | null): target is HTMLElement {
    return (
      target instanceof HTMLElement &&
      !isInputElement(target) &&
      !target.closest('.cdk-overlay-pane') &&
      !this._dialog.openDialogs.length &&
      !window.getSelection()?.toString()
    );
  }

  private _makeEntry(target: EventTarget | null, cut: boolean): ClipboardEntry | null {
    if (!this._canUseClipboard(target)) return null;
    const taskId = target.closest<HTMLElement>('task[data-task-id]')?.dataset.taskId;
    if (!taskId) return null;
    const ids =
      this._selection.isActive() && this._selection.has(taskId)
        ? this._selection.selectedIdsInDomOrder()
        : [taskId];
    let entry: ClipboardEntry | null = null;
    // These one-shot store selectors emit synchronously, while the browser's
    // clipboard event or user activation is still valid.
    forkJoin(ids.map((id) => this._tasks.getByIdWithSubTaskData$(id))).subscribe(
      (items) => {
        if (items.some((task) => !task)) return;
        const tasks = items.filter((task) => task != null);
        const selected = new Set(tasks.map((task) => task.id));
        const roots = tasks.filter(
          (task) => !task.parentId || !selected.has(task.parentId),
        );
        entry = { token: crypto.randomUUID(), cut, tasks: roots };
      },
    );
    return entry;
  }

  private _markdown(entry: ClipboardEntry): string {
    return entry.tasks.map(taskToMarkdownChecklist).join('\n');
  }

  // Chromium exposes web custom formats differently to ClipboardEvent and the
  // async Clipboard API. The HTML marker lets either kind of copy be pasted
  // with either kind of shortcut, while the token still has to match the
  // session-local entry. Escape task titles before putting them in HTML.
  private _html(entry: ClipboardEntry): string {
    const escaped = this._markdown(entry)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    return `<div ${TASK_CLIPBOARD_ATTRIBUTE}="${entry.token}"><pre>${escaped}</pre></div>`;
  }

  private _markerFromHtml(html: string): string | null {
    if (!html.includes(TASK_CLIPBOARD_ATTRIBUTE)) return null;
    // Inspect text only: parsing arbitrary clipboard HTML can load external
    // resources. Tokens are UUIDs generated by this session and matched again.
    return (
      /<div\b[^>]*\bdata-ultratasks-task-clipboard\s*=\s*["']([\da-f-]{36})["']/i.exec(
        html,
      )?.[1] ?? null
    );
  }

  private _writeSystemClipboard(entry: ClipboardEntry): void {
    const generation = ++this._generation;
    try {
      const item = new ClipboardItem({
        [TEXT_CLIPBOARD_TYPE]: new Blob([this._markdown(entry)], {
          type: TEXT_CLIPBOARD_TYPE,
        }),
        [HTML_CLIPBOARD_TYPE]: new Blob([this._html(entry)], {
          type: HTML_CLIPBOARD_TYPE,
        }),
      });
      void navigator.clipboard
        .write([item])
        .then(() => {
          if (generation !== this._generation) return;
          this._entry = entry;
          if (entry.cut) this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CUT_READY);
        })
        .catch(() => this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_UNAVAILABLE));
    } catch {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_UNAVAILABLE);
    }
  }

  private _pasteFromSystemClipboard(target: EventTarget | null): void {
    try {
      void navigator.clipboard
        .read()
        .then(async (items) => {
          for (const item of items) {
            const type = item.types.find(
              (t) => t === WEB_TASK_CLIPBOARD_TYPE || t === TASK_CLIPBOARD_TYPE,
            );
            const marker = type
              ? await (await item.getType(type)).text()
              : item.types.includes(HTML_CLIPBOARD_TYPE)
                ? this._markerFromHtml(
                    await (await item.getType(HTML_CLIPBOARD_TYPE)).text(),
                  )
                : null;
            if (marker) {
              const text = item.types.includes(TEXT_CLIPBOARD_TYPE)
                ? await (await item.getType(TEXT_CLIPBOARD_TYPE)).text()
                : '';
              this._pasteMarker(marker, target, text);
              return;
            }
          }
          this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_EXPIRED);
        })
        .catch(() => this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_UNAVAILABLE));
    } catch {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_UNAVAILABLE);
    }
  }

  /** Returns true only for a task clipboard written in this app session. */
  paste(event: ClipboardEvent): boolean {
    if (
      event.target instanceof HTMLElement &&
      (isInputElement(event.target) || event.target.closest('.cdk-overlay-pane'))
    )
      return false;
    if (this._dialog.openDialogs.length) return false;
    const marker =
      event.clipboardData?.getData(TASK_CLIPBOARD_TYPE) ||
      event.clipboardData?.getData(WEB_TASK_CLIPBOARD_TYPE) ||
      this._markerFromHtml(event.clipboardData?.getData(HTML_CLIPBOARD_TYPE) || '');
    if (!marker) return false;
    if (!this._isNativeBinding('taskPaste')) {
      event.preventDefault();
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_USE_BINDING);
      return true;
    }
    event.preventDefault();
    this._pasteMarker(
      marker,
      event.target,
      event.clipboardData?.getData(TEXT_CLIPBOARD_TYPE) || '',
    );
    return true;
  }

  private _pasteMarker(marker: string, target: EventTarget | null, text: string): void {
    const entry = this._entry;
    if (
      !entry ||
      marker !== entry.token ||
      text.replaceAll('\r\n', '\n') !== this._markdown(entry).replaceAll('\r\n', '\n')
    ) {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_EXPIRED);
      return;
    }
    if (!this._pasting) {
      this._pasting = true;
      void this._paste(entry, target)
        .catch(() => this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE))
        .finally(() => {
          this._pasting = false;
        });
    }
  }

  private async _paste(
    entry: NonNullable<TaskClipboardService['_entry']>,
    target: EventTarget | null,
  ): Promise<void> {
    const targetId =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>('task[data-task-id]')?.dataset.taskId
        : undefined;
    const targetTask = targetId
      ? await firstValueFrom(this._tasks.getByIdOnce$(targetId))
      : null;
    if (this._entry !== entry) return;
    const projectId =
      targetTask?.projectId ||
      (this._context.activeWorkContextType === WorkContextType.PROJECT
        ? this._context.activeWorkContextId
        : undefined);
    if (!projectId) {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_NEED_PROJECT);
      return;
    }
    if (!entry.cut) {
      for (const task of entry.tasks) this._duplicate.duplicate(task, projectId, true);
      return;
    }
    // Re-read all sources before any move: sync or another edit may have
    // changed their location after the cut.
    const current: TaskWithSubTasks[] = [];
    for (const captured of entry.tasks) {
      const task = await firstValueFrom(this._tasks.getByIdWithSubTaskData$(captured.id));
      if (
        this._entry !== entry ||
        !task ||
        task.parentId !== captured.parentId ||
        task.projectId !== captured.projectId
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      current.push(task);
    }
    if (targetId && current.some((task) => task.id === targetId)) {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
      return;
    }
    if (current.some((task) => task.parentId)) {
      if (current.some((task) => !task.parentId)) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      if (!targetTask) {
        if (current.some((task) => task.projectId !== projectId)) {
          this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_SUBTASK_OTHER_PROJECT);
          return;
        }
        const projects = await firstValueFrom(
          this._store.select(selectProjectFeatureState),
        );
        if (this._entry !== entry || !projects.entities[projectId]) {
          this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
          return;
        }
        // Conversion removes the child and inserts the parent task in one
        // replayable operation. With no focused row, insert at the top.
        let afterTaskId: string | null = null;
        for (const task of current) {
          const parent = await firstValueFrom(this._tasks.getByIdOnce$(task.parentId!));
          if (this._entry !== entry || !parent || parent.parentId) return;
          this._store.dispatch(
            TaskSharedActions.convertToMainTask({
              task,
              parentTagIds: parent.tagIds,
              afterTaskId,
              today: this._date.todayStr(),
              modified: Date.now(),
            }),
          );
          afterTaskId = task.id;
          entry.tasks = entry.tasks.filter((item) => item.id !== task.id);
        }
        if (this._entry === entry) this._entry = null;
        return;
      }
      const parentId = targetTask.parentId || targetTask.id;
      const parent = await firstValueFrom(this._tasks.getByIdOnce$(parentId));
      if (
        this._entry !== entry ||
        !parent ||
        parent.parentId ||
        current.some((task) => task.id === parent.id)
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      let afterTaskId: string | null = targetTask.parentId
        ? targetTask.id
        : (parent.subTaskIds
            .filter((id) => !current.some((task) => task.id === id))
            .at(-1) ?? null);
      for (const task of current) {
        this._store.dispatch(
          moveSubTask({
            taskId: task.id,
            srcTaskId: task.parentId!,
            targetTaskId: parent.id,
            afterTaskId,
          }),
        );
        afterTaskId = task.id;
      }
      if (this._entry === entry) this._entry = null;
      return;
    }
    if (current.some((task) => task.projectId === projectId)) {
      const isSameProject = current.every((task) => task.projectId === projectId);
      const list =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>('.task-list-inner')
          : null;
      const listId =
        list?.dataset.id ?? (current.every((task) => task.isDone) ? 'DONE' : 'UNDONE');
      if (
        !isSameProject ||
        (!targetTask &&
          current.some((task) => task.isDone) &&
          current.some((task) => !task.isDone)) ||
        (targetTask && (targetTask.parentId || list?.dataset.listId !== 'PARENT')) ||
        this._context.activeWorkContextType !== WorkContextType.PROJECT ||
        this._context.activeWorkContextId !== projectId
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      const [projects, sections] = await Promise.all([
        firstValueFrom(this._store.select(selectProjectFeatureState)),
        firstValueFrom(this._sections.getSectionsByContextId$(projectId)),
      ]);
      const project = projects.entities[projectId];
      const sourceSections = getTaskSectionMap(sections);
      const targetSection = sections.find((section) => section.id === listId);
      if (
        this._entry !== entry ||
        !project ||
        !current.every(
          (task) =>
            project.taskIds.includes(task.id) ||
            project.backlogTaskIds?.includes(task.id),
        ) ||
        (targetTask &&
          ![...project.taskIds, ...(project.backlogTaskIds ?? [])].includes(
            targetTask.id,
          )) ||
        (!['UNDONE', 'DONE', 'BACKLOG'].includes(listId) && !targetSection) ||
        (targetTask &&
          listId === 'BACKLOG' &&
          !project.backlogTaskIds?.includes(targetTask.id)) ||
        (targetTask &&
          targetSection &&
          (sourceSections.get(targetTask.id) ?? null) !== targetSection.id) ||
        (targetTask && listId === 'UNDONE' && sourceSections.has(targetTask.id))
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      if (
        listId === 'DONE' &&
        current.every((task) => task.isDone && project.taskIds.includes(task.id))
      ) {
        await this._reorderDoneTasks(entry, current, targetTask, project);
        return;
      }
      // Existing drag operations also reject direct section/backlog crossings.
      if (
        (listId === 'BACKLOG' && current.some((task) => sourceSections.has(task.id))) ||
        (targetSection &&
          current.some((task) => project.backlogTaskIds?.includes(task.id)))
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_SECTION_BACKLOG);
        return;
      }
      if (
        (listId === 'BACKLOG' && !project.isEnableBacklog) ||
        (targetSection && current.some((task) => task.isDone)) ||
        (listId === 'UNDONE' &&
          current.some((task) => task.isDone && sourceSections.has(task.id))) ||
        (listId === 'DONE' && current.some((task) => sourceSections.has(task.id)))
      ) {
        this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
        return;
      }
      let afterTaskId: string | null = targetTask?.id ?? null;
      for (const task of current) {
        const sourceSectionId = sourceSections.get(task.id) ?? null;
        const isBacklog = !!project.backlogTaskIds?.includes(task.id);
        if (targetSection) {
          this._sections.addTaskToSection(
            targetSection.id,
            task.id,
            afterTaskId,
            sourceSectionId,
          );
        } else if (listId === 'BACKLOG') {
          this._store.dispatch(
            isBacklog
              ? moveProjectTaskInBacklogList({
                  taskId: task.id,
                  afterTaskId,
                  workContextId: projectId,
                })
              : moveProjectTaskToBacklogList({
                  taskId: task.id,
                  afterTaskId,
                  workContextId: projectId,
                }),
          );
        } else if (isBacklog) {
          this._store.dispatch(
            moveProjectTaskToRegularList({
              taskId: task.id,
              afterTaskId,
              workContextId: projectId,
              src: 'BACKLOG',
              target: listId as 'DONE' | 'UNDONE',
            }),
          );
        } else if (sourceSectionId) {
          this._sections.removeTaskFromSection(
            sourceSectionId,
            task.id,
            projectId,
            WorkContextType.PROJECT,
            afterTaskId,
          );
        } else {
          this._store.dispatch(
            moveTaskInTodayList({
              taskId: task.id,
              afterTaskId,
              src: task.isDone ? 'DONE' : 'UNDONE',
              target: listId as 'DONE' | 'UNDONE',
              workContextId: projectId,
              workContextType: WorkContextType.PROJECT,
            }),
          );
        }
        afterTaskId = task.id;
      }
      if (listId === 'DONE') {
        // Crossing into Done also changes completion in the existing effects.
        // Re-read both models after those actions before assigning a position;
        // a previous completion timestamp must never be reused for the rank.
        const [updatedProjects, entities] = await Promise.all([
          firstValueFrom(this._store.select(selectProjectFeatureState)),
          firstValueFrom(this._store.select(selectTaskEntities)),
        ]);
        const updatedProject = updatedProjects.entities[projectId];
        const completed = current.map((task) => entities[task.id]);
        if (
          this._entry === entry &&
          updatedProject &&
          completed.every(
            (task): task is Task =>
              !!task && task.isDone && updatedProject.taskIds.includes(task.id),
          )
        ) {
          // This placement is part of a larger move, so don't present the
          // ordering alone as an undo of the whole operation.
          await this._reorderDoneTasks(
            entry,
            completed,
            targetTask,
            updatedProject,
            false,
          );
        }
      }
      if (this._entry === entry) this._entry = null;
      return;
    }
    // Cross-project parent moves keep the existing recurring-task confirmation.
    for (const captured of [...entry.tasks]) {
      if (!entry.tasks.some((item) => item.id === captured.id)) continue;
      const task = await firstValueFrom(this._tasks.getByIdWithSubTaskData$(captured.id));
      if (this._entry !== entry || !task || task.projectId !== captured.projectId) return;
      if (!(await this._move.moveToProject(task, projectId))) return;
      if (this._entry !== entry) return;
      entry.tasks = entry.tasks.filter(
        (item) =>
          item.id !== captured.id &&
          (!captured.repeatCfgId || item.repeatCfgId !== captured.repeatCfgId),
      );
    }
    if (this._entry === entry) this._entry = null;
  }

  private async _reorderDoneTasks(
    entry: ClipboardEntry,
    moving: Task[],
    target: Task | null,
    project: Project,
    recordHistory = true,
  ): Promise<void> {
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    if (this._entry !== entry) return;
    const movingIds = new Set(moving.map((task) => task.id));
    const done = sortDoneTasksByProjectOrder(
      project.taskIds
        .map((id) => entities[id])
        .filter((task): task is Task => !!task && task.isDone && !movingIds.has(task.id)),
    );
    const targetIndex = target ? done.findIndex((task) => task.id === target.id) : -1;
    if (target && targetIndex < 0) {
      this._snack.open(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
      return;
    }
    let lower = target ? doneTaskOrderKey(done[targetIndex]) : null;
    const next = done[targetIndex + 1];
    const upper = next ? doneTaskOrderKey(next) : null;
    for (const task of moving) {
      const key = doneTaskOrderBetween(lower, upper, task.id);
      const doneOrder = { projectId: project.id, doneOn: task.doneOn ?? null, key };
      if (
        !recordHistory ||
        moving.length !== 1 ||
        !this._undo.updateDoneOrder(task.id, task.doneOrder, doneOrder)
      ) {
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: { id: task.id, changes: { doneOrder } },
            isIgnoreShortSyntax: true,
          }),
        );
      }
      lower = key;
    }
    if (this._entry === entry) this._entry = null;
  }
}
