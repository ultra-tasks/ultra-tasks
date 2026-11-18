import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import { waitForStatePersistence } from '../../utils/waits';
import { openSyncSetup } from '../../utils/open-sync-setup';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true') {
  throw new Error('The isolated Ultra Tasks account acceptance server is required.');
}

/** The one place that knows how the account page signs in (Email, Password, Sign in). */
const signIn = async (page: Page, email: string): Promise<void> => {
  const account = page.locator('native-sync');
  await expect(
    account.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  // The address field exists only for a custom server (or when no official server is built in).
  const custom = account.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.isVisible()) await custom.check();
  await account.getByLabel('Ultra Tasks server URL').fill(ultraUrl!);
  await account.getByLabel('Email', { exact: true }).fill(email);
  await account
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
};

/** The focused dialog that asks which data to keep, when both sides hold real data. */
const dataChoice = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: 'Download account data' });

/** Chooses the account's data when asked. An empty device downloads it without asking. */
const downloadAccountData = async (page: Page): Promise<void> => {
  const choice = dataChoice(page).getByRole('button', { name: 'Download account data' });
  await choice
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => choice.click())
    .catch(() => undefined);
};

/**
 * The first connection is finished when the app lands on the task list, or the account page
 * says the account is up to date. A pending data choice or a failure is neither.
 */
const expectConnected = async (page: Page): Promise<void> => {
  const upToDate = page.locator(
    'native-sync [data-status="up-to-date"], native-sync [data-status="up-to-date-empty"]',
  );
  await expect
    .poll(
      async () =>
        !page.url().includes('native-sync') || (await upToDate.first().isVisible()),
      { timeout: 60000 },
    )
    .toBe(true);
};

test('keeps the provider choice and dialog fixed while a switch is saving', async ({
  page,
  workViewPage,
}) => {
  test.skip(!ultraUrl, 'The isolated Ultra Tasks account acceptance server is required');
  test.setTimeout(180000);

  await page.goto('/#/native-sync');
  await signIn(page, 'empty');
  // A device with no tasks of its own downloads the account's data without asking.
  await downloadAccountData(page);
  await expectConnected(page);

  const syncNow = page.getByRole('button', { name: 'Sync now', exact: true });
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  const title = `Switch in flight ${Date.now()}`;
  await workViewPage.addTask(title);
  await waitForStatePersistence(page);
  await page.goto('/#/native-sync');
  await expect(syncNow).toBeEnabled({ timeout: 60000 });
  await page.goto('/#/tag/TODAY/tasks');

  await openSyncSetup(page);
  const dialog = page.locator('dialog-sync-cfg');
  const picker = dialog.getByRole('combobox');
  await picker.click();
  await page.getByRole('option', { name: 'WebDAV — personal sync only' }).click();
  await dialog.locator('.e2e-baseUrl input').fill('https://webdav.example.invalid');
  await dialog.locator('.e2e-userName input').fill('synthetic-user');
  await dialog.locator('.e2e-password input').fill('synthetic-password');
  await dialog.locator('.e2e-syncFolderPath input').fill('synthetic-folder');
  await page.route('https://webdav.example.invalid/**', (route) => route.abort());

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const accountRequest = new Promise<void>((resolve) => (reached = resolve));
  let intercepted = false;
  await page.route(/\/api\/v2\/accounts\/sync\/scopes(?:\?.*)?$/, async (route) => {
    if (!intercepted) {
      intercepted = true;
      reached();
      await held;
    }
    await route.continue();
  });

  try {
    const save = dialog.getByRole('button', { name: 'Save & Enable Sync' });
    await save.click();
    // The nested encryption dialog remains usable while the parent is busy.
    await page.locator('.e2e-setup-encrypt-skip').click();
    await accountRequest;

    await expect(picker).toBeDisabled({ timeout: 2000 });
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText('Saving sync settings...');
    await expect(dialog.locator('form')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const backdrops = page.locator('.cdk-overlay-backdrop');
    await expect(backdrops).toHaveCount(1);
    await backdrops.first().click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();

    release();
    await expect(dialog).toBeHidden({ timeout: 60000 });
    await expect(page.locator('task').filter({ hasText: title })).toBeVisible();
    await page.locator('button.sync-btn').first().click({ button: 'right' });
    await expect(dialog.getByRole('combobox')).toContainText('WebDAV');
  } finally {
    release();
  }
});
