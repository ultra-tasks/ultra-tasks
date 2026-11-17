import { T } from '../../t.const';
import {
  ABOUT_CATEGORY_INDEX,
  getSettingsCategories,
  KEYBOARD_CATEGORY_INDEX,
  SettingsCategoryContext,
} from './settings-categories.util';

describe('getSettingsCategories', () => {
  const ctx = (over: Partial<SettingsCategoryContext> = {}): SettingsCategoryContext => ({
    hasKeyboardSections: true,
    isDrillDown: false,
    isTouchPrimary: false,
    ...over,
  });
  const indices = (over: Partial<SettingsCategoryContext> = {}): number[] =>
    getSettingsCategories(ctx(over)).map((c) => c.index);

  it('lists the seven categories of the two-pane window on desktop', () => {
    expect(getSettingsCategories(ctx()).map((c) => c.label)).toEqual([
      T.PS.TABS.GENERAL,
      T.PS.REFINEMENT.APPEARANCE,
      T.PS.REDESIGN.TASKS,
      T.PS.REDESIGN.TIME,
      T.PS.REFINEMENT.KEYBOARD,
      T.PS.REFINEMENT.SOUND,
      T.PS.REFINEMENT.DATA,
    ]);
  });

  describe('Keyboard shortcuts', () => {
    it('is hidden when the form has no keyboard section (the Android app)', () => {
      expect(indices({ hasKeyboardSections: false })).not.toContain(
        KEYBOARD_CATEGORY_INDEX,
      );
      expect(indices({ hasKeyboardSections: false, isDrillDown: true })).not.toContain(
        KEYBOARD_CATEGORY_INDEX,
      );
    });

    it('is hidden on a touch-only phone', () => {
      expect(indices({ isDrillDown: true, isTouchPrimary: true })).not.toContain(
        KEYBOARD_CATEGORY_INDEX,
      );
    });

    it('stays on a narrow desktop window, where a keyboard is the input', () => {
      expect(indices({ isDrillDown: true, isTouchPrimary: false })).toContain(
        KEYBOARD_CATEGORY_INDEX,
      );
    });

    it('stays on a tablet, which may have a hardware keyboard', () => {
      expect(indices({ isDrillDown: false, isTouchPrimary: true })).toContain(
        KEYBOARD_CATEGORY_INDEX,
      );
    });
  });

  describe('About', () => {
    it('is the last category of the drill-down, where the footer is gone', () => {
      const list = indices({ isDrillDown: true });
      expect(list[list.length - 1]).toBe(ABOUT_CATEGORY_INDEX);
    });

    it('is not offered next to the window footer', () => {
      expect(indices({ isDrillDown: false })).not.toContain(ABOUT_CATEGORY_INDEX);
      expect(indices({ isDrillDown: false, isTouchPrimary: true })).not.toContain(
        ABOUT_CATEGORY_INDEX,
      );
    });
  });

  it('gives every category its own index', () => {
    const list = indices({ isDrillDown: true });
    expect(new Set(list).size).toBe(list.length);
  });

  it('lists the phone of the Android app without an empty page', () => {
    const labels = getSettingsCategories(
      ctx({ hasKeyboardSections: false, isDrillDown: true, isTouchPrimary: true }),
    ).map((c) => c.label);
    expect(labels).not.toContain(T.PS.REFINEMENT.KEYBOARD);
    expect(labels).toEqual([
      T.PS.TABS.GENERAL,
      T.PS.REFINEMENT.APPEARANCE,
      T.PS.REDESIGN.TASKS,
      T.PS.REDESIGN.TIME,
      T.PS.REFINEMENT.SOUND,
      T.PS.REFINEMENT.DATA,
      T.PS.REFINEMENT.ABOUT,
    ]);
  });
});
