import { MISC_SETTINGS_FORM_CFG } from './form-cfgs/misc-settings-form.const';
import { APP_FEATURES_FORM_CFG } from './form-cfgs/app-features-form.const';
import { KEYBOARD_SETTINGS_FORM_CFG } from './form-cfgs/keyboard-form.const';
import { ConfigFormConfig, ConfigFormSection } from './global-config.model';
import { IDLE_FORM_CFG } from './form-cfgs/idle-form.const';
import { TAKE_A_BREAK_FORM_CFG } from './form-cfgs/take-a-break-form.const';
import { IMEX_FORM } from './form-cfgs/imex-form.const';
import { LANGUAGE_SELECTION_FORM_FORM } from './form-cfgs/language-selection-form.const';
import { EVALUATION_SETTINGS_FORM_CFG } from './form-cfgs/evaluation-settings-form.const';
import { TIME_TRACKING_FORM_CFG } from './form-cfgs/time-tracking-form.const';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { SCHEDULE_FORM_CFG } from './form-cfgs/schedule-form.const';
import { FOCUS_MODE_FORM_CFG } from './form-cfgs/focus-mode-form.const';
import { FOCUS_MODE_LOCAL_FORM_CFG } from './form-cfgs/focus-mode-local-form.const';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { IS_MOBILE } from '../../util/is-mobile';
import { IS_IOS } from '../../util/is-ios';
import { REMINDER_FORM_CFG } from './form-cfgs/reminder-form.const';
import { SHORT_SYNTAX_FORM_CFG } from './form-cfgs/short-syntax-form.const';
import { CLIPBOARD_IMAGES_FORM } from './form-cfgs/clipboard-images-form.const';
import { TASKS_SETTINGS_FORM_CFG } from './form-cfgs/tasks-settings-form.const';
import { TASK_WIDGET_FORM_CFG } from './form-cfgs/task-widget-form.const';

/** What decides whether a settings section exists on this device. */
export interface ConfigSectionPlatform {
  isElectron: boolean;
  isAndroidApp: boolean;
  /** A phone or tablet: the browser on it, or the iOS or Android app. */
  isMobile: boolean;
}

export const isConfigSectionAvailable = (
  cfg: Pick<
    ConfigFormSection<unknown>,
    'isElectronOnly' | 'isHideForAndroidApp' | 'isHideForMobile'
  >,
  platform: ConfigSectionPlatform,
): boolean =>
  (platform.isElectron || !cfg.isElectronOnly) &&
  !(platform.isAndroidApp && cfg.isHideForAndroidApp) &&
  !(platform.isMobile && cfg.isHideForMobile);

const filterGlobalConfigForm = (cfg: ConfigFormSection<any>): boolean =>
  isConfigSectionAvailable(cfg, {
    isElectron: IS_ELECTRON,
    isAndroidApp: IS_ANDROID_WEB_VIEW,
    // Never the desktop app: a Mac reports touch events and would pass as an iPad.
    isMobile: !IS_ELECTRON && (IS_MOBILE || IS_IOS || IS_NATIVE_PLATFORM),
  });

// Presentation grouping preserves the stored section keys and platform availability.
export const GLOBAL_GENERAL_FORM_CONFIG: ConfigFormConfig = [
  LANGUAGE_SELECTION_FORM_FORM,
  MISC_SETTINGS_FORM_CFG,
  APP_FEATURES_FORM_CFG,
  TASK_WIDGET_FORM_CFG,
  KEYBOARD_SETTINGS_FORM_CFG,
  CLIPBOARD_IMAGES_FORM,
].filter(filterGlobalConfigForm);

// Focus and break sections are appended by the settings page.
export const GLOBAL_TIME_TRACKING_FORM_CONFIG: ConfigFormConfig = [
  TIME_TRACKING_FORM_CFG,
  IDLE_FORM_CFG,
].filter(filterGlobalConfigForm);

// Tab: Plugins
export const GLOBAL_PLUGINS_FORM_CONFIG: ConfigFormConfig = [].filter(
  filterGlobalConfigForm,
);

export const GLOBAL_IMEX_FORM_CONFIG: ConfigFormConfig = [
  // NOTE: the backup form is added dynamically due to async prop required
  IMEX_FORM,
].filter(filterGlobalConfigForm);

export const GLOBAL_PRODUCTIVITY_FORM_CONFIG: ConfigFormConfig = [
  FOCUS_MODE_FORM_CFG,
  ...(IS_NATIVE_PLATFORM ? [] : [FOCUS_MODE_LOCAL_FORM_CFG]),
  TAKE_A_BREAK_FORM_CFG,
  EVALUATION_SETTINGS_FORM_CFG,
].filter(filterGlobalConfigForm);

export const GLOBAL_TASKS_FORM_CONFIG: ConfigFormConfig = [
  TASKS_SETTINGS_FORM_CFG,
  REMINDER_FORM_CFG,
  SCHEDULE_FORM_CFG,
  SHORT_SYNTAX_FORM_CFG,
].filter(filterGlobalConfigForm);
