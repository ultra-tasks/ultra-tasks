const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'account-session-store.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const UUID = '3e2edea8-ff50-4f20-87f6-a8f0465f9945';
const KEY = 'A'.repeat(43);
const session = (patch = {}) =>
  JSON.stringify({
    v: 1,
    serverUrl: 'http://localhost:1900',
    accountId: UUID,
    serverId: UUID,
    masterKey: KEY,
    refreshToken: 'B'.repeat(43),
    ...patch,
  });

const setup = ({
  available = true,
  platform = 'win32',
  backend = 'gnome_libsecret',
  decryptFails = false,
} = {}) => {
  let handler;
  const files = new Map();
  const protectedValues = [];
  const warnings = [];
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    process: { platform },
    Buffer,
    URL,
    require: (name) => {
      if (name === 'electron')
        return {
          app: { getPath: () => '/isolated-test-profile' },
          ipcMain: {
            handle: (_channel, callback) => {
              handler = callback;
            },
          },
          safeStorage: {
            isEncryptionAvailable: () => available,
            getSelectedStorageBackend: () => backend,
            encryptString: (value) => {
              protectedValues.push(value);
              return Buffer.from('protected:' + value);
            },
            decryptString: (value) => {
              if (decryptFails) throw new Error('keychain locked');
              return value.toString().slice('protected:'.length);
            },
          },
        };
      if (name === 'electron-log/main') return { warn: (message) => warnings.push(message) };
      if (name === 'node:fs') return { rmSync: (file) => files.delete(file) };
      if (name === './secure-file')
        return {
          writeSecretFile: (file, value) => files.set(file, value),
          readSecretFile: (file) => files.get(file),
        };
      if (name === './shared-with-frontend/ipc-events.const')
        return { IPC: { ACCOUNT_SESSION_STORE: 'ACCOUNT_SESSION_STORE' } };
      return require(name);
    },
  });
  exports.initAccountSessionStore();
  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  return {
    call: (method, value) => handler(event, method, value),
    untrusted: (method) => handler({ ...event, senderFrame: {} }, method),
    files,
    protectedValues,
    warnings,
  };
};

test('the unlocked session round trips through OS encryption and is removed on clear', () => {
  const h = setup();
  const value = session();
  assert.equal(h.call('load'), null);
  h.call('save', value);
  assert.equal(h.protectedValues[0], value);
  assert.notEqual([...h.files.values()][0], value);
  assert.equal(h.call('load'), value);
  // A rotation rewrites the same single file.
  const rotated = session({ refreshToken: 'C'.repeat(43) });
  h.call('save', rotated);
  assert.equal(h.files.size, 1);
  assert.equal(h.call('load'), rotated);
  h.call('clear');
  assert.equal(h.call('load'), null);
});

test('never stores anything outside the expected shape', () => {
  const h = setup();
  h.call('save', session());
  for (const bad of [
    session({ v: 2 }),
    session({ serverUrl: 'http://remote.example.test' }),
    session({ serverUrl: 'https://user:pw@account.example.test' }),
    session({ accountId: 'not-a-uuid' }),
    session({ masterKey: 'short' }),
    session({ refreshToken: 'x'.repeat(31) }),
    session({ refreshToken: 'x'.repeat(129) }),
    session({ refreshToken: 'x'.repeat(47) + '!' }),
    session({ refreshToken: 'x'.repeat(47) + ' ' }),
    session({ refreshToken: 7 }),
    JSON.stringify({ password: 'must never be here' }),
    'not json',
  ])
    assert.throws(() => h.call('save', bad), /Invalid/);
  assert.equal(h.protectedValues.length, 1);
});

test('remembers the server credentials of every format the server has issued', () => {
  // The refresh token is opaque to the app: the legacy 43-character form and the
  // self-identifying 48-character form must both be remembered, or a server update would
  // silently turn persistent sign-in off.
  for (const refreshToken of ['L'.repeat(43), 'V'.repeat(48), 'a-_Z9'.repeat(10)]) {
    const h = setup();
    const value = session({ refreshToken });
    h.call('save', value);
    assert.equal(h.call('load'), value);
  }
});

test('unavailable OS protection and a Linux plaintext backend fail closed and say so', () => {
  for (const options of [
    { available: false },
    { platform: 'linux', backend: 'basic_text' },
  ]) {
    const h = setup(options);
    // Nothing stored yet: nothing to report.
    assert.equal(h.call('load'), null);
    assert.throws(() => h.call('save', session()), /unavailable/);
    assert.equal(h.files.size, 0);
  }
});

test('a stored session that cannot be read is reported as unavailable, never as absent', () => {
  const locked = setup({ decryptFails: true });
  // Put an encrypted file in place through a working store, then read it through a locked one.
  const first = setup();
  first.call('save', session());
  const [file, encrypted] = [...first.files.entries()][0];
  locked.files.set(file, encrypted);
  assert.throws(() => locked.call('load'), /unavailable/);
  assert.ok(locked.files.has(file), 'the file is left untouched');

  const unavailable = setup({ available: false });
  unavailable.files.set(file, encrypted);
  assert.throws(() => unavailable.call('load'), /unavailable/);
  assert.ok(unavailable.files.has(file));
});

test('a decryptable value with an unexpected shape is ignored, not returned', () => {
  const h = setup();
  h.call('save', session());
  const [file] = [...h.files.keys()];
  h.files.set(file, Buffer.from('protected:{"hello":1}').toString('base64'));
  assert.equal(h.call('load'), null);
  assert.equal(h.warnings.length, 1);
});

test('rejects untrusted frames, oversized and unknown requests', () => {
  const h = setup();
  assert.throws(() => h.untrusted('load'), /Untrusted/);
  assert.throws(() => h.untrusted('save'), /Untrusted/);
  assert.throws(() => h.call('save', session({ serverId: 'x'.repeat(5000) })), /Invalid/);
  assert.throws(() => h.call('rotate', session()), /Invalid/);
  assert.throws(() => h.call('save'), /Invalid/);
});

const SERVER = '3e2edea8-ff50-4f20-87f6-a8f0465f9946';
const OTHER_SERVER = '9b1c3f5e-6a2d-4c81-8e07-5d2f9a4b7c10';
const hex = (digit) => digit.repeat(64);
const TOKEN = 'T'.repeat(43);
const device = (patch = {}) =>
  JSON.stringify({ serverId: SERVER, keys: [hex('a')], ...patch });
const deviceFile = (h) =>
  [...h.files.entries()].find(([name]) => /account-devices/.test(name));

test('a device trust marker round trips under every name of the account, encrypted at rest', () => {
  const h = setup();
  assert.equal(h.call('device-load', device()), null);
  h.call('device-save', device({ keys: [hex('a'), hex('b')], token: TOKEN }));
  // The email and any other name the account signed in with find the same marker.
  assert.equal(h.call('device-load', device({ keys: [hex('a')] })), TOKEN);
  assert.equal(h.call('device-load', device({ keys: [hex('c'), hex('b')] })), TOKEN);
  // Another account, or the same names on another server, are not recognised.
  assert.equal(h.call('device-load', device({ keys: [hex('d')] })), null);
  assert.equal(h.call('device-load', device({ serverId: OTHER_SERVER })), null);
  assert.ok(deviceFile(h), 'its own file, separate from the session');
  assert.ok(!deviceFile(h)[1].includes(TOKEN), 'nothing readable is written');
  assert.equal(
    h.protectedValues.some((value) => value.includes(TOKEN)),
    true,
    'the marker only ever reaches disk through the OS encryption',
  );
});

test('signing out keeps the marker; only forgetting the account removes it', () => {
  const h = setup();
  h.call('save', session());
  h.call('device-save', device({ keys: [hex('a'), hex('b')], token: TOKEN }));
  h.call('device-save', device({ keys: [hex('e')], token: 'U'.repeat(43) }));
  // Explicit lock, sign-out and revocation clear the session and nothing else.
  h.call('clear');
  assert.equal(h.call('load'), null);
  assert.equal(h.call('device-load', device()), TOKEN);
  // Deleting the account forgets every name it is known by, never another account's marker.
  h.call('device-forget', device({ keys: [hex('a'), hex('b')] }));
  assert.equal(h.call('device-load', device({ keys: [hex('a')] })), null);
  assert.equal(h.call('device-load', device({ keys: [hex('b')] })), null);
  assert.equal(h.call('device-load', device({ keys: [hex('e')] })), 'U'.repeat(43));
  h.call('device-forget', device({ keys: [hex('e')] }));
  assert.equal(deviceFile(h), undefined, 'the file goes away with its last marker');
});

test('a newer marker replaces the old one and the oldest are dropped past the bound', () => {
  const h = setup();
  h.call('device-save', device({ token: 'A'.repeat(43) }));
  h.call('device-save', device({ token: 'B'.repeat(43) }));
  assert.equal(h.call('device-load', device()), 'B'.repeat(43));
  const key = (i) => String(i % 10).repeat(32) + String(i).padStart(32, '0');
  for (let i = 0; i < 70; i++) h.call('device-save', device({ keys: [key(i)], token: TOKEN }));
  const stored = JSON.parse(
    Buffer.from(deviceFile(h)[1], 'base64').toString().slice('protected:'.length),
  );
  assert.equal(stored.entries.length, 64);
  // The very first account was the oldest: it is gone, the latest one is kept.
  assert.equal(h.call('device-load', device()), null);
  assert.equal(h.call('device-load', device({ keys: [key(69)] })), TOKEN);
});

test('device trust fails closed when OS protection is unavailable and never overwrites what it cannot read', () => {
  for (const options of [{ available: false }, { platform: 'linux', backend: 'basic_text' }]) {
    const h = setup(options);
    assert.equal(h.call('device-load', device()), null);
    assert.throws(() => h.call('device-save', device({ token: TOKEN })), /unavailable/);
    assert.equal(h.files.size, 0);
  }
  const first = setup();
  first.call('device-save', device({ token: TOKEN }));
  const [file, encrypted] = deviceFile(first);
  const locked = setup({ decryptFails: true });
  locked.files.set(file, encrypted);
  assert.throws(() => locked.call('device-load', device()), /unavailable/);
  assert.throws(
    () => locked.call('device-save', device({ token: 'N'.repeat(43) })),
    /unavailable/,
  );
  assert.equal(locked.files.get(file), encrypted, 'the unreadable file is left untouched');
});

test('rejects malformed device requests and untrusted frames', () => {
  const h = setup();
  for (const [method, request] of [
    ['device-load', device({ serverId: 'not-a-uuid' })],
    ['device-load', device({ keys: [] })],
    ['device-load', device({ keys: ['short'] })],
    ['device-load', device({ keys: [hex('a').toUpperCase()] })],
    ['device-load', device({ keys: [hex('a'), hex('b'), hex('c'), hex('d'), hex('e')] })],
    ['device-load', device({ token: TOKEN })],
    ['device-save', device()],
    ['device-save', device({ token: 'short' })],
    ['device-save', device({ token: 'x'.repeat(44) })],
    ['device-save', device({ token: TOKEN, keys: ['k'.repeat(2000)] })],
    ['device-forget', 'not json'],
    ['device-forget', undefined],
  ])
    assert.throws(() => h.call(method, request), /Invalid/, method);
  assert.throws(() => h.untrusted('device-load'), /Untrusted/);
  assert.throws(() => h.untrusted('device-save'), /Untrusted/);
  assert.throws(() => h.untrusted('device-forget'), /Untrusted/);
});
