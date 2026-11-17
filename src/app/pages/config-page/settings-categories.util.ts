import { T } from '../../t.const';

export interface SettingsCategory {
  /** The tab the page opens, shared with the `?tab=` deep links. */
  readonly index: number;
  readonly label: string;
  readonly icon: string;
}

export const KEYBOARD_CATEGORY_INDEX = 7;
/** Phones only: the version, changelog, logs and privacy policy of the footer. */
export const ABOUT_CATEGORY_INDEX = 10;

export interface SettingsCategoryContext {
  /** The keyboard form section exists: the Android app removes it. */
  hasKeyboardSections: boolean;
  /** Settings is the full-screen drill-down: a phone, or a short window on a touch screen. */
  isDrillDown: boolean;
  /** The primary input is a finger, so a soft keyboard has to fill the key-capture fields. */
  isTouchPrimary: boolean;
}

/**
 * The categories of the Settings window, derived from what the device can show
 * instead of one fixed list (an empty "Keyboard shortcuts" page in the Android
 * app, 60 key-capture fields a soft keyboard cannot fill on a phone).
 *
 * - Keyboard shortcuts: only with a keyboard form section, and not on a
 *   touch-only phone. A tablet keeps it: it may have a hardware keyboard.
 * - About: only where the window's footer is gone (the drill-down), as the way
 *   to the version, changelog, update check, logs and privacy policy.
 */
export const getSettingsCategories = ({
  hasKeyboardSections,
  isDrillDown,
  isTouchPrimary,
}: SettingsCategoryContext): SettingsCategory[] => [
  { index: 0, label: T.PS.TABS.GENERAL, icon: 'tune' },
  { index: 6, label: T.PS.REFINEMENT.APPEARANCE, icon: 'palette' },
  { index: 1, label: T.PS.REDESIGN.TASKS, icon: 'task_alt' },
  { index: 2, label: T.PS.REDESIGN.TIME, icon: 'timer' },
  ...(hasKeyboardSections && !(isDrillDown && isTouchPrimary)
    ? [
        {
          index: KEYBOARD_CATEGORY_INDEX,
          label: T.PS.REFINEMENT.KEYBOARD,
          icon: 'keyboard',
        },
      ]
    : []),
  { index: 8, label: T.PS.REFINEMENT.SOUND, icon: 'volume_up' },
  { index: 5, label: T.PS.REFINEMENT.DATA, icon: 'import_export' },
  ...(isDrillDown
    ? [{ index: ABOUT_CATEGORY_INDEX, label: T.PS.REFINEMENT.ABOUT, icon: 'info' }]
    : []),
];
