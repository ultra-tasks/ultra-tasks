import type { BrowserWindow } from 'electron';

export const WINDOWS_DESKTOP_APP_ID = 'app.ultratasks';

export const configureWindowsTaskbar = (
  win: Pick<BrowserWindow, 'setAppDetails'>,
  isPackaged: boolean,
  runtime: Pick<
    NodeJS.Process,
    'platform' | 'windowsStore' | 'execPath' | 'env'
  > = process,
): void => {
  if (runtime.platform !== 'win32' || !isPackaged || runtime.windowsStore) return;

  // The taskbar group has its own icon. The portable app runs from a temporary
  // directory, so give the shell the launcher that will still exist after exit.
  const launcher = runtime.env.PORTABLE_EXECUTABLE_FILE || runtime.execPath;
  win.setAppDetails({
    appId: WINDOWS_DESKTOP_APP_ID,
    appIconPath: launcher,
    relaunchCommand: `"${launcher}"`,
    relaunchDisplayName: 'Ultra Tasks',
  });
};
