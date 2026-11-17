import {
  ConfigSectionPlatform,
  GLOBAL_TIME_TRACKING_FORM_CONFIG,
  isConfigSectionAvailable,
} from './global-config-form-config.const';
import { IDLE_FORM_CFG } from './form-cfgs/idle-form.const';
import { KEYBOARD_SETTINGS_FORM_CFG } from './form-cfgs/keyboard-form.const';

describe('isConfigSectionAvailable', () => {
  const DESKTOP: ConfigSectionPlatform = {
    isElectron: false,
    isAndroidApp: false,
    isMobile: false,
  };

  it('shows an unrestricted section everywhere', () => {
    for (const platform of [
      DESKTOP,
      { ...DESKTOP, isElectron: true },
      { ...DESKTOP, isAndroidApp: true, isMobile: true },
      { ...DESKTOP, isMobile: true },
    ]) {
      expect(isConfigSectionAvailable({}, platform)).toBeTrue();
    }
  });

  it('keeps an Electron-only section out of the browser and the apps', () => {
    const section = { isElectronOnly: true };
    expect(isConfigSectionAvailable(section, DESKTOP)).toBeFalse();
    expect(
      isConfigSectionAvailable(section, { ...DESKTOP, isElectron: true }),
    ).toBeTrue();
  });

  it('keeps a section the Android app hides out of the Android app only', () => {
    const section = { isHideForAndroidApp: true };
    expect(
      isConfigSectionAvailable(section, {
        ...DESKTOP,
        isAndroidApp: true,
        isMobile: true,
      }),
    ).toBeFalse();
    expect(isConfigSectionAvailable(section, { ...DESKTOP, isMobile: true })).toBeTrue();
  });

  it('hides a desktop-only section on a phone or tablet, in the browser or the app', () => {
    const section = { isHideForMobile: true };
    expect(isConfigSectionAvailable(section, { ...DESKTOP, isMobile: true })).toBeFalse();
    expect(isConfigSectionAvailable(section, DESKTOP)).toBeTrue();
    expect(
      isConfigSectionAvailable(section, { ...DESKTOP, isElectron: true }),
    ).toBeTrue();
  });

  describe('Idle handling', () => {
    // Its only content on the web is a paragraph about a Chrome extension, which does
    // not exist on a phone: the section would be a heading and that paragraph.
    it('is hidden on mobile web and iOS, and in the Android app', () => {
      expect(
        isConfigSectionAvailable(IDLE_FORM_CFG, { ...DESKTOP, isMobile: true }),
      ).toBeFalse();
      expect(
        isConfigSectionAvailable(IDLE_FORM_CFG, {
          ...DESKTOP,
          isAndroidApp: true,
          isMobile: true,
        }),
      ).toBeFalse();
    });

    it('stays on desktop', () => {
      expect(isConfigSectionAvailable(IDLE_FORM_CFG, DESKTOP)).toBeTrue();
      expect(
        isConfigSectionAvailable(IDLE_FORM_CFG, { ...DESKTOP, isElectron: true }),
      ).toBeTrue();
    });

    it('is listed on the desktop test browser', () => {
      expect(GLOBAL_TIME_TRACKING_FORM_CONFIG.map((s) => s.key)).toContain('idle');
    });
  });

  it('keeps the keyboard shortcuts section off the Android app, where it would be an empty page', () => {
    expect(
      isConfigSectionAvailable(KEYBOARD_SETTINGS_FORM_CFG, {
        ...DESKTOP,
        isAndroidApp: true,
        isMobile: true,
      }),
    ).toBeFalse();
  });
});
