'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { getReleaseInfo } = require('./release-version');

test('recognizes stable fork tags despite the hyphens in the product name', () => {
  assert.deepEqual(getReleaseInfo('ultra-tasks-v0.1.0'), {
    version: '0.1.0',
    stable: true,
    prerelease: false,
  });
});

test('recognizes alpha, beta and lowercase rc releases', () => {
  for (const suffix of ['alpha.1', 'beta.1', 'rc.1']) {
    const version = `0.1.0-${suffix}`;
    assert.deepEqual(getReleaseInfo(`ultra-tasks-v${version}`), {
      version,
      stable: false,
      prerelease: true,
    });
  }
});

test('ignores upstream tags, branches and unrelated tags', () => {
  for (const ref of [
    'v19.1.0',
    'v1.0.0',
    'master',
    'super-tasks-v0.1.0',
    'ultra-tasks-version',
  ]) {
    assert.equal(getReleaseInfo(ref), null);
  }
});

test('emits workflow outputs and rejects a mismatched release version', () => {
  const version = require('../package.json').version;
  const output = execFileSync(process.execPath, [require.resolve('./release-version')], {
    env: { ...process.env, GITHUB_REF_NAME: `ultra-tasks-v${version}` },
    encoding: 'utf8',
  });
  const info = getReleaseInfo(`ultra-tasks-v${version}`);
  assert.equal(output, `stable=${info.stable}\nprerelease=${info.prerelease}\n`);
  const result = spawnSync(process.execPath, [require.resolve('./release-version')], {
    env: { ...process.env, GITHUB_REF_NAME: 'ultra-tasks-v999.0.0' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag must match/);
});

test('release tools select fork tags from a real mixed git history', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ultra-tasks-version-'));
  // Git hooks export repository-local variables; keep fixture commands isolated.
  const fixtureEnv = { ...process.env, GITHUB_OUTPUT: '' };
  for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], {
    encoding: 'utf8',
  }).split('\n')) {
    delete fixtureEnv[name];
  }
  t.after(() => {
    assert.equal(path.dirname(fixture), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('ultra-tasks-version-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync('git', args, { cwd: fixture, stdio: 'pipe', env: fixtureEnv });
  const commit = () =>
    git(
      '-c',
      'user.name=Version Test',
      '-c',
      'user.email=version-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
  git('init');
  commit();
  git('tag', 'v19.1.0');
  git('tag', 'ultra-tasks-v0.1.0');
  commit();
  git('tag', 'ultra-tasks-v0.2.0-beta.1');
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"version":"0.1.0"}');
  const run = (script) =>
    execFileSync(process.execPath, [require.resolve(script)], {
      cwd: fixture,
      encoding: 'utf8',
      env: fixtureEnv,
    });
  assert.equal(run('./ios-testflight-version'), '0.1.1\n');
  assert.match(run('./android-dev-version-code'), /code=1009001\n/);
  const base = execFileSync(
    process.execPath,
    [
      '-e',
      `console.log(require(${JSON.stringify(require.resolve('./release-notes'))}).__test.getLatestTag({version:'0.2.0',stableOnly:true}))`,
    ],
    { cwd: fixture, encoding: 'utf8', env: fixtureEnv },
  );
  assert.equal(base, 'ultra-tasks-v0.1.0\n');
});
