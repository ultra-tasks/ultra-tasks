import { expect, test } from '../../fixtures/test.fixture';
import { openSyncSetup } from '../../utils/open-sync-setup';

test('new sync setup defaults to the Ultra Tasks account and offers personal-only alternatives', async ({
  page,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  // A fresh profile has no header sync button; setup opens from the command bar.
  await expect(page.locator('button.sync-btn')).toHaveCount(0);
  await openSyncSetup(page);
  const dialog = page.locator('dialog-sync-cfg');
  await expect(
    dialog.getByRole('button', {
      name: 'Continue with Ultra Tasks account',
      exact: true,
    }),
  ).toBeVisible();
  const provider = dialog.getByRole('combobox');
  await expect(provider).toContainText('Ultra Tasks account');
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
  await openSyncSetup(page);
  await expect(page.locator('dialog-sync-cfg').getByRole('combobox')).toContainText(
    'Ultra Tasks account',
  );
});

test('Ultra Tasks account setup opens account sign-in on a narrow screen', async ({
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
    .getByRole('button', { name: 'Continue with Ultra Tasks account', exact: true })
    .click();
  await expect(page).toHaveURL(/native-sync/);
  // The dialog led to the account page, whose browser sign-in is reachable on a phone. The page
  // owns the button's wording ("Continue in browser" before its rework, "Sign in with browser"
  // after), so either one passes.
  await expect(page.locator('native-sync')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(Sign in with browser|Continue in browser)$/ }),
  ).toBeVisible();
});
