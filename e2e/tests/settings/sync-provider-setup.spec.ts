import { expect, test } from '../../fixtures/test.fixture';

test('new sync setup defaults to UltraTasks Account and offers personal-only alternatives', async ({
  page,
  syncPage,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  await syncPage.clickSyncBtn();
  const dialog = page.locator('dialog-sync-cfg');
  await expect(
    dialog.getByRole('button', { name: 'Continue with UltraTasks Account', exact: true }),
  ).toBeVisible();
  const provider = dialog.getByRole('combobox');
  await expect(provider).toContainText('UltraTasks Account');
  await provider.click();
  await expect(
    page.getByRole('option', { name: /SuperSync|Dropbox|Nextcloud|Local file/ }),
  ).toHaveCount(0);
  await page
    .getByRole('option', { name: 'WebDAV — personal sync only', exact: true })
    .click();
  await expect(dialog).toContainText('Basic personal sync only');
  await expect(dialog).toContainText('do not provide team collaboration');
  await expect(dialog.locator('.e2e-baseUrl input')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await syncPage.clickSyncBtn();
  await expect(page.locator('dialog-sync-cfg').getByRole('combobox')).toContainText(
    'UltraTasks Account',
  );
});

test('UltraTasks Account setup opens account sign-in on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/account');
  await page.getByRole('button', { name: 'Set up sync', exact: true }).click();
  const dialog = page.locator('dialog-sync-cfg');
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await dialog
    .getByRole('button', { name: 'Continue with UltraTasks Account', exact: true })
    .click();
  await expect(page).toHaveURL(/native-sync/);
  await expect(
    page.getByRole('button', { name: 'Continue in browser', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Ultra Tasks server URL', exact: true }),
  ).toBeVisible();
});
