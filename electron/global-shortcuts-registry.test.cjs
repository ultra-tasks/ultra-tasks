const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const { createGlobalShortcutRegistry } = require('./global-shortcuts-registry.ts');

// Stand-in for Electron's globalShortcut. Like the real one, register() returns false for
// a shortcut another app holds and for one this process already registered, and throws for
// an accelerator it cannot parse.
const createBackend = () => {
  const active = new Map();
  const calls = [];
  const heldByOtherApp = new Set();
  const unparsable = new Set();
  return {
    active,
    calls,
    heldByOtherApp,
    unparsable,
    register: (accelerator, callback) => {
      calls.push(`register ${accelerator}`);
      if (unparsable.has(accelerator)) {
        throw new TypeError(`conversion failure from ${accelerator}`);
      }
      if (heldByOtherApp.has(accelerator) || active.has(accelerator)) {
        return false;
      }
      active.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      calls.push(`unregister ${accelerator}`);
      active.delete(accelerator);
    },
  };
};

const setup = () => {
  const backend = createBackend();
  const conflicts = [];
  const logs = [];
  const pressed = [];
  const registry = createGlobalShortcutRegistry({
    backend,
    getAction: (action) => () => pressed.push(action),
    onConflict: (conflict) => conflicts.push(conflict),
    logger: {
      error: (...args) => logs.push(['error', ...args]),
      info: (...args) => logs.push(['info', ...args]),
    },
  });
  return {
    backend,
    registry,
    conflicts,
    logs,
    pressed,
    registeredShortcuts: () => [...backend.active.keys()].sort(),
    press: (shortcut) => backend.active.get(shortcut)(),
    takeCalls: () => backend.calls.splice(0),
  };
};

test('registers each configured global binding and ignores everything else', () => {
  const { registry, backend, conflicts, registeredShortcuts, press, pressed } = setup();

  registry.apply({
    globalAddTask: 'Ctrl+Alt+A',
    globalShowHide: 'Ctrl+Shift+X',
    undo: 'Ctrl+Z',
    taskDelete: 'Backspace',
  });

  // fixed action order, not the order of the config's keys
  assert.deepEqual(backend.calls, ['register Ctrl+Shift+X', 'register Ctrl+Alt+A']);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A', 'Ctrl+Shift+X']);
  assert.deepEqual(conflicts, []);

  press('Ctrl+Shift+X');
  press('Ctrl+Alt+A');
  assert.deepEqual(pressed, ['globalShowHide', 'globalAddTask']);
});

test('an unchanged config touches nothing and reports nothing', () => {
  const { registry, conflicts, takeCalls, registeredShortcuts } = setup();
  const cfg = { globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' };
  registry.apply(cfg);
  takeCalls();

  registry.apply({ ...cfg });
  registry.apply({ ...cfg, undo: 'Ctrl+Z' });

  assert.deepEqual(takeCalls(), []);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A', 'Ctrl+Shift+X']);
});

test('a changed binding is released and replaced, the others stay registered untouched', () => {
  const { registry, conflicts, takeCalls, registeredShortcuts, press, pressed } = setup();
  registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' });
  takeCalls();

  registry.apply({ globalShowHide: 'Ctrl+Alt+X', globalAddTask: 'Ctrl+Alt+A' });

  assert.deepEqual(takeCalls(), ['unregister Ctrl+Shift+X', 'register Ctrl+Alt+X']);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A', 'Ctrl+Alt+X']);
  assert.deepEqual(conflicts, []);
  press('Ctrl+Alt+X');
  assert.deepEqual(pressed, ['globalShowHide']);
});

test('a removed binding is released, whether it is null, empty or missing', () => {
  for (const removed of [null, '', undefined]) {
    const { registry, takeCalls, registeredShortcuts } = setup();
    registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' });
    takeCalls();

    registry.apply({ globalShowHide: removed, globalAddTask: 'Ctrl+Alt+A' });

    assert.deepEqual(takeCalls(), ['unregister Ctrl+Shift+X']);
    assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A']);
  }
});

test('clearing the config releases everything', () => {
  for (const cleared of [null, undefined, {}]) {
    const { registry, registeredShortcuts, conflicts } = setup();
    registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' });

    registry.apply(cleared);

    assert.deepEqual(registeredShortcuts(), []);
    assert.deepEqual(conflicts, []);
  }
});

test('values that are not usable shortcut strings are ignored', () => {
  const { registry, backend, conflicts } = setup();

  registry.apply({
    globalShowHide: 123,
    globalAddTask: '',
    globalAddNote: null,
    globalToggleTaskStart: undefined,
    globalToggleTaskWidget: { accelerator: 'F1' },
  });

  assert.deepEqual(backend.calls, []);
  assert.deepEqual(conflicts, []);
});

test('a binding another app holds is reported once, then retried silently', () => {
  const { registry, backend, conflicts, logs, takeCalls } = setup();
  backend.heldByOtherApp.add('Ctrl+Shift+X');
  const cfg = { globalShowHide: 'Ctrl+Shift+X' };

  registry.apply(cfg);
  assert.deepEqual(conflicts, [{ shortcut: 'Ctrl+Shift+X', action: 'globalShowHide' }]);
  assert.equal(logs.filter(([level]) => level === 'error').length, 1);
  takeCalls();

  for (let i = 0; i < 4; i++) {
    registry.apply({ ...cfg });
  }

  assert.equal(conflicts.length, 1);
  // still retried each time, so a released shortcut can start working ...
  assert.deepEqual(takeCalls(), Array(4).fill('register Ctrl+Shift+X'));
  // ... without a log line or a report per retry
  assert.equal(logs.filter(([level]) => level === 'error').length, 1);
});

test('a shortcut released by the other app registers on the next apply without a report', () => {
  const { registry, backend, conflicts, logs, registeredShortcuts, press, pressed } =
    setup();
  backend.heldByOtherApp.add('Ctrl+Shift+X');
  const cfg = { globalShowHide: 'Ctrl+Shift+X' };
  registry.apply(cfg);
  registry.apply(cfg);

  backend.heldByOtherApp.delete('Ctrl+Shift+X');
  registry.apply(cfg);

  assert.deepEqual(registeredShortcuts(), ['Ctrl+Shift+X']);
  assert.equal(conflicts.length, 1);
  assert.ok(
    logs.some(
      ([level, message]) => level === 'info' && /after an earlier failure/.test(message),
    ),
  );
  press('Ctrl+Shift+X');
  assert.deepEqual(pressed, ['globalShowHide']);
});

test('a binding that fails again after it worked is reported again', () => {
  const { registry, backend, conflicts } = setup();
  const cfg = { globalShowHide: 'Ctrl+Shift+X' };
  backend.heldByOtherApp.add('Ctrl+Shift+X');
  registry.apply(cfg);
  backend.heldByOtherApp.delete('Ctrl+Shift+X');
  registry.apply(cfg);
  // dropped from the config (released), then another app takes it before it is asked for again
  registry.apply({});
  backend.heldByOtherApp.add('Ctrl+Shift+X');

  registry.apply(cfg);

  assert.equal(conflicts.length, 2);
});

test('a failing binding does not disturb the working ones', () => {
  const { registry, backend, conflicts, takeCalls, registeredShortcuts, press, pressed } =
    setup();
  backend.heldByOtherApp.add('Ctrl+Shift+X');
  registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' });
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A']);
  takeCalls();

  // repeats leave the working binding alone ...
  registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+A' });
  assert.deepEqual(takeCalls(), ['register Ctrl+Shift+X']);

  // ... and changing it does not re-report the unchanged failure
  registry.apply({ globalShowHide: 'Ctrl+Shift+X', globalAddTask: 'Ctrl+Alt+B' });
  assert.deepEqual(takeCalls(), [
    'unregister Ctrl+Alt+A',
    'register Ctrl+Shift+X',
    'register Ctrl+Alt+B',
  ]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+B']);
  press('Ctrl+Alt+B');
  assert.deepEqual(pressed, ['globalAddTask']);
});

test('moving a failing binding to a free shortcut clears its failure record', () => {
  const { registry, backend, conflicts, registeredShortcuts } = setup();
  backend.heldByOtherApp.add('Ctrl+Shift+X');
  registry.apply({ globalShowHide: 'Ctrl+Shift+X' });

  registry.apply({ globalShowHide: 'Ctrl+Alt+X' });
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+X']);
  assert.equal(conflicts.length, 1);

  // asking for the held shortcut again is a new failure and is reported again
  registry.apply({ globalShowHide: 'Ctrl+Shift+X' });
  assert.equal(conflicts.length, 2);
  assert.deepEqual(registeredShortcuts(), []);
});

test('two actions on one shortcut: the first in action order keeps it, the other is reported once', () => {
  const { registry, conflicts, takeCalls, registeredShortcuts, press, pressed } = setup();

  // the order of the keys in the config does not matter
  registry.apply({ globalAddTask: 'Ctrl+Alt+A', globalShowHide: 'Ctrl+Alt+A' });

  assert.deepEqual(takeCalls(), ['register Ctrl+Alt+A']);
  assert.deepEqual(conflicts, [{ shortcut: 'Ctrl+Alt+A', action: 'globalAddTask' }]);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A']);
  press('Ctrl+Alt+A');
  assert.deepEqual(pressed, ['globalShowHide']);

  // repeats are silent and touch nothing: a duplicate cannot succeed, so it is not retried
  registry.apply({ globalAddTask: 'Ctrl+Alt+A', globalShowHide: 'Ctrl+Alt+A' });
  assert.deepEqual(takeCalls(), []);
  assert.equal(conflicts.length, 1);
});

test('the winner of a duplicate does not depend on what was registered before', () => {
  const { registry, conflicts, registeredShortcuts, press, pressed } = setup();
  registry.apply({ globalAddTask: 'Ctrl+Alt+A' });

  registry.apply({ globalShowHide: 'Ctrl+Alt+A', globalAddTask: 'Ctrl+Alt+A' });

  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A']);
  assert.deepEqual(conflicts, [{ shortcut: 'Ctrl+Alt+A', action: 'globalAddTask' }]);
  press('Ctrl+Alt+A');
  assert.deepEqual(pressed, ['globalShowHide']);
});

test('resolving a duplicate by changing one binding registers it and stops the failure', () => {
  const { registry, conflicts, registeredShortcuts } = setup();
  registry.apply({ globalShowHide: 'Ctrl+Alt+A', globalAddTask: 'Ctrl+Alt+A' });

  registry.apply({ globalShowHide: 'Ctrl+Alt+A', globalAddTask: 'Ctrl+Alt+B' });

  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A', 'Ctrl+Alt+B']);
  assert.equal(conflicts.length, 1);
});

test('an accelerator Electron cannot parse is reported once and does not block the others', () => {
  const { registry, backend, conflicts, logs, registeredShortcuts, takeCalls } = setup();
  backend.unparsable.add('Foo+Bar');
  const cfg = { globalShowHide: 'Foo+Bar', globalAddTask: 'Ctrl+Alt+A' };

  registry.apply(cfg);
  registry.apply({ ...cfg });
  registry.apply({ ...cfg });

  assert.deepEqual(conflicts, [{ shortcut: 'Foo+Bar', action: 'globalShowHide' }]);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A']);
  const errors = logs.filter(([level]) => level === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0][2].reason, /conversion failure from Foo\+Bar/);
  assert.deepEqual(
    takeCalls().filter((call) => call.endsWith('Ctrl+Alt+A')),
    ['register Ctrl+Alt+A'],
  );
});

test('swapping two bindings releases both before registering them again', () => {
  const { registry, conflicts, takeCalls, registeredShortcuts, press, pressed } = setup();
  registry.apply({ globalShowHide: 'Ctrl+Alt+A', globalAddTask: 'Ctrl+Alt+B' });
  takeCalls();

  registry.apply({ globalShowHide: 'Ctrl+Alt+B', globalAddTask: 'Ctrl+Alt+A' });

  assert.deepEqual(takeCalls(), [
    'unregister Ctrl+Alt+A',
    'unregister Ctrl+Alt+B',
    'register Ctrl+Alt+B',
    'register Ctrl+Alt+A',
  ]);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(registeredShortcuts(), ['Ctrl+Alt+A', 'Ctrl+Alt+B']);
  press('Ctrl+Alt+A');
  press('Ctrl+Alt+B');
  assert.deepEqual(pressed, ['globalAddTask', 'globalShowHide']);
});

test('handing a shortcut to another action replaces its callback', () => {
  const { registry, conflicts, takeCalls, press, pressed } = setup();
  registry.apply({ globalShowHide: 'Ctrl+Alt+A' });
  takeCalls();

  registry.apply({ globalAddTask: 'Ctrl+Alt+A' });

  assert.deepEqual(takeCalls(), ['unregister Ctrl+Alt+A', 'register Ctrl+Alt+A']);
  assert.deepEqual(conflicts, []);
  press('Ctrl+Alt+A');
  assert.deepEqual(pressed, ['globalAddTask']);
});

test('a failure is logged for diagnosis with the shortcut, the action and the reason', () => {
  const { registry, backend, logs } = setup();
  backend.heldByOtherApp.add('Ctrl+Shift+X');

  registry.apply({ globalShowHide: 'Ctrl+Shift+X' });

  assert.deepEqual(logs, [
    [
      'error',
      'Global shortcut registration failed',
      {
        shortcut: 'Ctrl+Shift+X',
        action: 'globalShowHide',
        reason: 'register() returned false',
      },
    ],
  ]);
});
