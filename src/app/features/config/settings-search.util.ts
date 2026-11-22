import { FormlyFieldConfig } from '@ngx-formly/core';
import { GenericConfigFormSection } from './global-config.model';
import { T } from '../../t.const';
import { IMEX_FORM } from './form-cfgs/imex-form.const';
import { MS_TODO_OAUTH_CONFIG } from '../../plugins/oauth/ms-todo-import-oauth';

/** A single search hit — everything needed to render the row and jump to it. */
export interface SettingsSearchTarget {
  labelKey: string;
  tabLabelKey: string;
  tabIndex: number;
  /** CSS selector of the element to scroll to, scoped to the config page. */
  scrollSelector: string;
  /** Set for collapsible sections — the key to expand on arrival. */
  sectionKey?: string;
  /** Translation key of the field label that matched, when it wasn't the title. */
  matchedLabelKey?: string;
  fieldKey?: string;
}

/** Index of the Plugins tab in the config page's `mat-tab-group`. */
export const SETTINGS_PLUGINS_TAB_INDEX = 4;

/** Index of the Sync & Backup tab, the last one in the config page's `mat-tab-group`. */
export const SETTINGS_SYNC_BACKUP_TAB_INDEX = 5;

/** Tab order must mirror the `mat-tab-group` in `config-page.component.html`. */
export interface SettingsSearchTab {
  labelKey: string;
  sections: readonly GenericConfigFormSection[];
}

/** A setting of the bespoke Sound form, which expands when its row is picked. */
const _soundTarget = (labelKey: string): SettingsSearchTarget => ({
  labelKey,
  tabLabelKey: T.PS.REFINEMENT.SOUND,
  tabIndex: 8,
  scrollSelector: '.sound-section',
});

/**
 * Settings that aren't formly sections (bespoke components with no `items` to
 * filter), so they can only be found via a hand-written entry. Anything added
 * to the config page that isn't a `config-section` needs a row here or it stays
 * unsearchable.
 */
const CUSTOM_TARGETS: readonly SettingsSearchTarget[] = [
  ...[
    T.PS.REFINEMENT.NATIVE,
    T.PS.REFINEMENT.UPSTREAM,
    T.PS.REFINEMENT.IMPORT,
    T.PS.REFINEMENT.EXPORT,
    T.PS.REFINEMENT.ENCRYPT,
  ].map((labelKey) => ({
    labelKey,
    tabLabelKey: T.PS.REFINEMENT.DATA,
    tabIndex: 5,
    scrollSelector: '.imex-section',
  })),

  {
    labelKey: T.GCF.MISC.APPEARANCE,
    tabLabelKey: T.PS.REFINEMENT.APPEARANCE,
    tabIndex: 6,
    scrollSelector: '.appearance-section',
  },
  {
    labelKey: T.GCF.MISC.DARK_MODE,
    tabLabelKey: T.PS.REFINEMENT.APPEARANCE,
    tabIndex: 6,
    scrollSelector: '.dark-mode-select',
  },
  {
    labelKey: T.GCF.MISC.PALETTE.TITLE,
    tabLabelKey: T.PS.REFINEMENT.APPEARANCE,
    tabIndex: 6,
    scrollSelector: '.theme-select',
  },
  {
    labelKey: T.F.ULTRA_TASKS.GLASS,
    tabLabelKey: T.PS.REFINEMENT.APPEARANCE,
    tabIndex: 6,
    scrollSelector: '.st-glass-setting',
  },
  // The image row sits under the Glass switch and only shows with Glass on
  // (and not in the macOS / Windows 11 app), so the hit lands on the switch.
  {
    labelKey: T.F.ULTRA_TASKS.BG_IMAGE,
    tabLabelKey: T.PS.REFINEMENT.APPEARANCE,
    tabIndex: 6,
    scrollSelector: '.st-glass-setting',
  },
  _soundTarget(T.GCF.SOUND.TITLE),
  _soundTarget(T.GCF.SOUND.VOLUME),
  _soundTarget(T.GCF.SOUND.DONE_SOUND),
  _soundTarget(T.GCF.SOUND.IS_INCREASE_DONE_PITCH),
  _soundTarget(T.GCF.SOUND.BREAK_REMINDER_SOUND),
  _soundTarget(T.GCF.SOUND.TRACK_TIME_SOUND),

  // The importer buttons live inside the Import/Export custom section, whose
  // title and help never name the source apps — switching users search for them.
  {
    labelKey: T.FILE_IMEX.IMPORT_FROM_TODOIST,
    tabLabelKey: T.PS.REFINEMENT.DATA,
    tabIndex: SETTINGS_SYNC_BACKUP_TAB_INDEX,
    scrollSelector: `.section-${IMEX_FORM.key}`,
    sectionKey: IMEX_FORM.key,
  },
  {
    labelKey: T.FILE_IMEX.IMPORT_FROM_TICKTICK,
    tabLabelKey: T.PS.REFINEMENT.DATA,
    tabIndex: SETTINGS_SYNC_BACKUP_TAB_INDEX,
    scrollSelector: `.section-${IMEX_FORM.key}`,
    sectionKey: IMEX_FORM.key,
  },
  // Show the search result only when the import can actually sign in.
  ...(MS_TODO_OAUTH_CONFIG
    ? [
        {
          labelKey: T.FILE_IMEX.IMPORT_FROM_MS_TODO,
          tabLabelKey: T.PS.REFINEMENT.DATA,
          tabIndex: SETTINGS_SYNC_BACKUP_TAB_INDEX,
          scrollSelector: `.section-${IMEX_FORM.key}`,
          sectionKey: IMEX_FORM.key,
        },
      ]
    : []),
];

/** Every field of a section, with `fieldGroup` wrappers (sync providers) flattened out. */
const _allFields = (fields: FormlyFieldConfig[] = []): FormlyFieldConfig[] =>
  fields.flatMap((field) => [field, ..._allFields(field.fieldGroup)]);

/**
 * Turns a query into a flat, jump-to-able list of settings across every tab.
 *
 * Matching a tab's own name returns all of that tab's sections, so "time
 * tracking" lists the whole tab rather than a single section.
 */
export const searchSettings = (
  tabs: readonly SettingsSearchTab[],
  query: string,
  translate: (key: string) => string,
): SettingsSearchTarget[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const has = (key?: string): boolean =>
    !!key && translate(key).toLowerCase().includes(q);

  return tabs.flatMap((tab, tabIndex) => {
    const isTabMatch = has(tab.labelKey);
    const sectionTargets = tab.sections.flatMap((section) => {
      const matchedFields = _allFields(section.items).filter((field) => {
        const props = field.props ?? field.templateOptions;
        return (
          has(props?.label) ||
          has(props?.description) ||
          String(field.key ?? '')
            .toLowerCase()
            .includes(q)
        );
      });
      const isMatch = isTabMatch || has(section.title) || has(section.help);
      if (!isMatch && matchedFields.length === 0) return [];
      if (!isMatch)
        return matchedFields.map((field) => ({
          labelKey: (field.props ?? field.templateOptions)?.label ?? section.title,
          tabLabelKey: tab.labelKey,
          tabIndex,
          scrollSelector: '.section-' + section.key,
          sectionKey: section.key,
          fieldKey: String(field.key ?? ''),
          matchedLabelKey: (field.props ?? field.templateOptions)?.label,
        }));
      return [
        {
          labelKey: section.title,
          tabLabelKey: tab.labelKey,
          tabIndex,
          scrollSelector: `.section-${section.key}`,
          sectionKey: section.key,
          // Only worth showing when the title itself didn't match.
        },
      ];
    });

    return [
      ...CUSTOM_TARGETS.filter(
        (target) => target.tabIndex === tabIndex && (isTabMatch || has(target.labelKey)),
      ),
      ...sectionTargets,
    ];
  });
};
