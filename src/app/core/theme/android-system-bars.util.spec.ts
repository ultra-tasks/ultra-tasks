import { fakeAsync, tick } from '@angular/core/testing';
import { SystemBarsStyle, SystemBarType } from '@capacitor/core';
import { Log } from '../log';
import {
  ANDROID_BAR_REAPPLY_DEBOUNCE_MS,
  AndroidBarPlugins,
  androidBarReapply$,
  applyAndroidBarAppearance,
} from './android-system-bars.util';

describe('applyAndroidBarAppearance()', () => {
  const createPlugins = (
    reject: Partial<Record<keyof AndroidBarPlugins, boolean>> = {},
  ): { plugins: AndroidBarPlugins; calls: string[] } => {
    const calls: string[] = [];
    const record =
      <K extends keyof AndroidBarPlugins>(name: K) =>
      (options: unknown): Promise<void> => {
        calls.push(`${name} ${JSON.stringify(options)}`);
        return reject[name]
          ? Promise.reject(new Error(`${name} failed`))
          : Promise.resolve();
      };
    return {
      calls,
      plugins: {
        setSystemBarStyle: record('setSystemBarStyle'),
        setNavigationBarColor: record('setNavigationBarColor'),
        setWebViewBackgroundColor: record('setWebViewBackgroundColor'),
      },
    };
  };

  it('stores the dark-icon style in SystemBars for both bars on a light theme', () => {
    const { plugins, calls } = createPlugins();
    applyAndroidBarAppearance({ lightIcons: false, surfaceColor: '#f8f8f7' }, plugins);
    expect(calls).toEqual([
      `setSystemBarStyle ${JSON.stringify({ style: SystemBarsStyle.Light, bar: SystemBarType.StatusBar })}`,
      `setSystemBarStyle ${JSON.stringify({ style: SystemBarsStyle.Light, bar: SystemBarType.NavigationBar })}`,
      `setNavigationBarColor ${JSON.stringify({ color: '#f8f8f7', style: 'LIGHT' })}`,
      `setWebViewBackgroundColor ${JSON.stringify({ color: '#f8f8f7' })}`,
    ]);
  });

  it('stores the light-icon style in SystemBars for both bars on a dark theme', () => {
    const { plugins, calls } = createPlugins();
    applyAndroidBarAppearance({ lightIcons: true, surfaceColor: '#131314' }, plugins);
    expect(calls).toEqual([
      `setSystemBarStyle ${JSON.stringify({ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar })}`,
      `setSystemBarStyle ${JSON.stringify({ style: SystemBarsStyle.Dark, bar: SystemBarType.NavigationBar })}`,
      `setNavigationBarColor ${JSON.stringify({ color: '#131314', style: 'DARK' })}`,
      `setWebViewBackgroundColor ${JSON.stringify({ color: '#131314' })}`,
    ]);
  });

  it('sets the SystemBars style first: it also resets the window background the later calls repaint', () => {
    const { plugins, calls } = createPlugins();
    applyAndroidBarAppearance({ lightIcons: false, surfaceColor: '#f8f8f7' }, plugins);
    const lastStyleCall = calls
      .map((c) => c.startsWith('setSystemBarStyle'))
      .lastIndexOf(true);
    const firstPaintCall = calls.findIndex((c) => !c.startsWith('setSystemBarStyle'));
    expect(lastStyleCall).toBeLessThan(firstPaintCall);
    expect(calls.at(-1)).toContain('setWebViewBackgroundColor');
  });

  it('logs a failing native call and still runs the others', fakeAsync(() => {
    const warn = spyOn(Log, 'warn');
    const { plugins, calls } = createPlugins({ setSystemBarStyle: true });
    applyAndroidBarAppearance({ lightIcons: false, surfaceColor: '#f8f8f7' }, plugins);
    tick();
    expect(calls.length).toBe(4);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.calls.argsFor(0)[0]).toBe('Failed to set status bar style');
    expect(warn.calls.argsFor(1)[0]).toBe('Failed to set navigation bar style');
  }));
});

describe('androidBarReapply$()', () => {
  type Source = Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia'>;

  const createSource = (): {
    source: Source;
    windowEvents: EventTarget;
    colorScheme: EventTarget;
    listenerCount: () => number;
  } => {
    const windowEvents = new EventTarget();
    const colorScheme = new EventTarget();
    let listeners = 0;
    const source = {
      addEventListener: (...args: Parameters<EventTarget['addEventListener']>): void => {
        listeners++;
        windowEvents.addEventListener(...args);
      },
      removeEventListener: (
        ...args: Parameters<EventTarget['removeEventListener']>
      ): void => {
        listeners--;
        windowEvents.removeEventListener(...args);
      },
      matchMedia: (query: string): MediaQueryList => {
        expect(query).toBe('(prefers-color-scheme: dark)');
        return colorScheme as MediaQueryList;
      },
    } as unknown as Source;
    return { source, windowEvents, colorScheme, listenerCount: () => listeners };
  };

  it('emits once, after a burst of resize events has settled', fakeAsync(() => {
    const { source, windowEvents } = createSource();
    const emitted: number[] = [];
    const sub = androidBarReapply$(source).subscribe((n) => emitted.push(n));

    windowEvents.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS - 50);
    windowEvents.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS - 50);
    expect(emitted).toEqual([]);

    tick(50);
    expect(emitted).toEqual([1]);

    windowEvents.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    expect(emitted).toEqual([1, 2]);
    sub.unsubscribe();
  }));

  it('reacts to a rotation', fakeAsync(() => {
    const { source, windowEvents } = createSource();
    const emitted: number[] = [];
    const sub = androidBarReapply$(source).subscribe((n) => emitted.push(n));

    windowEvents.dispatchEvent(new Event('orientationchange'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    expect(emitted).toEqual([1]);
    sub.unsubscribe();
  }));

  it('reacts to a system dark-mode flip, which fires neither resize nor orientationchange', fakeAsync(() => {
    const { source, colorScheme } = createSource();
    const emitted: number[] = [];
    const sub = androidBarReapply$(source).subscribe((n) => emitted.push(n));

    colorScheme.dispatchEvent(new Event('change'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    expect(emitted).toEqual([1]);
    sub.unsubscribe();
  }));

  it('removes its window listeners when unsubscribed', fakeAsync(() => {
    const { source, windowEvents, listenerCount } = createSource();
    const emitted: number[] = [];
    const sub = androidBarReapply$(source).subscribe((n) => emitted.push(n));
    expect(listenerCount()).toBe(2);

    sub.unsubscribe();
    expect(listenerCount()).toBe(0);
    windowEvents.dispatchEvent(new Event('resize'));
    tick(ANDROID_BAR_REAPPLY_DEBOUNCE_MS);
    expect(emitted).toEqual([]);
  }));
});
