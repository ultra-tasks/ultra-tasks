import { globalShortcut, ipcMain } from 'electron';
import { error, info } from 'electron-log/main';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { KeyboardConfig } from '../shared-with-frontend/keyboard-config.model';
import { getIsAppReady, getWin } from '../main-window';
import { toggleTaskWidgetVisibility } from '../task-widget/task-widget';
import { showOrFocus, toggleWindowVisibility } from '../various-shared';
import {
  createGlobalShortcutRegistry,
  GlobalShortcutConflict,
} from '../global-shortcuts-registry';

// The window is looked up when a shortcut is pressed: registrations are kept across
// config re-applies, and the window can be re-created in between (macOS).
const GLOBAL_SHORTCUT_ACTIONS: Record<string, () => void> = {
  globalShowHide: () => {
    toggleWindowVisibility(getWin());
  },

  globalToggleTaskStart: () => {
    getWin().webContents.send(IPC.TASK_TOGGLE_START);
  },

  globalAddNote: () => {
    const mainWin = getWin();
    showOrFocus(mainWin);
    mainWin.webContents.send(IPC.ADD_NOTE);
  },

  globalAddTask: () => {
    const mainWin = getWin();
    showOrFocus(mainWin);
    mainWin.webContents.send(IPC.SHOW_ADD_TASK_BAR);
  },

  globalToggleTaskWidget: () => {
    toggleTaskWidgetVisibility();
  },
};

// Same grace period errorHandlerWithFrontendInform gives a renderer that is still booting.
const WAIT_FOR_RENDERER_DURATION = 4000;
// A slow start (a large profile, a first run after an update) can take longer than one wait. The
// conflict keeps waiting for the renderer for about a minute, then is given up quietly: it is
// still in the log, and the settings page shows it the next time the shortcut is applied.
const MAX_RENDERER_WAITS = 15;

// A conflict is a settings problem, not an app error: it goes out on its own channel and
// is never handed to errorHandlerWithFrontendInform. The registry reports a conflict once;
// this only makes sure that one report arrives.
const sendConflictToRenderer = (conflict: GlobalShortcutConflict, waits = 0): void => {
  try {
    if (getIsAppReady()) {
      getWin().webContents.send(IPC.GLOBAL_SHORTCUT_CONFLICT, conflict);
      return;
    }
  } catch {
    // window already gone
  }
  if (waits < MAX_RENDERER_WAITS) {
    setTimeout(
      () => sendConflictToRenderer(conflict, waits + 1),
      WAIT_FOR_RENDERER_DURATION,
    );
  }
};

export const initGlobalShortcutsIpc = (): void => {
  const registry = createGlobalShortcutRegistry({
    backend: globalShortcut,
    getAction: (action) => GLOBAL_SHORTCUT_ACTIONS[action] ?? ((): void => undefined),
    onConflict: sendConflictToRenderer,
    logger: { error, info },
  });

  ipcMain.on(IPC.REGISTER_GLOBAL_SHORTCUTS_EVENT, (_ev, cfg: KeyboardConfig) => {
    registry.apply(cfg);
  });
};
