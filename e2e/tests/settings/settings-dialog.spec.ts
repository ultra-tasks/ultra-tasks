import { test, expect } from '../../fixtures/test.fixture';

test('settings opens over the workspace, finds advanced options, and dismisses help', async ({
  page,
}) => {
  await page.goto('/#/tag/TODAY/tasks');
  const settingsLink = page.locator('a[href="#/config"]');
  await settingsLink.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/tag\/TODAY\/tasks/);
  await expect(dialog.locator('.settings-categories')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Search settings' }).fill('delete');
  await page.getByRole('option').filter({ hasText: 'Confirm before deleting' }).click();
  const row = dialog.locator('[data-setting-key="isConfirmBeforeDelete"]');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Help/ }).hover();
  await expect(page.locator('.mat-mdc-tooltip')).toContainText('confirmation');
  await dialog.getByRole('heading').first().hover();
  await expect(page.locator('.mat-mdc-tooltip')).toBeHidden();
  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await settingsLink.click();
  await dialog.getByRole('button', { name: 'Tasks & planning', exact: true }).click();
  await expect(row.getByRole('switch')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Search settings' }).fill('week');
  await page.getByRole('option').filter({ hasText: 'First day of the week' }).click();
  await expect(dialog.locator('[data-setting-key="firstDayOfWeek"]')).toBeVisible();
  await page.screenshot({ path: '.tmp/settings-desktop.png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  // Plugins & integrations has no sidebar row: it is a row at the end of the
  // Settings list, on every screen size.
  await expect(page.locator('a[href="#/plugins"]')).toHaveCount(0);
  await settingsLink.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Plugins & integrations' }).click();
  // The window itself is titled Marketplace.
  await expect(page.getByRole('dialog', { name: 'Marketplace' })).toBeVisible();
});

test('data settings separates import and export from account sync', async ({ page }) => {
  await page.goto('/#/config?tab=5');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.sync-summary')).toHaveCount(0);
  await expect(dialog.locator('.import-section')).toBeVisible();
  await expect(dialog.locator('.export-section')).toBeVisible();
  await expect(dialog.locator('file-imex')).toBeVisible();
});

test('mobile settings uses category navigation without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/config');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Tasks & planning', exact: true }).click();
  await expect(dialog.locator('.section-tasks')).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/settings-mobile.png' });
  await dialog.locator('.settings-back').click();
  await expect(dialog.locator('.settings-categories')).toBeVisible();
});
