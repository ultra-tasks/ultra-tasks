import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { TaskClipboardService } from './task-clipboard.service';
import { TaskDuplicateService } from './task-duplicate.service';
import { TaskMoveToProjectService } from './task-move-to-project.service';
import { TaskMultiSelectService } from './task-multi-select.service';
import { DEFAULT_TASK, TaskWithSubTasks } from './task.model';
import { TaskService } from './task.service';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { GlobalConfigService } from '../config/global-config.service';
import { Store } from '@ngrx/store';
import { SectionService } from '../section/section.service';
import { moveSubTask } from './store/task.actions';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
} from '../project/store/project.actions';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { TaskUndoService } from './task-undo.service';
import { T } from '../../t.const';

describe('TaskClipboardService', () => {
  let service: TaskClipboardService;
  let duplicate: jasmine.Spy;
  let move: jasmine.Spy;
  let task: TaskWithSubTasks;
  let host: HTMLElement;
  let actions: Subject<{ type: string }>;

  beforeEach(() => {
    task = {
      ...DEFAULT_TASK,
      id: 'one',
      title: 'One',
      projectId: 'source',
      subTasks: [],
    };
    host = document.createElement('task');
    actions = new Subject();
    host.dataset.taskId = 'one';
    document.body.append(host);
    duplicate = jasmine.createSpy('duplicate');
    move = jasmine.createSpy('moveToProject').and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        TaskClipboardService,
        { provide: TaskUndoService, useValue: { updateDoneOrder: () => false } },
        { provide: DateService, useValue: { todayStr: () => '2026-11-10' } },
        { provide: GlobalConfigService, useValue: { cfg: () => ({ keyboard: {} }) } },
        {
          provide: Store,
          useValue: {
            dispatch: jasmine.createSpy('dispatch'),
            select: () => of({ entities: {} }),
          },
        },
        {
          provide: SectionService,
          useValue: {
            getSectionsByContextId$: () => of([]),
            addTaskToSection: jasmine.createSpy('addTaskToSection'),
            removeTaskFromSection: jasmine.createSpy('removeTaskFromSection'),
          },
        },
        { provide: ALL_ACTIONS, useValue: actions },
        {
          provide: TaskService,
          useValue: {
            getByIdWithSubTaskData$: () => of(task),
            getByIdOnce$: () => of({ ...task, projectId: 'target' }),
          },
        },
        {
          provide: TaskMultiSelectService,
          useValue: {
            isActive: () => false,
            has: () => false,
            selectedIdsInDomOrder: () => [],
          },
        },
        { provide: TaskDuplicateService, useValue: { duplicate } },
        { provide: TaskMoveToProjectService, useValue: { moveToProject: move } },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextType: WorkContextType.PROJECT,
            activeWorkContextId: 'target',
          },
        },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    service = TestBed.inject(TaskClipboardService);
  });

  afterEach(() => host.remove());

  const clipboardEvent = (
    type: string,
    target: HTMLElement,
    data: DataTransfer,
  ): ClipboardEvent => {
    const event = new ClipboardEvent(type, { clipboardData: data, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };

  it('copies readable Markdown and duplicates the task when pasted into a project', fakeAsync(() => {
    const data = new DataTransfer();
    const copy = clipboardEvent('copy', host, data);
    service.copy(copy, false);
    expect(copy.defaultPrevented).toBeTrue();
    expect(data.getData('text/plain')).toBe('- [ ] One');
    const paste = clipboardEvent('paste', document.body, data);
    expect(service.paste(paste)).toBeTrue();
    tick();
    expect(duplicate).toHaveBeenCalledOnceWith(task, 'target', true);
  }));

  it('copies a selected parent and child only once in Markdown and task data', fakeAsync(() => {
    const child = {
      ...DEFAULT_TASK,
      id: 'child',
      parentId: 'one',
      title: 'Child',
      projectId: 'source',
    };
    const parent = { ...task, subTasks: [child], subTaskIds: ['child'] };
    const selection = TestBed.inject(TaskMultiSelectService);
    spyOn(selection, 'isActive').and.returnValue(true);
    spyOn(selection, 'has').and.returnValue(true);
    spyOn(selection, 'selectedIdsInDomOrder').and.returnValue(['one', 'child']);
    spyOn(TestBed.inject(TaskService), 'getByIdWithSubTaskData$').and.callFake((id) =>
      of(id === 'one' ? parent : { ...child, subTasks: [] }),
    );
    const data = new DataTransfer();
    service.copy(clipboardEvent('copy', host, data), false);
    expect(data.getData('text/plain')).toBe('- [ ] One\n  - [ ] Child');
    expect(service.paste(clipboardEvent('paste', document.body, data))).toBeTrue();
    tick();
    expect(duplicate).toHaveBeenCalledOnceWith(parent, 'target', true);
  }));

  it('does not treat ordinary Markdown as an internal task clipboard', () => {
    const data = new DataTransfer();
    data.setData('text/plain', '- [ ] One');
    expect(service.paste(clipboardEvent('paste', document.body, data))).toBeFalse();
  });

  it('accepts the session marker in HTML when the custom clipboard format is unavailable', fakeAsync(() => {
    task = { ...task, title: '<unsafe> & task' };
    const copied = new DataTransfer();
    service.copy(clipboardEvent('copy', host, copied), false);
    expect(copied.getData('text/html')).toContain('&lt;unsafe&gt; &amp; task');
    const pasted = new DataTransfer();
    pasted.setData('text/plain', copied.getData('text/plain'));
    pasted.setData('text/html', copied.getData('text/html'));
    expect(service.paste(clipboardEvent('paste', document.body, pasted))).toBeTrue();
    tick();
    expect(duplicate).toHaveBeenCalledOnceWith(task, 'target', true);
  }));

  it('does not move a task if clipboard text changed while an HTML marker remained', () => {
    const copied = new DataTransfer();
    service.copy(clipboardEvent('cut', host, copied), true);
    const pasted = new DataTransfer();
    pasted.setData('text/html', copied.getData('text/html'));
    pasted.setData('text/plain', '- [ ] Changed outside the app');
    const event = clipboardEvent('paste', document.body, pasted);
    expect(service.paste(event)).toBeTrue();
    expect(event.defaultPrevented).toBeTrue();
    expect(move).not.toHaveBeenCalled();
  });

  it('rejects a task clipboard after sync invalidates its session data', () => {
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    actions.next(bulkApplyOperations({ operations: [] }));
    const paste = clipboardEvent('paste', document.body, data);
    expect(service.paste(paste)).toBeTrue();
    expect(paste.defaultPrevented).toBeTrue();
    expect(move).not.toHaveBeenCalled();
  });

  it('moves a cut task only once after paste into another project', fakeAsync(() => {
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    expect(move).not.toHaveBeenCalled();
    expect(service.paste(clipboardEvent('paste', document.body, data))).toBeTrue();
    tick();
    expect(move).toHaveBeenCalledOnceWith(task, 'target');
    const repeatedPaste = clipboardEvent('paste', document.body, data);
    expect(service.paste(repeatedPaste)).toBeTrue();
    expect(repeatedPaste.defaultPrevented).toBeTrue();
    expect(move).toHaveBeenCalledTimes(1);
  }));

  it('moves an independently cut subtask after a sibling', fakeAsync(() => {
    task = { ...task, id: 'one', parentId: 'old-parent' };
    const sibling = { ...task, id: 'sibling', parentId: 'new-parent' };
    const parent = {
      ...task,
      id: 'new-parent',
      parentId: undefined,
      subTaskIds: ['sibling'],
    };
    const tasks = TestBed.inject(TaskService);
    spyOn(tasks, 'getByIdOnce$').and.callFake((id) =>
      of(id === 'sibling' ? sibling : parent),
    );
    const destination = document.createElement('task');
    destination.dataset.taskId = 'sibling';
    document.body.append(destination);
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      moveSubTask({
        taskId: 'one',
        srcTaskId: 'old-parent',
        targetTaskId: 'new-parent',
        afterTaskId: 'sibling',
      }),
    );
    destination.remove();
  }));

  it('reorders a cut task after a focused task in the same project', fakeAsync(() => {
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'UNDONE';
    list.append(destination);
    document.body.append(list);
    const targetTask = { ...task, id: 'two' };
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(of(targetTask));
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({ entities: { source: { taskIds: ['one', 'two'] } } }) as any,
    );
    const context = TestBed.inject(WorkContextService);
    Object.defineProperty(context, 'activeWorkContextId', { value: 'source' });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      moveTaskInTodayList({
        taskId: 'one',
        afterTaskId: 'two',
        src: 'UNDONE',
        target: 'UNDONE',
        workContextId: 'source',
        workContextType: WorkContextType.PROJECT,
      }),
    );
    list.remove();
  }));

  describe('placing copies and cross-project moves like any other paste', () => {
    let list: HTMLElement;
    let destination: HTMLElement;
    let dispatch: jasmine.Spy;
    let snack: jasmine.Spy;

    const taskIn = (id: string, extra: Record<string, unknown> = {}): TaskWithSubTasks =>
      ({ ...task, id, projectId: 'source', ...extra }) as TaskWithSubTasks;

    const mount = (listId = 'UNDONE'): void => {
      destination = document.createElement('task');
      destination.dataset.taskId = 'two';
      list = document.createElement('div');
      list.className = 'task-list-inner';
      list.dataset.listId = 'PARENT';
      list.dataset.id = listId;
      list.append(destination);
      document.body.append(list);
    };

    beforeEach(() => {
      dispatch = TestBed.inject(Store).dispatch as jasmine.Spy;
      snack = TestBed.inject(SnackService).open as jasmine.Spy;
      const context = TestBed.inject(WorkContextService);
      Object.defineProperty(context, 'activeWorkContextId', { value: 'source' });
      spyOn(TestBed.inject(Store), 'select').and.returnValue(
        of({
          entities: { source: { taskIds: ['copy-1', 'copy-2', 'two', 'one'] } },
        }) as any,
      );
    });
    afterEach(() => list?.remove());

    const copyAndPaste = (at: HTMLElement, cut = false): void => {
      const data = new DataTransfer();
      service.copy(clipboardEvent(cut ? 'cut' : 'copy', host, data), cut);
      service.paste(clipboardEvent('paste', at, data));
      tick();
    };

    it('puts a copy after the focused task and keeps the clipboard', fakeAsync(() => {
      mount();
      duplicate.and.returnValue('copy-1');
      const tasks = TestBed.inject(TaskService);
      spyOn(tasks, 'getByIdOnce$').and.returnValue(of(taskIn('two')));
      spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake((id) =>
        of(id === 'copy-1' ? taskIn('copy-1') : taskIn('one')),
      );

      const data = new DataTransfer();
      service.copy(clipboardEvent('copy', host, data), false);
      service.paste(clipboardEvent('paste', destination, data));
      tick();
      service.paste(clipboardEvent('paste', destination, data));
      tick();

      expect(dispatch).toHaveBeenCalledWith(
        moveTaskInTodayList({
          taskId: 'copy-1',
          afterTaskId: 'two',
          src: 'UNDONE',
          target: 'UNDONE',
          workContextId: 'source',
          workContextType: WorkContextType.PROJECT,
        }),
      );
      expect(duplicate).toHaveBeenCalledTimes(2);
    }));

    it('puts a copy after the parent of a focused subtask', fakeAsync(() => {
      mount();
      const subtask = document.createElement('task');
      subtask.dataset.taskId = 'sub';
      destination.append(subtask);
      duplicate.and.returnValue('copy-1');
      const tasks = TestBed.inject(TaskService);
      spyOn(tasks, 'getByIdOnce$').and.callFake((id) =>
        of(id === 'sub' ? taskIn('sub', { parentId: 'two' }) : taskIn('two')),
      );
      spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake((id) =>
        of(id === 'copy-1' ? taskIn('copy-1') : taskIn('one')),
      );

      copyAndPaste(subtask);

      expect(dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ taskId: 'copy-1', afterTaskId: 'two' }),
      );
    }));

    it('leaves a single copy at the top when nothing is focused', fakeAsync(() => {
      duplicate.and.returnValue('copy-1');

      copyAndPaste(document.body);

      expect(duplicate).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ taskId: 'copy-1' }),
      );
    }));

    it('keeps several copies in order at the top when nothing is focused', fakeAsync(() => {
      const tasks = TestBed.inject(TaskService);
      duplicate.and.returnValues('copy-1', 'copy-2');
      const selection = TestBed.inject(TaskMultiSelectService);
      spyOn(selection, 'isActive').and.returnValue(true);
      spyOn(selection, 'has').and.returnValue(true);
      spyOn(selection, 'selectedIdsInDomOrder').and.returnValue(['one', 'other']);
      spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake((id) => of(taskIn(id)));

      copyAndPaste(document.body);

      expect(dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ taskId: 'copy-1', afterTaskId: null }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({ taskId: 'copy-2', afterTaskId: 'copy-1' }),
      );
    }));

    it('keeps a copy at the top, without an error, when the target list cannot take it', fakeAsync(() => {
      mount('unknown-section');
      duplicate.and.returnValue('copy-1');
      const tasks = TestBed.inject(TaskService);
      spyOn(tasks, 'getByIdOnce$').and.returnValue(of(taskIn('two')));
      spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake((id) =>
        of(id === 'copy-1' ? taskIn('copy-1') : taskIn('one')),
      );

      copyAndPaste(destination);

      expect(dispatch).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ taskId: 'copy-1' }),
      );
      expect(snack).not.toHaveBeenCalled();
    }));

    it('puts a task cut from another project after the focused task', fakeAsync(() => {
      mount();
      let isMoved = false;
      move.and.callFake(async () => {
        isMoved = true;
        return true;
      });
      const tasks = TestBed.inject(TaskService);
      spyOn(tasks, 'getByIdOnce$').and.returnValue(of(taskIn('two')));
      spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake((id) =>
        of(
          id === 'one' && !isMoved
            ? taskIn('one', { projectId: 'elsewhere' })
            : taskIn(id),
        ),
      );

      copyAndPaste(destination, true);

      expect(move).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(
        moveTaskInTodayList({
          taskId: 'one',
          afterTaskId: 'two',
          src: 'UNDONE',
          target: 'UNDONE',
          workContextId: 'source',
          workContextType: WorkContextType.PROJECT,
        }),
      );
    }));
  });

  it('moves a cut task between project sections using the normal section action', fakeAsync(() => {
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'section-b';
    list.append(destination);
    document.body.append(list);
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(
      of({ ...task, id: 'two' }),
    );
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({ entities: { source: { taskIds: ['one', 'two'] } } }) as any,
    );
    const sectionService = TestBed.inject(SectionService);
    spyOn(sectionService, 'getSectionsByContextId$').and.returnValue(
      of([
        {
          id: 'section-a',
          title: 'A',
          contextId: 'source',
          contextType: WorkContextType.PROJECT,
          taskIds: ['one'],
        },
        {
          id: 'section-b',
          title: 'B',
          contextId: 'source',
          contextType: WorkContextType.PROJECT,
          taskIds: ['two'],
        },
      ]),
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(sectionService.addTaskToSection).toHaveBeenCalledOnceWith(
      'section-b',
      'one',
      'two',
      'section-a',
    );
    list.remove();
  }));

  it('reorders a cut task within the backlog', fakeAsync(() => {
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'BACKLOG';
    list.append(destination);
    document.body.append(list);
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(
      of({ ...task, id: 'two' }),
    );
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({
        entities: {
          source: { taskIds: [], backlogTaskIds: ['one', 'two'], isEnableBacklog: true },
        },
      }) as any,
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      moveProjectTaskInBacklogList({
        taskId: 'one',
        afterTaskId: 'two',
        workContextId: 'source',
      }),
    );
    list.remove();
  }));

  it('moves a regular task into the backlog', fakeAsync(() => {
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'BACKLOG';
    list.append(destination);
    document.body.append(list);
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(
      of({ ...task, id: 'two' }),
    );
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({
        entities: {
          source: { taskIds: ['one'], backlogTaskIds: ['two'], isEnableBacklog: true },
        },
      }) as any,
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      moveProjectTaskToBacklogList({
        taskId: 'one',
        afterTaskId: 'two',
        workContextId: 'source',
      }),
    );
    list.remove();
  }));

  it('moves a backlog task into the regular list', fakeAsync(() => {
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'UNDONE';
    list.append(destination);
    document.body.append(list);
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(
      of({ ...task, id: 'two' }),
    );
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({
        entities: {
          source: { taskIds: ['two'], backlogTaskIds: ['one'], isEnableBacklog: true },
        },
      }) as any,
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      moveProjectTaskToRegularList({
        taskId: 'one',
        afterTaskId: 'two',
        workContextId: 'source',
        src: 'BACKLOG',
        target: 'UNDONE',
      }),
    );
    list.remove();
  }));

  it('promotes a cut subtask to its project root when no task is focused', fakeAsync(() => {
    task = { ...task, parentId: 'parent' };
    const parent = { ...task, id: 'parent', parentId: undefined, tagIds: ['tag'] };
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.returnValue(of(parent));
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({ entities: { source: { id: 'source' } } }) as any,
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', document.body, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: TaskSharedActions.convertToMainTask.type,
        task,
        parentTagIds: ['tag'],
        afterTaskId: null,
        today: '2026-11-10',
      }),
    );
  }));

  it('promotes a cut subtask into another project and places it at the top', fakeAsync(() => {
    task = { ...task, parentId: 'parent' };
    const parent = { ...task, id: 'parent', parentId: undefined, tagIds: ['tag'] };
    let isMoved = false;
    move.and.callFake(async () => {
      isMoved = true;
      return true;
    });
    const tasks = TestBed.inject(TaskService);
    spyOn(tasks, 'getByIdOnce$').and.returnValue(of(parent));
    spyOn(tasks, 'getByIdWithSubTaskData$').and.callFake(() =>
      of(
        isMoved
          ? { ...task, parentId: undefined, projectId: 'target' }
          : { ...task, parentId: isMoved ? undefined : task.parentId },
      ),
    );
    spyOn(TestBed.inject(Store), 'select').and.returnValue(
      of({ entities: { target: { id: 'target', taskIds: ['one'] } } }) as any,
    );
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', document.body, data));
    tick();
    const dispatch = TestBed.inject(Store).dispatch as jasmine.Spy;
    expect(dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: TaskSharedActions.convertToMainTask.type,
        parentTagIds: ['tag'],
        afterTaskId: null,
      }),
    );
    expect(move).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ id: 'one' }),
      'target',
    );
    expect(dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        taskId: 'one',
        afterTaskId: null,
        workContextId: 'target',
      }),
    );
    const snack = TestBed.inject(SnackService).open as jasmine.Spy;
    expect(snack).not.toHaveBeenCalledWith(T.GCF.KEYBOARD.CLIPBOARD_CANNOT_MOVE);
    expect(snack).not.toHaveBeenCalledWith(
      T.GCF.KEYBOARD.CLIPBOARD_SUBTASK_OTHER_PROJECT,
    );
  }));

  it('still refuses to move a repeating task subtask into another project', fakeAsync(() => {
    task = { ...task, parentId: 'parent', repeatCfgId: 'repeat' };
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', document.body, data));
    tick();
    expect(move).not.toHaveBeenCalled();
    expect(TestBed.inject(SnackService).open).toHaveBeenCalledWith(
      T.GCF.KEYBOARD.CLIPBOARD_SUBTASK_OTHER_PROJECT,
    );
  }));

  it('reorders completed tasks without changing their completion timestamps', fakeAsync(() => {
    task = { ...task, isDone: true, doneOn: 3000 };
    const destinationTask = { ...task, id: 'two', doneOn: 2000 };
    const destination = document.createElement('task');
    destination.dataset.taskId = 'two';
    const list = document.createElement('div');
    list.className = 'task-list-inner';
    list.dataset.listId = 'PARENT';
    list.dataset.id = 'DONE';
    list.append(destination);
    document.body.append(list);
    spyOn(TestBed.inject(TaskService), 'getByIdOnce$').and.callFake((id) =>
      of(id === 'one' ? task : destinationTask),
    );
    spyOn(TestBed.inject(Store), 'select').and.callFake((selector) =>
      selector === selectProjectFeatureState
        ? (of({
            entities: {
              source: { id: 'source', taskIds: ['one', 'two'], backlogTaskIds: [] },
            },
          }) as any)
        : (of({ one: task, two: destinationTask }) as any),
    );
    Object.defineProperty(TestBed.inject(WorkContextService), 'activeWorkContextId', {
      value: 'source',
    });
    const data = new DataTransfer();
    service.copy(clipboardEvent('cut', host, data), true);
    service.paste(clipboardEvent('paste', destination, data));
    tick();
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: TaskSharedActions.updateTask.type,
        task: jasmine.objectContaining({
          id: 'one',
          changes: {
            doneOrder: jasmine.objectContaining({
              projectId: 'source',
              doneOn: 3000,
              key: jasmine.any(String),
            }),
          },
        }),
      }),
    );
    list.remove();
  }));

  describe('Upcoming and Boards cards', () => {
    let card: HTMLElement;

    beforeEach(() => {
      card = document.createElement('planner-task');
      card.dataset.taskId = 'one';
      document.body.append(card);
    });
    afterEach(() => card.remove());

    it('copies a focused planner card as Markdown', () => {
      const data = new DataTransfer();
      const copy = clipboardEvent('copy', card, data);

      service.copy(copy, false);

      expect(copy.defaultPrevented).toBeTrue();
      expect(data.getData('text/plain')).toBe('- [ ] One');
    });

    it('tells the user to open a project instead of pasting from a planner card', fakeAsync(() => {
      const data = new DataTransfer();
      service.copy(clipboardEvent('copy', host, data), false);

      service.paste(clipboardEvent('paste', card, data));
      tick();

      expect(duplicate).not.toHaveBeenCalled();
      expect(TestBed.inject(SnackService).open).toHaveBeenCalledWith(
        T.GCF.KEYBOARD.CLIPBOARD_NEED_PROJECT,
      );
    }));
  });

  it('stops taking over native copy when the task shortcut is unassigned', () => {
    spyOn(TestBed.inject(GlobalConfigService), 'cfg').and.returnValue({
      keyboard: { taskCopy: null },
    } as any);
    const event = clipboardEvent('copy', host, new DataTransfer());
    service.copy(event, false);
    expect(event.defaultPrevented).toBeFalse();
  });

  it('leaves editable inputs to their native clipboard handling', () => {
    const copy = clipboardEvent(
      'copy',
      document.createElement('input'),
      new DataTransfer(),
    );
    service.copy(copy, false);
    expect(copy.defaultPrevented).toBeFalse();
  });

  it('leaves selected text to native copy handling', () => {
    spyOn(window, 'getSelection').and.returnValue({
      toString: () => 'selected',
    } as Selection);
    const copy = clipboardEvent('copy', host, new DataTransfer());
    service.copy(copy, false);
    expect(copy.defaultPrevented).toBeFalse();
  });
});
