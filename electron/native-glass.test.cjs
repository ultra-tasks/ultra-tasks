const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('ts-node/register/transpile-only');

const {
  applyNativeGlass,
  getNativeGlassWindowOptions,
  getWindowsBuild,
  initNativeGlassIpc,
  parsePersistedNativeGlass,
  resolveNativeGlassMaterial,
} = require(path.resolve(__dirname, 'native-glass.ts'));
const {
  isNativeGlassState,
  parseNativeGlassMaterialArg,
  NATIVE_GLASS_ARG_PREFIX,
} = require(path.resolve(__dirname, 'shared-with-frontend/native-glass.model.ts'));
const { IPC } = require(
  path.resolve(__dirname, 'shared-with-frontend/ipc-events.const.ts'),
);

const fakeWindow = () => {
  const calls = [];
  return {
    calls,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    setVibrancy: (type) => calls.push(['setVibrancy', type]),
    setBackgroundMaterial: (material) => calls.push(['setBackgroundMaterial', material]),
    setBackgroundColor: (color) => calls.push(['setBackgroundColor', color]),
  };
};

const fakeIpc = () => {
  const handlers = {};
  return { handlers, on: (channel, handler) => (handlers[channel] = handler) };
};

test('resolveNativeGlassMaterial: macOS always uses vibrancy', () => {
  for (const isCustomTitleBar of [true, false]) {
    assert.equal(
      resolveNativeGlassMaterial({
        platform: 'darwin',
        systemVersion: '15.1.0',
        isCustomTitleBar,
      }),
      'vibrancy',
    );
  }
});

test('resolveNativeGlassMaterial: acrylic needs Windows 11 22H2 and the custom title bar', () => {
  const win = (systemVersion, isCustomTitleBar) =>
    resolveNativeGlassMaterial({ platform: 'win32', systemVersion, isCustomTitleBar });
  assert.equal(win('10.0.22621', true), 'acrylic');
  assert.equal(win('10.0.26100', true), 'acrylic');
  // Native frame: the material would only fill the caption.
  assert.equal(win('10.0.22631', false), null);
  // Windows 11 21H2 and Windows 10.
  assert.equal(win('10.0.22000', true), null);
  assert.equal(win('10.0.19045', true), null);
  assert.equal(win('garbage', true), null);
});

test('resolveNativeGlassMaterial: Linux draws its own backdrop', () => {
  assert.equal(
    resolveNativeGlassMaterial({
      platform: 'linux',
      systemVersion: '6.8.0',
      isCustomTitleBar: true,
    }),
    null,
  );
});

test('getWindowsBuild reads the third version part', () => {
  assert.equal(getWindowsBuild('10.0.22631'), 22631);
  assert.equal(getWindowsBuild('10.0'), 0);
});

test('macOS always creates the window with vibrancy', () => {
  // Nothing saved yet (a fresh install, Glass defaults to on), saved on, saved
  // off: vibrancy is never switched on after the window exists on macOS.
  const options = {
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
  };
  assert.deepEqual(getNativeGlassWindowOptions('vibrancy', null), options);
  assert.deepEqual(
    getNativeGlassWindowOptions('vibrancy', { isEnabled: true, themeSource: 'dark' }),
    options,
  );
  assert.deepEqual(
    getNativeGlassWindowOptions('vibrancy', { isEnabled: false, themeSource: 'system' }),
    options,
  );
});

test('Windows starts with acrylic only when it was on', () => {
  const on = { isEnabled: true, themeSource: 'dark' };
  const off = { isEnabled: false, themeSource: 'system' };
  assert.deepEqual(getNativeGlassWindowOptions('acrylic', on), {
    backgroundMaterial: 'acrylic',
  });
  assert.deepEqual(getNativeGlassWindowOptions('acrylic', off), {});
  assert.deepEqual(getNativeGlassWindowOptions('acrylic', null), {});
  assert.deepEqual(getNativeGlassWindowOptions(null, on), {});
});

test('persisted state and IPC payloads are validated strictly', () => {
  assert.deepEqual(parsePersistedNativeGlass({ isEnabled: true, themeSource: 'light' }), {
    isEnabled: true,
    themeSource: 'light',
  });
  assert.equal(
    parsePersistedNativeGlass({ isEnabled: 'yes', themeSource: 'light' }),
    null,
  );
  assert.equal(parsePersistedNativeGlass({ isEnabled: true, themeSource: 'blue' }), null);
  assert.equal(parsePersistedNativeGlass(undefined), null);

  const valid = { isEnabled: false, themeSource: 'system', solidColor: '#131314' };
  assert.equal(isNativeGlassState(valid), true);
  assert.equal(isNativeGlassState({ ...valid, solidColor: 'red' }), false);
  assert.equal(isNativeGlassState({ ...valid, solidColor: '#13131' }), false);
  assert.equal(isNativeGlassState({ ...valid, isEnabled: 1 }), false);
  assert.equal(isNativeGlassState(null), false);
});

test('the renderer reads the material from its startup argument', () => {
  assert.equal(
    parseNativeGlassMaterialArg(['electron', `${NATIVE_GLASS_ARG_PREFIX}vibrancy`]),
    'vibrancy',
  );
  assert.equal(
    parseNativeGlassMaterialArg([`${NATIVE_GLASS_ARG_PREFIX}acrylic`]),
    'acrylic',
  );
  assert.equal(parseNativeGlassMaterialArg([`${NATIVE_GLASS_ARG_PREFIX}none`]), null);
  assert.equal(parseNativeGlassMaterialArg([`${NATIVE_GLASS_ARG_PREFIX}mica`]), null);
  assert.equal(parseNativeGlassMaterialArg(undefined), null);
});

test('applyNativeGlass on macOS only follows the theme and leaves the window alone', () => {
  const win = fakeWindow();
  const theme = { themeSource: 'system' };
  applyNativeGlass(
    win,
    'vibrancy',
    { isEnabled: true, themeSource: 'dark', solidColor: '#131314' },
    theme,
  );
  assert.equal(theme.themeSource, 'dark');
  applyNativeGlass(
    win,
    'vibrancy',
    { isEnabled: false, themeSource: 'dark', solidColor: '#131314' },
    theme,
  );
  assert.equal(theme.themeSource, 'system');
  // No setVibrancy / setBackgroundColor at runtime: the renderer's opaque
  // surfaces cover the vibrancy view while Glass is off.
  assert.deepEqual(win.calls, []);
});

test('applyNativeGlass on Windows repaints after removing the material', () => {
  const win = fakeWindow();
  const theme = { themeSource: 'system' };
  applyNativeGlass(
    win,
    'acrylic',
    { isEnabled: true, themeSource: 'light', solidColor: '#f8f8f7' },
    theme,
  );
  assert.equal(theme.themeSource, 'light');
  assert.deepEqual(win.calls, [['setBackgroundMaterial', 'acrylic']]);
  win.calls.length = 0;
  applyNativeGlass(
    win,
    'acrylic',
    { isEnabled: false, themeSource: 'light', solidColor: '#f8f8f7' },
    theme,
  );
  // 'none' makes Electron paint the window white; the app color replaces it.
  assert.deepEqual(win.calls, [
    ['setBackgroundMaterial', 'none'],
    ['setBackgroundColor', '#f8f8f7'],
  ]);
});

test('IPC on Windows applies changes, repaints palette edits and persists only mode changes', () => {
  const ipc = fakeIpc();
  const win = fakeWindow();
  const theme = { themeSource: 'system' };
  const saved = [];
  initNativeGlassIpc({
    ipcMain: ipc,
    win,
    material: 'acrylic',
    persisted: { isEnabled: true, themeSource: 'system' },
    theme,
    save: (value) => saved.push(value),
  });
  const send = (payload) => ipc.handlers[IPC.SET_NATIVE_GLASS]({}, payload);

  send({ isEnabled: true, themeSource: 'system', solidColor: '#f8f8f7' });
  assert.deepEqual(win.calls, [['setBackgroundMaterial', 'acrylic']]);
  assert.deepEqual(saved, []);

  win.calls.length = 0;
  // A palette edit with glass on changes nothing in the window.
  send({ isEnabled: true, themeSource: 'system', solidColor: '#eeeeee' });
  assert.deepEqual(win.calls, []);

  send({ isEnabled: false, themeSource: 'system', solidColor: '#eeeeee' });
  assert.deepEqual(saved, [{ isEnabled: false, themeSource: 'system' }]);
  win.calls.length = 0;
  send({ isEnabled: false, themeSource: 'system', solidColor: '#dddddd' });
  assert.deepEqual(win.calls, [['setBackgroundColor', '#dddddd']]);
  assert.equal(saved.length, 1);

  // Malformed payloads are ignored.
  win.calls.length = 0;
  send({ isEnabled: true, themeSource: 'neon', solidColor: '#dddddd' });
  send('true');
  assert.deepEqual(win.calls, []);
});

test('IPC on macOS follows the theme and persists, but never touches the window', () => {
  const ipc = fakeIpc();
  const win = fakeWindow();
  const theme = { themeSource: 'system' };
  const saved = [];
  // A fresh install: nothing saved yet.
  initNativeGlassIpc({
    ipcMain: ipc,
    win,
    material: 'vibrancy',
    persisted: null,
    theme,
    save: (value) => saved.push(value),
  });
  const send = (payload) => ipc.handlers[IPC.SET_NATIVE_GLASS]({}, payload);

  send({ isEnabled: true, themeSource: 'dark', solidColor: '#131314' });
  assert.equal(theme.themeSource, 'dark');
  assert.deepEqual(saved, [{ isEnabled: true, themeSource: 'dark' }]);

  send({ isEnabled: false, themeSource: 'dark', solidColor: '#131314' });
  assert.equal(theme.themeSource, 'system');
  // A palette edit with glass off repaints in the renderer, not the window.
  send({ isEnabled: false, themeSource: 'dark', solidColor: '#222222' });
  send({ isEnabled: true, themeSource: 'dark', solidColor: '#222222' });
  assert.equal(theme.themeSource, 'dark');
  assert.deepEqual(saved, [
    { isEnabled: true, themeSource: 'dark' },
    { isEnabled: false, themeSource: 'dark' },
    { isEnabled: true, themeSource: 'dark' },
  ]);
  assert.deepEqual(win.calls, []);
});

test('IPC does nothing where the window has no material', () => {
  const ipc = fakeIpc();
  const win = fakeWindow();
  const theme = { themeSource: 'system' };
  const saved = [];
  initNativeGlassIpc({
    ipcMain: ipc,
    win,
    material: null,
    persisted: null,
    theme,
    save: (value) => saved.push(value),
  });
  ipc.handlers[IPC.SET_NATIVE_GLASS](
    {},
    {
      isEnabled: true,
      themeSource: 'dark',
      solidColor: '#131314',
    },
  );
  assert.deepEqual(win.calls, []);
  assert.deepEqual(saved, []);
  assert.equal(theme.themeSource, 'system');
});

test('main window wires the material, the startup argument and the IPC', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'main-window.ts'), 'utf8');
  assert.match(
    src,
    /\.\.\.getNativeGlassWindowOptions\(nativeGlassMaterial, persistedNativeGlass\)/,
  );
  assert.match(src, /additionalArguments: \[`\$\{NATIVE_GLASS_ARG_PREFIX\}/);
  assert.match(src, /initNativeGlassIpc\(\{/);
  // Never a transparent window: that drops the shadow and native resizing.
  assert.match(src, /transparent: false,/);
});
