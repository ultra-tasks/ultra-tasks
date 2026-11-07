const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('client builds include declared public settings and exclude backend operator secrets', () => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, '.tmp/client-env-test-'));
  try {
    fs.writeFileSync(
      path.join(directory, '.env'),
      'UNSPLASH_KEY=public-example\nULTRA_AUTH_SECRET=private-operator-secret\nSMTP_PASS=private-mail-secret\nDATABASE_URL=private-database-address\n',
    );
    const result = spawnSync(process.execPath, [path.join(__dirname, 'load-env.js')], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const source = fs.readFileSync(
      path.join(directory, 'src/app/config/env.generated.ts'),
      'utf8',
    );
    assert.match(source, /public-example/);
    assert.doesNotMatch(source, /private-|ULTRA_AUTH_SECRET|SMTP_PASS|DATABASE_URL/);
  } finally {
    assert.equal(path.dirname(directory), path.join(root, '.tmp'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
