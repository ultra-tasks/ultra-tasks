import { test, expect } from '../../fixtures/test.fixture';
import { readFile } from 'node:fs/promises';
import { ImportPage } from '../../pages/import.page';

test('the shared export control downloads a native backup', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Native export witness');
  const importPage = new ImportPage(page);
  await importPage.navigateToImportPage();
  const downloaded = page.waitForEvent('download');
  await importPage.exportBackupBtn.click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('No downloaded backup');
  const backup = await readFile(path, 'utf8');
  expect(JSON.parse(backup)).toBeTruthy();
  expect(backup).toContain('Native export witness');
});

test('dedicated settings categories reveal themes, shortcuts, sound and date examples', async ({
  page,
}) => {
  await page.goto('/#/config');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const nav = dialog.locator('.settings-categories');
  // Seven categories. The rows after them (Plugins & integrations, and Account on
  // a phone) open windows of their own and are not categories.
  await expect(nav.locator('button:not(.window-link) mat-icon')).toHaveCount(7);
  await expect(nav.locator('button.window-link')).toHaveCount(1);
  await expect(dialog.locator('.date-examples')).toContainText('Task date labels');
  await dialog.locator('.date-examples').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.tmp/settings-dates-refinement.png' });
  await expect(
    dialog.locator('[data-setting-key="dateTimeLocale"] .mat-mdc-form-field-hint'),
  ).toHaveCount(0);
  await nav.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(dialog.locator('.settings-content')).toHaveJSProperty('scrollTop', 0);
  await expect(dialog.locator('.palette-preset')).toHaveCount(12);
  await expect(
    dialog.getByRole('button', { name: 'Dracula', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Dracula', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Dracula', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '.tmp/settings-appearance-refinement.png' });
  await nav.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(dialog.locator('.section-keyboard')).toBeVisible();
  await nav.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Play preview', exact: true }),
  ).toHaveCount(3);
  await expect(dialog.locator('config-sound-form collapsible')).toHaveCount(0);
  await page.mouse.move(1180, 100);
  await page.screenshot({ path: '.tmp/settings-sound-refinement.png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('a[href="#/account"]').click();
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  await expect(account.locator('.sync-summary')).toBeVisible();
  await expect(account.locator('.settings-categories')).toBeHidden();
  await expect(account.locator('file-imex')).toHaveCount(0);
});

test('encrypted native export unlocks and restores through the normal import path', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Encrypted settings round trip');
  await page.locator('a[href="#/config"]').click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: 'Import & export', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Encrypt this export', exact: true }).click();
  await dialog
    .locator('.export-section')
    .getByRole('button', { name: 'Ultra Tasks backup (.json)', exact: true })
    .click();
  const passphrase = page.locator('backup-passphrase-dialog');
  await passphrase
    .getByLabel('Backup passphrase', { exact: true })
    .fill('a long test backup passphrase');
  await passphrase
    .getByLabel('Confirm passphrase', { exact: true })
    .fill('a long test backup passphrase');
  const downloadPromise = page.waitForEvent('download');
  await passphrase.getByRole('button', { name: 'Continue', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('No downloaded backup');
  const bytes = await readFile(path, 'utf8');
  expect(JSON.parse(bytes).format).toBe('ultra-tasks-encrypted-backup');
  expect(bytes).not.toContain('Encrypted settings round trip');
  await dialog.locator('input[type=file]').setInputFiles(path);
  await passphrase
    .getByLabel('Backup passphrase', { exact: true })
    .fill('incorrect passphrase');
  await passphrase.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('Could not unlock the backup. Check the passphrase and file.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles(path);
  await passphrase
    .getByLabel('Backup passphrase', { exact: true })
    .fill('a long test backup passphrase');
  const imported = page.waitForEvent('console', {
    predicate: (msg) => msg.text().includes('Load(import) all data'),
  });
  await passphrase.getByRole('button', { name: 'Continue', exact: true }).click();
  await imported;
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.locator('task').filter({ hasText: 'Encrypted settings round trip' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('task').filter({ hasText: 'Encrypted settings round trip' }),
  ).toBeVisible();
  await page.locator('a[href="#/config"]').click();
  await dialog.getByRole('button', { name: 'Import & export', exact: true }).click();
  await dialog.getByRole('button', { name: 'Browse backups', exact: true }).click();
  const backups = page.getByRole('dialog', {
    name: 'Backups on this device',
    exact: true,
  });
  await expect(backups.locator('button.backup').first()).toBeVisible();
  await backups.getByRole('button', { name: 'Clear all', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Clear all local backups?',
    exact: true,
  });
  await expect(confirmation).toContainText('This cannot be undone');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(backups.locator('button.backup').first()).toBeVisible();
  await backups.getByRole('button', { name: 'Clear all', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(backups.locator('button.backup')).toHaveCount(0);
  await backups.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(
    page.locator('task').filter({ hasText: 'Encrypted settings round trip' }),
  ).toBeVisible();
});

test('mobile appearance fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/config?tab=6');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.palette-preset')).toHaveCount(12);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/settings-appearance-mobile-refinement.png' });
});
