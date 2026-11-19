const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'lifecycle-diagnostics.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const load = (files = new Map(), logs = []) => {
  const exports = {};
  const processEvents = new EventEmitter();
  vm.runInNewContext(source, {
    exports,
    process: { pid: 4242, on: (event, listener) => processEvents.on(event, listener) },
    Date,
    JSON,
    String,
    Math,
    Set,
    setInterval: () => ({ unref: () => undefined }),
    require: (name) => {
      if (name === 'electron-log/main')
        return {
          info: (line) => logs.push(['info', line]),
          warn: (line) => logs.push(['warn', line]),
        };
      if (name === 'node:path') return { join: (...parts) => parts.join('/') };
      if (name === 'node:fs')
        return {
          readFileSync: (file) => {
            if (!files.has(file)) throw new Error('ENOENT');
            return files.get(file);
          },
          writeFileSync: (file, value) => files.set(file, value),
        };
      return require(name);
    },
  });
  return { exports, processEvents, files, logs };
};

const FILE = '/profile/lifecycle.json';
const marker = (files) => JSON.parse(files.get(FILE));
const boot = (files = new Map(), logs = []) => {
  const env = load(files, logs);
  const app = new EventEmitter();
  const power = new EventEmitter();
  const lifecycle = env.exports.initLifecycleDiagnostics({ app, userDataPath: '/profile' });
  lifecycle.watchPower(power);
  const window = new EventEmitter();
  app.emit('browser-window-created', {}, window);
  return { ...env, app, power, window };
};

test('a first start logs that there is no marker and creates one without secrets', () => {
  const { logs, files } = boot();
  assert.match(logs[0][1], /no lifecycle marker/);
  assert.deepEqual(Object.keys(marker(files)).sort(), [
    'detail',
    'endedAt',
    'lastAliveAt',
    'pid',
    'reason',
    'startedAt',
    'v',
  ]);
});

test('records why the app ended, and the next start logs it', () => {
  const cases = [
    ['user-quit', (e) => e.app.emit('before-quit', {})],
    ['window-close', (e) => e.window.emit('close')],
    ['os-session-end', (e) => e.window.emit('session-end', {})],
    ['os-session-end', (e) => e.power.emit('shutdown')],
    [
      'renderer-crash',
      (e) => e.app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: 9 }),
    ],
  ];
  for (const [reason, trigger] of cases) {
    const first = boot();
    trigger(first);
    first.app.emit('quit', {}, 0);
    assert.equal(marker(first.files).reason, reason);
    const second = boot(first.files);
    assert.match(second.logs[0][1], new RegExp('previous run ended: ' + reason));
    assert.doesNotMatch(second.logs[0][1], /token|password|key/i);
  }
});

test('the first quit path wins, but an OS or crash cause outranks it', () => {
  const closed = boot();
  closed.window.emit('close');
  closed.app.emit('before-quit', {});
  closed.app.emit('quit', {}, 0);
  assert.equal(marker(closed.files).reason, 'window-close');

  const shutdown = boot();
  shutdown.window.emit('close');
  shutdown.window.emit('session-end', {});
  assert.equal(marker(shutdown.files).reason, 'os-session-end');

  const exit333 = boot();
  exit333.app.emit('before-quit', {});
  exit333.processEvents.emit('exit', 333);
  assert.equal(marker(exit333.files).reason, 'uncaught-exception');

  const clean = boot();
  clean.app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(marker(clean.files).reason, null);
});

test('an update restart is attributed to the updater', () => {
  const env = load();
  const app = new EventEmitter();
  const updater = new EventEmitter();
  env.exports.initLifecycleDiagnostics({ app, userDataPath: '/profile', updater });
  updater.emit('before-quit-for-update');
  app.emit('before-quit', {});
  assert.equal(marker(env.files).reason, 'updater');
});

test('without any recorded exit the next start says unknown and when it was last alive', () => {
  const files = new Map();
  const first = boot(files);
  // The process disappears: no quit, no exit, no crash event.
  assert.equal(marker(first.files).reason, null);
  const second = boot(files);
  assert.match(second.logs[0][1], /unknown \(no exit was recorded/);
  assert.match(second.logs[0][1], /last seen alive at \d{4}-\d\d-\d\dT/);
});

test('a corrupt or unwritable marker never breaks startup', () => {
  const files = new Map([[FILE, '{not json']]);
  const { logs } = boot(files);
  assert.match(logs[0][1], /no lifecycle marker/);
});
