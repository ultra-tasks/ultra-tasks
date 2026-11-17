import {
  computed,
  DestroyRef,
  effect,
  EnvironmentInjector,
  inject,
  Injectable,
  runInInjectionContext,
  signal,
  Signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BodyClass, IS_ELECTRON, IS_GNOME_WAYLAND } from '../../app.constants';
import { IS_MAC } from '../../util/is-mac';
import { distinctUntilChanged, map, startWith, switchMap, take } from 'rxjs/operators';
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { isAnimationDisabled } from '../../util/prefers-reduced-motion';
import { MaterialCssVarsService } from 'angular-material-css-vars';
import { DOCUMENT } from '@angular/common';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { ChromeExtensionInterfaceService } from '../chrome-extension-interface/chrome-extension-interface.service';

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { GlobalConfigService } from '../../features/config/global-config.service';
import { fromEvent, Observable, of } from 'rxjs';
import { IS_FIREFOX } from '../../util/is-firefox';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import {
  IS_HYBRID_DEVICE,
  IS_MOUSE_PRIMARY,
  IS_TOUCH_PRIMARY,
} from '../../util/is-mouse-primary';
// Injected to ensure constructor runs and registers global pointer event listeners
import { InputIntentService } from '../input-intent/input-intent.service';
import { ipcEnterFullScreen$, ipcLeaveFullScreen$ } from '../ipc-events';

import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { androidInterface } from '../../features/android/android-interface';
import { HttpClient } from '@angular/common/http';
import { CapacitorPlatformService } from '../platform/capacitor-platform.service';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SafeArea } from 'capacitor-plugin-safe-area';
import {
  applyAndroidBarAppearance,
  androidBarReapply$,
} from './android-system-bars.util';
import { patchCdkViewportForSafeArea } from './cdk-safe-area-viewport.util';
import { lockViewportZoom } from './lock-viewport-zoom.util';
import { LS } from '../persistence/storage-keys.const';
import { Log, PluginLog } from '../log';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { IosKeyboardService } from './ios-keyboard.service';
import { CSS_VAR_KEYBOARD_HEIGHT } from './keyboard-css-vars.const';
import { OverlayContainer } from '@angular/cdk/overlay';
import { sanitizeSvgIconContent } from '../../util/sanitize-svg-icon.util';
import { PaletteThemeService } from './palette-theme.service';
import { colorChannels } from './palette.util';
import { BUILT_IN_SVG_ICONS } from './built-in-svg-icons.const';
import { UltraTasksAppearanceService } from './ultra-tasks-appearance.service';
import { pickGlassBackgroundImage } from './glass-backdrop/glass-backdrop.util';

export type DarkModeCfg = 'dark' | 'light' | 'system';

const CSS_VAR_SAFE_AREA_TOP = '--safe-area-inset-top';
const CSS_VAR_SAFE_AREA_BOTTOM = '--safe-area-inset-bottom';
const CSS_VAR_SAFE_AREA_LEFT = '--safe-area-inset-left';
const CSS_VAR_SAFE_AREA_RIGHT = '--safe-area-inset-right';
const CSS_VAR_SYSTEM_SURFACE = '--system-surface';
const DEFAULT_LIGHT_SYSTEM_SURFACE = '#f8f8f7';
const DEFAULT_DARK_SYSTEM_SURFACE = '#131314';

/**
 * Resolve a CSS theme surface to the opaque hex format Android's Color parser
 * accepts. Transparent, gradient, unresolved, and otherwise invalid values
 * fall back to the matching Default-theme surface.
 */
export const resolveSystemSurfaceColor = (
  rawColor: string,
  isDarkMode: boolean,
): string => {
  const color = rawColor.trim();
  const fallback = isDarkMode
    ? DEFAULT_DARK_SYSTEM_SURFACE
    : DEFAULT_LIGHT_SYSTEM_SURFACE;

  if (/^#[\da-f]{6}$/i.test(color)) {
    return color;
  }
  if (/^#[\da-f]{3}$/i.test(color)) {
    return `#${[...color.slice(1)].map((digit) => `${digit}${digit}`).join('')}`;
  }
  const rgbMatch = color.match(
    /^rgb\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*\)$/i,
  );
  if (rgbMatch) {
    const channels = rgbMatch.slice(1).map(Number);
    if (channels.every((channel) => channel <= 255)) {
      return `#${channels
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }
  return fallback;
};

@Injectable({ providedIn: 'root' })
export class GlobalThemeService {
  private document = inject<Document>(DOCUMENT);
  private _layoutService = inject(LayoutService);
  private _materialCssVarsService = inject(MaterialCssVarsService);
  private _globalConfigService = inject(GlobalConfigService);
  private _matIconRegistry = inject(MatIconRegistry);
  private readonly _registeredPluginIcons = new Set<string>();
  private _domSanitizer = inject(DomSanitizer);

  private _chromeExtensionInterfaceService = inject(ChromeExtensionInterfaceService);
  private _imexMetaService = inject(ImexViewService);
  private _http = inject(HttpClient);
  private _platformService = inject(CapacitorPlatformService);
  private _paletteThemeService = inject(PaletteThemeService);
  private _appearanceService = inject(UltraTasksAppearanceService);
  private _environmentInjector = inject(EnvironmentInjector);
  private _destroyRef = inject(DestroyRef);
  private _inputIntentService = inject(InputIntentService);
  private _iosKeyboardService = inject(IosKeyboardService);
  private _overlayContainer = inject(OverlayContainer);
  private _hasInitialized = false;
  private _isCustomWindowTitleBarEnabled(): boolean {
    // The main process (main-window.ts) force-disables the custom title bar on
    // GNOME+Wayland because the Window-Controls-Overlay won't render there.
    // Mirror that here so we never lay the custom header on top of native
    // decorations, which would produce a doubled header.
    if (IS_GNOME_WAYLAND) {
      return false;
    }
    // Default ON to match main-window's `?? !IS_GNOME_WAYLAND` default.
    // KNOWN RESIDUAL: main-window also honors the legacy `isUseObsidianStyleHeader`
    // SimpleStore field, which is never mirrored into global config, so it isn't
    // visible here. A user who explicitly disabled the *old* header and never set
    // the new toggle gets native decorations + custom header (doubled). This is a
    // pre-existing divergence (already present for non-GNOME) and is self-healing:
    // the now-visible Misc toggle lets them turn the custom header off.
    const misc = this._globalConfigService.misc();
    return misc?.isUseCustomWindowTitleBar ?? true;
  }

  darkMode = signal<DarkModeCfg>(
    (localStorage.getItem(LS.DARK_MODE) as DarkModeCfg) || 'system',
  );

  private _isDarkThemeObs$: Observable<boolean> = toObservable(this.darkMode).pipe(
    switchMap((darkMode) => {
      switch (darkMode) {
        case 'dark':
          return of(true);
        case 'light':
          return of(false);
        default:
          const darkModePreference = window.matchMedia('(prefers-color-scheme: dark)');
          return fromEvent(darkModePreference, 'change').pipe(
            map((e: any) => e.matches),
            startWith(darkModePreference.matches),
          );
      }
    }),
    distinctUntilChanged(),
  );

  isDarkTheme = toSignal(this._isDarkThemeObs$, { initialValue: false });

  /**
   * The configured background image (raw value: data:, http(s):, legacy
   * image:<id> or file://) shown blurred behind the glass surfaces. Only the
   * drawn backdrop uses it: with Solid, reduced transparency or forced colors
   * the plain palette background shows, and the desktop app on macOS and
   * Windows 11 blurs the desktop instead.
   */
  readonly backgroundImg = computed<string | null>(() =>
    this._appearanceService.backdrop() === 'bitmap'
      ? pickGlassBackgroundImage(this._globalConfigService.misc(), this.isDarkTheme())
      : null,
  );

  init(): void {
    if (this._hasInitialized) {
      return;
    }
    this._hasInitialized = true;

    runInInjectionContext(this._environmentInjector, () => {
      // This is here to make web page reloads on non-work-context pages at least usable
      this._setBackgroundTint(true);
      this._initIcons();
      effect(() => {
        this._paletteThemeService.apply(this.isDarkTheme());
        this._setChartTheme(this.isDarkTheme()).catch((err) => {
          Log.warn('Failed to set chart theme', err);
        });
      });
      this._initHandlersForInitialBodyClasses();
      this._initGlass();
      this._initThemeWatchers();

      // Set up dark mode persistence effect
      effect(() => {
        const darkMode = this.darkMode();
        localStorage.setItem(LS.DARK_MODE, darkMode);
      });
    });
  }

  private _setDarkTheme(isDarkTheme: boolean): void {
    this._materialCssVarsService.setDarkTheme(isDarkTheme);
    // this._materialCssVarsService.setDarkTheme(true);
    // this._materialCssVarsService.setDarkTheme(false);
  }

  private _setBackgroundTint(isDisableBackgroundTint: boolean): void {
    // Simplify: toggle only the disable flag; CSS handles the rest
    this.document.body.classList.toggle(
      BodyClass.isDisableBackgroundTint,
      !!isDisableBackgroundTint,
    );
  }

  private _initIcons(): void {
    // Material v22 infers the ligature class from the loaded fonts and would pick
    // `material-symbols-outlined`; our icon styles are bound to `.material-icons`.
    this._matIconRegistry.setDefaultFontSetClass('material-icons', 'mat-ligature-font');
    // todo test if can be removed with airplane mode and wifi without internet
    BUILT_IN_SVG_ICONS.forEach(([name, path]) => {
      this._matIconRegistry.addSvgIcon(
        name,
        this._domSanitizer.bypassSecurityTrustResourceUrl(path),
      );
    });

    this.preloadIcons(BUILT_IN_SVG_ICONS);
  }

  preloadIcons(icons: readonly (readonly [string, string])[]): Promise<void[]> {
    // Map each icon name to a promise that fetches and registers the icon.
    const iconPromises = icons.map(([iconName, url]) => {
      // Construct the URL for the SVG file.
      // Adjust the path if your SVGs are located elsewhere.
      return this._http
        .get(url, { responseType: 'text' })
        .toPromise()
        .then((svg) => {
          // Register the fetched SVG as an inline icon.
          this._matIconRegistry.addSvgIconLiteral(
            iconName,
            this._domSanitizer.bypassSecurityTrustHtml(svg),
          );
        })
        .catch((error) => {
          Log.err(`Error loading icon: ${iconName} from ${url}`, error);
        });
    });

    // Return a promise that resolves when all icons have been processed.
    return Promise.all(iconPromises);
  }

  registerSvgIcon(iconName: string, url: string): void {
    // Plugin icon is already registered, skip
    if (this._registeredPluginIcons.has(iconName)) return;
    this._matIconRegistry.addSvgIcon(
      iconName,
      this._domSanitizer.bypassSecurityTrustResourceUrl(url),
    );
    this._registeredPluginIcons.add(iconName);
  }

  hasPluginIcon(iconName: string): boolean {
    return this._registeredPluginIcons.has(iconName);
  }

  /**
   * `svgContent` comes from a plugin, so it is untrusted. `MatIconRegistry` parses the
   * literal with `div.innerHTML`, which makes this the trust boundary for that sink.
   */
  registerSvgIconFromContent(iconName: string, svgContent: string): void {
    // Plugin icon is already registered, skip
    if (this._registeredPluginIcons.has(iconName)) return;
    const safeSvgContent = sanitizeSvgIconContent(svgContent);
    if (!safeSvgContent) {
      PluginLog.warn(`Skipping unsafe or invalid SVG icon: ${iconName}`);
      return;
    }
    this._matIconRegistry.addSvgIconLiteral(
      iconName,
      this._domSanitizer.bypassSecurityTrustHtml(safeSvgContent),
    );
    this._registeredPluginIcons.add(iconName);
  }

  /**
   * Glass appearance: body classes for the glass CSS (applied once right away
   * so the first frame is right, then kept current), and in the desktop app the
   * OS material, which follows the app's light/dark choice while it is on.
   */
  private _initGlass(): void {
    const applyBodyClasses = (): void => {
      const backdrop = this._appearanceService.backdrop();
      const classList = this.document.body.classList;
      classList.toggle(BodyClass.stSolid, backdrop === 'solid');
      classList.toggle(BodyClass.stGlass, backdrop !== 'solid');
      classList.toggle(BodyClass.stGlassNative, backdrop === 'native');
      classList.toggle(BodyClass.stGlassBitmap, backdrop === 'bitmap');
      // Acrylic keeps the content sheet opaque so text keeps ClearType.
      classList.toggle(
        BodyClass.stGlassAcrylic,
        backdrop === 'native' && this._appearanceService.nativeMaterial === 'acrylic',
      );
    };
    applyBodyClasses();
    effect(applyBodyClasses);

    if (this._appearanceService.nativeMaterial) {
      effect(() => {
        window.ea.setNativeGlass({
          isEnabled: this._appearanceService.backdrop() === 'native',
          themeSource: this.darkMode(),
          solidColor: this._paletteThemeService.roles(this.isDarkTheme()).background,
        });
      });
    }
  }

  private _initThemeWatchers(): void {
    // init theme watchers
    this._isDarkThemeObs$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((isDarkTheme) => this._setDarkTheme(isDarkTheme));

    // Update Electron title bar overlay when dark mode changes
    if (IS_ELECTRON && !IS_MAC) {
      effect(() => {
        const roles = this._paletteThemeService.roles(this.isDarkTheme());
        const isDark = roles.backgroundInk === '#ffffff';
        // Native controls share the dedicated title strip's opaque background,
        // including when the workspace below it uses glass.
        const [r, g, b] = colorChannels(roles.background);
        const overlayColor = `rgba(${r}, ${g}, ${b}, 1)`;
        // Use untracked to prevent creating additional dependencies in this effect
        const isCustomWindowTitleBarEnabled = untracked(() =>
          this._isCustomWindowTitleBarEnabled(),
        );
        // Only update if custom window title bar is enabled
        if (isCustomWindowTitleBarEnabled) {
          window.ea.updateTitleBarDarkMode(isDark, overlayColor);
        }
      });
    }
  }

  private _initHandlersForInitialBodyClasses(): void {
    this.document.body.classList.add(BodyClass.isNoAdvancedFeatures);

    if (!IS_FIREFOX) {
      this.document.body.classList.add(BodyClass.isNoFirefox);
    }

    if (IS_MAC) {
      this.document.body.classList.add(BodyClass.isMac);
    } else {
      this.document.body.classList.add(BodyClass.isNoMac);
    }

    if (IS_ELECTRON) {
      this.document.body.classList.add(BodyClass.isElectron);
      this.document.body.classList.add(BodyClass.isAdvancedFeatures);
      this.document.body.classList.remove(BodyClass.isNoAdvancedFeatures);
      ipcEnterFullScreen$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        this.document.body.classList.add(BodyClass.isFullScreen);
      });
      ipcLeaveFullScreen$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(() => {
        this.document.body.classList.remove(BodyClass.isFullScreen);
      });
    } else {
      this.document.body.classList.add(BodyClass.isWeb);
      this._chromeExtensionInterfaceService.onReady$.pipe(take(1)).subscribe(() => {
        this.document.body.classList.add(BodyClass.isExtension);
        this.document.body.classList.add(BodyClass.isAdvancedFeatures);
        this.document.body.classList.remove(BodyClass.isNoAdvancedFeatures);
      });
    }

    // Add native mobile platform classes
    if (this._platformService.isNative) {
      this.document.body.classList.add(BodyClass.isNativeMobile);
      this._initMobileStatusBar();
      this._initSafeAreaInsets();

      if (this._platformService.isIOS()) {
        this.document.body.classList.add(BodyClass.isIOS);
        this._iosKeyboardService.init();
        lockViewportZoom(this.document);

        // Add iPad-specific class for tablet optimizations
        if (this._platformService.isIPad()) {
          this.document.body.classList.add(BodyClass.isIPad);
        }
      }
    }

    // Engine-level marker for the iOS focus-zoom workaround, set for web too:
    // `isIOS` above is inside the isNative branch, so mobile Safari and the
    // installed PWA never get it, yet they zoom exactly the same. Styles that
    // must clear the 16px threshold key off THIS class (see
    // styles/mixins/_ios-focus-zoom.scss).
    if (this._platformService.isIOSWebKit()) {
      this.document.body.classList.add(BodyClass.isIOSWebKit);
    }

    if (IS_ANDROID_WEB_VIEW) {
      androidInterface.isKeyboardShown$
        // The native OnGlobalLayoutListener pushes a value on every layout pass
        // (i.e. every frame of the IME slide), so dedupe to actual transitions —
        // otherwise we rewrite <body> classes and re-trigger change detection
        // every frame while the keyboard animates.
        .pipe(distinctUntilChanged(), takeUntilDestroyed(this._destroyRef))
        .subscribe((isShown) => {
          Log.log('isShown', isShown);

          this.document.body.classList.remove(BodyClass.isAndroidKeyboardHidden);
          this.document.body.classList.remove(BodyClass.isAndroidKeyboardShown);
          this.document.body.classList.remove(BodyClass.isKeyboardVisible);
          this.document.body.classList.add(
            isShown
              ? BodyClass.isAndroidKeyboardShown
              : BodyClass.isAndroidKeyboardHidden,
          );
          if (isShown) {
            this.document.body.classList.add(BodyClass.isKeyboardVisible);
          }
        });
    }

    // VisualViewport keyboard-height tracking covers every non-iOS touch
    // build: Capacitor Android, the legacy F-Droid build, and Android
    // mobile-web. iOS is handled entirely by IosKeyboardService above.
    if (IS_TOUCH_ONLY && !this._platformService.isIOS()) {
      this._initVisualViewportKeyboardTracking();
    }

    // Use effect to reactively update animation class
    effect(() => {
      if (isAnimationDisabled(this._globalConfigService.misc())) {
        this.document.body.classList.add(BodyClass.isDisableAnimations);
      } else {
        this.document.body.classList.remove(BodyClass.isDisableAnimations);
      }
    });

    effect(() => {
      if (this._isCustomWindowTitleBarEnabled()) {
        this.document.body.classList.add(BodyClass.isObsidianStyleHeader);
      } else {
        this.document.body.classList.remove(BodyClass.isObsidianStyleHeader);
      }
    });

    effect(() => {
      const misc = this._globalConfigService.misc();
      if (misc?.isVerticalActionBar) {
        this.document.body.classList.add(BodyClass.isVerticalActionBar);
      } else {
        this.document.body.classList.remove(BodyClass.isVerticalActionBar);
      }
    });

    // Add/remove has-mobile-bottom-nav class to body for snack bar positioning
    effect(() => {
      if (this._layoutService.isShowMobileBottomNav()) {
        this.document.body.classList.add(BodyClass.hasMobileBottomNav);
      } else {
        this.document.body.classList.remove(BodyClass.hasMobileBottomNav);
      }
    });

    this._imexMetaService.isDataImportInProgress$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((isInProgress) => {
        // timer(1000, 5000)
        //   .pipe(map((val) => val % 2 === 0))
        //   .subscribe((isInProgress) => {
        if (isInProgress) {
          this.document.body.classList.add(BodyClass.isDataImportInProgress);
        } else {
          this.document.body.classList.remove(BodyClass.isDataImportInProgress);
        }
      });

    if (IS_TOUCH_ONLY) {
      this.document.body.classList.add(BodyClass.isTouchOnly);
    } else {
      this.document.body.classList.add(BodyClass.isNoTouchOnly);
    }

    // On hybrid devices, InputIntentService dynamically toggles these classes
    if (!IS_HYBRID_DEVICE) {
      if (IS_MOUSE_PRIMARY) {
        this.document.body.classList.add(BodyClass.isMousePrimary);
      } else if (IS_TOUCH_PRIMARY) {
        this.document.body.classList.add(BodyClass.isTouchPrimary);
      }
    }
  }

  private async _setChartTheme(isDarkTheme: boolean): Promise<void> {
    const { ThemeService } = await import('ng2-charts');

    const chartThemeService = this._environmentInjector.get(ThemeService);

    // Normalised roles: the ink always matches the painted background.
    const roles = this._paletteThemeService.roles(isDarkTheme);
    const ink = roles.backgroundInk;
    const grid = `rgba(${colorChannels(ink).join(', ')}, ${roles.alphas.separator})`;
    const overrides: import('chart.js').ChartConfiguration['options'] = {
      color: ink,
      scales: {
        x: { ticks: { color: ink }, grid: { color: grid } },
        y: { ticks: { color: ink }, grid: { color: grid } },
      },
      plugins: {
        legend: { labels: { color: ink } },
        tooltip: {
          backgroundColor: roles.surfaceRaised,
          titleColor: roles.surfaceInk,
          bodyColor: roles.surfaceInk,
        },
      },
    };
    chartThemeService.setColorschemesOptions(overrides);
  }

  /**
   * Keyboard-height tracking via VisualViewport — the fallback path for any
   * non-iOS touch build (Capacitor Android, F-Droid, mobile-web).
   *
   * Android's `adjustResize` is supposed to shrink the WebView when the IME
   * appears, in which case `position: fixed; bottom: 0` would naturally sit
   * above the keyboard. In practice it's inconsistent — depending on Chrome
   * version, transient transitions, and edge-to-edge insets, the layout
   * viewport sometimes does not shrink in step with the keyboard, leaving
   * fixed-position UI hidden behind it.
   *
   * VisualViewport always reflects the actual visible area. The difference
   * `window.innerHeight - visualViewport.height` is the obscured area —
   * which is zero when adjustResize already handled it, and equals the
   * keyboard height otherwise. Either way, `--keyboard-height` ends up
   * correct without needing to know which path Android took.
   */
  private _initVisualViewportKeyboardTracking(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = this.document.documentElement;
    // Filter out small differences from URL bar / overlay UI rather than the
    // IME — keeps us from setting a phantom keyboard offset.
    const KEYBOARD_THRESHOLD_PX = 100;
    // IME open/close on Android resizes the layout viewport (adjustResize)
    // and the visual viewport at slightly different times, so per-event
    // commits park fixed-position UI (e.g. the global add-task bar) at
    // intermediate partial-keyboard amounts. Debounce the OPEN path so only
    // the final value lands (200ms, just past `--transition-duration-m`:
    // 225ms). Commit the CLOSE path synchronously so the bar drops the moment
    // the IME is gone rather than parking at the old height for the debounce
    // window — that would just invert the original symptom.
    const KEYBOARD_RESIZE_DEBOUNCE_MS = 200;
    let resizeTimer: number | null = null;

    const commit = (): void => {
      const obscured = window.innerHeight - vv.height;
      const keyboardHeight = obscured > KEYBOARD_THRESHOLD_PX ? obscured : 0;
      root.style.setProperty(CSS_VAR_KEYBOARD_HEIGHT, `${keyboardHeight}px`);
    };

    const onViewportResize = (): void => {
      const obscured = window.innerHeight - vv.height;
      if (obscured <= KEYBOARD_THRESHOLD_PX) {
        if (resizeTimer !== null) {
          window.clearTimeout(resizeTimer);
          resizeTimer = null;
        }
        commit();
        return;
      }
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        commit();
      }, KEYBOARD_RESIZE_DEBOUNCE_MS);
    };

    commit();
    vv.addEventListener('resize', onViewportResize, { passive: true });
    this._destroyRef.onDestroy(() => {
      vv.removeEventListener('resize', onViewportResize);
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
    });
  }

  /**
   * Read native safe area insets and set CSS variables.
   * Works around Android WebView's unreliable env(safe-area-inset-*) values.
   */
  private _initSafeAreaInsets(): void {
    const applyInsets = (insets: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }): void => {
      const root = this.document.documentElement;
      root.style.setProperty(CSS_VAR_SAFE_AREA_TOP, `${insets.top}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_BOTTOM, `${insets.bottom}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_LEFT, `${insets.left}px`);
      root.style.setProperty(CSS_VAR_SAFE_AREA_RIGHT, `${insets.right}px`);
    };

    // On Android the WebView now draws edge-to-edge (the @capawesome plugin that
    // used to inset it via native margins was removed in favour of Capacitor's
    // built-in SystemBars). The --safe-area-inset-* vars are no longer written
    // from JS on Android — that would race SystemBars on the same documentElement
    // inline style (last-writer-wins, OS/timing dependent). Each band resolves
    // them on its own (verified against the bundled SystemBars.java, Capacitor
    // 8.5.3 — see docs/android-edge-to-edge-keyboard.md, "Capacitor 8.5.2+"):
    //   - WebView >= 140 (any API, viewport-fit=cover): SystemBars passes the
    //     native insets through and mirrors them into --safe-area-inset-*
    //     (bottom 0px while the keyboard is up, which it pads natively).
    //   - WebView < 140 (any API): SystemBars pads the window natively for the
    //     system bars and keyboard and writes 0px into --safe-area-inset-*.
    // In every case the SCSS fallback `var(--safe-area-inset-*, env(...))` in
    // _css-variables.scss resolves to the injected px when present, else to
    // env() — which covers the moment before SystemBars' first write.
    // Only iOS (contentInset: 'never') still needs JS-fed insets from
    // capacitor-plugin-safe-area; SystemBars insetsHandling is Android-only.
    if (!this._platformService.isAndroid()) {
      SafeArea.getSafeAreaInsets().then(({ insets }) => applyInsets(insets));
      SafeArea.addListener('safeAreaChanged', ({ insets }) => applyInsets(insets));
    }
    patchCdkViewportForSafeArea(
      this.document,
      this._overlayContainer.getContainerElement(),
    );
  }

  /**
   * Initialize mobile status bar styling.
   * Syncs status bar style with app dark/light mode on both iOS and Android.
   */
  private _initMobileStatusBar(): void {
    // Android with the Capacitor bridge: counts the native configuration changes
    // (rotation, system dark-mode flip, hardware keyboard, display size, fold)
    // that reset the bars' window background, so the effect below runs again
    // after each one. See applyAndroidBarAppearance.
    const androidBarReapplies: Signal<number> =
      this._platformService.isAndroid() && !this._platformService.isLegacyAndroidWebView
        ? toSignal(androidBarReapply$(), { initialValue: 0 })
        : signal(0);
    effect(() => {
      const isDark = this.isDarkTheme();
      // Re-read computed tokens only after the loader has atomically swapped
      // the stylesheet. Theme changes do not necessarily change dark mode.
      this._paletteThemeService.appliedVersion();
      const lightIcons =
        this._paletteThemeService.roles(isDark).backgroundInk === '#ffffff';
      StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light }).catch(
        (err) => {
          Log.warn('Failed to set status bar style', err);
        },
      );
      if (this._platformService.isAndroid()) {
        androidBarReapplies();
        const bgColor = resolveSystemSurfaceColor(
          getComputedStyle(this.document.body).getPropertyValue(CSS_VAR_SYSTEM_SURFACE),
          isDark,
        );
        // The @capawesome edge-to-edge plugin (which painted opaque bar overlays
        // via EdgeToEdge.set{Status,Navigation}BarColor) was removed in favour of
        // Capacitor's built-in SystemBars. SystemBars has NO bar-color API — the
        // edge-to-edge model is transparent bars with the web content drawn
        // behind them. The bar backgrounds are therefore painted by:
        //   - setWebViewBackgroundColor (window decor + WebView surface), which
        //     shows through the transparent bars (the color backstop on API 35+
        //     where window.*BarColor is a no-op), and
        //   - NavigationBar.setColor's window.navigationBarColor, still effective
        //     on API < 35, plus its setSystemBarsAppearance which drives the nav
        //     bar icon light/dark on all versions.
        // Both bars' icon style is also stored in SystemBars, which re-applies its
        // own copy on every configuration change (see applyAndroidBarAppearance).
        applyAndroidBarAppearance({ lightIcons, surfaceColor: bgColor });
      }
    });
  }
}
