const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, 'account-login-store.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const setup = ({
  available = true,
  platform = 'win32',
  backend = 'gnome_libsecret',
} = {}) => {
  let handler;
  const files = new Map();
  const protectedValues = [];
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    process: { platform },
    Buffer,
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
            decryptString: (value) => value.toString().slice('protected:'.length),
          },
        };
      if (name === 'node:fs') return { rmSync: (file) => files.delete(file) };
      if (name === './secure-file')
        return {
          writeSecretFile: (file, value) => files.set(file, value),
          readSecretFile: (file) => files.get(file),
        };
      if (name === './shared-with-frontend/ipc-events.const')
        return { IPC: { ACCOUNT_LOGIN_STORE: 'ACCOUNT_LOGIN_STORE' } };
      return require(name);
    },
  });
  exports.initAccountLoginStore();
  const mainFrame = {};
  const event = { senderFrame: mainFrame, sender: { mainFrame } };
  return {
    call: (method, value) => handler(event, method, value),
    untrusted: (method) => handler({ ...event, senderFrame: {} }, method),
    files,
    protectedValues,
  };
};
test('pending proof round trips through OS encryption and is removed on clear', () => {
  const h = setup();
  const value = JSON.stringify({
    request: { expiresAt: Date.now() + 120000 },
    verifier: 'device-secret',
  });
  h.call('save', value);
  assert.equal(h.protectedValues[0], value);
  assert.notEqual([...h.files.values()][0], value);
  assert.equal(h.call('load'), value);
  h.call('clear');
  assert.equal(h.call('load'), null);
});
test('unavailable OS protection and Linux plaintext backend fail closed', () => {
  const value = JSON.stringify({ request: { expiresAt: Date.now() + 120000 } });
  for (const options of [
    { available: false },
    { platform: 'linux', backend: 'basic_text' },
  ]) {
    const h = setup(options);
    assert.equal(h.call('load'), null);
    assert.throws(() => h.call('save', value), /unavailable/);
    assert.equal(h.files.size, 0);
  }
});
test('rejects untrusted frame, expired requests, unbounded payload and expiry', () => {
  const h = setup();
  assert.throws(() => h.untrusted('load'), /Untrusted/);
  for (const expiresAt of [Date.now() - 1, Date.now() + 600000])
    assert.throws(
      () => h.call('save', JSON.stringify({ request: { expiresAt } })),
      /Expired/,
    );
  assert.throws(() => h.call('save', 'x'.repeat(16385)), /Invalid/);
});
