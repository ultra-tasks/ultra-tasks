import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Router } from '@angular/router';
import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EMPTY, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

import { AndroidBackButtonService } from './android-back-button.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DefaultStartPage } from '../config/default-start-page.const';
import { HISTORY_STATE } from '../../app.constants';
import { TODAY_TAG } from '../tag/tag.const';
import { INBOX_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { AppFeaturesConfig } from '../config/global-config.model';
import { getStartPageUrlPath } from '../config/default-start-page.util';
import { hideFocusOverlay } from '../focus-mode/store/focus-mode.actions';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskFocusService } from '../tasks/task-focus.service';
import { TaskMultiSelectService } from '../tasks/task-multi-select.service';
import { setDialogBackHandler } from '../../ui/dialog-back-handler.util';
import { useDiscardGuard } from '../../ui/dialog-discard-guard.util';

const TODAY_URL = `/tag/${TODAY_TAG.id}/tasks`;

@Component({ template: '<p>overlay content</p>' })
class OverlayContentComponent {}

const project = (over: Partial<Project>): Project =>
  ({ id: 'p1', isArchived: false, isHiddenFromMenu: false, ...over }) as Project;

describe('AndroidBackButtonService (#7972)', () => {
  const multiSelect = {
    isSelecting: signal(false),
    clear: jasmine.createSpy('clear'),
  };
  let service: AndroidBackButtonService;
  let store: MockStore;
  let routerUrl: string;
  let navigateByUrl: jasmine.Spy;
  let historyBack: jasmine.Spy;
  let minimizeApp: jasmine.Spy;
  let dispatch: jasmine.Spy;
  let misc: { defaultStartPage?: number | string } | undefined;
  let appFeatures: Record<string, boolean>;
  let openDialogs: MatDialogRef<unknown>[];
  let isShowAddTaskBar: jasmine.Spy<() => boolean>;
  let isShowIssuePanel: jasmine.Spy<() => boolean>;
  let hideAddTaskBar: jasmine.Spy;
  let hideAddTaskPanel: jasmine.Spy;
  let isTaskContextMenuOpen: ReturnType<typeof signal<boolean>>;
  let closeActiveTaskContextMenu: ReturnType<typeof signal<(() => void) | null>>;

  const setProjects = (projects: Project[]): void => {
    store.overrideSelector(selectAllProjects, projects);
    store.refreshState();
  };

  const fakeDialog = (
    over: Partial<Pick<MatDialogRef<unknown>, 'disableClose'>> = {},
  ): MatDialogRef<unknown> & { close: jasmine.Spy } =>
    ({
      disableClose: false,
      close: jasmine.createSpy('close'),
      ...over,
    }) as MatDialogRef<unknown> & { close: jasmine.Spy };

  beforeEach(() => {
    routerUrl = TODAY_URL;
    navigateByUrl = jasmine.createSpy('navigateByUrl');
    misc = { defaultStartPage: DefaultStartPage.Today };
    openDialogs = [];
    appFeatures = {
      isPlannerEnabled: true,
      isSchedulerEnabled: true,
      isBoardsEnabled: true,
    };
    isShowAddTaskBar = jasmine.createSpy('isShowAddTaskBar').and.returnValue(false);
    isShowIssuePanel = jasmine.createSpy('isShowIssuePanel').and.returnValue(false);
    hideAddTaskBar = jasmine.createSpy('hideAddTaskBar');
    hideAddTaskPanel = jasmine.createSpy('hideAddTaskPanel');
    isTaskContextMenuOpen = signal(false);
    closeActiveTaskContextMenu = signal<(() => void) | null>(null);

    TestBed.configureTestingModule({
      providers: [
        AndroidBackButtonService,
        provideMockStore(),
        {
          provide: Router,
          useValue: {
            get url(): string {
              return routerUrl;
            },
            navigateByUrl,
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            misc: () => misc,
            appFeatures: () => appFeatures,
          },
        },
        {
          provide: MatDialog,
          useValue: {
            get openDialogs(): MatDialogRef<unknown>[] {
              return openDialogs;
            },
          },
        },
        {
          provide: LayoutService,
          useValue: {
            isShowAddTaskBar,
            isShowIssuePanel,
            hideAddTaskBar,
            hideAddTaskPanel,
          },
        },
        {
          provide: TaskMultiSelectService,
          useValue: multiSelect,
        },
        {
          provide: TaskFocusService,
          useValue: {
            isTaskContextMenuOpen,
            closeActiveTaskContextMenu,
          },
        },
      ],
    });

    store = TestBed.inject(MockStore);
    dispatch = spyOn(store, 'dispatch');
    store.overrideSelector(selectAllProjects, []);
    service = TestBed.inject(AndroidBackButtonService);

    // Prevent real side effects on globals.
    historyBack = spyOn(
      service as unknown as { _historyBack: () => void },
      '_historyBack',
    );
    minimizeApp = spyOn(
      service as unknown as { _minimizeApp: () => void },
      '_minimizeApp',
    );
    // Default: no overlays open.
    spyOn(
      service as unknown as { _isFocusOverlayShown: () => boolean },
      '_isFocusOverlayShown',
    ).and.returnValue(false);
    spyOn(
      service as unknown as { _isHistoryOverlayOpen: () => boolean },
      '_isHistoryOverlayOpen',
    ).and.returnValue(false);
  });

  describe('multi-selection', () => {
    afterEach(() => {
      multiSelect.isSelecting.set(false);
      multiSelect.clear.calls.reset();
    });

    it('clears an active multi-selection instead of navigating', () => {
      multiSelect.isSelecting.set(true);
      service.handleBackButton();
      expect(multiSelect.clear).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
    });

    it('closes an open dialog first and keeps the selection', () => {
      multiSelect.isSelecting.set(true);
      const dialogRef = { disableClose: false, close: jasmine.createSpy('close') };
      openDialogs.push(dialogRef as never);
      service.handleBackButton();
      expect(dialogRef.close).toHaveBeenCalled();
      expect(multiSelect.clear).not.toHaveBeenCalled();
    });
  });

  describe('overlays', () => {
    it('closes an open task context menu before exiting from the start page', () => {
      const closeTaskContextMenu = jasmine.createSpy('closeTaskContextMenu');
      isTaskContextMenuOpen.set(true);
      closeActiveTaskContextMenu.set(closeTaskContextMenu);

      service.handleBackButton();

      expect(closeTaskContextMenu).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('closes a history-state overlay via window.history.back()', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.returnValue(true);

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
    });

    it('hides focus-mode overlay directly because it is not history-backed', () => {
      (
        service as unknown as { _isFocusOverlayShown: jasmine.Spy }
      )._isFocusOverlayShown.and.returnValue(true);

      service.handleBackButton();

      expect(dispatch).toHaveBeenCalledWith(hideFocusOverlay());
      expect(historyBack).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  // The CDK lays an overlay out two ways. With the Popover API (Chromium 114+, so nearly
  // every Android WebView) its host holds both the backdrop and the pane, and the host is
  // what sits in the container. Without it the backdrop is a child of the container and
  // the host follows it. Both are covered; a real overlay follows below.
  (['popover', 'legacy'] as const).forEach((layout) =>
    describe(`CDK overlays with a backdrop (menus, selects, pickers, sheets), ${layout} DOM`, () => {
      let overlayContainer: HTMLElement;
      let escapes: KeyboardEvent[];
      const recordEscape = (ev: KeyboardEvent): void => {
        escapes.push(ev);
      };
      const setHistoryOverlayOpen = (isOpen: boolean): void => {
        (
          service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
        )._isHistoryOverlayOpen.and.returnValue(isOpen);
      };

      const addOverlay = (
        kind: 'menu' | 'sheet' | 'dialog',
        { isShowing = true }: { isShowing?: boolean } = {},
      ): void => {
        const backdrop = document.createElement('div');
        backdrop.classList.add(
          'cdk-overlay-backdrop',
          kind === 'menu'
            ? 'cdk-overlay-transparent-backdrop'
            : 'cdk-overlay-dark-backdrop',
        );
        if (isShowing) {
          backdrop.classList.add('cdk-overlay-backdrop-showing');
        }
        const host = document.createElement('div');
        const pane = document.createElement('div');
        pane.classList.add('cdk-overlay-pane');
        if (kind === 'dialog') {
          pane.classList.add('mat-mdc-dialog-panel');
        }
        if (layout === 'popover') {
          host.classList.add('cdk-overlay-popover');
          host.append(backdrop, pane);
          overlayContainer.append(host);
        } else {
          host.appendChild(pane);
          overlayContainer.append(backdrop, host);
        }
      };

      beforeEach(() => {
        overlayContainer = document.createElement('div');
        overlayContainer.classList.add('cdk-overlay-container');
        document.body.appendChild(overlayContainer);
        escapes = [];
        document.body.addEventListener('keydown', recordEscape);
      });

      afterEach(() => {
        document.body.removeEventListener('keydown', recordEscape);
        overlayContainer.remove();
      });

      it('closes an open menu with Escape on <body> instead of leaving the start page', () => {
        addOverlay('menu');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
        // Material reads `keyCode`, not `key`.
        expect(escapes[0].key).toBe('Escape');
        expect(escapes[0].keyCode).toBe(27);
        expect(escapes[0].target).toBe(document.body);
        expect(minimizeApp).not.toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('closes the menu before navigating up from a non-top-level page', () => {
        routerUrl = '/config';
        addOverlay('menu');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('sends one Escape per press, for the top-most of several overlays', () => {
        addOverlay('menu');
        addOverlay('menu');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
      });

      it('closes a sheet that has no history entry (customizer and plugin panels)', () => {
        addOverlay('sheet');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('ignores a backdrop that is already on its way out', () => {
        addOverlay('menu', { isShowing: false });

        service.handleBackButton();

        expect(escapes.length).toBe(0);
        expect(minimizeApp).toHaveBeenCalled();
      });

      it('does nothing when no overlay is open', () => {
        service.handleBackButton();

        expect(escapes.length).toBe(0);
        expect(minimizeApp).toHaveBeenCalled();
      });

      it('leaves a dialog to the dialog step', () => {
        const dialog = fakeDialog();
        openDialogs = [dialog];
        addOverlay('dialog');

        service.handleBackButton();

        expect(escapes.length).toBe(0);
        expect(dialog.close).toHaveBeenCalled();
      });

      it('closes a menu that is open above a dialog before the dialog', () => {
        const dialog = fakeDialog();
        openDialogs = [dialog];
        addOverlay('dialog');
        addOverlay('menu');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
        expect(dialog.close).not.toHaveBeenCalled();
      });

      it('leaves a history-backed sheet to its popstate listener', () => {
        setHistoryOverlayOpen(true);
        addOverlay('sheet');

        service.handleBackButton();

        expect(escapes.length).toBe(0);
        expect(historyBack).toHaveBeenCalled();
      });

      it('closes a menu above a history-backed overlay first, then the overlay', () => {
        setHistoryOverlayOpen(true);
        addOverlay('sheet');
        addOverlay('menu');

        service.handleBackButton();

        expect(escapes.length).toBe(1);
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('keeps the task context menu step ahead of it', () => {
        const closeTaskContextMenu = jasmine.createSpy('closeTaskContextMenu');
        closeActiveTaskContextMenu.set(closeTaskContextMenu);
        addOverlay('menu');

        service.handleBackButton();

        expect(closeTaskContextMenu).toHaveBeenCalled();
        expect(escapes.length).toBe(0);
      });

      it('sends the next press to the overlay beneath one that is still closing', () => {
        addOverlay('sheet');
        addOverlay('menu');

        service.handleBackButton();
        // The menu's backdrop keeps "showing" while it animates out.
        service.handleBackButton();

        expect(escapes.length).toBe(2);
        expect(minimizeApp).not.toHaveBeenCalled();
      });

      it('does not let an overlay that ignores Escape trap the button', () => {
        addOverlay('menu');

        service.handleBackButton();
        expect(escapes.length).toBe(1);
        expect(minimizeApp).not.toHaveBeenCalled();

        // Still there after the first press: that press was lost, the next one is not.
        service.handleBackButton();
        expect(escapes.length).toBe(1);
        expect(minimizeApp).toHaveBeenCalled();
      });

      it('tries a different overlay that opens afterwards', () => {
        addOverlay('menu');
        service.handleBackButton();

        addOverlay('menu');
        service.handleBackButton();

        expect(escapes.length).toBe(2);
      });
    }),
  );

  describe('a real CDK overlay (whatever DOM this browser gives it)', () => {
    let overlayRef: OverlayRef | undefined;
    let escapes: KeyboardEvent[];
    const recordEscape = (ev: KeyboardEvent): void => {
      escapes.push(ev);
    };

    // The CDK marks a backdrop "showing" on the next animation frame.
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const open = async ({
      isEscapeClosing = true,
      isTransparent = true,
    }: {
      isEscapeClosing?: boolean;
      isTransparent?: boolean;
    } = {}): Promise<OverlayRef> => {
      const overlay = TestBed.inject(Overlay);
      const ref = overlay.create({
        hasBackdrop: true,
        backdropClass: isTransparent
          ? 'cdk-overlay-transparent-backdrop'
          : 'cdk-overlay-dark-backdrop',
        positionStrategy: overlay.position().global(),
      });
      ref.attach(new ComponentPortal(OverlayContentComponent));
      if (isEscapeClosing) {
        // What a menu, a select and a sheet do with the key.
        ref
          .keydownEvents()
          .pipe(filter((ev) => ev.key === 'Escape'))
          .subscribe(() => ref.dispose());
      }
      overlayRef = ref;
      await nextFrame();
      return ref;
    };

    beforeEach(() => {
      escapes = [];
      document.body.addEventListener('keydown', recordEscape);
    });

    afterEach(() => {
      document.body.removeEventListener('keydown', recordEscape);
      overlayRef?.dispose();
      overlayRef = undefined;
    });

    it('shows its backdrop where the service looks for it', async () => {
      await open();

      expect(
        document.querySelectorAll(
          '.cdk-overlay-container .cdk-overlay-backdrop.cdk-overlay-backdrop-showing',
        ).length,
      ).toBe(1);
    });

    it('is closed by the press, and the app stays where it is', async () => {
      const ref = await open();

      service.handleBackButton();

      expect(ref.hasAttached()).toBeFalse();
      expect(escapes.length).toBe(1);
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('is closed by the press on a page that navigates up as well', async () => {
      routerUrl = '/config';
      const ref = await open({ isTransparent: false });

      service.handleBackButton();

      expect(ref.hasAttached()).toBeFalse();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('lets the next press through when it ignores Escape', async () => {
      const ref = await open({ isEscapeClosing: false });

      service.handleBackButton();
      expect(ref.hasAttached()).toBeTrue();
      expect(minimizeApp).not.toHaveBeenCalled();

      service.handleBackButton();
      expect(minimizeApp).toHaveBeenCalled();
    });

    it('closes one overlay per press when two are open', async () => {
      const first = await open();
      const second = await open();

      service.handleBackButton();
      expect(second.hasAttached()).toBeFalse();
      expect(first.hasAttached()).toBeTrue();

      service.handleBackButton();
      expect(first.hasAttached()).toBeFalse();
      expect(minimizeApp).not.toHaveBeenCalled();
    });
  });

  describe('modal dialogs', () => {
    it('closes the topmost open dialog instead of minimizing on the start page', () => {
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('closes only the topmost dialog when several are stacked', () => {
      const lower = fakeDialog();
      const top = fakeDialog();
      openDialogs = [lower, top];

      service.handleBackButton();

      expect(top.close).toHaveBeenCalled();
      expect(lower.close).not.toHaveBeenCalled();
    });

    it('closes a dialog before navigating up from a non-top-level page', () => {
      routerUrl = '/config';
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('swallows back for a non-closable dialog (disableClose) without closing or exiting', () => {
      const dialog = fakeDialog({ disableClose: true });
      openDialogs = [dialog];

      service.handleBackButton();

      expect(dialog.close).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('lets a history-backed overlay take precedence over the dialog check', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.returnValue(true);
      const dialog = fakeDialog();
      openDialogs = [dialog];

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(dialog.close).not.toHaveBeenCalled();
    });

    describe('a dialog that answers the press itself (discard guard)', () => {
      const withHandler = (
        handler: () => boolean,
        over: Partial<Pick<MatDialogRef<unknown>, 'disableClose'>> = {},
      ): MatDialogRef<unknown> & { close: jasmine.Spy } => {
        const dialog = fakeDialog(over);
        setDialogBackHandler(dialog, handler);
        return dialog;
      };
      const setHistoryOverlayOpen = (isOpen: boolean): void => {
        (
          service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
        )._isHistoryOverlayOpen.and.returnValue(isOpen);
      };

      it('hands the press to the handler, and the dialog stays open until it is told to close', () => {
        const handler = jasmine.createSpy('handler').and.returnValue(true);
        // what a guarded dialog with typed text looks like: it opted out of closing
        const dialog = withHandler(handler, { disableClose: true });
        openDialogs = [dialog];

        service.handleBackButton();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(dialog.close).not.toHaveBeenCalled();
        expect(minimizeApp).not.toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('asks before the history step: over the phone drawer a back press would dispose the dialog', () => {
        setHistoryOverlayOpen(true);
        const handler = jasmine.createSpy('handler').and.returnValue(true);
        const dialog = withHandler(handler, { disableClose: true });
        openDialogs = [dialog];

        service.handleBackButton();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(historyBack).not.toHaveBeenCalled();
        expect(dialog.close).not.toHaveBeenCalled();
      });

      it('closes a clean guarded dialog like any other: its handler declines', () => {
        const handler = jasmine.createSpy('handler').and.returnValue(false);
        const dialog = withHandler(handler);
        openDialogs = [dialog];

        service.handleBackButton();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(dialog.close).toHaveBeenCalledTimes(1);
        expect(minimizeApp).not.toHaveBeenCalled();
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('leaves a declining handler over a drawer to the history step, as before', () => {
        setHistoryOverlayOpen(true);
        const handler = jasmine.createSpy('handler').and.returnValue(false);
        const dialog = withHandler(handler);
        openDialogs = [dialog];

        service.handleBackButton();

        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(dialog.close).not.toHaveBeenCalled();
      });

      it('keeps swallowing the press for a disableClose dialog whose handler declines', () => {
        const dialog = withHandler(() => false, { disableClose: true });
        openDialogs = [dialog];

        service.handleBackButton();

        expect(dialog.close).not.toHaveBeenCalled();
        expect(minimizeApp).not.toHaveBeenCalled();
        expect(historyBack).not.toHaveBeenCalled();
      });

      it('asks only the topmost dialog', () => {
        const lowerHandler = jasmine.createSpy('lowerHandler').and.returnValue(true);
        const lower = withHandler(lowerHandler, { disableClose: true });
        const top = fakeDialog();
        openDialogs = [lower, top];

        service.handleBackButton();

        expect(lowerHandler).not.toHaveBeenCalled();
        expect(top.close).toHaveBeenCalledTimes(1);
      });

      it('does not change a disableClose dialog that has no handler', () => {
        setHistoryOverlayOpen(false);
        const dialog = fakeDialog({ disableClose: true });
        openDialogs = [dialog];

        service.handleBackButton();

        expect(dialog.close).not.toHaveBeenCalled();
        expect(minimizeApp).not.toHaveBeenCalled();
        expect(historyBack).not.toHaveBeenCalled();
      });

      describe('with the real discard guard on a dialog with typed text, over the phone drawer', () => {
        let guarded: ReturnType<typeof fakeDialog>;
        let guardDialogs: { open: jasmine.Spy };
        let isDirty: ReturnType<typeof signal<boolean>>;

        beforeEach(() => {
          setHistoryOverlayOpen(true);
          guarded = Object.assign(fakeDialog(), {
            backdropClick: () => EMPTY,
            keydownEvents: () => EMPTY,
            getState: () => MatDialogState.OPEN,
          });
          // The dialog stack the service reads: opening the question pushes it, closing pops it.
          guardDialogs = {
            open: jasmine.createSpy('open').and.callFake(() => {
              const closed$ = new Subject<unknown>();
              const question: Record<string, unknown> = {
                disableClose: false,
                afterClosed: () => closed$,
              };
              question['close'] = jasmine
                .createSpy('closeQuestion')
                .and.callFake((result?: unknown) => {
                  openDialogs = openDialogs.filter((d) => d !== (question as never));
                  closed$.next(result);
                });
              openDialogs = [...openDialogs, question as never];
              return question;
            }),
          };
          isDirty = signal(true);
          const injector = createEnvironmentInjector(
            [
              { provide: MatDialogRef, useValue: guarded },
              { provide: MatDialog, useValue: guardDialogs },
            ],
            TestBed.inject(EnvironmentInjector),
          );
          runInInjectionContext(injector, () => useDiscardGuard(isDirty));
          TestBed.flushEffects();
          openDialogs = [guarded];
        });

        it('asks instead of navigating back, and keeps the dialog when the user keeps editing', () => {
          service.handleBackButton();

          expect(guardDialogs.open).toHaveBeenCalledTimes(1);
          expect(openDialogs.length).toBe(2);
          expect(historyBack).not.toHaveBeenCalled();

          // Back on the question answers "Keep editing", still without navigating
          service.handleBackButton();

          expect(openDialogs).toEqual([guarded]);
          expect(guarded.close).not.toHaveBeenCalled();
          expect(historyBack).not.toHaveBeenCalled();
        });

        it('closes the dialog when the user discards, and asks again after a Keep editing', () => {
          service.handleBackButton();
          service.handleBackButton();
          service.handleBackButton();
          expect(guardDialogs.open).toHaveBeenCalledTimes(2);

          const question = openDialogs[1] as unknown as {
            close: (result?: unknown) => void;
          };
          question.close(true);

          expect(guarded.close).toHaveBeenCalledTimes(1);
          expect(historyBack).not.toHaveBeenCalled();
        });

        it('lets the usual rules close the dialog once nothing is left to lose', () => {
          isDirty.set(false);
          TestBed.flushEffects();

          service.handleBackButton();

          expect(guardDialogs.open).not.toHaveBeenCalled();
          // over the drawer the history step closes it, as for every other dialog
          expect(historyBack).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe('store-backed layout popups', () => {
    it('hides the add-task bar before exiting from the start page', () => {
      isShowAddTaskBar.and.returnValue(true);

      service.handleBackButton();

      expect(hideAddTaskBar).toHaveBeenCalled();
      expect(hideAddTaskPanel).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('hides the issue panel before exiting from the start page', () => {
      isShowIssuePanel.and.returnValue(true);

      service.handleBackButton();

      expect(hideAddTaskPanel).toHaveBeenCalled();
      expect(hideAddTaskBar).not.toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('lets history-backed overlays take precedence over store-backed popups', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.returnValue(true);
      isShowAddTaskBar.and.returnValue(true);

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(hideAddTaskBar).not.toHaveBeenCalled();
    });

    it('closes a modal dialog before store-backed popups', () => {
      const dialog = fakeDialog();
      openDialogs = [dialog];
      isShowAddTaskBar.and.returnValue(true);

      service.handleBackButton();

      expect(dialog.close).toHaveBeenCalled();
      expect(hideAddTaskBar).not.toHaveBeenCalled();
    });
  });

  describe('non-top-level pages navigate up normally', () => {
    [
      '/project/abc/worklog',
      `/tag/${TODAY_TAG.id}/metrics`,
      '/tag/x/quick-history',
      '/config',
      '/search',
      '/scheduled-list',
      '/donate',
    ].forEach((url) => {
      it(`uses window.history.back() on ${url}`, () => {
        routerUrl = url;

        service.handleBackButton();

        expect(historyBack).toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(minimizeApp).not.toHaveBeenCalled();
      });
    });

    it('exits instead of no-oping when there is no WebView history to go back to', () => {
      routerUrl = '/config';

      service.handleBackButton(false);

      expect(minimizeApp).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('top-level destinations', () => {
    it('pops to the start destination when not already there', () => {
      routerUrl = '/planner';

      service.handleBackButton(false);

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
    });

    it('exits the app when already on the start destination', () => {
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('exits even when a project task list is the top-level destination and start', () => {
      misc = { defaultStartPage: 'my-project' };
      setProjects([project({ id: 'my-project' })]);
      routerUrl = '/project/my-project/tasks';

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
    });

    it('pops a project task list to the start destination', () => {
      routerUrl = '/project/some-project/tasks';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('ignores query/fragment when comparing to the start destination', () => {
      routerUrl = `${TODAY_URL}?foo=1#bar`;

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('treats a deeper path under a task list as non-top-level (navigates up)', () => {
      routerUrl = `${TODAY_URL}/123`;

      service.handleBackButton();

      expect(historyBack).toHaveBeenCalled();
      expect(minimizeApp).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  // Full enum/project-validity matrix lives in default-start-page.util.spec.ts;
  // here we verify the service wires misc + appFeatures + the looked-up project
  // into that helper, including the store-based project lookup.
  describe('start-page resolution wiring', () => {
    it('resolves the Planner start page', () => {
      misc = { defaultStartPage: DefaultStartPage.Planner };
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith('/planner', { replaceUrl: true });
    });

    it('falls back to Today when the Planner feature is disabled', () => {
      misc = { defaultStartPage: DefaultStartPage.Planner };
      appFeatures.isPlannerEnabled = false;
      routerUrl = '/boards';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('resolves the legacy Inbox start page to the inbox project', () => {
      misc = { defaultStartPage: DefaultStartPage.Inbox };
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(`/project/${INBOX_PROJECT.id}/tasks`, {
        replaceUrl: true,
      });
    });

    it('resolves a valid project-id start page via the store', () => {
      misc = { defaultStartPage: 'proj-123' };
      setProjects([project({ id: 'proj-123' })]);
      routerUrl = TODAY_URL;

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith('/project/proj-123/tasks', {
        replaceUrl: true,
      });
    });

    it('falls back to Today when the project start page is archived', () => {
      misc = { defaultStartPage: 'proj-123' };
      setProjects([project({ id: 'proj-123', isArchived: true })]);
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('falls back to Today when the project start page is missing', () => {
      misc = { defaultStartPage: 'gone' };
      setProjects([]);
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });

    it('falls back to Today when misc config is undefined', () => {
      misc = undefined;
      routerUrl = '/planner';

      service.handleBackButton();

      expect(navigateByUrl).toHaveBeenCalledWith(TODAY_URL, { replaceUrl: true });
    });
  });

  // Guards the _isTopLevelDestination ⇄ getStartPageUrlPath invariant: being ON
  // the resolved start destination must exit, never navigate history. Iterating
  // the enum auto-covers any future DefaultStartPage value.
  describe('start destination is always a top-level destination (back exits)', () => {
    const allBuiltInStartPages = Object.values(DefaultStartPage).filter(
      (v): v is DefaultStartPage => typeof v === 'number',
    );

    allBuiltInStartPages.forEach((startPage) => {
      it(`exits when on the resolved start page (DefaultStartPage=${startPage})`, () => {
        misc = { defaultStartPage: startPage };
        routerUrl = getStartPageUrlPath(
          startPage,
          appFeatures as unknown as AppFeaturesConfig,
          undefined,
        );

        service.handleBackButton();

        expect(minimizeApp).toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
      });
    });

    it('exits when on a valid project start page', () => {
      misc = { defaultStartPage: 'proj-x' };
      setProjects([project({ id: 'proj-x' })]);
      routerUrl = '/project/proj-x/tasks';

      service.handleBackButton();

      expect(minimizeApp).toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('_isHistoryOverlayOpen (real implementation)', () => {
    it('detects an overlay history state', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.callThrough();
      const original = window.history.state;
      try {
        window.history.replaceState({ [HISTORY_STATE.NOTES]: true }, '');
        expect(
          (
            service as unknown as { _isHistoryOverlayOpen: () => boolean }
          )._isHistoryOverlayOpen(),
        ).toBe(true);
      } finally {
        window.history.replaceState(original, '');
      }
    });

    it('returns false when no overlay state is present', () => {
      (
        service as unknown as { _isHistoryOverlayOpen: jasmine.Spy }
      )._isHistoryOverlayOpen.and.callThrough();
      const original = window.history.state;
      try {
        window.history.replaceState(null, '');
        expect(
          (
            service as unknown as { _isHistoryOverlayOpen: () => boolean }
          )._isHistoryOverlayOpen(),
        ).toBe(false);
      } finally {
        window.history.replaceState(original, '');
      }
    });
  });
});
