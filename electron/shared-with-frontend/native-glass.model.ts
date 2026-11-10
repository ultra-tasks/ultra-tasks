/**
 * Glass appearance on the desktop: the OS blurs whatever is behind the window
 * (macOS vibrancy, Windows 11 acrylic) instead of the app drawing a backdrop.
 *
 * Main decides which material the window supports and passes it to the
 * renderer as a startup argument, so the renderer knows synchronously whether
 * the window can be translucent. The renderer reports the user's effective
 * Glass choice back over IPC; main mirrors it in its own settings file so the
 * next window starts with the right material (macOS always starts with
 * vibrancy, and the renderer's opaque surfaces cover it while Glass is off).
 * Device-local, never synced.
 */
export type NativeGlassMaterial = 'vibrancy' | 'acrylic';

/** The app's Light/Dark/System choice, mirrored to `nativeTheme.themeSource`. */
export type NativeGlassThemeSource = 'system' | 'light' | 'dark';

/** Renderer → main (`IPC.SET_NATIVE_GLASS`). */
export interface NativeGlassState {
  /** Glass on and no reduced-transparency or forced-colors preference. */
  isEnabled: boolean;
  themeSource: NativeGlassThemeSource;
  /** Opaque window color (`#rrggbb`) to paint while the material is off (Windows). */
  solidColor: string;
}

export const NATIVE_GLASS_ARG_PREFIX = '--ut-native-glass=';

const MATERIALS: readonly NativeGlassMaterial[] = ['vibrancy', 'acrylic'];
const THEME_SOURCES: readonly NativeGlassThemeSource[] = ['system', 'light', 'dark'];

export const isNativeGlassMaterial = (value: unknown): value is NativeGlassMaterial =>
  MATERIALS.includes(value as NativeGlassMaterial);

/** Reads the material main passed via `webPreferences.additionalArguments`. */
export const parseNativeGlassMaterialArg = (
  argv: readonly string[] | undefined,
): NativeGlassMaterial | null => {
  const arg = argv?.find((entry) => entry.startsWith(NATIVE_GLASS_ARG_PREFIX));
  const value = arg?.slice(NATIVE_GLASS_ARG_PREFIX.length);
  return isNativeGlassMaterial(value) ? value : null;
};

export const isNativeGlassState = (value: unknown): value is NativeGlassState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.isEnabled === 'boolean' &&
    THEME_SOURCES.includes(state.themeSource as NativeGlassThemeSource) &&
    typeof state.solidColor === 'string' &&
    /^#[\da-f]{6}$/i.test(state.solidColor)
  );
};
