import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  findKeyboardShortcutConflicts,
  keyboardShortcutBindings,
} from './keyboard-shortcut-conflicts';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { initialGlobalConfigState } from './store/global-config.reducer';

const field = (key: string): FormlyFieldConfig => ({
  key,
  templateOptions: { label: key },
});

describe('findKeyboardShortcutConflicts', () => {
  for (const isMac of [false, true]) {
    it(`ships without conflicting default shortcuts on ${isMac ? 'macOS' : 'Windows/Linux'}`, () => {
      const keyboard = DEFAULT_GLOBAL_CONFIG.keyboard;
      const fields = Object.keys(keyboard).map(field);
      expect(initialGlobalConfigState.keyboard).toEqual(keyboard);
      expect(findKeyboardShortcutConflicts(keyboard, fields, isMac)).toEqual([]);

      // Also cover desktop system-wide defaults, which the user-facing review
      // deliberately treats as a separate context.
      const owners = new Map<string, string>();
      const collisions: string[] = [];
      for (const [key, combo] of Object.entries(keyboard)) {
        if (typeof combo !== 'string' || !combo) continue;
        for (const binding of keyboardShortcutBindings(key, combo, isMac)) {
          const previous = owners.get(binding);
          if (previous && previous !== key) collisions.push(`${previous} / ${key}`);
          owners.set(binding, key);
        }
      }
      expect(collisions).toEqual([]);
    });
  }

  it('suggests the new defaults for the two inherited conflicts without changing the config', () => {
    const keyboard = {
      taskScheduleDeadline: 'Shift+S',
      goToScheduledView: 'Shift+S',
      taskScheduleToday: 'Shift+T',
      goToTimeline: 'Shift+T',
    };
    const result = findKeyboardShortcutConflicts(
      keyboard,
      Object.keys(keyboard).map(field),
      false,
    );
    expect(result).toContain({
      key: 'goToScheduledView',
      label: 'goToScheduledView',
      current: 'Shift+S',
      suggested: 'Shift+C',
    });
    expect(result).toContain({
      key: 'taskScheduleToday',
      label: 'taskScheduleToday',
      current: 'Shift+T',
      suggested: 'Alt+T',
    });
    expect(keyboard.goToScheduledView).toBe('Shift+S');
  });

  it('does not suggest a default already used by another action', () => {
    const keyboard = {
      goToScheduledView: 'Shift+S',
      taskScheduleDeadline: 'Shift+S',
      addNewTask: 'Shift+C',
    };
    const result = findKeyboardShortcutConflicts(
      keyboard,
      Object.keys(keyboard).map(field),
      false,
    );
    expect(
      result.find((entry) => entry.key === 'goToScheduledView')?.suggested,
    ).toBeUndefined();
  });

  it('detects modifier reordering and the default redo alternative', () => {
    const keyboard = { redo: 'Ctrl+Y', taskDelete: 'Shift+Ctrl+Z' };
    const result = findKeyboardShortcutConflicts(
      keyboard,
      Object.keys(keyboard).map(field),
      false,
    );
    expect(result.map((entry) => entry.key)).toEqual(['redo', 'taskDelete']);
  });

  it('recognizes macOS equivalents and leaves system-wide bindings separate', () => {
    const keyboard = {
      showSearchBar: 'Ctrl+F',
      taskDelete: 'Meta+F',
      globalShowHide: 'Ctrl+F',
    };
    const result = findKeyboardShortcutConflicts(
      keyboard,
      Object.keys(keyboard).map(field),
      true,
    );
    expect(result.map((entry) => entry.key)).toEqual(['showSearchBar', 'taskDelete']);
  });

  it('reports bindings that shadow fixed selection and subtask controls', () => {
    const keyboard = {
      moveTaskUp: 'Shift+ArrowUp',
      taskDelete: 'Ctrl+A',
      taskDuplicate: 'Meta+Enter',
      taskAddSubTask: 'Ctrl+Enter',
    };
    const result = findKeyboardShortcutConflicts(
      keyboard,
      Object.keys(keyboard).map(field),
      false,
    );
    expect(result.find((entry) => entry.key === 'moveTaskUp')?.suggested).toBe(
      'Ctrl+Shift+ArrowUp',
    );
    expect(result.map((entry) => entry.key)).toEqual([
      'moveTaskUp',
      'taskDelete',
      'taskDuplicate',
    ]);
  });
});
