'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { load } = require('js-yaml');
const { Arch } = require('builder-util');
const {
  getConfig,
  validateConfiguration,
} = require('app-builder-lib/out/util/config/config');
const AppxTarget = require('app-builder-lib/out/targets/AppxTarget').default;
const { getWindowsStoreConfig } = require('./windows-store-config');

const root = join(__dirname, '..');
const env = {
  WINDOWS_STORE_IDENTITY_NAME: '12345.UltraTasks',
  WINDOWS_STORE_PUBLISHER: 'CN=12345678-1234-1234-1234-123456789abc',
  WINDOWS_STORE_PUBLISHER_DISPLAY_NAME: 'Example & Developer',
  WINDOWS_STORE_PACKAGE_FAMILY_NAME: '12345.UltraTasks_abcde12345678',
};

test('missing Store configuration fails with actionable Partner Center fields', () => {
  assert.throws(
    () => getWindowsStoreConfig({}, '0.3.0'),
    /Missing Partner Center identity values: WINDOWS_STORE_IDENTITY_NAME/,
  );
  assert.throws(
    () =>
      getWindowsStoreConfig(
        { ...env, WINDOWS_STORE_PACKAGE_FAMILY_NAME: 'OtherApp_abcde12345678' },
        '0.3.0',
      ),
    /Package Family Name/,
  );
  assert.throws(
    () => getWindowsStoreConfig(env, '0.3.0-beta.1'),
    /numeric major.minor.patch/,
  );
  assert.throws(() => getWindowsStoreConfig(env, '0.3.65536'), /at most 65535/);
});

test('Store configuration passes the installed builder schema without changing direct targets', async () => {
  const before = readFileSync(join(root, 'electron-builder.yaml'), 'utf8');
  const previousEnv = { ...process.env };
  Object.assign(process.env, env);
  let config;
  try {
    config = await getConfig(root, 'build/electron-builder.appx.cjs');
  } finally {
    for (const key of Object.keys(env)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  await validateConfiguration(config, { isEnabled: false });
  assert.deepEqual(config.win.target, [{ target: 'appx', arch: ['x64', 'arm64'] }]);
  assert.equal(config.directories.output, '.tmp/store-builds');
  assert.equal(config.win.publish, null);
  assert.equal(config.publish, null);
  assert.equal(
    config.extraMetadata.ultraTasksWindowsStore.packageFamilyName,
    env.WINDOWS_STORE_PACKAGE_FAMILY_NAME,
  );
  assert.equal(config.win.signExecutable, false);
  const direct = await getConfig(root, 'electron-builder.desktop.yaml', {});
  assert.deepEqual(
    direct.win.target.map((target) => target.target),
    ['nsis', 'portable'],
  );
  assert.equal(direct.extraMetadata?.ultraTasksWindowsStore, undefined);
  assert.equal(readFileSync(join(root, 'electron-builder.yaml'), 'utf8'), before);
});

test('real AppX manifest generation includes our identity, protocol and desktop capability for both architectures', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ultra-store-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = getWindowsStoreConfig(env, '0.3.0');
  const target = Object.create(AppxTarget.prototype);
  target.options = config.appx;
  target.packager = {
    config,
    platformSpecificBuildOptions: config.win,
    appInfo: {
      productFilename: 'Ultra Tasks',
      productName: 'Ultra Tasks',
      description: 'Tasks & time',
      getVersionInWeirdWindowsForm: () => '0.3.0.0',
    },
    getResource: async () => null,
    info: { metadata: { dependencies: {} } },
  };
  for (const arch of [Arch.x64, Arch.arm64]) {
    const output = join(dir, `${arch}.xml`);
    await target.writeManifest(output, arch, config.appx.publisher, []);
    const xml = readFileSync(output, 'utf8');
    assert.match(xml, /Name="12345.UltraTasks"/);
    assert.match(xml, /Publisher="CN=12345678-1234-1234-1234-123456789abc"/);
    assert.match(xml, /Example &amp; Developer/);
    assert.match(xml, /Version="0.3.0.0"/);
    assert.match(xml, /ProcessorArchitecture="(?:x64|arm64)"/);
    assert.match(xml, /EntryPoint="Windows.FullTrustApplication"/);
    assert.match(xml, /Capability Name="runFullTrust"/);
    assert.match(xml, /Protocol Name="ultratasks"/);
    assert.doesNotMatch(xml, /windows.startupTask|superproductivity/i);
  }
});
