import { T } from '../../t.const';
import { IS_MAC } from '../../util/is-mac';

/**
 * Defaults that also accept the Command key on macOS. The shortcut guide and the
 * suggested actions show both forms.
 */
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

/** How a configured shortcut is shown, including the platform alternatives. */
export const displayShortcut = (
  key: string,
  combo: string | null | undefined,
): string | undefined => {
  if (!combo) return undefined;
  if (key === 'redo' && combo === 'Ctrl+Y') {
    return IS_MAC ? '⌘Shift+Z / ⌘Y / Ctrl+Y' : 'Ctrl+Y / Ctrl+Shift+Z';
  }
  return IS_MAC && combo === MAC_DEFAULTS[key]
    ? `${combo.replace('Ctrl+', '⌘')} / ${combo}`
    : combo;
};

/** The translation key naming what an undo or redo would change. */
export const taskHistoryLabel = (field: string | null, isRedo: boolean): string => {
  if (!field) return isRedo ? T.GCF.KEYBOARD.REDO : T.GCF.KEYBOARD.UNDO;
  if (field === 'isDone')
    return isRedo ? T.GCF.KEYBOARD.REDO_DONE : T.GCF.KEYBOARD.UNDO_DONE;
  if (field === 'doneOrder')
    return isRedo ? T.GCF.KEYBOARD.REDO_DONE_ORDER : T.GCF.KEYBOARD.UNDO_DONE_ORDER;
  if (field === 'title')
    return isRedo ? T.GCF.KEYBOARD.REDO_TITLE : T.GCF.KEYBOARD.UNDO_TITLE;
  if (field === 'notes')
    return isRedo ? T.GCF.KEYBOARD.REDO_NOTES : T.GCF.KEYBOARD.UNDO_NOTES;
  if (field === 'priority')
    return isRedo ? T.GCF.KEYBOARD.REDO_PRIORITY : T.GCF.KEYBOARD.UNDO_PRIORITY;
  return isRedo ? T.GCF.KEYBOARD.REDO_ESTIMATE : T.GCF.KEYBOARD.UNDO_ESTIMATE;
};
