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
} from '../../utils/sync-helpers';
import {
  dataChoiceDialog as dataChoice,
  replaceAccountData,
  signIn as signInToConfiguredAccount,
} from '../native-sync/native-account-helpers';

const ultraUrl = process.env.E2E_ULTRA_URL;
if (!ultraUrl && process.env.E2E_REQUIRE_ULTRA === 'true')
  throw new Error('The Ultra Tasks account migration acceptance server is required.');
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

/** Chooses the account's data when asked. An empty device downloads it without asking. */
const downloadAccountData = async (page: Page): Promise<void> => {
  const choice = dataChoice(page).getByRole('button', { name: 'Download account data' });
  await choice
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => choice.click())
    .catch(() => undefined);
};

/** Switches this device's sync provider to the Ultra Tasks account from the provider dialog. */
const switchToUltraTasksAccount = async (page: Page, syncBtn: Locator): Promise<void> => {
  await syncBtn.click({ button: 'right' });
  const dialog = page.locator('dialog-sync-cfg');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Ultra Tasks account', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue with Ultra Tasks account' }).click();
};

for (const phase of ['preflight', 'download', 'foreign'] as const) {
  test(`@webdav retains edits during the ${phase} of a switch to account data`, async ({
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
      await expectConnected(owner.page);

      const folder = generateSyncFolderName('ultra-late-edit');
      await createSyncFolder(request, folder);
      const sync = new SyncPage(source.page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      await switchToUltraTasksAccount(source.page, sync.syncBtn);

      // The download is held at the server before the first sign-in step finishes, so the edit
      // below always lands while it is under way (this device holds no tasks: it downloads).
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
      await signIn(source.page, username);
      await downloadAccountData(source.page);
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
    test.skip(
      !ultraUrl,
      'The isolated Ultra Tasks account acceptance server is required',
    );
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
      await expectConnected(owner.page);

      const folder = generateSyncFolderName('ultra-late-upload');
      await createSyncFolder(request, folder);
      const sync = new SyncPage(source.page);
      await sync.setupWebdavSync({
        ...WEBDAV_CONFIG_TEMPLATE,
        syncFolderPath: `/${folder}`,
      });
      await new WorkViewPage(source.page).addTask(originalTitle);
      await waitForStatePersistence(source.page);
      await switchToUltraTasksAccount(source.page, sync.syncBtn);
      await signIn(source.page, username);
      await expect(dataChoice(source.page)).toBeVisible();
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
      await replaceAccountData(source.page);
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
        await expect(
          source.page.getByRole('button', { name: /^Up to date\b/ }),
        ).toBeVisible({ timeout: 60000 });
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
  test.skip(!ultraUrl, 'The isolated Ultra Tasks account acceptance server is required');
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
    await expectConnected(owner.page);

    const folder = generateSyncFolderName('ultra-interrupted-upload');
    await createSyncFolder(request, folder);
    const sync = new SyncPage(source.page);
    await sync.setupWebdavSync({
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${folder}`,
    });
    await new WorkViewPage(source.page).addTask(localTitle);
    await waitForStatePersistence(source.page);
    await switchToUltraTasksAccount(source.page, sync.syncBtn);
    await signIn(source.page, 'latefailure');
    await expect(dataChoice(source.page)).toBeVisible();
    const stage = /\/sync\/scopes\/[^/]+\/replacement\/stage$/;
    await source.page.route(stage, (route) => route.abort());
    await Promise.all([
      source.page.waitForRequest(stage),
      replaceAccountData(source.page),
    ]);
    await expect(
      dataChoice(source.page)
        .getByRole('alert')
        .filter({ hasText: 'Sync is off on this device' }),
    ).toBeVisible({ timeout: 60000 });
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

    await owner.page.goto('/#/native-sync');
    await owner.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await owner.page.goto('/#/tag/TODAY/tasks');
    await expect(owner.page.locator('task').filter({ hasText: oldTitle })).toBeVisible();

    await signInToConfiguredAccount(source.page, 'latefailure');
    await replaceAccountData(source.page);
    await expectConnected(source.page);
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
