import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { GlassSettingsComponent } from '../../features/config/glass-settings/glass-settings.component';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { getChangedAppFeatures } from '../../features/config/get-changed-app-features.util';
import { TaskWidgetSettingsService } from '../../features/config/task-widget-settings.service';
import { FocusModeLocalSettingsService } from '../../features/config/focus-mode-local-settings.service';
import {
  FocusModeLocalConfig,
  TaskWidgetConfig,
} from '../../features/config/global-config.model';
import {
  GLOBAL_GENERAL_FORM_CONFIG,
  GLOBAL_IMEX_FORM_CONFIG,
  GLOBAL_PRODUCTIVITY_FORM_CONFIG,
  GLOBAL_TIME_TRACKING_FORM_CONFIG,
  GLOBAL_TASKS_FORM_CONFIG,
} from '../../features/config/global-config-form-config.const';
import {
  AppFeaturesConfig,
  ConfigFormConfig,
  GenericConfigFormSection,
  GlobalConfigFormSectionKey,
  GlobalConfigSectionKey,
  GlobalConfigState,
  GlobalSectionConfig,
} from '../../features/config/global-config.model';
import { from, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ProjectCfgFormKey } from '../../features/project/project.model';
import { T } from '../../t.const';
import { versions } from '../../../environments/versions';
import { IS_ELECTRON, IS_SYNC_AVAILABLE } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { getAutomaticBackUpFormCfg } from '../../features/config/form-cfgs/automatic-backups-form.const';
import { getAppVersionStr } from '../../util/get-app-version-str';
import { UpdateCheckService } from '../../core/update-check/update-check.service';
import { isUpdateCheckPossible } from '../../core/update-check/is-update-check-possible.util';
import { ConfigSectionComponent } from '../../features/config/config-section/config-section.component';
import { ConfigSoundFormComponent } from '../../features/config/config-sound-form/config-sound-form.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncConfigService } from '../../imex/sync/sync-config.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { createPluginShortcutFormItems } from '../../features/config/form-cfgs/plugin-keyboard-shortcuts';
import { PluginShortcutCfg } from '../../plugins/plugin-api.model';
import { ThemeSelectorComponent } from '../../core/theme/theme-selector/theme-selector.component';
import { Log } from '../../core/log';
import { DialogLogsComponent } from '../../ui/dialog-logs/dialog-logs.component';
import { SnackService } from '../../core/snack/snack.service';
import { ShareService } from '../../core/share/share.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { MAT_DIALOG_DATA, MatDialog, MatDialogClose } from '@angular/material/dialog';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton, MatIconButton } from '@angular/material/button';
import { LocalBackupService } from '../../imex/local-backup/local-backup.service';
import { DialogBackupsListComponent } from '../../imex/local-backup/dialog-backups-list/dialog-backups-list.component';
import { FormsModule } from '@angular/forms';
import { MatFormField, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatOption } from '@angular/material/core';
import {
  searchSettings,
  SettingsSearchTarget,
} from '../../features/config/settings-search.util';

/**
 * Starts expanded so the feature toggles are visible on opening Settings —
 * the point of leading the default tab with them. Collapsing it sticks until
 * the page is left.
 */
const OPEN_BY_DEFAULT_SECTION_KEY = 'appFeatures';

@Component({
  selector: 'config-page',
  templateUrl: './config-page.component.html',
  styleUrls: ['./config-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ThemeSelectorComponent,
    GlassSettingsComponent,
    ConfigSectionComponent,
    ConfigSoundFormComponent,
    TranslatePipe,
    MatIcon,
    MatTooltip,
    MatButton,
    MatIconButton,
    MatDialogClose,
    FormsModule,
    MatFormField,
    MatInput,
    MatPrefix,
    MatSuffix,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
  ],
})
export class ConfigPageComponent implements OnInit {
  private readonly _cd = inject(ChangeDetectorRef);
  private readonly _injector = inject(Injector);
  private readonly _elRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _content = viewChild<ElementRef<HTMLElement>>('settingsContent');
  private readonly _layout = viewChild<ElementRef<HTMLElement>>('settingsLayout');
  private readonly _route = inject(ActivatedRoute);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _pluginBridgeService = inject(PluginBridgeService);
  private readonly _snackService = inject(SnackService);
  private readonly _shareService = inject(ShareService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _localBackupService = inject(LocalBackupService);
  private readonly _translateService = inject(TranslateService);
  private readonly _isAndroidWebView = inject(IS_ANDROID_WEB_VIEW_TOKEN);
  private readonly _updateCheckService = inject(UpdateCheckService);

  readonly configService = inject(GlobalConfigService);
  readonly syncSettingsService = inject(SyncConfigService);
  readonly taskWidgetSettingsService = inject(TaskWidgetSettingsService);
  readonly focusModeLocalSettingsService = inject(FocusModeLocalSettingsService);

  T: typeof T = T;

  selectedTabIndex = 0;
  expandedSection: string | null = null;
  expandedField = '';
  colorEditorExpanded = false;
  soundExpanded = false;
  private _isDefaultSectionCollapsed = false;

  searchQuery = '';
  /** Flat, cross-tab search hits in tab order. Empty while not searching. */
  searchResults: SettingsSearchTarget[] = [];

  // @todo - find better names for tabs configs forms
  // Tab-specific form configurations
  generalFormCfg: ConfigFormConfig;
  globalTasksFormCfg: ConfigFormConfig;
  timeTrackingFormCfg: ConfigFormConfig;
  globalImexFormCfg: ConfigFormConfig;
  globalCfg?: GlobalConfigState;

  // `providerId === null` ⇒ empty state (sync disabled or no provider chosen).
  // switchMap drops stale signal writes if a new sync-config emission arrives
  // before the previous provider probe resolves — the underlying probe promise
  // still runs to completion in the background; only the result is ignored.
  // try/catch keeps the stream alive when isReady() rejects (otherwise the
  // observable error would kill the subscription and freeze the status).
  syncStatus = toSignal(
    this.syncSettingsService.syncSettingsForm$.pipe(
      switchMap((sync) => {
        const providerId = sync.isEnabled
          ? (sync.syncProvider as SyncProviderId | null)
          : null;
        const isEncrypted = !!sync.isEncryptionEnabled;
        if (!providerId) {
          return of({ providerId: null, needsAuth: false, isEncrypted });
        }
        return from(
          (async () => {
            const provider = await this._providerManager.getProviderById(providerId);
            const requiresAuth = !!provider?.getAuthHelper;
            try {
              const isAuthed = !!(await provider?.isReady());
              return { providerId, needsAuth: requiresAuth && !isAuthed, isEncrypted };
            } catch {
              // Don't claim a non-OAuth provider needs auth — only surface
              // the auth pill if the provider could plausibly require it.
              return { providerId, needsAuth: requiresAuth, isEncrypted };
            }
          })(),
        );
      }),
    ),
    { initialValue: { providerId: null, needsAuth: false, isEncrypted: false } },
  );

  appVersion: string = getAppVersionStr();
  versions?: typeof versions = versions;
  isUpdateCheckPossible: boolean = isUpdateCheckPossible();

  private readonly _destroyRef = inject(DestroyRef);
  private readonly _dialogData = inject<Record<string, string> | null>(MAT_DIALOG_DATA, {
    optional: true,
  });
  readonly categories = [
    { index: 0, label: T.PS.TABS.GENERAL, icon: 'tune' },
    { index: 6, label: T.PS.REFINEMENT.APPEARANCE, icon: 'palette' },
    { index: 1, label: T.PS.REDESIGN.TASKS, icon: 'task_alt' },
    { index: 2, label: T.PS.REDESIGN.TIME, icon: 'timer' },
    { index: 7, label: T.PS.REFINEMENT.KEYBOARD, icon: 'keyboard' },
    { index: 8, label: T.PS.REFINEMENT.SOUND, icon: 'volume_up' },
    { index: 5, label: T.PS.REFINEMENT.DATA, icon: 'import_export' },
  ];
  readonly isAccount = this._dialogData?.['account'] === 'true';
  readonly isPhone = inject(LayoutService).isXs;
  private readonly _router = inject(Router);
  /**
   * Windows of their own that Settings points to. Plugins & integrations has no
   * sidebar row on any screen size; Account has one on desktop, so it is a
   * Settings row on a phone only.
   */
  readonly windowLinks = [
    {
      path: '/plugins',
      label: T.PS.REDESIGN.PLUGINS,
      icon: 'extension',
      isPhoneOnly: false,
    },
    {
      path: '/account',
      label: T.PS.REFINEMENT.ACCOUNT,
      icon: 'account_circle',
      isPhoneOnly: true,
    },
  ];
  readonly visibleWindowLinks = computed(() =>
    this.windowLinks.filter(
      (link) =>
        (!link.isPhoneOnly || this.isPhone()) &&
        (IS_SYNC_AVAILABLE || link.path !== '/account'),
    ),
  );
  private readonly _dateFormat = inject(DateTimeFormatService);
  get dateExamples(): { regional: string; task: string } {
    const sample = new Date(2026, 10, 18, 14, 30);
    return {
      regional:
        this._dateFormat.formatDate(sample) +
        ' · ' +
        this._dateFormat.formatTime(sample.getTime()),
      task: formatTaskDateLabel(sample, '2026-11-05', this._dateFormat.taskDateDisplay()),
    };
  }

  get generalSections(): ConfigFormConfig {
    return this.generalFormCfg.filter((section) => section.key !== 'keyboard');
  }
  get keyboardSections(): ConfigFormConfig {
    return this.generalFormCfg.filter((section) => section.key === 'keyboard');
  }
  mobileCategoryVisible = false;

  constructor() {
    // Initialize tab-specific form configurations
    this.generalFormCfg = GLOBAL_GENERAL_FORM_CONFIG.slice();
    this.timeTrackingFormCfg = [
      ...GLOBAL_TIME_TRACKING_FORM_CONFIG,
      ...GLOBAL_PRODUCTIVITY_FORM_CONFIG,
    ];
    // "Browse backups" lives on the Import/Export section so every platform
    // (incl. web, which has no automatic backups) can reach the recovery ring.
    this.globalImexFormCfg = GLOBAL_IMEX_FORM_CONFIG.map((section) =>
      section.customSection === 'FILE_IMPORT_EXPORT'
        ? {
            ...section,
            actions: [
              ...(section.actions ?? []),
              {
                label: T.GCF.AUTO_BACKUPS.BROWSE,
                icon: 'history',
                onClick: () => {
                  this._matDialog.open(DialogBackupsListComponent, {
                    restoreFocus: true,
                  });
                },
              },
            ],
          }
        : section,
    );
    this.globalTasksFormCfg = GLOBAL_TASKS_FORM_CONFIG.slice();

    // NOTE: needs special handling cause of the async stuff
    if (this._isAndroidWebView) {
      this.globalImexFormCfg = [
        ...this.globalImexFormCfg,
        getAutomaticBackUpFormCfg(
          undefined,
          [
            {
              label: T.GCF.AUTO_BACKUPS.D_LIST.CLEAR_ALL,
              icon: 'delete_sweep',
              onClick: () => this.clearBackups(),
            },
            {
              label: T.GCF.AUTO_BACKUPS.RESTORE_LATEST,
              icon: 'settings_backup_restore',
              onClick: () =>
                this._localBackupService.restoreLatestMobileBackupFromSettings(),
            },
          ],
          this._lastBackupInfo(),
        ),
      ];
    } else if (IS_ELECTRON) {
      window.ea.getBackupPath().then((backupPath) => {
        this.globalImexFormCfg = [
          ...this.globalImexFormCfg,
          getAutomaticBackUpFormCfg(backupPath, [
            {
              label: T.GCF.AUTO_BACKUPS.D_LIST.CLEAR_ALL,
              icon: 'delete_sweep',
              onClick: () => this.clearBackups(),
            },
          ]),
        ];
        this._cd.detectChanges();
      });
    }

    // Use effect to react to plugin shortcuts changes for live updates
    effect(() => {
      const shortcuts = this._pluginBridgeService.shortcuts();
      // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
      Log.log('Plugin shortcuts changed:', { shortcuts });
      this._updateKeyboardFormWithPluginShortcuts(shortcuts);
    });
  }

  /**
   * Pre-formatted "Last backup: <date>" line for the mobile auto-backups section
   * (#7901), or undefined when no local backup has run yet. Reflects the time as
   * of opening Settings — good enough for a "you're protected" indicator without
   * wiring a live subscription. Uses toLocaleString() to match the Electron
   * restore prompt's date formatting.
   */
  private _lastBackupInfo(): string | undefined {
    const ts = this._localBackupService.getLastBackupTime();
    if (ts === null) {
      return undefined;
    }
    return this._translateService.instant(T.GCF.AUTO_BACKUPS.LAST_BACKUP_INFO, {
      date: new Date(ts).toLocaleString(),
    });
  }

  ngOnInit(): void {
    this.configService.cfg$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((cfg) => {
        this.globalCfg = cfg;
      });

    // Check for tab query parameter and set selected tab
    (this._dialogData ? of(this._dialogData) : this._route.queryParams)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((params) => {
        if (params['tab'] !== undefined) {
          const tabIndex = parseInt(params['tab'], 10);
          if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex <= 9) {
            this.selectedTabIndex = tabIndex === 3 ? 2 : tabIndex;
            this._cd.detectChanges();
          }
        }
        if (params['section'] !== undefined) {
          this.expandedSection = params['section'];
          if (this.expandedSection === 'keyboard') this.selectedTabIndex = 7;
          if (this.expandedSection === 'sound') this.selectedTabIndex = 8;
          if (this.expandedSection === 'appearance') this.selectedTabIndex = 6;
          // Backups, import and export: the first-run Restore and Import land here.
          if (this.expandedSection === 'data') this.selectedTabIndex = 5;
          if (
            this.globalTasksFormCfg.some(
              (section) => section.key === this.expandedSection,
            )
          ) {
            this.selectedTabIndex = 1;
          } else if (
            this.timeTrackingFormCfg.some(
              (section) => section.key === this.expandedSection,
            )
          ) {
            this.selectedTabIndex = 2;
          }
          this._cd.detectChanges();
        }
        this.mobileCategoryVisible =
          params['tab'] !== undefined || params['section'] !== undefined;
      });
  }

  private _updateKeyboardFormWithPluginShortcuts(shortcuts: PluginShortcutCfg[]): void {
    // @todo - make separate core shortcuts and plugins shortcuts settings
    // Find keyboard form section in general tab configuration
    const keyboardFormIndex = this.generalFormCfg.findIndex(
      (section) => section.key === 'keyboard',
    );

    if (keyboardFormIndex === -1) {
      Log.err('Keyboard form section not found');
      return;
    }

    const keyboardSection = this.generalFormCfg[keyboardFormIndex];

    // Remove existing plugin shortcuts and header from the form
    const filteredItems = (keyboardSection.items || []).filter((item) => {
      // Remove plugin shortcut items
      if (item.key?.toString().startsWith('plugin_')) {
        return false;
      }
      // Remove plugin shortcuts header
      if (
        item.type === 'tpl' &&
        item.templateOptions?.text ===
          (T.GCF.KEYBOARD.PLUGIN_SHORTCUTS || 'Plugin Shortcuts')
      ) {
        return false;
      }
      return true;
    });

    // Add current plugin shortcuts to the form
    let newItems = [...filteredItems];
    if (shortcuts.length > 0) {
      const pluginShortcutItems = createPluginShortcutFormItems(shortcuts);
      newItems = [...filteredItems, ...pluginShortcutItems];
      Log.log(`Updated keyboard form with ${shortcuts.length} plugin shortcuts`);
    } else {
      Log.log('No plugin shortcuts to add to keyboard form');
    }

    // Create a new keyboard section object to trigger change detection
    const newKeyboardSection = {
      ...keyboardSection,
      items: newItems,
    };

    // Create a new config array to ensure Angular detects the change
    this.generalFormCfg = [
      ...this.generalFormCfg.slice(0, keyboardFormIndex),
      newKeyboardSection,
      ...this.generalFormCfg.slice(keyboardFormIndex + 1),
    ];

    // Trigger change detection
    this._cd.detectChanges();
  }

  async openSyncCfgDialog(): Promise<void> {
    const { DialogSyncCfgComponent } =
      await import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component');
    this._matDialog.open(DialogSyncCfgComponent);
  }

  triggerSync(): void {
    this._syncWrapperService.sync(true);
  }

  saveGlobalCfg($event: {
    sectionKey: GlobalConfigFormSectionKey | ProjectCfgFormKey;
    config: Record<string, unknown>;
  }): void {
    const config = $event.config;
    const formSectionKey = $event.sectionKey;

    if (!formSectionKey || !config) {
      throw new Error('Not enough data');
    }

    // taskWidget is per-instance (not synced) — handled by a dedicated service
    if (formSectionKey === 'taskWidget') {
      this.taskWidgetSettingsService.update(config as Partial<TaskWidgetConfig>);
      return;
    }

    // focusModeLocal is per-instance (not synced) — handled by a dedicated service
    if (formSectionKey === 'focusModeLocal') {
      this.focusModeLocalSettingsService.update(config as Partial<FocusModeLocalConfig>);
      return;
    }

    // From here on we know it's a real GlobalConfigState section.
    const sectionKey = formSectionKey as GlobalConfigSectionKey;

    if (sectionKey === 'appFeatures') {
      // Sync only the switches that changed, never this device's untouched defaults.
      const changed = getChangedAppFeatures(
        this.configService.appFeatures(),
        config as Partial<AppFeaturesConfig>,
      );
      if (Object.keys(changed).length > 0) {
        this.configService.updateSection(sectionKey, changed);
      }
      return;
    }

    this.configService.updateSection(sectionKey, config);
  }

  /**
   * Recomputes the result list. Done on input rather than in a `computed()`
   * because the per-tab configs are plain fields reassigned after construction
   * (plugin shortcuts, the Electron backup path).
   */
  onSearchChange(query: unknown): void {
    // Picking an option makes the autocomplete write the result object back
    // into the model — ignore it, `goToSearchResult` clears the field anyway.
    this.searchQuery = typeof query === 'string' ? query : '';
    // Tab order must match the `mat-tab-group` — the index is what we navigate to.
    this.searchResults = searchSettings(
      [
        { labelKey: T.PS.TABS.GENERAL, sections: this.generalSections },
        { labelKey: T.PS.REDESIGN.TASKS, sections: this.globalTasksFormCfg },
        { labelKey: T.PS.REDESIGN.TIME, sections: this.timeTrackingFormCfg },
        {
          labelKey: T.PS.TABS.PRODUCTIVITY,
          sections: [],
        },
        { labelKey: T.PS.TABS.PLUGINS, sections: [] },
        { labelKey: T.PS.REFINEMENT.DATA, sections: this.globalImexFormCfg },
        { labelKey: T.PS.REFINEMENT.APPEARANCE, sections: [] },
        { labelKey: T.PS.REFINEMENT.KEYBOARD, sections: this.keyboardSections },
        { labelKey: T.PS.REFINEMENT.SOUND, sections: [] },
      ],
      this.searchQuery,
      (key) => this._translateService.instant(key),
    );
  }

  selectCategory(index: number): void {
    this.selectedTabIndex = index;
    this.mobileCategoryVisible = true;
    this._content()?.nativeElement.scrollTo({ top: 0 });
    this._layout()?.nativeElement.scrollTo({ top: 0 });
  }

  openWindow(path: string): void {
    this._matDialog.getDialogById('settings-window')?.close();
    void this._router.navigateByUrl(path);
  }

  clearBackups(): void {
    this._matDialog.open(DialogBackupsListComponent, { data: { confirmClear: true } });
  }

  /** Jumps to a hit: right tab, section expanded, scrolled into view. */
  goToSearchResult(target: SettingsSearchTarget): void {
    this.onSearchChange('');
    this.expandedField = '';
    this._cd.detectChanges();
    this.selectedTabIndex = target.tabIndex;
    this.expandedSection = target.sectionKey ?? null;
    this.mobileCategoryVisible = true;
    this.expandedField = target.fieldKey ?? '';
    this.colorEditorExpanded = target.scrollSelector === '.theme-select';
    this.soundExpanded = target.scrollSelector === '.sound-section';
    this._cd.detectChanges();
    afterNextRender(
      () => {
        const section = this._elRef.nativeElement.querySelector<HTMLElement>(
          target.scrollSelector,
        );
        const field = target.fieldKey
          ? section?.querySelector<HTMLElement>(
              '[data-setting-key="' + CSS.escape(target.fieldKey) + '"]',
            )
          : null;
        const destination = field ?? section;
        destination?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        destination
          ?.querySelector<HTMLElement>(
            'input, select, textarea, button, [role="combobox"], [role="switch"]',
          )
          ?.focus({ preventScroll: true });
      },
      { injector: this._injector },
    );
  }

  /** Shared `[isExpanded]` check for the `config-section` repeated across every tab. */
  isSectionExpanded(section: GenericConfigFormSection): boolean {
    return (
      section.key === this.expandedSection ||
      section.customSection === this.expandedSection ||
      (section.key === OPEN_BY_DEFAULT_SECTION_KEY && !this._isDefaultSectionCollapsed)
    );
  }

  /**
   * Forgets the expanded section once it is collapsed by hand, so selecting its
   * search result again changes `[isExpanded]` and reopens it (#9643).
   */
  onSectionExpandedChange(section: GenericConfigFormSection, isExpanded: boolean): void {
    if (section.key === OPEN_BY_DEFAULT_SECTION_KEY) {
      this._isDefaultSectionCollapsed = !isExpanded;
      // Only drop `expandedSection` if it points here — another section's
      // search-driven expansion must survive collapsing this one.
      if (!isExpanded && this.expandedSection === section.key) {
        this.expandedSection = null;
      }
      return;
    }
    if (!isExpanded && this.isSectionExpanded(section)) {
      this.expandedSection = null;
    }
  }

  getGlobalCfgSection(
    sectionKey: GlobalConfigFormSectionKey | ProjectCfgFormKey,
  ): GlobalSectionConfig {
    if (sectionKey === 'taskWidget') {
      return this.taskWidgetSettingsService.settings() as GlobalSectionConfig;
    }
    if (sectionKey === 'focusModeLocal') {
      return this.focusModeLocalSettingsService.settings() as GlobalSectionConfig;
    }
    return (this.globalCfg as unknown as Record<string, GlobalSectionConfig>)[sectionKey];
  }

  showLogs(): void {
    this._matDialog.open(DialogLogsComponent, {
      data: { logs: Log.exportLogHistory() },
    });
  }

  checkForUpdates(): void {
    this._updateCheckService.checkForUpdate({ isUserTriggered: true });
  }

  async copyVersionToClipboard(text: string): Promise<void> {
    const result = await this._shareService.copyToClipboard(text, 'Version');
    if (!result.success) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.PS.FAILED_TO_COPY_TO_CLIPBOARD,
      });
    }
  }
}
import { formatTaskDateLabel } from '../../core/date-time-format/task-date-display';
