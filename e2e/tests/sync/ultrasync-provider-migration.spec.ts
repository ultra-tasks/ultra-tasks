import { test, expect } from '../../fixtures/webdav.fixture';
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
  confirmSyncConflictOverwriteIfShown,
} from '../../utils/sync-helpers';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true')
  throw new Error('The UltraSync migration acceptance server is required.');
const testPassword = 'test password for encrypted accounts';

const signIn = async (page: Page, username: string): Promise<void> => {
  const custom = page.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.isVisible()) await custom.check();
  await page.getByLabel('Ultra Tasks server URL').fill(ultraUrl!);
  await page.getByLabel('Email or username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: 'Sign in and unlock' }).click();
};

const openUltraFromProvider = async (page: Page): Promise<void> => {
  await page.locator('button.sync-btn').first().click({ button: 'right' });
  const dialog = page.locator('dialog-sync-cfg');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'UltraSync', exact: true }).click();
  await expect(dialog).toContainText('Switch your other devices');
  await dialog.getByRole('button', { name: 'Continue with UltraSync' }).click();
};

const expectConnected = async (page: Page): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.locator('native-sync [role=alert]')).toHaveCount(0);
};

const showTasks = async (page: Page): Promise<void> => {
  await page.goto('/#/tag/TODAY/tasks');
  await new WorkViewPage(page).waitForTaskList();
};

test.describe('@webdav UltraSync provider migration', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });
  test('a device with WebDAV data can select UltraSync without disconnecting first', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    expect(webdavServerUp).toBe(true);
    const folder = generateSyncFolderName('ultra-provider-switch');
    await createSyncFolder(request, folder);
    const { context, page } = await setupSyncClient(browser, baseURL);
    try {
      const sync = new SyncPage(page);
      const tasks = new WorkViewPage(page);
      await tasks.waitForTaskList();
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      const title = `Migration source task ${Date.now()}`;
      await tasks.addTask(title);
      await waitForStatePersistence(page);
      await sync.triggerSync();
      await waitForSyncComplete(page, sync);
      await sync.syncBtn.click({ button: 'right' });
      const dialog = page.locator('dialog-sync-cfg');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').click();
      await expect(
        page.getByRole('option', { name: 'UltraSync', exact: true }),
      ).toBeEnabled();
      await page.getByRole('option', { name: 'UltraSync', exact: true }).click();
      await expect(dialog).toContainText('UltraSync');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.locator('task').filter({ hasText: title })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('moves a real WebDAV task to an empty account and onward to an empty WebDAV target', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
    expect(webdavServerUp).toBe(true);
    const source = generateSyncFolderName('ultra-empty-source');
    const target = generateSyncFolderName('ultra-empty-target');
    await createSyncFolder(request, source);
    await createSyncFolder(request, target);
    const first = await setupSyncClient(browser, baseURL);
    const second = await setupSyncClient(browser, baseURL);
    const third = await setupSyncClient(browser, baseURL);
    const title = `WebDAV to UltraSync ${Date.now()}`;
    try {
      const firstSync = new SyncPage(first.page);
      await firstSync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${source}`,
      });
      await new WorkViewPage(first.page).addTask(title);
      await waitForStatePersistence(first.page);
      await firstSync.triggerSync();
      await waitForSyncComplete(first.page, firstSync);
      await openUltraFromProvider(first.page);
      await signIn(first.page, 'empty');
      await expectConnected(first.page);

      await second.page.goto('/#/native-sync');
      await signIn(second.page, 'empty');
      await expect(
        second.page.getByText('This account already has data.', { exact: false }),
      ).toBeVisible();
      await second.page
        .getByRole('button', { name: 'Use the account’s existing data' })
        .click();
      await expectConnected(second.page);
      await showTasks(second.page);
      await expect(second.page.locator('task').filter({ hasText: title })).toBeVisible();

      await showTasks(first.page);
      await firstSync.setupWebdavSync(
        { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${target}` },
        { isReconfigure: true },
      );
      await waitForSyncComplete(first.page, firstSync);
      const thirdSync = new SyncPage(third.page);
      await thirdSync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${target}`,
      });
      await waitForSyncComplete(third.page, thirdSync);
      await expect(third.page.locator('task').filter({ hasText: title })).toBeVisible();
    } finally {
      await first.context.close();
      await second.context.close();
      await third.context.close();
    }
  });

  test('chooses local or account data when UltraSync already contains tasks', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
    expect(webdavServerUp).toBe(true);
    const firstFolder = generateSyncFolderName('ultra-local-choice');
    const secondFolder = generateSyncFolderName('ultra-server-choice');
    await createSyncFolder(request, firstFolder);
    await createSyncFolder(request, secondFolder);
    const owner = await setupSyncClient(browser, baseURL);
    const local = await setupSyncClient(browser, baseURL);
    const remote = await setupSyncClient(browser, baseURL);
    const oldTitle = `Existing account ${Date.now()}`;
    const localTitle = `Chosen local ${Date.now()}`;
    const discardedTitle = `Other local ${Date.now()}`;
    try {
      await new WorkViewPage(owner.page).addTask(oldTitle);
      await waitForStatePersistence(owner.page);
      await owner.page.goto('/#/native-sync');
      await signIn(owner.page, 'populated');
      await expectConnected(owner.page);

      const localSync = new SyncPage(local.page);
      await localSync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${firstFolder}`,
      });
      await new WorkViewPage(local.page).addTask(localTitle);
      await waitForStatePersistence(local.page);
      await localSync.triggerSync();
      await waitForSyncComplete(local.page, localSync);
      await openUltraFromProvider(local.page);
      await signIn(local.page, 'populated');
      await expect(
        local.page.getByText('This account already has data.', { exact: false }),
      ).toBeVisible();
      // Losing the new server before committing the choice must leave WebDAV active.
      await local.page.route('**/api/v2/accounts/sync/scopes', (route) => route.abort());
      await local.page.getByRole('button', { name: 'Import this device’s data' }).click();
      await expect(local.page.locator('native-sync [role=alert]')).toBeVisible();
      await expect
        .poll(() =>
          local.page.evaluate(() => {
            const store = (
              window as unknown as {
                __e2eTestHelpers: {
                  store: {
                    subscribe: (
                      next: (state: {
                        globalConfig: { sync: { isEnabled: boolean } };
                      }) => void,
                    ) => { unsubscribe: () => void };
                  };
                };
              }
            ).__e2eTestHelpers.store;
            let enabled = false;
            store
              .subscribe((state) => {
                enabled = state.globalConfig.sync.isEnabled;
              })
              .unsubscribe();
            return enabled;
          }),
        )
        .toBe(true);
      await local.page.unroute('**/api/v2/accounts/sync/scopes');
      await local.page.getByRole('button', { name: 'Import this device’s data' }).click();
      await expectConnected(local.page);
      await owner.page.getByRole('button', { name: 'Sync now', exact: true }).click();
      await expectConnected(owner.page);
      await showTasks(owner.page);
      await expect(
        owner.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();
      await expect(owner.page.locator('task').filter({ hasText: oldTitle })).toHaveCount(
        0,
      );

      const remoteSync = new SyncPage(remote.page);
      await remoteSync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${secondFolder}`,
      });
      await new WorkViewPage(remote.page).addTask(discardedTitle);
      await waitForStatePersistence(remote.page);
      await remoteSync.triggerSync();
      await waitForSyncComplete(remote.page, remoteSync);
      await openUltraFromProvider(remote.page);
      await signIn(remote.page, 'populated');
      await remote.page
        .getByRole('button', { name: 'Use the account’s existing data' })
        .click();
      await expectConnected(remote.page);
      await showTasks(remote.page);
      await expect(
        remote.page.locator('task').filter({ hasText: localTitle }),
      ).toBeVisible();
      await expect(
        remote.page.locator('task').filter({ hasText: discardedTitle }),
      ).toHaveCount(0);
    } finally {
      await owner.context.close();
      await local.context.close();
      await remote.context.close();
    }
  });

  for (const choice of ['local', 'remote'] as const) {
    test(`chooses ${choice} when switching from UltraSync to a populated WebDAV target`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }) => {
      test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
      expect(webdavServerUp).toBe(true);
      const folder = generateSyncFolderName(`ultra-populated-dav-${choice}`);
      await createSyncFolder(request, folder);
      const cfg = { ...WEBDAV_CONFIG_TEMPLATE, syncFolderPath: `/${folder}` };
      const source = await setupSyncClient(browser, baseURL, [
        /This device has never synced before.*Use My Data/i,
      ]);
      const existing = await setupSyncClient(browser, baseURL);
      const verifier = await setupSyncClient(browser, baseURL);
      const localTitle = `Ultra source ${choice} ${Date.now()}`;
      const remoteTitle = `Existing WebDAV ${choice} ${Date.now()}`;
      try {
        const existingSync = new SyncPage(existing.page);
        await existingSync.setupWebdavSync(cfg);
        await new WorkViewPage(existing.page).addTask(remoteTitle);
        await waitForStatePersistence(existing.page);
        await existingSync.triggerSync();
        await waitForSyncComplete(existing.page, existingSync);

        await new WorkViewPage(source.page).addTask(localTitle);
        await waitForStatePersistence(source.page);
        await source.page.goto('/#/native-sync');
        await signIn(source.page, choice === 'local' ? 'davlocal' : 'davremote');
        await expectConnected(source.page);
        await showTasks(source.page);
        const sourceSync = new SyncPage(source.page);
        await sourceSync.setupWebdavSync(cfg, { isReconfigure: true });

        const keep = source.page.getByRole('button', {
          name:
            choice === 'local'
              ? /^(Keep local|Use My Data)$/i
              : /^(Keep remote|Use Server Data)$/i,
        });
        await expect(keep).toBeVisible({ timeout: 30000 });
        expect(await waitForSyncComplete(source.page, sourceSync)).toBe('conflict');
        const conflict = source.page.locator('dialog-sync-conflict');
        sourceSync.prepareForNextSyncCycle(choice === 'local' ? 'write' : 'read');
        await keep.click();
        await confirmSyncConflictOverwriteIfShown(source.page, conflict);
        await waitForSyncComplete(source.page, sourceSync, 30000, {
          allowResponseOnlyCompletion: true,
        });
        const expected = choice === 'local' ? localTitle : remoteTitle;
        const replaced = choice === 'local' ? remoteTitle : localTitle;
        await expect(
          source.page.locator('task').filter({ hasText: expected }),
        ).toBeVisible({ timeout: 30000 });
        await expect(
          source.page.locator('task').filter({ hasText: replaced }),
        ).toHaveCount(0);

        const verifierSync = new SyncPage(verifier.page);
        await verifierSync.setupWebdavSync(cfg);
        await waitForSyncComplete(verifier.page, verifierSync);
        await expect(
          verifier.page.locator('task').filter({ hasText: expected }),
        ).toBeVisible();
        await expect(
          verifier.page.locator('task').filter({ hasText: replaced }),
        ).toHaveCount(0);
      } finally {
        await source.context.close();
        await existing.context.close();
        await verifier.context.close();
      }
    });
  }
});
