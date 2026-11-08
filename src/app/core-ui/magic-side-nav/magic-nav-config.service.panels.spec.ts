import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { MagicNavConfigService } from './magic-nav-config.service';
import { NavActionItem, NavItem } from './magic-side-nav.model';
import { LayoutService } from '../layout/layout.service';
import { togglePluginPanel } from '../layout/store/layout.actions';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { TagService } from '../../features/tag/tag.service';
import { ShepherdService } from '../../features/shepherd/shepherd.service';
import { QuickTourService } from '../../features/onboarding/quick-tour.service';
import { SearchDialogService } from '../../pages/search-page/search-dialog/search-dialog.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { PluginService } from '../../plugins/plugin.service';
import { MenuTreeService } from '../../features/menu-tree/menu-tree.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

/**
 * Below 600px nothing renders the right-panel toggles in the header, so the
 * phone drawer (opened from the bottom nav's Browse button) is their one home.
 * `desktop-panel-buttons` and `plugin-side-panel-btns` own them from 600px up.
 * A panel added there without an item here is how it ends up with no way to be
 * opened on a phone, so every toggle is pinned below.
 */
describe('MagicNavConfigService panel items', () => {
  interface SidePanelBtn {
    pluginId: string;
    label: string;
    icon?: string;
    onClick?: () => void;
  }

  const ALL_OFF: Partial<AppFeaturesConfig> = {
    isIssuesPanelEnabled: false,
    isProjectNotesEnabled: false,
  };

  let layout: { toggleNotes: jasmine.Spy; toggleAddTaskPanel: jasmine.Spy };
  let dispatch: jasmine.Spy;

  const build = (
    over: Partial<AppFeaturesConfig>,
    sidePanelButtons: SidePanelBtn[] = [],
    contexts: { main: unknown; inbox: unknown } = { main: null, inbox: null },
  ): NavItem[] => {
    layout = {
      toggleNotes: jasmine.createSpy('toggleNotes'),
      toggleAddTaskPanel: jasmine.createSpy('toggleAddTaskPanel'),
    };
    dispatch = jasmine.createSpy('dispatch');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MagicNavConfigService,
        { provide: LayoutService, useValue: layout },
        { provide: Store, useValue: { select: () => of([]), dispatch } },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: signal<AppFeaturesConfig>({
              ...DEFAULT_GLOBAL_CONFIG.appFeatures,
              ...over,
            }),
          },
        },
        {
          provide: WorkContextService,
          useValue: {
            mainWorkContext$: of(contexts.main),
            inboxWorkContext$: of(contexts.inbox),
          },
        },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList$: of([]) } },
        { provide: ShepherdService, useValue: {} },
        { provide: QuickTourService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: SearchDialogService, useValue: {} },
        {
          provide: PluginBridgeService,
          useValue: {
            menuEntries: signal([]),
            sidePanelButtons: signal(sidePanelButtons),
          },
        },
        {
          provide: PluginService,
          useValue: {
            getAllPluginStates: () => new Map(),
            getPluginIconsSignal: () => signal(new Map()),
          },
        },
        {
          provide: MenuTreeService,
          useValue: {
            buildProjectViewTree: () => [],
            buildTagViewTree: () => [],
            hasProjectTree: () => true,
            hasTagTree: () => true,
          },
        },
        { provide: SnackService, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    return TestBed.inject(MagicNavConfigService).navConfig().items;
  };

  const panelItems = (items: NavItem[]): NavActionItem[] =>
    items.filter((i): i is NavActionItem => i.type === 'action' && !!i.mobileOnly);

  it('adds nothing when no panel is enabled', () => {
    const items = build(ALL_OFF);

    expect(items.filter((i) => i.mobileOnly)).toEqual([]);
  });

  it('lists the project notes and toggles them', () => {
    const [notes] = panelItems(build({ ...ALL_OFF, isProjectNotesEnabled: true }));

    expect(notes.id).toBe('panel-notes');
    expect(notes.label).toBe(T.BN.SHOW_NOTES);
    notes.action();
    expect(layout.toggleNotes).toHaveBeenCalledTimes(1);
  });

  it('ignores the retired issue-panel flag', () => {
    const items = build({ ...ALL_OFF, isIssuesPanelEnabled: true });
    expect(panelItems(items)).toEqual([]);
    expect(items.filter((item) => item.id === 'integrations').length).toBe(1);
  });

  it('lists every plugin side panel, toggling it and running its own handler', () => {
    const onClick = jasmine.createSpy('onClick');
    const [plugin] = panelItems(
      build(ALL_OFF, [{ pluginId: 'p1', label: 'Panel one', icon: 'star', onClick }]),
    );

    expect(plugin.label).toBe('Panel one');
    expect(plugin.icon).toBe('star');
    plugin.action();
    expect(dispatch).toHaveBeenCalledWith(togglePluginPanel('p1'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('groups the toggles under one phone-only separator', () => {
    const items = build({ ...ALL_OFF, isProjectNotesEnabled: true });

    const separator = items.find((i) => i.id === 'sep-panels');
    expect(separator?.type).toBe('separator');
    expect(separator?.mobileOnly).toBe(true);
  });
});

/**
 * The phone drawer is Browse: what the bottom nav and Settings already reach is
 * left out of it. Today, Inbox and Upcoming are bottom-nav buttons; Plugins and
 * Account are Settings rows on a phone; Support us moves under Help.
 */
describe('MagicNavConfigService phone drawer placement', () => {
  let items: NavItem[];

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MagicNavConfigService,
        { provide: LayoutService, useValue: {} },
        { provide: Store, useValue: { select: () => of([]), dispatch: () => undefined } },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: signal<AppFeaturesConfig>({
              ...DEFAULT_GLOBAL_CONFIG.appFeatures,
              isPlannerEnabled: true,
              isDonatePageEnabled: true,
            }),
          },
        },
        {
          provide: WorkContextService,
          useValue: {
            mainWorkContext$: of({ id: 'TODAY', title: 'Today' }),
            inboxWorkContext$: of({ id: 'INBOX_PROJECT', title: 'Inbox' }),
          },
        },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList$: of([]) } },
        { provide: ShepherdService, useValue: {} },
        { provide: QuickTourService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: SearchDialogService, useValue: {} },
        {
          provide: PluginBridgeService,
          useValue: { menuEntries: signal([]), sidePanelButtons: signal([]) },
        },
        {
          provide: PluginService,
          useValue: {
            getAllPluginStates: () => new Map(),
            getPluginIconsSignal: () => signal(new Map()),
          },
        },
        {
          provide: MenuTreeService,
          useValue: {
            buildProjectViewTree: () => [],
            buildTagViewTree: () => [],
            hasProjectTree: () => true,
            hasTagTree: () => true,
          },
        },
        { provide: SnackService, useValue: {} },
        {
          provide: Router,
          useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') },
        },
      ],
    });
    items = TestBed.inject(MagicNavConfigService).navConfig().items;
  });

  const find = (id: string): NavItem | undefined => items.find((i) => i.id === id);

  it('keeps the destinations the bottom nav already has out of the drawer', () => {
    expect(find('main-TODAY')?.desktopOnly).toBe(true);
    expect(find('inbox-INBOX_PROJECT')?.desktopOnly).toBe(true);
    expect(find('planner')?.desktopOnly).toBe(true);
  });

  it('leaves Plugins and Account to the Settings rows on a phone', () => {
    expect(find('plugins')?.desktopOnly).toBe(true);
    expect(find('account')?.desktopOnly).toBe(true);
  });

  it('keeps Settings and Help in the drawer', () => {
    expect(find('settings')?.desktopOnly).toBeUndefined();
    expect(find('help')?.desktopOnly).toBeUndefined();
  });

  it('moves Support us under Help on a phone', () => {
    const help = find('help');
    const children = help?.type === 'menu' ? help.children : [];
    const donate = find('donate');

    // Donation links are off on iOS and macOS builds, where neither exists.
    if (!donate) {
      expect(children.find((c) => c.id === 'help-donate')).toBeUndefined();
      return;
    }
    expect(donate.desktopOnly).toBe(true);
    const phoneDonate = children.find((c) => c.id === 'help-donate');
    expect(phoneDonate?.mobileOnly).toBe(true);
    expect(phoneDonate?.type).toBe('action');
  });
});
