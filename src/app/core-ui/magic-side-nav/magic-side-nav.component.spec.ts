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
  let isMobileSideNavOpen: ReturnType<typeof signal<boolean>>;
  let browserMatches: boolean;
  let navConfigServiceMock: {
    navConfig: ReturnType<typeof signal<NavConfig>>;
    areInitialTreesReady: ReturnType<typeof signal<boolean>>;
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
    isMobileSideNavOpen = signal(false);
    browserMatches = false;
    navConfigServiceMock = {
      navConfig: signal(navConfig),
      areInitialTreesReady: signal(false),
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
      const closeButton = fixture.nativeElement.querySelector(
        '.mobile-menu-close',
      ) as HTMLButtonElement;

      for (const isNative of [false, true]) {
        document.body.classList.toggle('isNativeMobile', isNative);

        // The drawer is full screen and owns the inset: its brand row, Close
        // and list all sit below it, and nothing adds the inset a second time.
        expect(getComputedStyle(drawer).top).toBe('0px');
        expect(getComputedStyle(drawer).paddingTop).toBe('24px');
        expect(getComputedStyle(closeButton).marginTop).toBe('0px');
      }
    } finally {
      document.body.classList.toggle('isNativeMobile', wasNativeMobile);
    }
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
