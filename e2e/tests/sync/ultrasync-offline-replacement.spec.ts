import { test, expect } from '../../fixtures/webdav.fixture';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
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
  throw new Error('The UltraSync migration acceptance server is required.');

const signIn = async (page: Page): Promise<void> => {
  const custom = page.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.isVisible()) await custom.check();
  await page.getByLabel('Ultra Tasks server URL').fill(server!);
  await page.getByLabel('Email or username').fill('offline');
  await page
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await page.getByRole('button', { name: 'Sign in and unlock' }).click();
};

test.describe('@webdav UltraSync replacement while another device is offline', () => {
  test('preserves an offline edit as a draft and leaves the replacement readable', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.setTimeout(180000);
    test.skip(!server, 'The isolated UltraSync acceptance server is required');
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
      await expect(
        stale.page.getByRole('button', { name: 'Sync now', exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(stale.page.getByText('Sync complete.', { exact: true })).toBeVisible();
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
      await expect(stale.page.locator('native-sync [role=alert]')).toBeVisible({
        timeout: 30000,
      });

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
      await source.page.getByRole('option', { name: 'UltraSync', exact: true }).click();
      await dialog.getByRole('button', { name: 'Continue with UltraSync' }).click();
      await signIn(source.page);
      await source.page
        .getByRole('button', { name: 'Import this device’s data' })
        .click();
      await expect(
        source.page.getByRole('button', { name: 'Sync now', exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(source.page.locator('native-sync [role=alert]')).toHaveCount(0);

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
      await fresh.page
        .getByRole('button', { name: 'Use the account’s existing data' })
        .click();
      await expect(
        fresh.page.getByRole('button', { name: 'Sync now', exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(fresh.page.locator('native-sync [role=alert]')).toHaveCount(0);
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
