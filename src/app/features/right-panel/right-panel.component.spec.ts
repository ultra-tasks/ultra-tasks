import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Store } from '@ngrx/store';
import { of, Subject } from 'rxjs';

import { RightPanelComponent } from './right-panel.component';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { LanguageService } from '../../core/language/language.service';
import { TaskService } from '../tasks/task.service';
import { PanelContentService, PanelContentType } from '../panels/panel-content.service';
import { INITIAL_LAYOUT_STATE } from '../../core-ui/layout/store/layout.reducer';
import { hidePluginPanel } from '../../core-ui/layout/store/layout.actions';
import { HISTORY_STATE } from '../../app.constants';

/**
 * The panel (task, notes, plugin panels) is a bottom sheet in the compact shell, below
 * 960px, and a side column above it. It has to survive the window crossing 960px: a
 * rotating tablet, an unfolding phone, a dragged window.
 */
describe('RightPanelComponent', () => {
  let fixture: ComponentFixture<RightPanelComponent>;
  let isCompactShell: ReturnType<typeof signal<boolean>>;
  let hasContent: ReturnType<typeof signal<boolean>>;
  let panelType: ReturnType<typeof signal<PanelContentType | null>>;
  let hasTaskPanelHistoryEntry: boolean;
  let taskService: { setSelectedId: jasmine.Spy };
  let layout: Record<string, jasmine.Spy>;
  let dispatch: jasmine.Spy;
  let sheetOpen: jasmine.Spy;
  let afterDismissed: Subject<void>;
  let sheetDismiss: jasmine.Spy;

  const waitFor = async (isDone: () => boolean): Promise<void> => {
    for (let i = 0; i < 1000 && !isDone(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();
  };
  const component = (): RightPanelComponent => fixture.componentInstance;
  const popstate = (): void => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const create = async (isCompact: boolean, content: boolean): Promise<void> => {
    isCompactShell.set(isCompact);
    hasContent.set(content);
    fixture = TestBed.createComponent(RightPanelComponent);
    await settle();
  };

  beforeEach(async () => {
    isCompactShell = signal(false);
    hasContent = signal(false);
    panelType = signal<PanelContentType | null>('NOTES');
    hasTaskPanelHistoryEntry = false;
    taskService = { setSelectedId: jasmine.createSpy('setSelectedId') };
    layout = {
      hideNotes: jasmine.createSpy('hideNotes'),
      hideAddTaskPanel: jasmine.createSpy('hideAddTaskPanel'),
      hideTaskViewCustomizerPanel: jasmine.createSpy('hideTaskViewCustomizerPanel'),
    };
    dispatch = jasmine.createSpy('dispatch');
    afterDismissed = new Subject<void>();
    sheetDismiss = jasmine.createSpy('dismiss');
    sheetOpen = jasmine.createSpy('open').and.callFake(() => ({
      backdropClick: () => new Subject<void>(),
      afterDismissed: () => afterDismissed.asObservable(),
      dismiss: sheetDismiss,
    }));
    spyOnProperty(window.history, 'state', 'get').and.callFake(() =>
      hasTaskPanelHistoryEntry ? { [HISTORY_STATE.TASK_DETAIL_PANEL]: true } : null,
    );

    await TestBed.configureTestingModule({
      imports: [RightPanelComponent],
      providers: [
        provideRouter([]),
        {
          provide: LayoutService,
          useValue: {
            isCompactShell,
            isPanelResizing: signal(false),
            ...layout,
          },
        },
        { provide: LanguageService, useValue: { isLangRTL: signal(false) } },
        {
          provide: TaskService,
          useValue: {
            selectedTask$: of(null),
            taskDetailPanelTargetPanel$: of(null),
            ...taskService,
          },
        },
        {
          provide: Store,
          useValue: { select: () => of(INITIAL_LAYOUT_STATE), dispatch },
        },
        {
          provide: PanelContentService,
          useValue: {
            getCanOpen: () => hasContent(),
            getCurrentPanelType: () => (hasContent() ? panelType() : null),
          },
        },
        { provide: MatBottomSheet, useValue: { open: sheetOpen } },
      ],
    })
      // The content (task detail, notes, plugin panels) has its own specs: only the
      // switching between the sheet and the column is under test here.
      .overrideComponent(RightPanelComponent, {
        set: { template: '<div class="content"></div>', imports: [], animations: [] },
      })
      .compileComponents();
  });

  afterEach(() => fixture?.destroy());

  describe('below 960px', () => {
    it('opens the panel as a bottom sheet, and not as the side column', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      expect(sheetOpen).toHaveBeenCalledTimes(1);
      expect(sheetOpen.calls.mostRecent().args[1]).toEqual(
        jasmine.objectContaining({ panelClass: 'bottom-panel-sheet', hasBackdrop: true }),
      );
      expect(component().isOpen()).toBe(false);
    });

    it('opens nothing without content', async () => {
      await create(true, false);

      expect(sheetOpen).not.toHaveBeenCalled();
    });

    it('closes the panel when the user dismisses the sheet', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      afterDismissed.next();

      expect(taskService.setSelectedId).toHaveBeenCalledWith(null);
      expect(layout['hideNotes']).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith(hidePluginPanel());
    });

    it('closes the sheet when the content goes', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      hasContent.set(false);
      await settle();

      expect(sheetDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('from 960px up', () => {
    it('opens the panel as the side column', async () => {
      await create(false, true);

      expect(sheetOpen).not.toHaveBeenCalled();
      expect(component().isOpen()).toBe(true);
    });

    it('stays shut without content', async () => {
      await create(false, false);

      expect(component().isOpen()).toBe(false);
    });
  });

  describe('crossing 960px with the panel open', () => {
    it('hands the sheet over to the side column without closing the panel', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      isCompactShell.set(false);
      await settle();
      expect(sheetDismiss).toHaveBeenCalledTimes(1);
      // The sheet's dismissal is the layout's doing, not the user's.
      afterDismissed.next();
      await settle();

      expect(taskService.setSelectedId).not.toHaveBeenCalled();
      expect(layout['hideNotes']).not.toHaveBeenCalled();
      expect(component().isOpen()).toBe(true);
    });

    it('hands the side column over to a sheet, and the panel stays open', async () => {
      await create(false, true);
      expect(component().isOpen()).toBe(true);

      isCompactShell.set(true);
      await settle();
      await waitFor(() => sheetOpen.calls.count() > 0);

      expect(sheetOpen).toHaveBeenCalledTimes(1);
      expect(component().isOpen()).toBe(false);
      expect(taskService.setSelectedId).not.toHaveBeenCalled();
    });

    it('goes back and forth without closing the panel or stacking sheets', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() === 1);

      isCompactShell.set(false);
      await settle();
      afterDismissed.next();
      await settle();
      isCompactShell.set(true);
      await settle();
      await waitFor(() => sheetOpen.calls.count() === 2);

      expect(sheetOpen).toHaveBeenCalledTimes(2);
      expect(taskService.setSelectedId).not.toHaveBeenCalled();
    });

    it('does not open a sheet that the layout has overtaken while its chunk was loading', async () => {
      await create(false, true);

      isCompactShell.set(true);
      fixture.detectChanges(); // the sheet starts to open
      isCompactShell.set(false);
      fixture.detectChanges(); // and the window is wide again before it has
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(sheetOpen).not.toHaveBeenCalled();
      expect(component().isOpen()).toBe(true);
    });
  });

  // A task panel owns one history entry: the instance that goes away pops it with
  // history.back(), and any live instance closes the panel on a popstate. Moving the
  // panel replaces the instance, so the new one must not exist when that popstate lands.
  describe('crossing 960px with a task panel open', () => {
    beforeEach(() => {
      panelType.set('TASK');
      hasTaskPanelHistoryEntry = true;
    });

    it('holds the side column back until the closing sheet has popped its history entry', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      isCompactShell.set(false);
      await settle();
      afterDismissed.next();
      await settle();
      // The sheet is gone and its popstate is on its way.
      expect(component().isOpen()).toBe(false);

      popstate();
      await settle();

      expect(component().isOpen()).toBe(true);
      expect(taskService.setSelectedId).not.toHaveBeenCalled();
    });

    it('does not hold the side column back for ever when no popstate comes', async () => {
      await create(true, true);
      await waitFor(() => sheetOpen.calls.count() > 0);

      isCompactShell.set(false);
      await settle();
      afterDismissed.next();
      await waitFor(() => component().isOpen());

      expect(component().isOpen()).toBe(true);
    });

    it('opens the sheet only after the side column has popped its history entry', async () => {
      await create(false, true);

      isCompactShell.set(true);
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sheetOpen).not.toHaveBeenCalled();

      popstate();
      await waitFor(() => sheetOpen.calls.count() > 0);

      expect(sheetOpen).toHaveBeenCalledTimes(1);
    });

    it('opens the sheet at once for a fresh open, which has no handover to wait for', async () => {
      await create(true, false);

      hasContent.set(true);
      await settle();
      await waitFor(() => sheetOpen.calls.count() > 0);

      expect(sheetOpen).toHaveBeenCalledTimes(1);
    });
  });
});
