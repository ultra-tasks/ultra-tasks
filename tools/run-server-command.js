#!/usr/bin/env node
const { execFileSync, spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const { directory, revision } = require('./prepare-sync-server');
const command = process.argv[2];
const scripts = {
  accounts: 'test:native',
  build: 'build',
  regression: 'test:server',
  'accounts:browser': 'test:accounts:browser',
  sync: 'test:native',
  'sync:browser': 'test:client:browser',
  'private:browser': 'test:private:browser',
  'provider:harness': 'test:provider-migration:harness',
  'accounts:harness': 'test:provider-migration:harness',
  'login:browser': 'test:browser-login:browser',
  realtime: 'test:native',
  recovery: 'test:native',
  load: 'test:realtime:load',
  crypto: 'test:crypto',
  parity: 'test:parity',
};
if (!scripts[command]) throw new Error('Unknown server command: ' + command);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this command through its npm script');
const run = (args, extraEnv = {}) => {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd: directory,
    stdio: 'inherit',
    env: {
      ...process.env,
      ULTRA_CLIENT_DIST: resolve(__dirname, '../.tmp/angular-dist/browser'),
      ULTRA_CLIENT_SOURCE: resolve(__dirname, '..'),
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

function runAccountsHarness() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: directory,
    encoding: 'utf8',
  }).trim();
  if (head !== revision)
    throw new Error('The account fixture requires the pinned server source');

  // Overlay one fixture in Vitest, leaving the server checkout and normal harness untouched.
  const staging = mkdtempSync(resolve(tmpdir(), 'ultra-native-accounts-'));
  const fixture = resolve(staging, 'provider-migration.harness.ts');
  const patch = resolve(__dirname, 'native-account-test-fixtures.patch');
  const apply = (...args) =>
    spawnSync('git', ['apply', ...args, '--', patch], { cwd: staging, encoding: 'utf8' });

  try {
    writeFileSync(
      fixture,
      readFileSync(
        resolve(directory, 'apps/server/tests/provider-migration.harness.ts'),
        'utf8',
      ).replaceAll('\r\n', '\n'),
    );
    const forward = apply('--check');
    if (forward.error) throw forward.error;
    if (forward.status === 0) {
      const applied = apply();
      if (applied.status !== 0) throw applied.error ?? new Error(applied.stderr);
    } else {
      const reverse = apply('--check', '--reverse');
      if (reverse.status !== 0) {
        throw (
          reverse.error ??
          new Error('The account fixture overlay no longer matches the pinned source')
        );
      }
    }

    return run(
      [
        'exec',
        '-w',
        '@ultra-tasks/server',
        '--',
        'vitest',
        'run',
        '--config',
        resolve(__dirname, 'native-account-test-fixtures.config.mjs'),
        ...process.argv.slice(3),
      ],
      {
        ULTRA_ACCOUNTS_HARNESS_OVERLAY: fixture,
        ...(process.env.ULTRA_CLIENT_DIST
          ? { ULTRA_CLIENT_DIST: process.env.ULTRA_CLIENT_DIST }
          : {}),
      },
    );
  } finally {
    if (existsSync(fixture)) unlinkSync(fixture);
    rmdirSync(staging);
  }
}

const marker = resolve(directory, '.tmp/client-tooling-' + revision);
if (process.env.ULTRA_SERVER_SOURCE || !existsSync(marker)) {
  for (const step of [
    ['ci', '--ignore-scripts'],
    ['run', 'db:generate'],
    ['run', 'build'],
  ]) {
    const status = run(step);
    if (status !== 0) process.exit(status);
  }
  mkdirSync(resolve(directory, '.tmp'), { recursive: true });
  writeFileSync(marker, revision);
}
process.exitCode =
  command === 'accounts:harness'
    ? runAccountsHarness()
    : run(['run', scripts[command], '--', ...process.argv.slice(3)]);
