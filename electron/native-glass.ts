import type { BrowserWindowConstructorOptions, IpcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  isNativeGlassState,
  NativeGlassMaterial,
  NativeGlassState,
  NativeGlassThemeSource,
} from './shared-with-frontend/native-glass.model';

// Windows 11 22H2: the first build whose DWM system backdrop Electron uses.
const MIN_WINDOWS_BUILD_FOR_MATERIAL = 22621;

/** What main keeps between launches (SimpleStoreKey.NATIVE_GLASS). */
export interface PersistedNativeGlass {
  isEnabled: boolean;
  themeSource: NativeGlassThemeSource;
}

/** `process.getSystemVersion()` on Windows reads like `10.0.22631`. */
export const getWindowsBuild = (systemVersion: string): number =>
  Number(systemVersion.split('.')[2]) || 0;

/**
 * The OS material this window can show behind the app, or null where the
 * renderer draws its own backdrop instead (Linux, Windows 10, older Windows 11).
 * On Windows the material only reaches the client area of a window without a
 * native frame (`titleBarStyle: 'hidden'`, i.e. the custom title bar); with a
 * native frame it would only fill the caption.
 */
export const resolveNativeGlassMaterial = ({
  platform,
  systemVersion,
  isCustomTitleBar,
}: {
  platform: NodeJS.Platform;
  systemVersion: string;
  isCustomTitleBar: boolean;
}): NativeGlassMaterial | null => {
  if (platform === 'darwin') {
    return 'vibrancy';
  }
  if (
    platform === 'win32' &&
    isCustomTitleBar &&
    getWindowsBuild(systemVersion) >= MIN_WINDOWS_BUILD_FOR_MATERIAL
  ) {
    return 'acrylic';
  }
  return null;
};

export const parsePersistedNativeGlass = (raw: unknown): PersistedNativeGlass | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  // Reuse the IPC validator; the stored value has no solid color.
  return isNativeGlassState({ ...value, solidColor: '#000000' })
    ? {
        isEnabled: value.isEnabled as boolean,
        themeSource: value.themeSource as NativeGlassThemeSource,
      }
    : null;
};

/**
 * Constructor options for the window's OS material. Setting either option makes
 * Electron create the web contents transparent.
 *
 * macOS always gets vibrancy, whatever was saved: the view lives as long as the
 * window and the renderer decides whether it shows (transparent canvas) or is
 * covered (opaque surfaces). Nothing switches vibrancy on once the window
 * exists, which is unreliable on recent macOS: a fresh install (nothing saved
 * yet, Glass defaults to on) would open opaque and stay that way, and so would
 * turning Glass back on in Settings after it started off.
 *
 * Windows starts with acrylic only when it was on last time; the DWM backdrop
 * can be switched on afterwards.
 */
export const getNativeGlassWindowOptions = (
  material: NativeGlassMaterial | null,
  persisted: PersistedNativeGlass | null,
): Pick<
  BrowserWindowConstructorOptions,
  'vibrancy' | 'visualEffectState' | 'backgroundMaterial'
> => {
  if (material === 'vibrancy') {
    return { vibrancy: 'under-window', visualEffectState: 'followWindow' };
  }
  if (material === 'acrylic' && persisted?.isEnabled) {
    return { backgroundMaterial: 'acrylic' };
  }
  return {};
};

export interface NativeGlassWindow {
  isDestroyed(): boolean;
  setBackgroundMaterial(material: 'acrylic' | 'none'): void;
  setBackgroundColor(color: string): void;
}

export interface NativeGlassThemeHost {
  themeSource: NativeGlassThemeSource;
}

/**
 * Switch the window between the OS material and an opaque background. The
 * material's light/dark variant follows `nativeTheme.themeSource`, so it
 * mirrors the app's mode while the material is on and goes back to the
 * system's otherwise (the behaviour without glass).
 *
 * On macOS that is all there is to do: the vibrancy view stays attached (see
 * `getNativeGlassWindowOptions`) and the renderer's surfaces cover it when Glass
 * is off. Windows swaps the DWM backdrop.
 */
export const applyNativeGlass = (
  win: NativeGlassWindow,
  material: NativeGlassMaterial,
  state: NativeGlassState,
  theme: NativeGlassThemeHost,
): void => {
  theme.themeSource = state.isEnabled ? state.themeSource : 'system';
  if (material === 'vibrancy') {
    return;
  }
  win.setBackgroundMaterial(state.isEnabled ? 'acrylic' : 'none');
  if (!state.isEnabled) {
    // 'none' repaints the window white; replace that with the app's color.
    win.setBackgroundColor(state.solidColor);
  }
};

/** Listens for the renderer's Glass state and keeps window and store in step. */
export const initNativeGlassIpc = ({
  ipcMain,
  win,
  material,
  persisted,
  theme,
  save,
}: {
  ipcMain: Pick<IpcMain, 'on'>;
  win: NativeGlassWindow;
  material: NativeGlassMaterial | null;
  persisted: PersistedNativeGlass | null;
  theme: NativeGlassThemeHost;
  save: (value: PersistedNativeGlass) => void;
}): void => {
  let last: NativeGlassState | null = null;
  let stored = persisted;
  ipcMain.on(IPC.SET_NATIVE_GLASS, (_ev, payload: unknown) => {
    if (!material || !isNativeGlassState(payload) || win.isDestroyed()) {
      return;
    }
    const isSameMode =
      last?.isEnabled === payload.isEnabled && last.themeSource === payload.themeSource;
    if (!isSameMode) {
      applyNativeGlass(win, material, payload, theme);
    } else if (
      material === 'acrylic' &&
      !payload.isEnabled &&
      last?.solidColor !== payload.solidColor
    ) {
      // Palette edits while glass is off only repaint the opaque window.
      win.setBackgroundColor(payload.solidColor);
    }
    last = payload;
    if (
      stored?.isEnabled !== payload.isEnabled ||
      stored.themeSource !== payload.themeSource
    ) {
      stored = { isEnabled: payload.isEnabled, themeSource: payload.themeSource };
      save(stored);
    }
  });
};
