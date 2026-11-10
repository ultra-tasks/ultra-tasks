import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { KEYBOARD_SETTINGS_FORM_CFG } from '../../../features/config/form-cfgs/keyboard-form.const';
import { createPluginShortcutFormItems } from '../../../features/config/form-cfgs/plugin-keyboard-shortcuts';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { useDialogSize } from '../../../ui/dialog-size.util';
import { IS_MAC } from '../../../util/is-mac';
import { TaskUndoService } from '../../../features/tasks/task-undo.service';
import { findKeyboardShortcutConflicts } from '../../../features/config/keyboard-shortcut-conflicts';

interface ShortcutRow {
  heading?: string;
  label?: string;
  combo?: string;
  conflict?: boolean;
  key?: string;
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

@Component({
  selector: 'dialog-keyboard-shortcuts',
  templateUrl: './dialog-keyboard-shortcuts.component.html',
  styleUrls: ['./dialog-keyboard-shortcuts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    TranslatePipe,
  ],
})
export class DialogKeyboardShortcutsComponent {
  private readonly _dialogSize = useDialogSize('l');
  private _configService = inject(GlobalConfigService);
  private _pluginBridgeService = inject(PluginBridgeService);
  readonly taskUndo = inject(TaskUndoService);
  readonly undoLabel = computed(() =>
    this._historyLabel(this.taskUndo.undoField(), false),
  );
  readonly redoLabel = computed(() =>
    this._historyLabel(this.taskUndo.redoField(), true),
  );
  readonly undoKey = computed(() =>
    this._displayShortcut('undo', this._configService.cfg()?.keyboard?.undo),
  );
  readonly redoKey = computed(() =>
    this._displayShortcut('redo', this._configService.cfg()?.keyboard?.redo),
  );

  T: typeof T = T;

  private _historyLabel(field: string | null, isRedo: boolean): string {
    if (!field) return isRedo ? T.GCF.KEYBOARD.REDO : T.GCF.KEYBOARD.UNDO;
    if (field === 'doneOrder')
      return isRedo ? T.GCF.KEYBOARD.REDO_DONE_ORDER : T.GCF.KEYBOARD.UNDO_DONE_ORDER;
    if (field === 'title')
      return isRedo ? T.GCF.KEYBOARD.REDO_TITLE : T.GCF.KEYBOARD.UNDO_TITLE;
    if (field === 'notes')
      return isRedo ? T.GCF.KEYBOARD.REDO_NOTES : T.GCF.KEYBOARD.UNDO_NOTES;
    if (field === 'priority')
      return isRedo ? T.GCF.KEYBOARD.REDO_PRIORITY : T.GCF.KEYBOARD.UNDO_PRIORITY;
    return isRedo ? T.GCF.KEYBOARD.REDO_ESTIMATE : T.GCF.KEYBOARD.UNDO_ESTIMATE;
  }

  private _displayShortcut(
    key: string,
    combo: string | null | undefined,
  ): string | undefined {
    if (!combo) return undefined;
    if (key === 'redo' && combo === 'Ctrl+Y') {
      return IS_MAC ? '⌘Shift+Z / ⌘Y / Ctrl+Y' : 'Ctrl+Y / Ctrl+Shift+Z';
    }
    return IS_MAC && combo === MAC_DEFAULTS[key]
      ? `${combo.replace('Ctrl+', '⌘')} / ${combo}`
      : combo;
  }

  useSuggestion(key: string): void {
    const keyboard = this._configService.cfg()?.keyboard;
    const fields = [
      ...(KEYBOARD_SETTINGS_FORM_CFG.items ?? []),
      ...createPluginShortcutFormItems(this._pluginBridgeService.shortcuts()),
    ];
    const suggestion = findKeyboardShortcutConflicts(keyboard, fields).find(
      (conflict) => conflict.key === key,
    )?.suggested;
    if (suggestion) this._configService.updateSection('keyboard', { [key]: suggestion });
  }

  // Reuses the settings form config as the single source of labels and grouping,
  // so a new shortcut shows up here without touching this component.
  readonly rows = computed<ShortcutRow[]>(() => {
    const keyboard = this._configService.cfg()?.keyboard as
      | Record<string, string | null | undefined>
      | undefined;
    if (!keyboard) {
      return [];
    }

    const items = [
      ...(KEYBOARD_SETTINGS_FORM_CFG.items ?? []),
      // plugin shortcuts only exist on the config page's runtime copy of the form
      ...createPluginShortcutFormItems(this._pluginBridgeService.shortcuts()),
    ];

    const conflicts = new Map(
      findKeyboardShortcutConflicts(keyboard, items).map((conflict) => [
        conflict.key,
        conflict,
      ]),
    );
    const rows: ShortcutRow[] = [];
    for (const item of items) {
      if (item.type === 'tpl') {
        // only headings start a group – the explanatory paragraphs are not shown here
        if (item.templateOptions?.['tag'] === 'h3') {
          rows.push({ heading: item.templateOptions?.['text'] as string | undefined });
        }
      } else if (item.key) {
        const combo = keyboard[item.key as string];
        const conflict = conflicts.get(String(item.key));
        rows.push({
          label: item.templateOptions?.label,
          combo: this._displayShortcut(item.key as string, combo),
          ...(conflict ? { conflict: true } : {}),
          ...(conflict?.suggested
            ? { key: conflict.key, suggested: conflict.suggested }
            : {}),
        });
      }
    }

    rows.push(
      { heading: T.GCF.KEYBOARD.FIXED_SHORTCUTS },
      { label: T.GCF.KEYBOARD.FIXED_TASK_NAVIGATION, combo: '↑ / ↓' },
      { label: T.GCF.KEYBOARD.FIXED_TASK_EXPAND, combo: '← / →' },
      { label: T.GCF.KEYBOARD.FIXED_TASK_SELECT_RANGE, combo: 'Shift+↑ / Shift+↓' },
      {
        label: T.GCF.KEYBOARD.FIXED_TASK_SELECT_ALL,
        combo: IS_MAC ? '⌘A / Ctrl+A' : 'Ctrl+A',
      },
      { label: T.GCF.KEYBOARD.FIXED_TASK_EDIT, combo: 'Enter' },
      {
        label: T.GCF.KEYBOARD.FIXED_TASK_SUBTASK,
        combo: IS_MAC ? '⌘Enter / Ctrl+Enter' : 'Ctrl+Enter',
      },
      { label: T.GCF.KEYBOARD.FIXED_TASK_ESCAPE, combo: 'Escape' },
      { label: T.GCF.KEYBOARD.FIXED_TASK_MENU, combo: 'Menu' },
      { label: T.GCF.KEYBOARD.FIXED_SIDENAV, combo: '↑ / ↓ / Escape' },
      { label: T.GCF.KEYBOARD.FIXED_GROUPS, combo: '← / → / Enter / Space' },
      { label: T.GCF.KEYBOARD.FIXED_ALL_GROUPS, combo: 'Shift+← / Shift+→' },
      { label: T.GCF.KEYBOARD.FIXED_CARD_NAVIGATION, combo: '↑ / ↓ / ← / →' },
      { label: T.GCF.KEYBOARD.FIXED_CARD_MOVE, combo: 'Ctrl+Shift+← / →' },
      ...[
        T.GCF.KEYBOARD.FIXED_ADD_ISSUE,
        T.GCF.KEYBOARD.FIXED_ADD_NOTE,
        T.GCF.KEYBOARD.FIXED_ADD_POSITION,
        T.GCF.KEYBOARD.FIXED_ADD_PROJECT,
        T.GCF.KEYBOARD.FIXED_ADD_SCHEDULE,
        T.GCF.KEYBOARD.FIXED_ADD_TAGS,
        T.GCF.KEYBOARD.FIXED_ADD_ESTIMATE,
        T.GCF.KEYBOARD.FIXED_ADD_REPEAT,
        T.GCF.KEYBOARD.FIXED_ADD_DEADLINE,
      ].map((label, index) => ({ label, combo: `Ctrl+${index + 1}` })),
    );
    return rows;
  });
}
