const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
const handlerModulePath = path.resolve(__dirname, 'ipc-handlers/global-shortcuts.ts');
const { IPC } = require('./shared-with-frontend/ipc-events.const.ts');

let ipcHandlers;
let active;
let calls;
let heldByOtherApp;
let events;
let logs;
let currentWin;
let isAppReady;

const createWin = (id) => {
  const sent = [];
  return { id, sent, webContents: { send: (...args) => sent.push(args) } };
};

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        globalShortcut: {
          register: (accelerator, callback) => {
            calls.push(`register ${accelerator}`);
            if (heldByOtherApp.has(accelerator) || active.has(accelerator)) return false;
            active.set(accelerator, callback);
            return true;
          },
          unregister: (accelerator) => {
            calls.push(`unregister ${accelerator}`);
            active.delete(accelerator);
          },
        },
        ipcMain: { on: (eventName, handler) => ipcHandlers.set(eventName, handler) },
      };
    }
    if (request === 'electron-log/main') {
      return {
        error: (...args) => logs.push(['error', ...args]),
        info: (...args) => logs.push(['info', ...args]),
      };
    }
    if (request === '../main-window') {
      return {
        getWin: () => {
          if (!currentWin) throw new Error('No main window');
          return currentWin;
        },
        getIsAppReady: () => isAppReady,
      };
    }
    if (request === '../task-widget/task-widget') {
      return { toggleTaskWidgetVisibility: () => events.push(['toggleTaskWidget']) };
    }
    if (request === '../various-shared') {
      return {
        showOrFocus: (win) => events.push(['showOrFocus', win.id]),
        toggleWindowVisibility: (win) => events.push(['toggleWindowVisibility', win.id]),
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

// The handler holds a registry; load it fresh for every test so none inherits registrations.
const loadHandler = () => {
  delete require.cache[handlerModulePath];
  const { initGlobalShortcutsIpc } = require(handlerModulePath);
  initGlobalShortcutsIpc();
  return ipcHandlers.get(IPC.REGISTER_GLOBAL_SHORTCUTS_EVENT);
};

test.beforeEach(() => {
  ipcHandlers = new Map();
  active = new Map();
  calls = [];
  heldByOtherApp = new Set();
  events = [];
  logs = [];
  currentWin = createWin('win-1');
  isAppReady = true;
  installMocks();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  delete require.cache[handlerModulePath];
});

test('conflicts use a channel of their own', () => {
  assert.equal(IPC.GLOBAL_SHORTCUT_CONFLICT, 'GLOBAL_SHORTCUT_CONFLICT');
  assert.notEqual(IPC.GLOBAL_SHORTCUT_CONFLICT, IPC.ERROR);
});

test('listens for the renderer config and re-registers nothing when it is unchanged', () => {
  const register = loadHandler();
  assert.equal(typeof register, 'function');
  const cfg = { globalShowHide: 'Ctrl+Shift+X', undo: 'Ctrl+Z' };

  register({}, cfg);
  register({}, { ...cfg });
  register({}, { ...cfg, undo: 'Ctrl+Alt+Z' });

  assert.deepEqual(calls, ['register Ctrl+Shift+X']);
});

test('a pressed shortcut acts on the window that exists then, not the one at registration', () => {
  const register = loadHandler();
  register(
    {},
    {
      globalShowHide: 'F1',
      globalToggleTaskStart: 'F2',
      globalAddNote: 'F3',
      globalAddTask: 'F4',
      globalToggleTaskWidget: 'F5',
    },
  );
  // e.g. macOS re-creates the window after it was closed; the registrations stay
  const recreatedWin = createWin('win-2');
  currentWin = recreatedWin;

  for (const accelerator of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    active.get(accelerator)();
  }

  assert.deepEqual(events, [
    ['toggleWindowVisibility', 'win-2'],
    ['showOrFocus', 'win-2'],
    ['showOrFocus', 'win-2'],
    ['toggleTaskWidget'],
  ]);
  assert.deepEqual(recreatedWin.sent, [
    [IPC.TASK_TOGGLE_START],
    [IPC.ADD_NOTE],
    [IPC.SHOW_ADD_TASK_BAR],
  ]);
});

test('a conflict reaches the renderer once on its own channel, not as a generic error', () => {
  heldByOtherApp.add('Ctrl+Shift+X');
  const register = loadHandler();

  for (let i = 0; i < 5; i++) {
    register({}, { globalShowHide: 'Ctrl+Shift+X' });
  }

  assert.deepEqual(currentWin.sent, [
    [
      IPC.GLOBAL_SHORTCUT_CONFLICT,
      { shortcut: 'Ctrl+Shift+X', action: 'globalShowHide' },
    ],
  ]);
  assert.ok(currentWin.sent.every(([channel]) => channel !== IPC.ERROR));
  // Electron's own reason stays in the log for diagnosis
  assert.equal(logs.filter(([level]) => level === 'error').length, 1);
});

test('a conflict found while the renderer boots is delivered once it is ready', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  isAppReady = false;
  heldByOtherApp.add('Ctrl+Shift+X');
  const register = loadHandler();

  register({}, { globalShowHide: 'Ctrl+Shift+X' });
  assert.deepEqual(currentWin.sent, []);

  isAppReady = true;
  t.mock.timers.tick(4000);

  assert.deepEqual(currentWin.sent, [
    [
      IPC.GLOBAL_SHORTCUT_CONFLICT,
      { shortcut: 'Ctrl+Shift+X', action: 'globalShowHide' },
    ],
  ]);
});

test('a conflict is dropped quietly when the renderer never becomes ready', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  isAppReady = false;
  heldByOtherApp.add('Ctrl+Shift+X');
  const register = loadHandler();

  register({}, { globalShowHide: 'Ctrl+Shift+X' });
  t.mock.timers.tick(4000);
  t.mock.timers.tick(60000);

  assert.deepEqual(currentWin.sent, []);
});

test('a window that is already gone does not break registration', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  heldByOtherApp.add('Ctrl+Shift+X');
  const register = loadHandler();
  currentWin = null;

  assert.doesNotThrow(() => {
    register({}, { globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'F4' });
    t.mock.timers.tick(4000);
  });

  assert.ok(active.has('F4'));
});
