import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { NavigateToTaskService } from '../../core-ui/navigate-to-task/navigate-to-task.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { FocusModeService } from '../../features/focus-mode/focus-mode.service';
import { TaskUndoService } from '../../features/tasks/task-undo.service';
import { MenuTreeService } from '../../features/menu-tree/menu-tree.service';
import { Note } from '../../features/note/note.model';
import { NoteService } from '../../features/note/note.service';
import { Project } from '../../features/project/project.model';
import { ProjectService } from '../../features/project/project.service';
import { Tag } from '../../features/tag/tag.model';
import { TagService } from '../../features/tag/tag.service';
import { RecentlyDeletedService } from '../../features/tasks/recently-deleted/recently-deleted.service';
import { Task } from '../../features/tasks/task.model';
import { TaskService } from '../../features/tasks/task.service';
import { SearchPageComponent } from './search-page.component';
import { AccountSyncActionsService } from '../../features/native-sync/account-sync-actions.service';
import { AccountSyncStatusService } from '../../features/native-sync/account-sync-status.service';

/**
 * Renders the real template (the main spec swaps it for a bare input), so the
 * command rows, Enter-to-open and the preview chord are checked as a user meets
 * them: through the DOM and the keyboard.
 */
describe('SearchPageComponent commands (real template)', () => {
  let fixture: ComponentFixture<SearchPageComponent>;
  let routerSpy: jasmine.SpyObj<Router>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let layoutSpy: jasmine.SpyObj<LayoutService>;
  let syncStatus: ReturnType<
    typeof signal<{
      engine: 'account' | 'provider' | null;
      actionLabelKey?: string | null;
    }>
  >;
  let syncActions: jasmine.SpyObj<AccountSyncActionsService>;
  const el = (): HTMLElement => fixture.nativeElement;

  const task = (id: string, title: string): Task =>
    ({
      id,
      title,
      notes: '',
      parentId: null,
      projectId: 'INBOX_PROJECT',
      tagIds: [],
      timeSpentOnDay: {},
      created: 1,
      subTaskIds: [],
      isDone: false,
    }) as unknown as Task;

  beforeEach(async () => {
    routerSpy = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
    routerSpy.navigate.and.resolveTo(true);
    routerSpy.navigateByUrl.and.resolveTo(true);
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getArchivedTasks',
      'setSelectedId',
    ]);
    (taskServiceSpy as unknown as { allTasks$: unknown }).allTasks$ = new BehaviorSubject<
      Task[]
    >([task('t1', 'Update invoice template'), task('t2', 'Review PLANNER notes')]);
    taskServiceSpy.getArchivedTasks.and.resolveTo([]);
    layoutSpy = jasmine.createSpyObj('LayoutService', ['toggleNotes', 'showAddTaskBar'], {
      isShowNotes: signal(false),
    });
    syncStatus = signal<{
      engine: 'account' | 'provider' | null;
      actionLabelKey?: string | null;
    }>({ engine: null });
    syncActions = jasmine.createSpyObj('AccountSyncActionsService', [
      'syncNow',
      'openAccount',
      'openSetup',
    ]);
    syncActions.syncNow.and.resolveTo();
    syncActions.openAccount.and.resolveTo();
    syncActions.openSetup.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [SearchPageComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: ProjectService,
          useValue: {
            list$: new BehaviorSubject<Project[]>([
              { id: 'INBOX_PROJECT', title: 'Inbox', icon: 'inbox' } as Project,
            ]),
          },
        },
        { provide: TagService, useValue: { tags$: new BehaviorSubject<Tag[]>([]) } },
        {
          provide: NavigateToTaskService,
          useValue: { navigate: () => Promise.resolve() },
        },
        { provide: NoteService, useValue: { notes$: new BehaviorSubject<Note[]>([]) } },
        { provide: Router, useValue: routerSpy },
        { provide: LayoutService, useValue: layoutSpy },
        { provide: AccountSyncStatusService, useValue: { status: syncStatus } },
        { provide: AccountSyncActionsService, useValue: syncActions },
        {
          provide: RecentlyDeletedService,
          useValue: { getEntries: () => Promise.resolve([]), restore: () => undefined },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: signal({
              isFocusModeEnabled: true,
              isPlannerEnabled: true,
              isSchedulerEnabled: false,
            }),
            cfg: signal({ keyboard: { addNewTask: 'Shift+A', goToPlanner: 'Shift+P' } }),
          },
        },
        { provide: FocusModeService, useValue: { openOverlay: () => undefined } },
        {
          provide: TaskUndoService,
          useValue: {
            canUndo: signal(true),
            canRedo: signal(false),
            undoField: signal<string | null>('title'),
            redoField: signal<string | null>(null),
            undo: () => true,
            redo: () => true,
          },
        },
        {
          provide: MenuTreeService,
          useValue: {
            projectFolderMap: signal(new Map()),
            tagFolderMap: signal(new Map()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchPageComponent);
  });

  const open = (): void => {
    fixture.detectChanges();
    tick(150);
    fixture.detectChanges();
  };
  const type = (term: string): void => {
    fixture.componentInstance.searchForm.setValue(term);
    tick(150);
    fixture.detectChanges();
  };
  const rowLabels = (): string[] =>
    Array.from(el().querySelectorAll('.search-result-main')).map(
      (b) => b.querySelector('span')?.textContent?.trim() ?? '',
    );
  const press = (key: string, shiftKey = false): KeyboardEvent => {
    const input = el().querySelector('input') as HTMLInputElement;
    const ev = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    return ev;
  };

  it('lists the actions, then the places, while the field is empty', fakeAsync(() => {
    open();
    const titles = Array.from(el().querySelectorAll('.search-group-title')).map((h) =>
      h.textContent?.trim(),
    );
    // Actions first: "Add new task" must not sit below the popup's fold.
    expect(titles).toEqual(['F.SEARCH_BAR.ACTIONS', 'F.SEARCH_BAR.GO_TO']);
    // Calendar is off in this suite, Upcoming is on.
    expect(rowLabels()).toEqual([
      'GCF.KEYBOARD.ADD_NEW_TASK',
      'GCF.KEYBOARD.GO_TO_FOCUS_MODE',
      'ACCOUNT_STATUS.COMMAND_SIGN_IN',
      'GCF.KEYBOARD.UNDO_TITLE',
      'GCF.KEYBOARD.SHOW_HELP',
      'G.TODAY',
      'G.INBOX_PROJECT_TITLE',
      'MH.PLANNER',
      'F.INTEGRATIONS.TITLE',
      'MH.SETTINGS',
    ]);
    // The user's own shortcut is shown beside a command that has one.
    const upcoming = el().querySelectorAll('.search-result-main')[7];
    expect(upcoming.querySelector('kbd')?.textContent).toBe('Shift+P');
    // Nothing is highlighted as "the one Enter opens" until something is typed.
    expect(el().querySelector('.search-results.has-default')).toBeNull();
  }));

  it('lists the places before the actions once something is typed', fakeAsync(() => {
    open();
    // Matches Today (places) and the Sync action, whatever their stand-in labels.
    type('S');
    const titles = Array.from(el().querySelectorAll('.search-group-title')).map((h) =>
      h.textContent?.trim(),
    );
    expect(titles.indexOf('F.SEARCH_BAR.GO_TO')).toBeLessThan(
      titles.indexOf('F.SEARCH_BAR.ACTIONS'),
    );
  }));

  it('marks the shortcut chips and the cheat sheet row as keyboard-only', fakeAsync(() => {
    open();
    // show-only-on-mouse-primary hides them under touch intent (global utility).
    const chips = Array.from(el().querySelectorAll('kbd'));
    expect(chips.length).toBeGreaterThan(0);
    expect(
      chips.every((kbd) => kbd.classList.contains('show-only-on-mouse-primary')),
    ).toBe(true);
    const cheatSheetRow = Array.from(el().querySelectorAll('.search-result')).find((li) =>
      li.textContent?.includes('GCF.KEYBOARD.SHOW_HELP'),
    );
    expect(cheatSheetRow?.classList).toContain('show-only-on-mouse-primary');
    // Every other row stays visible on touch.
    const addTaskRow = Array.from(el().querySelectorAll('.search-result')).find((li) =>
      li.textContent?.includes('GCF.KEYBOARD.ADD_NEW_TASK'),
    );
    expect(addTaskRow?.classList).not.toContain('show-only-on-mouse-primary');
  }));

  it('shows matching commands above matching tasks, with the first match highlighted', fakeAsync(() => {
    open();
    // The stand-in translation returns the key, so "PLANNER" matches the
    // Upcoming command (MH.PLANNER) and the task "Review PLANNER notes".
    type('PLANNER');
    const rows = Array.from(el().querySelectorAll('.search-result-main'));
    expect(rows[0].classList).toContain('search-command');
    expect(rows[0].textContent).toContain('MH.PLANNER');
    expect(rows[1].classList).not.toContain('search-command');
    expect(rows[1].textContent).toContain('Review PLANNER notes');
    const headings = Array.from(el().querySelectorAll('.search-group-title')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headings).toEqual(['F.SEARCH_BAR.GO_TO', 'F.SEARCH_BAR.RESULTS']);
    // The first match is the one Enter opens, and is marked as such.
    expect(el().querySelector('.search-results.has-default')).not.toBeNull();
  }));

  it('lists only tasks, without a Results heading, when no command matches', fakeAsync(() => {
    open();
    type('Update');
    expect(el().querySelector('.search-command')).toBeNull();
    expect(el().querySelector('.search-group-title')).toBeNull();
    expect(el().textContent).toContain('Update invoice template');
  }));

  it('says nothing was found only when no command and no result match', fakeAsync(() => {
    open();
    type('qqqqzzzz');
    expect(el().querySelector('.empty-state')).not.toBeNull();
    expect(el().querySelector('.search-command')).toBeNull();
  }));

  it('runs an action from its row', fakeAsync(() => {
    open();
    const add = Array.from(
      el().querySelectorAll<HTMLButtonElement>('.search-command'),
    ).find((b) => b.textContent?.includes('ADD_NEW_TASK'));
    add?.click();
    expect(layoutSpy.showAddTaskBar).toHaveBeenCalled();
  }));

  describe('sync commands', () => {
    const commandButton = (labelKey: string): HTMLButtonElement | undefined =>
      Array.from(el().querySelectorAll<HTMLButtonElement>('.search-command')).find((b) =>
        b.textContent?.includes(labelKey),
      );

    it('offers to sign in, and only that, while nothing is connected', fakeAsync(() => {
      open();
      expect(commandButton('ACCOUNT_STATUS.COMMAND_SIGN_IN')).toBeTruthy();
      expect(commandButton('ACCOUNT_STATUS.ACTION_SYNC')).toBeUndefined();
      expect(commandButton('ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT')).toBeUndefined();
    }));

    it('hands the sign-in row to the sync action, which opens the provider dialog', fakeAsync(() => {
      open();
      commandButton('ACCOUNT_STATUS.COMMAND_SIGN_IN')!.click();
      expect(syncActions.syncNow).toHaveBeenCalledTimes(1);
    }));

    it('offers Sync now and the account page for a connected account, instead of "Set up sync"', fakeAsync(() => {
      syncStatus.set({ engine: 'account' });
      open();
      expect(commandButton('ACCOUNT_STATUS.ACTION_SYNC')).toBeTruthy();
      expect(commandButton('ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT')).toBeTruthy();
      expect(commandButton('ACCOUNT_STATUS.COMMAND_SIGN_IN')).toBeUndefined();
      expect(el().textContent).not.toContain('PS.SYNC.SET_UP_SYNC');
    }));

    it('says what a locked account needs, and runs it from the same command', fakeAsync(() => {
      syncStatus.set({
        engine: 'account',
        actionLabelKey: 'ACCOUNT_STATUS.ACTION_UNLOCK',
      });
      open();
      expect(commandButton('ACCOUNT_STATUS.ACTION_SYNC')).toBeUndefined();
      commandButton('ACCOUNT_STATUS.ACTION_UNLOCK')!.click();
      expect(syncActions.syncNow).toHaveBeenCalledTimes(1);
    }));

    it('syncs the active engine once from Sync now', fakeAsync(() => {
      syncStatus.set({ engine: 'account' });
      open();
      commandButton('ACCOUNT_STATUS.ACTION_SYNC')!.click();
      expect(syncActions.syncNow).toHaveBeenCalledTimes(1);
      expect(syncActions.openAccount).not.toHaveBeenCalled();
    }));

    it('opens the account page from its command, without syncing', fakeAsync(() => {
      syncStatus.set({ engine: 'account' });
      open();
      commandButton('ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT')!.click();
      expect(syncActions.openAccount).toHaveBeenCalledTimes(1);
      expect(syncActions.syncNow).not.toHaveBeenCalled();
    }));

    it('opens the settings of a legacy provider from its own command', fakeAsync(() => {
      syncStatus.set({ engine: 'provider' });
      open();
      expect(commandButton('ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT')).toBeUndefined();
      commandButton('ACCOUNT_STATUS.ACTION_SYNC_SETTINGS')!.click();
      expect(syncActions.openSetup).toHaveBeenCalledTimes(1);
    }));
  });

  it('opens the first match when Enter is pressed in the field', fakeAsync(() => {
    open();
    type('PLANNER');
    const ev = press('Enter');
    expect(ev.defaultPrevented).toBeTrue();
    expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/planner');
  }));

  it('opens the first command for what is typed even before the results catch up', fakeAsync(() => {
    open();
    // No tick and no change detection: Enter comes right behind the last key.
    fixture.componentInstance.searchForm.setValue('PLANNER');
    const ev = press('Enter');
    expect(ev.defaultPrevented).toBeTrue();
    expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/planner');
    tick(150);
  }));

  it('never opens a result row that belongs to an older term', fakeAsync(() => {
    open();
    type('Update');
    fixture.componentInstance.searchForm.setValue('Review');
    const enter = press('Enter');
    const peek = press('Enter', true);
    expect(enter.defaultPrevented).toBeFalse();
    expect(peek.defaultPrevented).toBeFalse();
    expect(taskServiceSpy.setSelectedId).not.toHaveBeenCalled();
    tick(150);
  }));

  it('does nothing on Enter while the field is empty', fakeAsync(() => {
    open();
    const ev = press('Enter');
    expect(ev.defaultPrevented).toBeFalse();
    expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
  }));

  it('previews the first task match on Shift+Enter, without navigating', fakeAsync(() => {
    open();
    type('Update');
    expect(el().textContent).toContain('F.SEARCH_BAR.PEEK_HINT');
    const ev = press('Enter', true);
    expect(ev.defaultPrevented).toBeTrue();
    expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith('t1');
    expect(routerSpy.navigate).not.toHaveBeenCalled();
    expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
  }));

  it('does not preview when the matches are commands only', fakeAsync(() => {
    open();
    type('F.INTEGRATIONS');
    expect(rowLabels()).toEqual(['F.INTEGRATIONS.TITLE']);
    press('Enter', true);
    expect(taskServiceSpy.setSelectedId).not.toHaveBeenCalled();
    expect(el().textContent).not.toContain('F.SEARCH_BAR.PEEK_HINT');
  }));
});
