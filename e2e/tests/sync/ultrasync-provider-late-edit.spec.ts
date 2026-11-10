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
} from '../../utils/sync-helpers';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true')
  throw new Error('The UltraSync migration acceptance server is required.');
const signIn = async (page: Page, username: string): Promise<void> => {
  const custom = page.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.isVisible()) await custom.check();
  await page.getByLabel('Ultra Tasks server URL').fill(ultraUrl!);
  await page.getByLabel('Email or username').fill(username);
  await page
    .getByLabel('Password', { exact: true })
    .fill('test password for encrypted accounts');
  await page.getByRole('button', { name: 'Sign in and unlock' }).click();
};

for (const phase of ['preflight', 'download', 'foreign'] as const) {
  test(`@webdav retains edits during the ${phase} of a switch to account data`, async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
    expect(webdavServerUp).toBe(true);
    test.setTimeout(180000);
    const username =
      process.env.E2E_ULTRA_LATE_ACCOUNT ??
      (phase === 'preflight'
        ? 'latepreflight'
        : phase === 'foreign'
          ? 'latetab'
          : 'lateedit');
    const owner = await setupSyncClient(browser, baseURL);
    const source = await setupSyncClient(browser, baseURL);
    const remoteTitle = `Account data ${Date.now()}`;
    const lateTitle = `Created while switching ${Date.now()}`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    try {
      await new WorkViewPage(owner.page).addTask(remoteTitle);
      await waitForStatePersistence(owner.page);
      await owner.page.goto('/#/native-sync');
      await signIn(owner.page, username);
      await expect(
        owner.page.getByRole('button', { name: 'Sync now', exact: true }),
      ).toBeEnabled({
        timeout: 60000,
      });

      const folder = generateSyncFolderName('ultra-late-edit');
      await createSyncFolder(request, folder);
      const sync = new SyncPage(source.page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      await sync.syncBtn.click({ button: 'right' });
      const dialog = source.page.locator('dialog-sync-cfg');
      await dialog.getByRole('combobox').click();
      await source.page.getByRole('option', { name: 'UltraSync', exact: true }).click();
      await dialog.getByRole('button', { name: 'Continue with UltraSync' }).click();
      await signIn(source.page, username);
      const useAccount = source.page.getByRole('button', {
        name: 'Use the account’s existing data',
      });
      await expect(useAccount).toBeVisible();

      let seen!: () => void;
      const reachedDownload = new Promise<void>((resolve) => (seen = resolve));
      const endpoint = phase === 'preflight' ? 'snapshot' : 'changes';
      await source.page.route(
        new RegExp(`/sync/scopes/[^/]+/${endpoint}(?:\\?|$)`),
        async (route) => {
          seen();
          await held;
          await route.continue();
        },
      );
      await useAccount.click();
      await reachedDownload;
      const editingPage =
        phase === 'foreign' ? await source.context.newPage() : source.page;
      if (phase === 'foreign') {
        // Simulate the concurrent-tab startup race while retaining shared IndexedDB.
        await editingPage.addInitScript(() => {
          const NativeChannel = window.BroadcastChannel;
          window.BroadcastChannel = class extends NativeChannel {
            constructor(name: string) {
              super(name === 'superProductivityTab' ? 'isolated-startup-check' : name);
            }
          };
        });
      }
      await editingPage.goto('/#/tag/TODAY/tasks');
      const tasks = new WorkViewPage(editingPage);
      await tasks.waitForTaskList();
      await tasks.addTask(lateTitle);
      await waitForStatePersistence(editingPage);
      release();
      await source.page.goto('/#/native-sync');
      await expect(source.page.locator('native-sync [role=alert]')).toContainText(
        'Your data changed while switching',
        { timeout: 60000 },
      );
      if (phase === 'foreign') await editingPage.reload();
      else await source.page.goto('/#/tag/TODAY/tasks');
      await tasks.waitForTaskList();
      await expect(
        editingPage.locator('task').filter({ hasText: lateTitle }).first(),
      ).toBeVisible({
        timeout: 60000,
      });
      await expect(
        editingPage.locator('task').filter({ hasText: remoteTitle }),
      ).toHaveCount(0);
    } finally {
      release();
      await owner.context.close();
      await source.context.close();
    }
  });
}

for (const writer of ['local', 'foreign'] as const) {
  test(`@webdav retains ${writer} edits made while uploading this device's data`, async ({
    browser,
    baseURL,
    request,
    webdavServerUp,
  }) => {
    test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
    expect(webdavServerUp).toBe(true);
    test.setTimeout(180000);
    const username = writer === 'local' ? 'latemigrate' : 'latemigratetab';
    const owner = await setupSyncClient(browser, baseURL);
    const source = await setupSyncClient(browser, baseURL);
    const previousTitle = `Previous account ${Date.now()}`;
    const originalTitle = `Original local ${Date.now()}`;
    const lateTitle = `Local during upload ${Date.now()}`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    try {
      await new WorkViewPage(owner.page).addTask(previousTitle);
      await waitForStatePersistence(owner.page);
      await owner.page.goto('/#/native-sync');
      await signIn(owner.page, username);
      await expect(
        owner.page.getByRole('button', { name: 'Sync now', exact: true }),
      ).toBeEnabled({ timeout: 60000 });

      const folder = generateSyncFolderName('ultra-late-upload');
      await createSyncFolder(request, folder);
      const sync = new SyncPage(source.page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      await new WorkViewPage(source.page).addTask(originalTitle);
      await waitForStatePersistence(source.page);
      await sync.syncBtn.click({ button: 'right' });
      const dialog = source.page.locator('dialog-sync-cfg');
      await dialog.getByRole('combobox').click();
      await source.page.getByRole('option', { name: 'UltraSync', exact: true }).click();
      await dialog.getByRole('button', { name: 'Continue with UltraSync' }).click();
      await signIn(source.page, username);
      const useLocal = source.page.getByRole('button', {
        name: 'Import this device’s data',
      });
      await expect(useLocal).toBeVisible();
      let seen!: () => void;
      const reachedUpload = new Promise<void>((resolve) => (seen = resolve));
      await source.page.route(
        /\/sync\/scopes\/[^/]+\/replacement\/stage$/,
        async (route) => {
          seen();
          await held;
          await route.continue();
        },
      );
      await useLocal.click();
      await reachedUpload;
      const editingPage =
        writer === 'foreign' ? await source.context.newPage() : source.page;
      if (writer === 'foreign') {
        await editingPage.addInitScript(() => {
          const NativeChannel = window.BroadcastChannel;
          window.BroadcastChannel = class extends NativeChannel {
            constructor(name: string) {
              super(name === 'superProductivityTab' ? 'isolated-startup-check' : name);
            }
          };
        });
      }
      await editingPage.goto('/#/tag/TODAY/tasks');
      const tasks = new WorkViewPage(editingPage);
      await tasks.waitForTaskList();
      await tasks.addTask(lateTitle);
      await waitForStatePersistence(editingPage);
      release();
      if (writer === 'foreign') {
        await expect(source.page.locator('native-sync [role=alert]')).toContainText(
          'Your data changed while switching',
          { timeout: 60000 },
        );
        await editingPage.reload();
      } else {
        await source.page.goto('/#/native-sync');
        await expect(
          source.page.getByRole('button', { name: 'Sync now', exact: true }),
        ).toBeEnabled({ timeout: 60000 });
        await source.page.goto('/#/tag/TODAY/tasks');
      }
      await tasks.waitForTaskList();
      await expect(
        editingPage.locator('task').filter({ hasText: originalTitle }).first(),
      ).toBeVisible();
      await expect(
        editingPage.locator('task').filter({ hasText: lateTitle }).first(),
      ).toBeVisible();
    } finally {
      release();
      await owner.context.close();
      await source.context.close();
    }
  });
}

test('@webdav reports an interrupted upload and permits a retry after restart', async ({
  browser,
  baseURL,
  request,
  webdavServerUp,
}) => {
  test.skip(!ultraUrl, 'The isolated UltraSync acceptance server is required');
  expect(webdavServerUp).toBe(true);
  test.setTimeout(180000);
  const owner = await setupSyncClient(browser, baseURL);
  const source = await setupSyncClient(browser, baseURL);
  const oldTitle = `Account before interruption ${Date.now()}`;
  const localTitle = `Preserved after interruption ${Date.now()}`;
  try {
    await new WorkViewPage(owner.page).addTask(oldTitle);
    await waitForStatePersistence(owner.page);
    await owner.page.goto('/#/native-sync');
    await signIn(owner.page, 'latefailure');
    await expect(
      owner.page.getByRole('button', { name: 'Sync now', exact: true }),
    ).toBeEnabled({
      timeout: 60000,
    });

    const folder = generateSyncFolderName('ultra-interrupted-upload');
    await createSyncFolder(request, folder);
    const sync = new SyncPage(source.page);
    await sync.setupWebdavSync({
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folder}`,
    });
    await new WorkViewPage(source.page).addTask(localTitle);
    await waitForStatePersistence(source.page);
    await sync.syncBtn.click({ button: 'right' });
    const dialog = source.page.locator('dialog-sync-cfg');
    await dialog.getByRole('combobox').click();
    await source.page.getByRole('option', { name: 'UltraSync', exact: true }).click();
    await dialog.getByRole('button', { name: 'Continue with UltraSync' }).click();
    await signIn(source.page, 'latefailure');
    const stage = /\/sync\/scopes\/[^/]+\/replacement\/stage$/;
    await source.page.route(stage, (route) => route.abort());
    await source.page.getByRole('button', { name: 'Import this device’s data' }).click();
    await expect(source.page.locator('native-sync [role=alert]')).toContainText(
      'Sync is off on this device',
      { timeout: 60000 },
    );
    await source.page.unroute(stage);
    await source.page.goto('/#/tag/TODAY/tasks');
    await source.page.reload();
    const tasks = new WorkViewPage(source.page);
    await tasks.waitForTaskList();
    await expect(
      source.page.locator('task').filter({ hasText: localTitle }).first(),
    ).toBeVisible();
    await expect
      .poll(() =>
        source.page.evaluate(() => {
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
          let enabled = true;
          store
            .subscribe((state) => (enabled = state.globalConfig.sync.isEnabled))
            .unsubscribe();
          return enabled;
        }),
      )
      .toBe(false);

    await owner.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await owner.page.goto('/#/tag/TODAY/tasks');
    await expect(owner.page.locator('task').filter({ hasText: oldTitle })).toBeVisible();

    await source.page.goto('/#/native-sync');
    await signIn(source.page, 'latefailure');
    await source.page.getByRole('button', { name: 'Import this device’s data' }).click();
    await expect(
      source.page.getByRole('button', { name: 'Sync now', exact: true }),
    ).toBeEnabled({ timeout: 60000 });
    await source.page.goto('/#/tag/TODAY/tasks');
    await tasks.waitForTaskList();
    await expect(
      source.page.locator('task').filter({ hasText: localTitle }).first(),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await source.context.close();
  }
});
