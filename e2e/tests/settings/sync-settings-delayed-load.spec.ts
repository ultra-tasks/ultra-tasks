import { expect, test } from '../../fixtures/test.fixture';
import { restoreSavedSuperSyncConnection } from '../../utils/legacy-sync-setup';
import { openSyncSetup } from '../../utils/open-sync-setup';

test('a delayed initial settings load cannot replace the chosen provider', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  // This disabled saved connection supplies a real prior provider; its option
  // also witnesses that the first settings emission reached the dialog.
  expect(await restoreSavedSuperSyncConnection(page)).toBe(true);

  let releaseOverride!: () => void;
  const overrideHeld = new Promise<void>((resolve) => (releaseOverride = resolve));
  await page.route('**/assets/sync-config-default-override.json', async (route) => {
    await overrideHeld;
    await route.continue();
  });
  const overrideRequest = page.waitForRequest(
    '**/assets/sync-config-default-override.json',
  );

  try {
    // The saved connection is disabled, so there is no header sync button.
    await openSyncSetup(page);
    await overrideRequest;
    const dialog = page.locator('dialog-sync-cfg');
    const picker = dialog.locator('mat-select').first();
    const userName = dialog.locator('.e2e-userName input');
    const save = dialog.getByRole('button', { name: 'Save & Enable Sync' });
    const fillWebDav = async (): Promise<void> => {
      await dialog.locator('.e2e-baseUrl input').fill('https://webdav.example.invalid');
      await userName.fill('delayed-settings-draft');
      await dialog.locator('.e2e-password input').fill('synthetic-password');
      await dialog.locator('.e2e-syncFolderPath input').fill('synthetic-folder');
    };

    // If editing is allowed while settings are pending, the later emission
    // must not replace it. Otherwise, setup must become usable after loading.
    const couldEditWhileLoading = await picker.isEnabled();
    if (couldEditWhileLoading) {
      await picker.click();
      await page.getByRole('option', { name: 'WebDAV — personal sync only' }).click();
      await fillWebDav();
      await expect(save).toBeEnabled();
    } else {
      await expect(
        dialog.getByRole('button', { name: 'Continue with UltraTasks Account' }),
      ).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    }

    const overrideResponse = page.waitForResponse((response) =>
      response.url().endsWith('/assets/sync-config-default-override.json'),
    );
    releaseOverride();
    expect((await overrideResponse).ok()).toBe(true);
    await picker.click();
    await expect(
      page.getByRole('option', { name: 'SuperSync — existing connection (deprecated)' }),
    ).toBeVisible();
    if (couldEditWhileLoading) {
      // Opening the menu witnesses the initial emission; Escape avoids a new selection.
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('option', { name: 'WebDAV — personal sync only' }).click();
      await fillWebDav();
    }
    await expect(picker).toContainText('WebDAV');
    await expect(userName).toHaveValue('delayed-settings-draft');
    await expect(save).toBeEnabled();

    // Never connect to either synthetic WebDAV or a local SuperSync service.
    await page.route('https://webdav.example.invalid/**', (route) => route.abort());
    await page.route('http://localhost:1901/**', (route) => route.abort());
    await save.click();
    const skipEncryption = page.locator('.e2e-setup-encrypt-skip');
    await Promise.race([
      skipEncryption.waitFor({ state: 'visible' }),
      dialog.waitFor({ state: 'hidden' }),
    ]);
    await page.context().setOffline(true);
    if (await skipEncryption.isVisible()) await skipEncryption.click();
    await expect(dialog).toBeHidden();

    await openSyncSetup(page);
    await expect(picker).toContainText('WebDAV');
    await expect(userName).toHaveValue('delayed-settings-draft');
  } finally {
    releaseOverride();
  }
});
