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

  it('pastes several copied tasks back to front, so each copy lands in its original order', fakeAsync(() => {
    // Every copy is added at the top, so the last one added ends up first.
    const second = { ...task, id: 'two', title: 'Two' };
    const selection = TestBed.inject(TaskMultiSelectService);
    spyOn(selection, 'isActive').and.returnValue(true);
    spyOn(selection, 'has').and.returnValue(true);
    spyOn(selection, 'selectedIdsInDomOrder').and.returnValue(['one', 'two']);
    spyOn(TestBed.inject(TaskService), 'getByIdWithSubTaskData$').and.callFake((id) =>
      of(id === 'one' ? task : second),
    );
    const data = new DataTransfer();
    service.copy(clipboardEvent('copy', host, data), false);
    expect(service.paste(clipboardEvent('paste', document.body, data))).toBeTrue();
    tick();
    expect(duplicate.calls.allArgs().map(([copied]) => copied.id)).toEqual([
      'two',
      'one',
    ]);
  }));

  describe('clipboard HTML marker scan', () => {
    const token = '12345678-1234-1234-1234-123456789abc';
    const marker = (html: string): string | null =>
      (
        service as unknown as { _markerFromHtml(value: string): string | null }
      )._markerFromHtml(html);

    it('finds the marker behind the short wrapper a browser adds', () => {
      expect(
        marker(
          `<meta charset='utf-8'><html><body><!--StartFragment--><div data-ultratasks-task-clipboard="${token}"><pre>x</pre></div>`,
        ),
      ).toBe(token);
    });

    it('answers at once for pathological HTML instead of backtracking', () => {
      // An unbounded attribute run took half a second for 80 KB of this.
      const html = '<div '.repeat(40000) + 'data-ultratasks-task-clipboard';
      const start = performance.now();
      expect(marker(html)).toBeNull();
      expect(performance.now() - start).toBeLessThan(100);
    });

    it('ignores a marker far from the start, where this app never puts it', () => {
      expect(
        marker(`${'x'.repeat(5000)}<div data-ultratasks-task-clipboard="${token}">`),
      ).toBeNull();
    });
  });

  it('reads the page selection only for a key that is a task clipboard shortcut', () => {
    const getSelection = spyOn(window, 'getSelection').and.callThrough();
    const plain = new KeyboardEvent('keydown', { key: 'a' });
    Object.defineProperty(plain, 'target', { value: host });
    expect(service.handleKeyDown(plain, {} as never)).toBeFalse();
    expect(getSelection).not.toHaveBeenCalled();

    const copy = new KeyboardEvent('keydown', {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
    });
    Object.defineProperty(copy, 'target', { value: host });
    service.handleKeyDown(copy, {} as never);
    expect(getSelection).toHaveBeenCalled();
  });
});
