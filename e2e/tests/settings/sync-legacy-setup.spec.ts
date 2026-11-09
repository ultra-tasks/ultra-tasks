import { expect, test } from '../../fixtures/test.fixture';
import { SuperSyncPage } from '../../pages/supersync.page';
import {
  disconnectBeforeProviderSwitch,
  restoreSavedSuperSyncConnection,
} from '../../utils/legacy-sync-setup';
import { seedSuperSyncCredentials } from '../../utils/supersync-helpers';

test('saved legacy setup preserves tasks and remains available after restart', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  const witness = 'Saved sync connection task witness';
  await workViewPage.addTask(witness);
  expect(await restoreSavedSuperSyncConnection(page)).toBe(true);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(taskPage.getTaskByText(witness)).toBeVisible();
  expect(await restoreSavedSuperSyncConnection(page)).toBe(false);

  const sync = new SuperSyncPage(page);
  const dialog = await sync.openSuperSyncSettings();
  await expect(sync.providerSelect).toContainText('SuperSync');
  await expect(sync.accessTokenInput).toBeVisible();
  await expect(dialog).toContainText('This saved connection still works');
  await expect(page.getByRole('listbox')).toBeHidden();
  await sync.providerSelect.click();
  const options = page.getByRole('listbox');
  await expect(options).toBeVisible();
  await expect(
    page.getByRole('option', { name: /Dropbox|Nextcloud|Local file/ }),
  ).toHaveCount(0);
  await options.getByRole('option', { selected: true }).click();
  await expect(options).toBeHidden();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(taskPage.getTaskByText(witness)).toBeVisible();
});

test('an enabled legacy provider permits switching and the disconnect helper still works', async ({
  page,
  workViewPage,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  const endpoint = 'https://legacy.fixture.test';
  await page.route(endpoint + '/**', (route) => route.abort());
  await seedSuperSyncCredentials(page, {
    baseUrl: endpoint,
    accessToken: 'synthetic-legacy-access-token',
    encryptKey: 'synthetic-legacy-encryption-key',
  });
  await restoreSavedSuperSyncConnection(page);
  // Reload before enabling so the credential store reads the persisted fixture.
  await page.reload();
  await workViewPage.waitForTaskList();
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'sync',
      sectionCfg: { isEnabled: true },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'sync',
        opType: 'UPD',
      },
    });
  });
  const sync = new SuperSyncPage(page);
  const dialog = await sync.openSuperSyncSettings();
  await sync.accessTokenInput.fill('synthetic-unsaved-token');
  const trackingPresence = dialog.getByRole('checkbox', { name: /live tracking/i });
  if (!(await trackingPresence.isVisible())) {
    await dialog.locator('.collapsible-header:has-text("Advanced")').last().click();
  }
  await trackingPresence.setChecked(true);
  await sync.presenceDeviceNameInput.fill('synthetic-device-draft');
  await trackingPresence.setChecked(false);
  await expect(page.getByRole('listbox')).toBeHidden();
  await sync.providerSelect.click();
  const options = page.getByRole('listbox');
  await expect(options).toBeVisible();
  const alternative = page.getByRole('option', {
    name: 'WebDAV — personal sync only',
    exact: true,
  });
  await expect(alternative).toBeEnabled();
  await alternative.click();
  await expect(options).toBeHidden();
  await expect(dialog.locator('.e2e-userName input')).toBeVisible();
  await expect(sync.accessTokenInput).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Switching changes this device only');
  const webdavFolder = dialog.locator('.e2e-syncFolderPath input');
  await expect(webdavFolder).toHaveValue('super-productivity');
  await dialog.locator('.e2e-userName input').fill('synthetic-webdav-draft');

  await sync.providerSelect.click();
  await page
    .getByRole('option', {
      name: 'SuperSync — existing connection (deprecated)',
      exact: true,
    })
    .click();
  await expect(sync.accessTokenInput).toHaveValue('synthetic-unsaved-token');
  if (!(await trackingPresence.isVisible())) {
    await dialog.locator('.collapsible-header:has-text("Advanced")').last().click();
  }
  await trackingPresence.setChecked(true);
  await expect(sync.presenceDeviceNameInput).toHaveValue('synthetic-device-draft');

  await sync.providerSelect.click();
  await alternative.click();
  await expect(dialog.locator('.e2e-userName input')).toHaveValue(
    'synthetic-webdav-draft',
  );
  await expect(webdavFolder).toHaveValue('super-productivity');

  // The legacy helper is still used by provider suites that disconnect first.
  await sync.providerSelect.click();
  await page
    .getByRole('option', {
      name: 'SuperSync — existing connection (deprecated)',
      exact: true,
    })
    .click();
  await expect(sync.accessTokenInput).toHaveValue('synthetic-unsaved-token');
  await sync.accessTokenInput.fill('synthetic-legacy-access-token');

  await disconnectBeforeProviderSwitch(page, 'WebDAV');
  await sync.providerSelect.click();
  await expect(alternative).toBeEnabled();
  await alternative.click();
  await expect(dialog.locator('.e2e-userName input')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
