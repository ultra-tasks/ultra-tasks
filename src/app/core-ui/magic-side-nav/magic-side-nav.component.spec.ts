import { TaskMultiDragService } from '../../features/tasks/task-multi-drag.service';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NavigationStart, provideRouter, Router } from '@angular/router';
import { DragDropRegistry } from '@angular/cdk/drag-drop';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, of, Subject } from 'rxjs';
import { HISTORY_STATE } from '../../app.constants';
import { LS } from '../../core/persistence/storage-keys.const';

import { MagicSideNavComponent } from './magic-side-nav.component';
import { MagicNavConfigService } from './magic-nav-config.service';
import { LayoutService } from '../layout/layout.service';
import { TaskService } from '../../features/tasks/task.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskExternalDragService } from '../../features/tasks/task-external-drag.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { NavActionItem, NavConfig, NavItem, NavPluginItem } from './magic-side-nav.model';

describe('MagicSideNavComponent', () => {
  let fixture: ComponentFixture<MagicSideNavComponent>;
  let isXs: ReturnType<typeof signal<boolean>>;
  let isCompactShell: ReturnType<typeof signal<boolean>>;
  let isMobileSideNavOpen: ReturnType<typeof signal<boolean>>;
  let browserMatches: boolean;
  let navConfigServiceMock: {
    navConfig: ReturnType<typeof signal<NavConfig>>;
    areInitialTreesReady: ReturnType<typeof signal<boolean>>;
    hasAnyProjects: ReturnType<typeof signal<boolean>>;
    hasAnyTags: ReturnType<typeof signal<boolean>>;
    isProjectsExpanded: ReturnType<typeof signal<boolean>>;
    isTagsExpanded: ReturnType<typeof signal<boolean>>;
    onNavItemClick: jasmine.Spy;
  };

  it('closes the mobile drawer on navigation without going back over the new route', () => {
    isXs.set(true);
    let state: Record<string, unknown> = {
      [HISTORY_STATE.MOBILE_NAVIGATION]: true,
      navigationId: 42,
    };
    spyOnProperty(window.history, 'state', 'get').and.callFake(() => state);
    (window.history.replaceState as jasmine.Spy).and.callFake((next) => (state = next));
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();
    state.navigationId = 42;

    (TestBed.inject(Router).events as Subject<unknown>).next(
      new NavigationStart(43, '/schedule'),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
    expect(state).toEqual({ navigationId: 42 });
    expect(window.history.back).not.toHaveBeenCalled();
  });

  const navConfig: NavConfig = {
    items: [],
    fullModeByDefault: true,
    showLabels: true,
    resizable: false,
    minWidth: 190,
    maxWidth: 400,
    defaultWidth: 260,
    collapseThreshold: 150,
    expandThreshold: 180,
  };

  beforeEach(async () => {
    isXs = signal(false);
    isCompactShell = signal(false);
    isMobileSideNavOpen = signal(false);
    browserMatches = false;
    navConfigServiceMock = {
      navConfig: signal(navConfig),
      areInitialTreesReady: signal(false),
      hasAnyProjects: signal(true),
      hasAnyTags: signal(false),
      isProjectsExpanded: signal(false),
      isTagsExpanded: signal(false),
      onNavItemClick: jasmine.createSpy('onNavItemClick'),
    };
    spyOn(window, 'matchMedia').and.callFake(
      () =>
        ({
          matches: browserMatches,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    // Opening and closing the drawer must not navigate Karma's shared browser.
    spyOn(window.history, 'pushState');
    spyOn(window.history, 'replaceState');
    spyOn(window.history, 'back');

    await TestBed.configureTestingModule({
      imports: [MagicSideNavComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: TaskMultiDragService,
          useValue: {
            ids: () => [],
            selectedIds: () => new Set(),
            selectionSize: () => 0,
            start: () => {},
            clear: () => {},
            canDrop: () => false,
          },
        },
        {
          provide: MagicNavConfigService,
          useValue: navConfigServiceMock,
        },
        {
          provide: LayoutService,
          useValue: {
            isXs,
            isCompactShell,
            focusSideNavTrigger: signal(0),
            toggleSideNavModeTrigger: signal(0),
            isMobileSideNavOpen,
          },
        },
        {
          provide: TaskService,
          useValue: {
            focusFirstTaskIfVisible: jasmine.createSpy('focusFirstTaskIfVisible'),
          },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(false) },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal({ keyboard: { showSearchBar: 'Ctrl+F' } }) },
        },
        provideRouter([]),
        { provide: DragDropRegistry, useValue: { pointerUp: EMPTY } },
        {
          provide: TaskExternalDragService,
          useValue: {
            activeTask: signal(null),
            activeDragRef: signal(null),
            setActiveTask: jasmine.createSpy('setActiveTask'),
            setCancelNextDrop: jasmine.createSpy('setCancelNextDrop'),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
  });

  it('uses the shared layout breakpoint signal as its mobile source of truth', () => {
    isXs.set(true);
    browserMatches = false;

    fixture = TestBed.createComponent(MagicSideNavComponent);

    expect(fixture.componentInstance.isMobile()).toBe(true);
  });

  it('reports the open mobile drawer to the layout service', () => {
    isXs.set(true);
    browserMatches = true;
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();
    expect(isMobileSideNavOpen()).toBe(false);

    fixture.componentInstance.toggleMobileNav();
    fixture.detectChanges();
    expect(isMobileSideNavOpen()).toBe(true);

    fixture.componentInstance.toggleMobileNav();
    fixture.detectChanges();
    expect(isMobileSideNavOpen()).toBe(false);
  });

  describe('phone-only items', () => {
    const items: NavConfig['items'] = [
      { type: 'action', id: 'always', label: 'a', icon: 'a', action: () => undefined },
      {
        type: 'action',
        id: 'panel-notes',
        label: 'n',
        icon: 'n',
        mobileOnly: true,
        action: () => undefined,
      },
    ];

    it('lists the right-panel toggles in the phone drawer', () => {
      isXs.set(true);
      navConfigServiceMock.navConfig.set({ ...navConfig, items });
      fixture = TestBed.createComponent(MagicSideNavComponent);

      expect(fixture.componentInstance.navigationItems().map((i) => i.id)).toEqual([
        'always',
        'panel-notes',
      ]);
    });

    it('leaves desktop-only rows out of the phone drawer and drops the separators they leave', () => {
      const route = (id: string, over: Partial<NavItem> = {}): NavItem =>
        ({
          type: 'route',
          id,
          label: id,
          icon: id,
          route: `/${id}`,
          ...over,
        }) as NavItem;
      const separator = (id: string, over: Partial<NavItem> = {}): NavItem =>
        ({ type: 'separator', id, ...over }) as NavItem;
      const menu: NavItem = {
        type: 'menu',
        id: 'help',
        label: 'Help',
        icon: 'help',
        children: [
          route('help-a'),
          { ...route('help-donate'), mobileOnly: true } as NavItem,
        ],
      };
      navConfigServiceMock.navConfig.set({
        ...navConfig,
        items: [
          route('today', { desktopOnly: true }),
          route('inbox', { desktopOnly: true }),
          separator('sep-2'),
          route('projects'),
          separator('sep-3', { mtAuto: true }),
          route('plugins', { desktopOnly: true }),
          menu,
          route('account', { desktopOnly: true }),
        ],
      });

      isXs.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      const phone = fixture.componentInstance.navigationItems();
      expect(phone.map((i) => i.id)).toEqual(['projects', 'sep-3', 'help']);
      const phoneHelp = phone.find((i) => i.id === 'help');
      expect(phoneHelp?.type === 'menu' && phoneHelp.children.map((c) => c.id)).toEqual([
        'help-a',
        'help-donate',
      ]);

      isXs.set(false);
      const desktop = fixture.componentInstance.navigationItems();
      expect(desktop.map((i) => i.id)).toEqual([
        'today',
        'inbox',
        'sep-2',
        'projects',
        'sep-3',
        'plugins',
        'help',
        'account',
      ]);
      const desktopHelp = desktop.find((i) => i.id === 'help');
      expect(
        desktopHelp?.type === 'menu' && desktopHelp.children.map((c) => c.id),
      ).toEqual(['help-a']);
    });

    it('leaves them out of the desktop side nav, where the header has the toggles', () => {
      isXs.set(false);
      navConfigServiceMock.navConfig.set({ ...navConfig, items });
      fixture = TestBed.createComponent(MagicSideNavComponent);

      expect(fixture.componentInstance.navigationItems().map((i) => i.id)).toEqual([
        'always',
      ]);
    });
  });

  it('renders the window drag strip above the desktop nav', () => {
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    const strip = fixture.nativeElement.querySelector(
      '.title-bar-drag-strip',
    ) as HTMLElement | null;

    expect(strip).not.toBeNull();
    expect(strip!.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits the window drag strip on mobile, where the nav is a drawer', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.title-bar-drag-strip')).toBeNull();
  });

  it('exposes the open mobile drawer as labelled navigation with a focus trap', () => {
    isXs.set(true);
    browserMatches = true;
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    const drawer = fixture.nativeElement.querySelector(
      '.nav-sidenav',
    ) as HTMLElement | null;

    expect(drawer).not.toBeNull();
    expect(drawer!.tagName).toBe('NAV');
    expect(drawer!.getAttribute('role')).toBeNull();
    expect(drawer!.getAttribute('aria-modal')).toBeNull();
    expect(drawer!.getAttribute('aria-hidden')).toBeNull();
    expect(drawer!.getAttribute('aria-label')).toBeTruthy();
    expect(
      fixture.debugElement.query(By.directive(CdkTrapFocus)).injector.get(CdkTrapFocus)
        .enabled,
    ).toBe(true);
  });

  it('provides an initially focused close button inside the mobile focus trap', async () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const closeButton = fixture.nativeElement.querySelector(
      '.mobile-menu-close',
    ) as HTMLButtonElement | null;

    expect(closeButton).not.toBeNull();
    expect(closeButton!.getAttribute('aria-label')).toBeTruthy();
    expect(closeButton!.hasAttribute('cdkFocusInitial')).toBe(true);
    expect(document.activeElement).toBe(closeButton);

    closeButton!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
  });

  it('clears the top safe area once, from the screen edge, native or not', () => {
    const wasNativeMobile = document.body.classList.contains('isNativeMobile');
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    (fixture.nativeElement as HTMLElement).style.setProperty('--safe-area-top', '24px');
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    try {
      const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
      const header = fixture.nativeElement.querySelector('.nav-header') as HTMLElement;
      const closeButton = fixture.nativeElement.querySelector(
        '.mobile-menu-close',
      ) as HTMLButtonElement;

      for (const isNative of [false, true]) {
        document.body.classList.toggle('isNativeMobile', isNative);

        // The drawer is full screen and its sticky header row owns the inset: the
        // brand and Close sit below it, the list scrolls under it, and nothing
        // adds the inset a second time.
        expect(getComputedStyle(drawer).top).toBe('0px');
        expect(getComputedStyle(drawer).paddingTop).toBe('0px');
        expect(getComputedStyle(header).paddingTop).toBe('24px');
        expect(getComputedStyle(closeButton).marginTop).toBe('0px');
      }
    } finally {
      document.body.classList.toggle('isNativeMobile', wasNativeMobile);
    }
  });

  describe('phone drawer chrome', () => {
    const open = (): HTMLElement => {
      isXs.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.componentInstance.showMobileMenuOverlay.set(true);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    afterEach(() => {
      localStorage.removeItem(LS.NAV_ROW_MENU_HINT_SEEN);
    });

    it('keeps the brand and Close in one row that sticks to the top of the scroll', () => {
      const host = open();
      const header = host.querySelector('.nav-header') as HTMLElement;

      expect(header.querySelector('.st-brand')).not.toBeNull();
      expect(header.querySelector('.mobile-menu-close')).not.toBeNull();
      expect(getComputedStyle(header).position).toBe('sticky');
      expect(getComputedStyle(header).top).toBe('0px');
      expect(getComputedStyle(host.querySelector('.nav-sidenav')!).overflowY).toBe(
        'auto',
      );
    });

    it('is only a plain wrapper around the brand on desktop', () => {
      isXs.set(false);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
      const header = fixture.nativeElement.querySelector('.nav-header') as HTMLElement;

      expect(getComputedStyle(header).display).toBe('contents');
      expect(header.querySelector('.mobile-menu-close')).toBeNull();
    });

    describe('footer', () => {
      const route = (id: string, over: Partial<NavItem> = {}): NavItem =>
        ({ type: 'route', id, label: id, icon: id, route: `/${id}`, ...over }) as NavItem;
      const separator = (id: string): NavItem => ({ type: 'separator', id });
      const menu: NavItem = {
        type: 'menu',
        id: 'help',
        label: 'Help',
        icon: 'help',
        pinBottom: true,
        children: [route('help-a')],
      };
      const ids = (items: NavItem[]): string[] => items.map((item) => item.id);

      beforeEach(() => {
        navConfigServiceMock.navConfig.set({
          ...navConfig,
          items: [
            route('schedule'),
            separator('sep-3'),
            menu,
            route('settings', { pinBottom: true }),
          ],
        });
      });

      it('keeps Help and Settings out of the scroll on a phone, and drops the separator above them', () => {
        isXs.set(true);
        fixture = TestBed.createComponent(MagicSideNavComponent);

        expect(ids(fixture.componentInstance.footerItems())).toEqual([
          'help',
          'settings',
        ]);
        expect(ids(fixture.componentInstance.listItems())).toEqual(['schedule']);
      });

      it('lists every row in one scroll on desktop, with no footer', () => {
        isXs.set(false);
        fixture = TestBed.createComponent(MagicSideNavComponent);

        expect(fixture.componentInstance.footerItems()).toEqual([]);
        expect(ids(fixture.componentInstance.listItems())).toEqual([
          'schedule',
          'sep-3',
          'help',
          'settings',
        ]);
      });
    });

    describe('first-use hint for the row menus', () => {
      const sync = (isOpen: boolean, isTouch?: boolean): void =>
        (
          fixture.componentInstance as unknown as {
            _syncRowMenuHint: (isOpen: boolean, isTouch?: boolean) => void;
          }
        )._syncRowMenuHint(isOpen, isTouch);

      beforeEach(() => {
        localStorage.removeItem(LS.NAV_ROW_MENU_HINT_SEEN);
        isXs.set(true);
        fixture = TestBed.createComponent(MagicSideNavComponent);
      });

      it('shows once, the first time the drawer opens under touch, and is remembered', () => {
        sync(true, true);
        expect(fixture.componentInstance.isRowMenuHintShown()).toBe(true);
        expect(localStorage.getItem(LS.NAV_ROW_MENU_HINT_SEEN)).toBe('true');

        sync(false);
        expect(fixture.componentInstance.isRowMenuHintShown()).toBe(false);

        sync(true, true);
        expect(fixture.componentInstance.isRowMenuHintShown()).toBe(false);
      });

      it('stays away for a mouse or keyboard session and keeps the first use for touch', () => {
        sync(true, false);

        expect(fixture.componentInstance.isRowMenuHintShown()).toBe(false);
        expect(localStorage.getItem(LS.NAV_ROW_MENU_HINT_SEEN)).toBeNull();
      });

      it('stays away when there is no project or tag to long-press', () => {
        navConfigServiceMock.hasAnyProjects.set(false);
        navConfigServiceMock.hasAnyTags.set(false);

        sync(true, true);

        expect(fixture.componentInstance.isRowMenuHintShown()).toBe(false);
        expect(localStorage.getItem(LS.NAV_ROW_MENU_HINT_SEEN)).toBeNull();
      });

      it('renders as a note under the header while it is shown', () => {
        fixture.componentInstance.showMobileMenuOverlay.set(true);
        sync(true, true);
        fixture.detectChanges();

        const note = fixture.nativeElement.querySelector('.drawer-hint');
        expect(note?.getAttribute('role')).toBe('note');
        expect(note?.previousElementSibling?.classList).toContain('nav-header');
      });
    });
  });

  it('removes the mobile drawer and its focus trap while closed', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.nav-sidenav')).toBeNull();
    expect(fixture.debugElement.query(By.directive(CdkTrapFocus))).toBeNull();
  });

  it('closes the mobile drawer on Escape', () => {
    isXs.set(true);
    fixture = TestBed.createComponent(MagicSideNavComponent);
    fixture.componentInstance.showMobileMenuOverlay.set(true);
    fixture.detectChanges();

    const drawer = fixture.nativeElement.querySelector('.nav-sidenav') as HTMLElement;
    drawer.tabIndex = -1;
    drawer.focus();
    drawer.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
  });

  describe('compact shell (below 960px)', () => {
    const savedChoice = (): string | null =>
      localStorage.getItem(LS.NAV_SIDEBAR_EXPANDED);

    beforeEach(() => {
      localStorage.removeItem(LS.NAV_SIDEBAR_EXPANDED);
      localStorage.removeItem(LS.NAV_SIDEBAR_WIDTH);
    });

    afterEach(() => {
      localStorage.removeItem(LS.NAV_SIDEBAR_EXPANDED);
      localStorage.removeItem(LS.NAV_SIDEBAR_WIDTH);
    });

    it('is the 56px rail whatever the saved choice says, and leaves the choice alone', () => {
      localStorage.setItem(LS.NAV_SIDEBAR_EXPANDED, 'true');
      isCompactShell.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
      const nav = fixture.componentInstance;

      expect(nav.isExpanded()).toBe(false);
      expect(nav.sidenavWidth()).toBe(56);
      expect(nav.showText()).toBe(false);
      expect(nav.isFullMode()).toBe(true);
      expect(savedChoice()).toBe('true');
      expect(
        fixture.nativeElement
          .querySelector('.nav-sidenav')
          ?.classList.contains('compactMode'),
      ).toBe(true);
    });

    it('follows the saved choice again from 960px, collapsed or expanded', () => {
      localStorage.setItem(LS.NAV_SIDEBAR_EXPANDED, 'false');
      isCompactShell.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
      expect(fixture.componentInstance.sidenavWidth()).toBe(56);

      isCompactShell.set(false);
      fixture.detectChanges();
      // The user had collapsed it themselves: still collapsed.
      expect(fixture.componentInstance.sidenavWidth()).toBe(56);
      expect(savedChoice()).toBe('false');

      fixture.componentInstance.toggleSideNavMode();
      fixture.detectChanges();
      expect(fixture.componentInstance.sidenavWidth()).toBe(260);
      expect(savedChoice()).toBe('true');
    });

    it('expands for now on the toggle without saving it, and starts as a rail again', () => {
      localStorage.setItem(LS.NAV_SIDEBAR_EXPANDED, 'false');
      isCompactShell.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
      const nav = fixture.componentInstance;

      nav.toggleSideNavMode();
      fixture.detectChanges();
      expect(nav.isExpanded()).toBe(true);
      expect(nav.showText()).toBe(true);
      expect(nav.isFullMode()).toBe(false);
      expect(savedChoice()).toBe('false');

      isCompactShell.set(false);
      fixture.detectChanges();
      isCompactShell.set(true);
      fixture.detectChanges();
      expect(nav.isExpanded()).toBe(false);
    });

    it('reads the saved choice when it starts as a phone, then shows it in landscape', () => {
      localStorage.setItem(LS.NAV_SIDEBAR_EXPANDED, 'false');
      isXs.set(true);
      isCompactShell.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();

      // Rotated to a desktop-width landscape window (960px up): the saved choice, not
      // the default, and the phone session never replaced it.
      isXs.set(false);
      isCompactShell.set(false);
      fixture.detectChanges();

      expect(fixture.componentInstance.isFullMode()).toBe(false);
      expect(fixture.componentInstance.sidenavWidth()).toBe(56);
      expect(savedChoice()).toBe('false');
    });

    it('keeps the rail from being dragged open or shut', () => {
      navConfigServiceMock.navConfig.set({ ...navConfig, resizable: true });
      isCompactShell.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.resize-handle')).toBeNull();
      fixture.componentInstance.onResizeStart(new MouseEvent('mousedown'));
      expect(fixture.componentInstance.isResizing()).toBe(false);
    });
  });

  describe('the layout changes under the open drawer', () => {
    let state: Record<string, unknown> | null;

    const open = (): void => {
      state = null;
      spyOnProperty(window.history, 'state', 'get').and.callFake(() => state);
      (window.history.pushState as jasmine.Spy).and.callFake((next) => (state = next));
      isXs.set(true);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();
    };

    it('closes it and pops its history entry when the layout leaves the phone shell', () => {
      open();
      fixture.componentInstance.toggleMobileNav();
      fixture.detectChanges();
      expect(state?.[HISTORY_STATE.MOBILE_NAVIGATION]).toBe(true);

      // Rotated to landscape: the drawer is gone, and so must be what it left behind,
      // or the next Back is spent on a page that looks the same.
      isXs.set(false);
      fixture.detectChanges();

      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
      expect(window.history.back).toHaveBeenCalledTimes(1);
    });

    it('leaves the history alone when it was closed', () => {
      open();

      isXs.set(false);
      fixture.detectChanges();

      expect(window.history.back).not.toHaveBeenCalled();
    });

    it('starts closed when the layout enters the phone shell, with nothing to pop', () => {
      state = null;
      spyOnProperty(window.history, 'state', 'get').and.callFake(() => state);
      isXs.set(false);
      fixture = TestBed.createComponent(MagicSideNavComponent);
      fixture.detectChanges();

      isXs.set(true);
      fixture.detectChanges();

      expect(fixture.componentInstance.showMobileMenuOverlay()).toBe(false);
      expect(window.history.back).not.toHaveBeenCalled();
    });
  });

  describe('onItemClick', () => {
    it('dispatches action items to the service without executing them directly', () => {
      fixture = TestBed.createComponent(MagicSideNavComponent);
      const action = jasmine.createSpy('action');
      const item: NavActionItem = {
        id: 'test-action',
        label: 'Test action',
        icon: 'bug_report',
        type: 'action',
        action,
      };

      fixture.componentInstance.onItemClick(item);

      expect(action).not.toHaveBeenCalled();
      expect(navConfigServiceMock.onNavItemClick).toHaveBeenCalledOnceWith(item);
    });

    it('dispatches plugin items to the service without executing them directly', () => {
      fixture = TestBed.createComponent(MagicSideNavComponent);
      const action = jasmine.createSpy('pluginAction');
      const item: NavPluginItem = {
        id: 'test-plugin',
        label: 'Test plugin',
        icon: 'extension',
        type: 'plugin',
        pluginId: 'test-plugin',
        action,
      };

      fixture.componentInstance.onItemClick(item);

      expect(action).not.toHaveBeenCalled();
      expect(navConfigServiceMock.onNavItemClick).toHaveBeenCalledOnceWith(item);
    });
  });
});
