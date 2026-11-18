import { test, expect } from '../../fixtures/webdav.fixture';
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
  confirmSyncConflictOverwriteIfShown,
} from '../../utils/sync-helpers';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true')
  throw new Error('The Ultra Tasks account migration acceptance server is required.');
const testPassword = 'test password for encrypted accounts';

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
  await account.getByLabel('Password', { exact: true }).fill(testPassword);
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
};

const openUltraFromProvider = async (page: Page): Promise<void> => {
  await page.locator('button.sync-btn').first().click({ button: 'right' });
  const dialog = page.locator('dialog-sync-cfg');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Ultra Tasks account', exact: true }).click();
  await expect(dialog).toContainText('Switch your other devices');
  await dialog.getByRole('button', { name: 'Continue with Ultra Tasks account' }).click();
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

/**
 * Replaces the account's data with this device's. The choice reopens from "Data connection not
 * finished" when an earlier attempt failed; replacement asks for one more confirmation.
 */
const replaceAccountData = async (page: Page): Promise<void> => {
  const dialog = dataChoice(page);
  const finish = page.getByRole('button', { name: 'Finish connecting' });
  await expect(dialog.or(finish)).toBeVisible({ timeout: 30000 });
  if (!(await dialog.isVisible())) await finish.click();
  await dialog
    .getByRole('button', { name: 'Replace account data with this device' })
    .click();
  const confirm = page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirm
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => confirm.click())
    .catch(() => undefined);
};

/** Syncs from the account page and waits for the manual sync to finish without a problem. */
const syncFromAccountPage = async (page: Page): Promise<void> => {
  await page.goto('/#/native-sync');
  const syncNow = page.getByRole('button', { name: 'Sync now', exact: true });
  await expect(syncNow).toBeEnabled({ timeout: 60000 });
  await syncNow.click();
  await expect(syncNow).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('native-sync [role=alert]')).toHaveCount(0);
};

const showTasks = async (page: Page): Promise<void> => {
  await page.goto('/#/tag/TODAY/tasks');
  await new WorkViewPage(page).waitForTaskList();
};

test.describe('@webdav Ultra Tasks account provider migration', () => {
  test.describe.configure({ mode: 'serial', timeout: 180000 });
  test('a device with WebDAV data can select the Ultra Tasks account without disconnecting first', async ({
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
        page.getByRole('option', { name: 'Ultra Tasks account', exact: true }),
      ).toBeEnabled();
      await page
        .getByRole('option', { name: 'Ultra Tasks account', exact: true })
        .click();
      await expect(dialog).toContainText('Ultra Tasks account');
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
    test.skip(
      !ultraUrl,
      'The isolated Ultra Tasks account acceptance server is required',
    );
    expect(webdavServerUp).toBe(true);
    const source = generateSyncFolderName('ultra-empty-source');
    const target = generateSyncFolderName('ultra-empty-target');
    await createSyncFolder(request, source);
    await createSyncFolder(request, target);
    const first = await setupSyncClient(browser, baseURL);
    const second = await setupSyncClient(browser, baseURL);
    const third = await setupSyncClient(browser, baseURL);
    const title = `WebDAV to the Ultra Tasks account ${Date.now()}`;
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
      await downloadAccountData(second.page);
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

  test('chooses local or account data when the Ultra Tasks account already contains tasks', async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.skip(
      !ultraUrl,
      'The isolated Ultra Tasks account acceptance server is required',
    );
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
      await expect(dataChoice(local.page)).toBeVisible();
      // Losing the new server before committing the choice must leave WebDAV active.
      await local.page.route('**/api/v2/accounts/sync/scopes', (route) => route.abort());
      await replaceAccountData(local.page);
      await expect(local.page.getByRole('alert').first()).toBeVisible();
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
      await replaceAccountData(local.page);
      await expectConnected(local.page);
      await syncFromAccountPage(owner.page);
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
      await expect(dataChoice(remote.page)).toBeVisible();
      await downloadAccountData(remote.page);
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
    test(`chooses ${choice} when switching from the Ultra Tasks account to a populated WebDAV target`, async ({
      browser,
      baseURL,
      request,
      webdavServerUp,
    }) => {
      test.skip(
        !ultraUrl,
        'The isolated Ultra Tasks account acceptance server is required',
      );
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
