#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { existsSync, writeFileSync, mkdirSync } = require('node:fs');
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
  realtime: 'test:native',
  recovery: 'test:native',
  load: 'test:realtime:load',
  crypto: 'test:crypto',
  parity: 'test:parity',
};
if (!scripts[command]) throw new Error('Unknown server command: ' + command);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this command through its npm script');
const run = (args) => {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd: directory,
    stdio: 'inherit',
    env: {
      ...process.env,
      ULTRA_CLIENT_DIST: resolve(__dirname, '../.tmp/angular-dist/browser'),
      ULTRA_CLIENT_SOURCE: resolve(__dirname, '..'),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const marker = resolve(directory, '.tmp/client-tooling-' + revision);
if (process.env.ULTRA_SERVER_SOURCE || !existsSync(marker)) {
  run(['ci', '--ignore-scripts']);
  run(['run', 'db:generate']);
  run(['run', 'build']);
  mkdirSync(resolve(directory, '.tmp'), { recursive: true });
  writeFileSync(marker, revision);
}
run(['run', scripts[command], '--', ...process.argv.slice(3)]);
