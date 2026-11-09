import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true') {
  throw new Error('The isolated UltraSync acceptance server is required.');
}

test('keeps the provider choice and dialog fixed while a switch is saving', async ({
  page,
  workViewPage,
}) => {
  test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
  test.setTimeout(180000);

  await page.goto('/#/native-sync');
  const customServer = page.getByRole('radio', { name: 'Custom server', exact: true });
  if (await customServer.isVisible()) await customServer.check();
  await page.getByLabel('Ultra Tasks server URL').fill(ultraUrl!);
  await page.getByLabel('Email or username').fill('empty');
  await page
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await page.getByRole('button', { name: 'Sign in and unlock' }).click();

  const syncNow = page.getByRole('button', { name: 'Sync now', exact: true });
  await expect(syncNow).toBeVisible({ timeout: 60000 });
  const useAccount = page.getByRole('button', {
    name: 'Use the account’s existing data',
  });
  await expect(useAccount.or(syncNow.and(page.locator('button:enabled')))).toBeVisible({
    timeout: 60000,
  });
  if (await useAccount.isVisible()) await useAccount.click();
  await expect(syncNow).toBeEnabled({ timeout: 60000 });

  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  const title = `Switch in flight ${Date.now()}`;
  await workViewPage.addTask(title);
  await waitForStatePersistence(page);
  await page.goto('/#/native-sync');
  await expect(syncNow).toBeEnabled({ timeout: 60000 });
  await page.goto('/#/tag/TODAY/tasks');

  await page.locator('button.sync-btn').first().click({ button: 'right' });
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
