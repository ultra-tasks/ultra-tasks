import {
  registerPlugin,
  SystemBars,
  SystemBarsStyle,
  SystemBarType,
} from '@capacitor/core';
import { fromEvent, merge, Observable } from 'rxjs';
import { debounceTime, scan } from 'rxjs/operators';
import { Log } from '../log';

/** The app's own plugin (`NavigationBarPlugin.kt`). */
interface NavigationBarPlugin {
  setColor(options: { color: string; style: 'LIGHT' | 'DARK' }): Promise<void>;
  setWebViewBackgroundColor(options: { color: string }): Promise<void>;
}

const NavigationBar = registerPlugin<NavigationBarPlugin>('NavigationBar');

/**
 * The native calls the Android bars need, behind plain functions so a spec can
 * replace them (Capacitor plugin objects are proxies a spy cannot intercept).
 */
export interface AndroidBarPlugins {
  setSystemBarStyle(options: {
    style: SystemBarsStyle;
    bar: SystemBarType;
  }): Promise<void>;
  setNavigationBarColor(options: {
    color: string;
    style: 'LIGHT' | 'DARK';
  }): Promise<void>;
  setWebViewBackgroundColor(options: { color: string }): Promise<void>;
}

export const ANDROID_BAR_PLUGINS: AndroidBarPlugins = {
  setSystemBarStyle: (options) => SystemBars.setStyle(options),
  setNavigationBarColor: (options) => NavigationBar.setColor(options),
  setWebViewBackgroundColor: (options) =>
    NavigationBar.setWebViewBackgroundColor(options),
};

export interface AndroidBarAppearance {
  /** Light (white) icons, for a dark bar background. */
  lightIcons: boolean;
  /** Opaque `#rrggbb` theme surface painted behind the transparent bars. */
  surfaceColor: string;
}

/**
 * Paint the Android status and navigation bars for the current app theme.
 *
 * Capacitor's core `SystemBars` plugin keeps its own copy of the icon style
 * (seeded from `capacitor.config.ts`, 'DARK') and, on every configuration
 * change (rotation, system dark-mode flip, hardware keyboard, display size,
 * fold), re-applies that copy to both bars and resets the window background to
 * the system-theme colour. Setting the style only through `StatusBar` and the
 * app's `NavigationBar` plugin leaves that copy stale, so after such a change
 * the icons turn white on a light header (and the other way round), whichever
 * plugin the framework visits last. Storing the style in `SystemBars` makes the
 * re-applied copy the right one.
 *
 * Order matters: `SystemBars.setStyle` also resets the window background, so
 * the `NavigationBar` calls that paint the app theme go after it. Plugin calls
 * reach the main thread in call order.
 */
export const applyAndroidBarAppearance = (
  { lightIcons, surfaceColor }: AndroidBarAppearance,
  plugins: AndroidBarPlugins = ANDROID_BAR_PLUGINS,
): void => {
  const style = lightIcons ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
  const warn =
    (what: string) =>
    (err: unknown): void =>
      Log.warn(`Failed to set ${what}`, err);

  plugins
    .setSystemBarStyle({ style, bar: SystemBarType.StatusBar })
    .catch(warn('status bar style'));
  plugins
    .setSystemBarStyle({ style, bar: SystemBarType.NavigationBar })
    .catch(warn('navigation bar style'));
  plugins
    .setNavigationBarColor({
      color: surfaceColor,
      style: lightIcons ? 'DARK' : 'LIGHT',
    })
    .catch(warn('navigation bar appearance'));
  // Paints the WebView surface and window decor, which show through the
  // transparent bars and behind the keyboard animation.
  plugins
    .setWebViewBackgroundColor({ color: surfaceColor })
    .catch(warn('web view background color'));
};

/**
 * Lets the settled window be told apart from the burst of events a native
 * configuration change (or the keyboard sliding in) causes.
 */
export const ANDROID_BAR_REAPPLY_DEBOUNCE_MS = 250;

type ConfigChangeSource = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'matchMedia'
>;

/**
 * Counts the native configuration changes that can reset the bars: rotation and
 * size changes (`orientationchange`, `resize`: the latter also fires for the
 * keyboard) and a system dark-mode flip (which fires neither, only the
 * `prefers-color-scheme` change). Emits once the burst has settled, so it
 * always lands after the native plugins have re-applied their own state.
 */
export const androidBarReapply$ = (
  source: ConfigChangeSource = window,
  debounceMs: number = ANDROID_BAR_REAPPLY_DEBOUNCE_MS,
): Observable<number> =>
  merge(
    fromEvent(source, 'orientationchange'),
    fromEvent(source, 'resize'),
    fromEvent(source.matchMedia('(prefers-color-scheme: dark)'), 'change'),
  ).pipe(
    debounceTime(debounceMs),
    scan((count) => count + 1, 0),
  );
