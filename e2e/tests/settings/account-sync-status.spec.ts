import { expect, test } from '../../fixtures/test.fixture';

// Needs the isolated Ultra Tasks acceptance server (see e2e/tests/sync/ultrasync-*.spec.ts) and
// the name of a synthetic account on it that no other spec uses: E2E_ULTRA_STATUS_USER.
const ultraUrl = process.env.E2E_ULTRA_URL;
const statusUser = process.env.E2E_ULTRA_STATUS_USER;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true') {
  throw new Error('The isolated Ultra Tasks acceptance server is required.');
}

/**
 * Regression for the connected-account-looks-unconfigured bug: header, Account window and
 * search commands each read only the legacy provider state, so a signed-in account showed no
 * sync button and "Set up sync". One derived status now drives all of them.
 *
 * Deliberately independent of how far the first data connection got: a freshly linked account
 * and one that still waits for the data choice are both configured, and neither is "Set up sync".
 */
test('a connected account is one status in the header, Account and search, never "Set up sync"', async ({
  page,
  workViewPage,
}) => {
  test.skip(
    !ultraUrl || !statusUser,
    'The isolated Ultra Tasks acceptance server and E2E_ULTRA_STATUS_USER are required',
  );
  test.setTimeout(180000);

  await page.goto('/#/native-sync');
  const customServer = page.getByRole('radio', { name: 'Custom server', exact: true });
  if (await customServer.isVisible()) await customServer.check();
  await page.getByLabel('Ultra Tasks server URL').fill(ultraUrl!);
  await page.getByLabel(/^Email/).fill(statusUser!);
  await page
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await page.getByRole('button', { name: /^Sign in( and unlock)?$/ }).click();

  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();

  // Header: a button that names the state in words, whatever the icon draws.
  const syncButton = page.locator('button.sync-btn');
  await expect(syncButton).toBeVisible({ timeout: 60000 });
  await expect(syncButton).toHaveAttribute('aria-label', /\S/);
  await expect(syncButton).not.toHaveAttribute('aria-label', 'Set up sync');

  // Account window: this account, its ID to copy, and no invitation to set sync up.
  await page.goto('/#/account');
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  const summary = account.locator('account-sync-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(`${statusUser}@`);
  await expect(summary.getByText('Account ID', { exact: true })).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Copy Account ID' })).toBeVisible();
  await expect(
    summary.getByRole('button', { name: 'Open Ultra Tasks account' }),
  ).toBeVisible();
  await expect(
    account.getByRole('button', { name: 'Set up sync', exact: true }),
  ).toHaveCount(0);
  // Other options stay available, one disclosure away.
  await expect(summary.getByText('Other sync options', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();

  // Search: the account's own command (Sync now, or what its status needs, such as Finish
  // connecting), instead of "Sign in to your Ultra Tasks account".
  await page.keyboard.press('Control+F');
  const search = page.locator('search-page');
  await expect(search).toBeVisible();
  await page.keyboard.type('sync');
  await expect(
    search.getByRole('button', {
      name: /^(Sync now|Retry|Unlock|Sign in|Finish connecting)$/,
    }),
  ).toBeVisible();
  await expect(
    search.getByRole('button', { name: 'Sign in to your Ultra Tasks account' }),
  ).toHaveCount(0);
});
