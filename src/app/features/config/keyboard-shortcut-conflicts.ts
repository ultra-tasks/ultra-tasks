import { FormlyFieldConfig } from '@ngx-formly/core';
import { KeyboardConfig } from '@sp/keyboard-config';
import { IS_MAC } from '../../util/is-mac';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';

export interface KeyboardShortcutConflict {
  key: string;
  label: string;
  current: string;
  suggested?: string;
}

const MAC_DEFAULTS: Record<string, string> = {
  showSearchBar: 'Ctrl+F',
  goToSettings: 'Ctrl+,',
  toggleSideNavMode: 'Ctrl+B',
  taskDuplicate: 'Ctrl+D',
  taskCopy: 'Ctrl+C',
  taskCut: 'Ctrl+X',
  taskPaste: 'Ctrl+V',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
};

// These controls run on task rows without a configurable field of their own.
// Flag an assignment that would take precedence over them (or be intercepted
// by them), but do not report a duplicate binding for the very same action.
const FIXED_TASK_BINDINGS: { combos: string[]; sameAction?: string }[] = [
  { combos: ['Ctrl+A', 'Meta+A'] },
  { combos: ['Ctrl+Enter', 'Meta+Enter'], sameAction: 'taskAddSubTask' },
  { combos: ['Shift+ArrowUp', 'Shift+ArrowDown'] },
];

// checkKeyCombo treats modifier order as immaterial. Use the same meaning here
// so, for example, Ctrl+Shift+Z and Shift+Ctrl+Z cannot evade conflict checks.
const canonical = (combo: string): string => {
  const lower = combo.toLowerCase();
  const plusKey = lower === '+' || lower.endsWith('++');
  const parts = lower.split('+').filter(Boolean);
  const key = plusKey ? '+' : (parts.pop() ?? '');
  return `${parts.sort().join('+')}|${key}`;
};

export const keyboardShortcutBindings = (
  key: string,
  combo: string,
  isMac = IS_MAC,
): string[] => {
  const values = [combo];
  if (isMac && combo === MAC_DEFAULTS[key]) {
    values.push(combo.replace('Ctrl+', 'Meta+'));
  }
  if (key === 'redo' && combo === 'Ctrl+Y') {
    values.push(isMac ? 'Meta+Shift+Z' : 'Ctrl+Shift+Z');
  }
  return values.map(canonical);
};

/** Reports in-app collisions and safe, explicitly opt-in default replacements. */
export const findKeyboardShortcutConflicts = (
  keyboard: Record<string, unknown> | undefined,
  fields: readonly FormlyFieldConfig[] | undefined,
  isMac = IS_MAC,
): KeyboardShortcutConflict[] => {
  if (!keyboard || !fields) return [];
  const entries = fields.flatMap((field) => {
    const key = typeof field.key === 'string' ? field.key : undefined;
    const combo = key ? keyboard[key] : undefined;
    const label = field.templateOptions?.label;
    // System-wide bindings live in a separate context and are registered by
    // the operating system; don't call them in-app duplicates.
    return key &&
      !key.startsWith('global') &&
      typeof combo === 'string' &&
      combo &&
      typeof label === 'string'
      ? [{ key, label, combo, bindings: keyboardShortcutBindings(key, combo, isMac) }]
      : [];
  });
  const defaults = DEFAULT_GLOBAL_CONFIG.keyboard as KeyboardConfig;
  const conflictsWithFixed = (key: string, bindings: string[]): boolean =>
    FIXED_TASK_BINDINGS.some(
      (fixed) =>
        fixed.sameAction !== key &&
        fixed.combos.some((combo) => bindings.includes(canonical(combo))),
    );
  return entries.flatMap((entry) => {
    const others = entries.filter((other) => other.key !== entry.key);
    if (
      !conflictsWithFixed(entry.key, entry.bindings) &&
      !others.some((other) =>
        entry.bindings.some((binding) => other.bindings.includes(binding)),
      )
    )
      return [];
    const candidate = defaults[entry.key as keyof KeyboardConfig];
    const suggested =
      typeof candidate === 'string' &&
      candidate !== entry.combo &&
      !conflictsWithFixed(
        entry.key,
        keyboardShortcutBindings(entry.key, candidate, isMac),
      ) &&
      !others.some((other) =>
        keyboardShortcutBindings(entry.key, candidate, isMac).some((binding) =>
          other.bindings.includes(binding),
        ),
      )
        ? candidate
        : undefined;
    return [
      {
        key: entry.key,
        label: entry.label,
        current: entry.combo,
        ...(suggested ? { suggested } : {}),
      },
    ];
  });
};
