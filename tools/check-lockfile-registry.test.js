const test = require('node:test');
const assert = require('node:assert/strict');
const { findRegistryViolations } = require('./check-lockfile-registry');

const name = '@ultra-tasks/example';
const url = 'https://github.com/ultra-tasks/server/releases/download/v1/example.tgz';
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;

const fixture = () => ({
  lock: {
    packages: {
      '': {},
      'packages/client': { dependencies: { [name]: url } },
      [`node_modules/${name}`]: { resolved: url, integrity },
    },
  },
  manifests: { '': {}, 'packages/client': { dependencies: { [name]: url } } },
});

test('accepts registry packages and explicitly declared, integrity-pinned tarballs', () => {
  const { lock, manifests } = fixture();
  lock.packages['node_modules/other'] = {
    resolved: 'https://registry.npmjs.org/other/-/other-1.0.0.tgz',
  };
  assert.deepEqual(findRegistryViolations(lock, manifests), []);
});

test('rejects a mirror even when its hostname resembles the npm registry', () => {
  const { lock, manifests } = fixture();
  lock.packages['node_modules/other'] = {
    resolved: 'https://registry.npmjs.org.attacker.example/other.tgz',
  };
  assert.match(findRegistryViolations(lock, manifests).join('\n'), /other/);
});

test('rejects a tarball absent from the actual manifest or under a different name', () => {
  const { lock, manifests } = fixture();
  manifests['packages/client'].dependencies[name] = '^1.0.0';
  assert.match(findRegistryViolations(lock, manifests).join('\n'), /example/);

  manifests['packages/client'].dependencies[name] = url;
  lock.packages['node_modules/impostor'] = lock.packages[`node_modules/${name}`];
  assert.match(findRegistryViolations(lock, manifests).join('\n'), /impostor/);
});

test('rejects unpinned, insecure, and modified direct tarball URLs', () => {
  for (const invalid of [
    { resolved: url },
    { resolved: url, integrity: 'sha512-invalid' },
    { resolved: url.replace('https:', 'http:'), integrity },
    { resolved: `${url}?different=1`, integrity },
  ]) {
    const { lock, manifests } = fixture();
    lock.packages[`node_modules/${name}`] = invalid;
    assert.equal(findRegistryViolations(lock, manifests).length, 1);
  }
});

test('requires the manifest and workspace lock entry to agree', () => {
  const { lock, manifests } = fixture();
  lock.packages['packages/client'].dependencies[name] = '^1.0.0';
  assert.equal(findRegistryViolations(lock, manifests).length, 1);
});

test('fails closed if an old lockfile has no package metadata', () => {
  const lock = {
    lockfileVersion: 1,
    dependencies: { other: { resolved: 'https://mirror.example/other.tgz' } },
  };
  assert.match(findRegistryViolations(lock, {}).join('\n'), /missing package metadata/);
});

test('rejects a mirror hidden in a legacy dependencies tree', () => {
  const { lock, manifests } = fixture();
  lock.dependencies = {
    other: {
      resolved: 'https://registry.npmjs.org/other/-/other-1.0.0.tgz',
      dependencies: { nested: { resolved: 'https://mirror.example/nested.tgz' } },
    },
  };
  assert.match(findRegistryViolations(lock, manifests).join('\n'), /nested/);
});

test('accepts a pinned direct tarball in both v2 lockfile sections', () => {
  const { lock, manifests } = fixture();
  lock.dependencies = { [name]: { resolved: url, integrity } };
  assert.deepEqual(findRegistryViolations(lock, manifests), []);
});
