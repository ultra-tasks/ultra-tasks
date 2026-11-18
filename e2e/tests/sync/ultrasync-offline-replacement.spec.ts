import { test, expect } from '../../fixtures/webdav.fixture';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import {
  WEBDAV_CONFIG_TEMPLATE,
  createSyncFolder,
  generateSyncFolderName,
  setupSyncClient,
  waitForSyncComplete,
} from '../../utils/sync-helpers';

const server = process.env.E2E_ULTRA_URL;
if (!server && process.env.E2E_REQUIRE_ULTRA === 'true')
  throw new Error('The Ultra Tasks account migration acceptance server is required.');

/** The one place that knows how the account page signs in (Email, Password, Sign in). */
const signIn = async (page: Page): Promise<void> => {
  const account = page.locator('native-sync');
  await expect(
    account.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  // The address field exists only for a custom server (or when no official server is built in).
  const custom = account.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.isVisible()) await custom.check();
  await account.getByLabel('Ultra Tasks server URL').fill(server!);
  await account.getByLabel('Email', { exact: true }).fill('offline');
  await account
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
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
  await expect(page.locator('native-sync [role=alert]')).toHaveCount(0);
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

/** Replaces the account's data with this device's; replacement asks for one more confirmation. */
const replaceAccountData = async (page: Page): Promise<void> => {
  await dataChoice(page)
    .getByRole('button', { name: 'Replace account data with this device' })
    .click();
  const confirm = page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirm
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => confirm.click())
    .catch(() => undefined);
};

/** The sync attempt did not reach the server: the account says so instead of "Up to date". */
const expectNotDelivered = (page: Page): Promise<void> =>
  expect(
    page.locator(
      'native-sync [data-status="offline"], native-sync [data-status="error"]',
    ),
  ).toBeVisible({ timeout: 30000 });

test.describe('@webdav Ultra Tasks account replacement while another device is offline', () => {
  test('preserves an offline edit as a draft and leaves the replacement readable', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.setTimeout(180000);
    test.skip(!server, 'The isolated Ultra Tasks account acceptance server is required');
    expect(webdavServerUp).toBe(true);
    const folder = generateSyncFolderName('ultra-offline-replacement');
    await createSyncFolder(request, folder);
    const stale = await setupSyncClient(browser, baseURL);
    const source = await setupSyncClient(browser, baseURL);
    const fresh = await setupSyncClient(browser, baseURL);
    const original = `Old account task ${Date.now()}`;
    const offlineEdit = `Offline draft ${Date.now()}`;
    const replacement = `Replacement task ${Date.now()}`;
    try {
      await new WorkViewPage(stale.page).addTask(original);
      await waitForStatePersistence(stale.page);
      await stale.page.goto('/#/native-sync');
      await signIn(stale.page);
      await expectConnected(stale.page);
      await stale.page.evaluate(() => {
        location.hash = '/tag/TODAY/tasks';
      });
      await new WorkViewPage(stale.page).waitForTaskList();
      await stale.context.setOffline(true);
      const task = stale.page.locator('task').filter({ hasText: original });
      await task.locator('task-title').click();
      await task.locator('textarea').fill(offlineEdit);
      await stale.page.keyboard.press('Tab');
      await waitForStatePersistence(stale.page);
      await stale.page.evaluate(() => {
        location.hash = '/native-sync';
      });
      await stale.page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expectNotDelivered(stale.page);

      const sourceSync = new SyncPage(source.page);
      await sourceSync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      await new WorkViewPage(source.page).addTask(replacement);
      await waitForStatePersistence(source.page);
      await sourceSync.triggerSync();
      await waitForSyncComplete(source.page, sourceSync);
      await sourceSync.syncBtn.click({ button: 'right' });
      const dialog = source.page.locator('dialog-sync-cfg');
      await dialog.getByRole('combobox').click();
      await source.page
        .getByRole('option', { name: 'Ultra Tasks account', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: 'Continue with Ultra Tasks account' })
        .click();
      await signIn(source.page);
      await expect(dataChoice(source.page)).toBeVisible();
      await replaceAccountData(source.page);
      await expectConnected(source.page);

      await stale.context.setOffline(false);
      await stale.page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expect(stale.page.locator('native-sync [role=alert]')).toHaveCount(0, {
        timeout: 30000,
      });
      await expect(
        stale.page.getByText(
          'An overlapping edit was preserved as a private conflict draft.',
          { exact: false },
        ),
      ).toBeVisible({ timeout: 30000 });
      const exported = stale.page.waitForEvent('download');
      await stale.page
        .getByRole('button', { name: 'Export private conflict drafts' })
        .click();
      const exportedPath = await (await exported).path();
      expect(await readFile(exportedPath, 'utf8')).toContain(offlineEdit);

      await fresh.page.goto('/#/native-sync');
      await signIn(fresh.page);
      await downloadAccountData(fresh.page);
      await expectConnected(fresh.page);
      await fresh.page.evaluate(() => {
        location.hash = '/tag/TODAY/tasks';
      });
      await new WorkViewPage(fresh.page).waitForTaskList();
      await expect(
        fresh.page.locator('task').filter({ hasText: replacement }),
      ).toBeVisible();
      await expect(
        fresh.page.locator('task').filter({ hasText: offlineEdit }),
      ).toHaveCount(0);
    } finally {
      await stale.context.close();
      await source.context.close();
      await fresh.context.close();
    }
  });
});
