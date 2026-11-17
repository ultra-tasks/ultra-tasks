import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  WritableSignal,
} from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SystemBarsStyle, SystemBarType } from '@capacitor/core';
import { GlobalThemeService, resolveSystemSurfaceColor } from './global-theme.service';
import {
  ANDROID_BAR_PLUGINS,
  ANDROID_BAR_REAPPLY_DEBOUNCE_MS,
} from './android-system-bars.util';
import { Log } from '../log';
import { GlassBackdrop } from './ultra-tasks-appearance.service';
import { NativeGlassState } from '../../../../electron/shared-with-frontend/native-glass.model';

interface GlobalThemeInitHarness {
  init(): void;
  darkMode: WritableSignal<'system' | 'dark' | 'light'>;
  _hasInitialized: boolean;
  _environmentInjector: EnvironmentInjector;
  _paletteThemeService: { apply: jasmine.Spy };
  isDarkTheme: WritableSignal<boolean>;
  _setBackgroundTint(value: boolean): void;
  _initIcons(): void;
  _setChartTheme(isDark: boolean): Promise<void>;
  _initHandlersForInitialBodyClasses(): void;
  _initGlass(): void;
  _initThemeWatchers(): void;
}

interface GlassHarness {
  _initGlass(): void;
  document: Document;
  darkMode: WritableSignal<'system' | 'dark' | 'light'>;
  isDarkTheme: WritableSignal<boolean>;
  _appearanceService: {
    backdrop: WritableSignal<GlassBackdrop>;
    nativeMaterial: 'vibrancy' | 'acrylic' | null;
  };
  _paletteThemeService: {
    roles: (isDark: boolean) => { background: string };
  };
}

describe('resolveSystemSurfaceColor()', () => {
  it('uses an opaque theme-supplied hex color', () => {
    expect(resolveSystemSurfaceColor('  #ece5d4  ', false)).toBe('#ece5d4');
    expect(resolveSystemSurfaceColor('#abc', false)).toBe('#aabbcc');
  });

  it('normalizes an opaque CSS rgb color for Android', () => {
    expect(resolveSystemSurfaceColor('rgb(26, 24, 22)', true)).toBe('#1a1816');
  });

  it('falls back to the current mode when the token is empty or not a solid color', () => {
    expect(resolveSystemSurfaceColor('', false)).toBe('#f8f8f7');
    expect(resolveSystemSurfaceColor('linear-gradient(red, blue)', true)).toBe('#131314');
    expect(resolveSystemSurfaceColor('rgb(256, 0, 0)', true)).toBe('#131314');
  });

  it('accepts a computed theme token that resolves through another custom property', () => {
    try {
      document.body.style.setProperty('--test-system-surface', '#abc');
      document.body.style.setProperty('--system-surface', 'var(--test-system-surface)');

      const computedColor = getComputedStyle(document.body).getPropertyValue(
        '--system-surface',
      );

      expect(resolveSystemSurfaceColor(computedColor, false)).toBe('#aabbcc');
    } finally {
      document.body.style.removeProperty('--system-surface');
      document.body.style.removeProperty('--test-system-surface');
    }
  });
});

describe('GlobalThemeService palette initialization', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  it('applies palettes on mode changes without overriding the chosen mode', () => {
    const service = Object.create(GlobalThemeService.prototype) as GlobalThemeInitHarness;
    service.darkMode = signal<'system' | 'dark' | 'light'>('light');
    service.isDarkTheme = signal(false);
    service._hasInitialized = false;
    service._environmentInjector = TestBed.inject(EnvironmentInjector);
    const apply = jasmine.createSpy('apply');
    service._paletteThemeService = { apply };
    service._setBackgroundTint = (): void => undefined;
    service._initIcons = (): void => undefined;
    service._setChartTheme = async (): Promise<void> => undefined;
    service._initHandlersForInitialBodyClasses = (): void => undefined;
    service._initGlass = (): void => undefined;
    service._initThemeWatchers = (): void => undefined;
    service.init();
    TestBed.tick();
    expect(apply).toHaveBeenCalledWith(false);
    service.isDarkTheme.set(true);
    TestBed.tick();
    expect(apply).toHaveBeenCalledWith(true);
    expect(service.darkMode()).toBe('light');
  });
});

describe('GlobalThemeService glass appearance', () => {
  const GLASS_CLASSES = [
    'st-solid',
    'st-glass',
    'st-glass-native',
    'st-glass-bitmap',
    'st-glass-acrylic',
  ];
  let originalEa: unknown;
  let glassInjector: EnvironmentInjector | undefined;

  // Own injector per test, so its effects are destroyed with it.
  const initGlass = (service: GlassHarness): void => {
    glassInjector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(glassInjector, () => service._initGlass());
  };

  const createHarness = (
    backdrop: GlassBackdrop,
    nativeMaterial: 'vibrancy' | 'acrylic' | null,
  ): GlassHarness => {
    const service = Object.create(GlobalThemeService.prototype) as GlassHarness;
    service.document = document;
    service.darkMode = signal<'system' | 'dark' | 'light'>('dark');
    service.isDarkTheme = signal(true);
    service._appearanceService = { backdrop: signal(backdrop), nativeMaterial };
    service._paletteThemeService = {
      roles: (isDark) => ({ background: isDark ? '#131314' : '#f8f8f7' }),
    };
    return service;
  };
  const bodyGlassClasses = (): string[] =>
    GLASS_CLASSES.filter((name) => document.body.classList.contains(name));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    originalEa = (window as unknown as { ea?: unknown }).ea;
  });
  afterEach(() => {
    // Destroy the effects before the stubbed bridge goes away.
    glassInjector?.destroy();
    glassInjector = undefined;
    document.body.classList.remove(...GLASS_CLASSES);
    (window as unknown as { ea?: unknown }).ea = originalEa;
  });

  it('sets the body classes synchronously and keeps them current', () => {
    const service = createHarness('bitmap', null);
    initGlass(service);
    expect(bodyGlassClasses()).toEqual(['st-glass', 'st-glass-bitmap']);
    service._appearanceService.backdrop.set('solid');
    TestBed.tick();
    expect(bodyGlassClasses()).toEqual(['st-solid']);
  });

  it('marks acrylic so the content sheet stays opaque', () => {
    const service = createHarness('native', 'acrylic');
    (window as unknown as { ea: unknown }).ea = { setNativeGlass: () => undefined };
    initGlass(service);
    expect(bodyGlassClasses()).toEqual([
      'st-glass',
      'st-glass-native',
      'st-glass-acrylic',
    ]);
  });

  it('reports the effective state to the desktop window', () => {
    const sent: NativeGlassState[] = [];
    (window as unknown as { ea: unknown }).ea = {
      setNativeGlass: (state: NativeGlassState) => sent.push(state),
    };
    const service = createHarness('native', 'vibrancy');
    initGlass(service);
    TestBed.tick();
    expect(sent.at(-1)).toEqual({
      isEnabled: true,
      themeSource: 'dark',
      solidColor: '#131314',
    });
    service._appearanceService.backdrop.set('solid');
    service.darkMode.set('system');
    TestBed.tick();
    expect(sent.at(-1)).toEqual({
      isEnabled: false,
      themeSource: 'system',
      solidColor: '#131314',
    });
  });

  it('sends nothing outside the desktop app', () => {
    const setNativeGlass = jasmine.createSpy('setNativeGlass');
    (window as unknown as { ea: unknown }).ea = { setNativeGlass };
    const service = createHarness('bitmap', null);
    initGlass(service);
    TestBed.tick();
    expect(setNativeGlass).not.toHaveBeenCalled();
  });
});

describe('GlobalThemeService.registerSvgIconFromContent()', () => {
  interface IconRegistrationHarness {
    registerSvgIconFromContent(iconName: string, svgContent: string): void;
    _registeredPluginIcons: Set<string>;
    _matIconRegistry: { addSvgIconLiteral: jasmine.Spy };
    _domSanitizer: { bypassSecurityTrustHtml: (value: string) => string };
  }

  let harness: IconRegistrationHarness;

  beforeEach(() => {
    harness = Object.create(GlobalThemeService.prototype) as IconRegistrationHarness;
    harness._registeredPluginIcons = new Set<string>();
    harness._matIconRegistry = {
      addSvgIconLiteral: jasmine.createSpy('addSvgIconLiteral'),
    };
    harness._domSanitizer = { bypassSecurityTrustHtml: (value: string) => value };
  });

  /** MatIconRegistry parses the registered literal with `div.innerHTML`. */
  const renderRegisteredLiteral = (): HTMLDivElement => {
    const div = document.createElement('div');
    div.innerHTML = harness._matIconRegistry.addSvgIconLiteral.calls.mostRecent()
      .args[1] as string;
    return div;
  };

  it('registers a benign plugin icon', () => {
    harness.registerSvgIconFromContent(
      'plugin-a-icon',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 2"></path></svg>',
    );

    expect(harness._matIconRegistry.addSvgIconLiteral).toHaveBeenCalledTimes(1);
    expect(renderRegisteredLiteral().querySelector('path')?.getAttribute('d')).toBe(
      'M1 2',
    );
    expect(harness._registeredPluginIcons.has('plugin-a-icon')).toBe(true);
  });

  it('does not register content that is not an SVG', () => {
    harness.registerSvgIconFromContent('plugin-b-icon', '<div>nope</div>');

    expect(harness._matIconRegistry.addSvgIconLiteral).not.toHaveBeenCalled();
    expect(harness._registeredPluginIcons.has('plugin-b-icon')).toBe(false);
  });

  it('registers no live markup for a plugin icon that smuggles CDATA', () => {
    harness.registerSvgIconFromContent(
      'plugin-c-icon',
      '<svg xmlns="http://www.w3.org/2000/svg"><desc><![CDATA[><img src=x onerror="window.alert(1)">]]></desc><circle r="4"></circle></svg>',
    );

    expect(harness._matIconRegistry.addSvgIconLiteral).toHaveBeenCalledTimes(1);
    const rendered = renderRegisteredLiteral();
    expect(rendered.querySelector('img')).toBeNull();
    expect(rendered.querySelector('[onerror]')).toBeNull();
    expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('4');
  });

  it('does not register an icon whose content is entirely stripped', () => {
    harness.registerSvgIconFromContent(
      'plugin-e-icon',
      '<svg xmlns="http://www.w3.org/2000/svg"><desc><![CDATA[><img src=x onerror="window.alert(1)">]]></desc></svg>',
    );

    // Registering an empty literal would make `hasPluginIcon()` true, so callers would pick
    // this icon name over their own fallback and render nothing.
    expect(harness._matIconRegistry.addSvgIconLiteral).not.toHaveBeenCalled();
    expect(harness._registeredPluginIcons.has('plugin-e-icon')).toBe(false);
  });

  it('strips an event handler from a plugin icon before registering it', () => {
    harness.registerSvgIconFromContent(
      'plugin-d-icon',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.alert(1)"><circle r="4"></circle></svg>',
    );

    const rendered = renderRegisteredLiteral();
    expect(rendered.querySelector('svg')?.getAttribute('onload')).toBeNull();
    expect(rendered.querySelector('circle')?.getAttribute('r')).toBe('4');
  });
});

describe('GlobalThemeService mobile bars', () => {
  interface MobileBarsHarness {
    _initMobileStatusBar(): void;
    document: Document;
    isDarkTheme: WritableSignal<boolean>;
    _paletteThemeService: {
      appliedVersion: WritableSignal<number>;
      roles: (isDark: boolean) => { backgroundInk: string };
    };
    _platformService: { isAndroid: () => boolean; isLegacyAndroidWebView: boolean };
  }

  let barsInjector: EnvironmentInjector | undefined;
  let setSystemBarStyle: jasmine.Spy;
  let setNavigationBarColor: jasmine.Spy;
  let setWebViewBackgroundColor: jasmine.Spy;

  const initBars = (platform: {
    isAndroid: boolean;
    isLegacyAndroidWebView?: boolean;
  }): MobileBarsHarness => {
    const service = Object.create(GlobalThemeService.prototype) as MobileBarsHarness;
    service.document = document;
    service.isDarkTheme = signal(false);
    service._paletteThemeService = {
      appliedVersion: signal(0),
      roles: (isDark) => ({ backgroundInk: isDark ? '#ffffff' : '#000000' }),
    };
    service._platformService = {
      isAndroid: () => platform.isAndroid,
      isLegacyAndroidWebView: !!platform.isLegacyAndroidWebView,
    };
    // Own injector per test, so the effect and the listeners are destroyed with it.
    barsInjector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(barsInjector, () => service._initMobileStatusBar());
    TestBed.tick();
    return service;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    // The web fallback of the StatusBar plugin rejects; that is logged, not thrown.
    spyOn(Log, 'warn');
    setSystemBarStyle = spyOn(ANDROID_BAR_PLUGINS, 'setSystemBarStyle').and.resolveTo();
    setNavigationBarColor = spyOn(
      ANDROID_BAR_PLUGINS,
      'setNavigationBarColor',
    ).and.resolveTo();
    setWebViewBackgroundColor = spyOn(
      ANDROID_BAR_PLUGINS,
      'setWebViewBackgroundColor',
    ).and.resolveTo();
  });
  afterEach(() => {
    barsInjector?.destroy();
    barsInjector = undefined;
  });

  it('stores the icon style in SystemBars for both bars on Android', () => {
    initBars({ isAndroid: true });
    expect(setSystemBarStyle.calls.allArgs()).toEqual([
      [{ style: SystemBarsStyle.Light, bar: SystemBarType.StatusBar }],
      [{ style: SystemBarsStyle.Light, bar: SystemBarType.NavigationBar }],
    ]);
    expect(setNavigationBarColor.calls.mostRecent().args[0].style).toBe('LIGHT');
    expect(setWebViewBackgroundColor.calls.mostRecent().args[0].color).toMatch(
      /^#[\da-f]{6}$/i,
    );
  });

  it('follows the app theme, not the system theme', () => {
    const service = initBars({ isAndroid: true });
    service.isDarkTheme.set(true);
    TestBed.tick();
    expect(setSystemBarStyle.calls.allArgs().slice(-2)).toEqual([
      [{ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar }],
      [{ style: SystemBarsStyle.Dark, bar: SystemBarType.NavigationBar }],
    ]);
    expect(setNavigationBarColor.calls.mostRecent().args[0].style).toBe('DARK');
  });

  it('applies the theme again once a native configuration change has settled', fakeAsync(() => {
    initBars({ isAndroid: true });
    expect(setWebViewBackgroundColor).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('orientationchange'));
    window.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS - 1);
    TestBed.tick();
    expect(setWebViewBackgroundColor).toHaveBeenCalledTimes(1);

    tick(1);
    TestBed.tick();
    expect(setSystemBarStyle).toHaveBeenCalledTimes(4);
    expect(setNavigationBarColor).toHaveBeenCalledTimes(2);
    expect(setWebViewBackgroundColor).toHaveBeenCalledTimes(2);
  }));

  it('does not listen for configuration changes in the legacy Android WebView', fakeAsync(() => {
    initBars({ isAndroid: true, isLegacyAndroidWebView: true });
    const before = setWebViewBackgroundColor.calls.count();

    window.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    TestBed.tick();
    expect(setWebViewBackgroundColor.calls.count()).toBe(before);
  }));

  it('leaves the Android bars alone on other platforms', fakeAsync(() => {
    initBars({ isAndroid: false });

    window.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    TestBed.tick();
    expect(setSystemBarStyle).not.toHaveBeenCalled();
    expect(setNavigationBarColor).not.toHaveBeenCalled();
    expect(setWebViewBackgroundColor).not.toHaveBeenCalled();
  }));
});
