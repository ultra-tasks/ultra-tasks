import { settingsDialogGuard } from './features/config/settings-dialog.guard';
import { Routes } from '@angular/router';

import {
  ActiveWorkContextGuard,
  DefaultStartPageGuard,
  DonatePageGuard,
  FocusOverlayOpenGuard,
  ValidProjectIdGuard,
  ValidTagIdGuard,
  FeatureEnabledGuard,
} from './app.guard';

import { TagTaskPageComponent } from './pages/tag-task-page/tag-task-page.component';
import { environment } from '../environments/environment';
import { IS_SYNC_AVAILABLE } from './app.constants';

export const APP_ROUTES: Routes = [
  ...(IS_SYNC_AVAILABLE
    ? [
        {
          path: 'native-sync',
          loadComponent: () =>
            import('./features/native-sync/native-sync.component').then(
              (m) => m.NativeSyncComponent,
            ),
          canActivate: [FocusOverlayOpenGuard],
        },
      ]
    : []),
  // Eagerly loaded — this is the main view
  {
    path: 'tag/:id/tasks',
    component: TagTaskPageComponent,
    data: { page: 'tag-tasks' },
    canActivate: [ValidTagIdGuard, FocusOverlayOpenGuard],
  },
  // Tag sub-routes (worklog, history, summary, metrics)
  // Must appear after tag/:id/tasks so the more specific path matches first
  {
    path: 'tag/:id',
    canActivate: [ValidTagIdGuard],
    canActivateChild: [FocusOverlayOpenGuard],
    loadChildren: () => import('./routes/context.routes').then((m) => m.TAG_CHILD_ROUTES),
  },
  // Project routes (tasks, worklog, history, summary, metrics)
  // Shares one chunk with tag routes via context.routes.ts
  {
    path: 'project/:id',
    canActivate: [ValidProjectIdGuard],
    canActivateChild: [FocusOverlayOpenGuard],
    loadChildren: () =>
      import('./routes/context.routes').then((m) => m.PROJECT_CHILD_ROUTES),
  },
  // Standalone pages — all import from same barrel so they share one chunk
  {
    path: 'config',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
    data: { page: 'config' },
    canActivate: [FocusOverlayOpenGuard, settingsDialogGuard],
  },
  ...(IS_SYNC_AVAILABLE
    ? [
        {
          path: 'account',
          loadComponent: () =>
            import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
          data: { account: true },
          canActivate: [FocusOverlayOpenGuard, settingsDialogGuard],
        },
      ]
    : []),
  {
    path: 'integrations',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.IntegrationsPageComponent),
    data: { page: 'integrations' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'plugins',
    loadComponent: () =>
      import('./plugins/ui/plugins-window.component').then(
        (m) => m.PluginsWindowComponent,
      ),
    data: { plugins: true },
    canActivate: [FocusOverlayOpenGuard, settingsDialogGuard],
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.SearchPageComponent),
    data: {
      page: 'search',
      featureConfigKey: 'isSearchEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'scheduled-list',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ScheduledListPageComponent),
    data: { page: 'scheduled-list' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'planner',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.PlannerComponent),
    data: {
      page: 'planner',
      featureConfigKey: 'isPlannerEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'schedule',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.ScheduleComponent),
    data: {
      page: 'schedule',
      featureConfigKey: 'isSchedulerEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'boards',
    loadComponent: () => import('./routes/pages.routes').then((m) => m.BoardsComponent),
    data: {
      page: 'boards',
      featureConfigKey: 'isBoardsEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'habits',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.HabitPageComponent),
    data: {
      page: 'habits',
      featureConfigKey: 'isHabitsEnabled',
    },
    canActivate: [FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  {
    path: 'archived-projects',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ArchivedProjectsPageComponent),
    data: { page: 'archived-projects' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'donate',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.DonatePageComponent),
    data: {
      page: 'donate',
      featureConfigKey: 'isDonatePageEnabled',
    },
    canActivate: [DonatePageGuard, FeatureEnabledGuard, FocusOverlayOpenGuard],
  },
  // Developer aid for checking theme contrast; not part of the app.
  ...(environment.production
    ? []
    : [
        {
          path: 'contrast-test',
          loadComponent: () =>
            import('./pages/contrast-test/contrast-test.component').then(
              (m) => m.ContrastTestComponent,
            ),
          data: { page: 'contrast-test' },
        },
      ]),
  {
    path: 'plugins/:pluginId/index',
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.PluginIndexComponent),
    data: { page: 'plugin-index' },
    canActivate: [FocusOverlayOpenGuard],
  },
  {
    path: 'active/:subPageType',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  {
    path: 'active/:subPageType/:param',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  {
    path: 'active',
    canActivate: [ActiveWorkContextGuard, FocusOverlayOpenGuard],
    loadComponent: () =>
      import('./routes/pages.routes').then((m) => m.ConfigPageComponent),
  },
  // Wildcard — redirects to default start page
  {
    path: '**',
    canActivate: [DefaultStartPageGuard],
    component: TagTaskPageComponent,
  },
];
