#!/usr/bin/env node
// Fetch test tooling from its owning repository; never ship it in the client tree.
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const pin = JSON.parse(
  readFileSync(resolve(__dirname, 'sync-server-source.json'), 'utf8'),
);
if (!/^[a-f0-9]{40}$/.test(pin.revision))
  throw new Error('Invalid server source revision');
const directory = resolve(
  process.env.ULTRA_SERVER_SOURCE || resolve(root, '.tmp/sync-server'),
);
const git = (...args) =>
  execFileSync('git', ['-c', 'credential.helper=', ...args], {
    cwd: directory,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
if (process.env.ULTRA_SERVER_SOURCE) {
  if (!existsSync(resolve(directory, 'apps/server/package.json')))
    throw new Error('ULTRA_SERVER_SOURCE must contain the standalone server repository');
} else {
  mkdirSync(directory, { recursive: true });
  if (!existsSync(resolve(directory, '.git'))) {
    git('init', '--quiet');
    git('remote', 'add', 'origin', pin.repository);
  }
  if (git('remote', 'get-url', 'origin') !== pin.repository)
    throw new Error('The cached server checkout has an unexpected origin');
  let revision;
  try {
    revision = git('rev-parse', 'HEAD');
  } catch {
    /* Fresh checkout. */
  }
  if (revision !== pin.revision) {
    if (git('status', '--porcelain'))
      throw new Error(
        'The cached server has local edits; use ULTRA_SERVER_SOURCE for development',
      );
    git('fetch', '--quiet', '--depth=1', 'origin', pin.revision);
    git(
      '-c',
      'advice.detachedHead=false',
      'checkout',
      '--quiet',
      '--detach',
      pin.revision,
    );
  }
}
if (require.main === module) console.log('Server test source: ' + directory);
module.exports = { directory, revision: pin.revision };
