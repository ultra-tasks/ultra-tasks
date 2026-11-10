const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, win32 } = require('node:path');
const { tmpdir } = require('node:os');

require('ts-node/register/transpile-only');
const originalLoad = Module._load;
const dir = mkdtempSync(join(tmpdir(), 'ultra-store-identity-'));
Module._load = function (request, parent, isMain) {
  return request === 'electron'
    ? { app: { getAppPath: () => dir } }
    : originalLoad.call(this, request, parent, isMain);
};
const {
  getWindowsStoreIdentity,
  getWindowsStoreUserDataDir,
} = require('./windows-store-identity.ts');
Module._load = originalLoad;
const identity = {
  packageFamilyName: '12345.UltraTasks_abcde12345678',
  applicationId: 'UltraTasks',
};
test.after(() => {
  delete process.windowsStore;
  rmSync(dir, { recursive: true, force: true });
});

test('only Store processes use the identity embedded in the packaged app', () => {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ultraTasksWindowsStore: identity }),
  );
  delete process.windowsStore;
  assert.equal(getWindowsStoreIdentity(), undefined);
  process.windowsStore = true;
  assert.deepEqual(getWindowsStoreIdentity(), identity);
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.equal(getWindowsStoreIdentity(), undefined);
  delete process.windowsStore;
});

test('virtualized paths use the current package, including usernames containing Roaming', () => {
  const roaming = 'C:\\Users\\RoamingUser\\AppData\\Roaming';
  assert.equal(
    getWindowsStoreUserDataDir(
      win32.join(roaming, 'ultra-tasks'),
      roaming,
      identity.packageFamilyName,
    ),
    win32.join(
      'C:\\Users\\RoamingUser\\AppData\\Local\\Packages',
      identity.packageFamilyName,
      'LocalCache\\Roaming\\ultra-tasks',
    ),
  );
});

test('custom profiles outside Roaming do not get redirected into the Store package', () => {
  for (const custom of [
    'D:\\Profiles\\Ultra',
    'C:\\Users\\test\\AppData\\Roaming-other\\Ultra',
  ]) {
    assert.equal(
      getWindowsStoreUserDataDir(
        custom,
        'C:\\Users\\test\\AppData\\Roaming',
        identity.packageFamilyName,
      ),
      undefined,
    );
  }
});
