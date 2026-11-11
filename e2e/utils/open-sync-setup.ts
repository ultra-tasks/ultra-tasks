import { expect, type Page } from '@playwright/test';

/**
 * Opens the sync setup dialog without needing the header's sync button.
 *
 * The header button exists only once sync is switched on and a provider is
 * chosen, so a fresh profile, or one whose sync was just disabled, has no button
 * to click. The search command bar's "Set up sync" action opens the very same
 * dialog from anywhere, and leaves the current page where it is, so callers
 * continue from the view they were on.
 *
 * Use the header button (`SyncPage.syncBtn`) only for what it is for once sync
 * is set up: starting a sync and reading its state. Right-clicking it to
 * reconfigure still works on a configured profile.
 */
export const openSyncSetup = async (page: Page): Promise<void> => {
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  // A previous attempt can leave the popup open; do not toggle it shut.
  if (!(await search.isVisible())) {
    await page.keyboard.press('Control+F');
    await expect(search).toBeVisible();
  }
  const field = page.locator('search-page .search-field input');
  await expect(field).toBeFocused();
  await field.fill('set up sync');
  // The command is the typed match, so Enter runs it (see the command bar spec).
  await expect(page.locator('search-page .search-results.has-default')).toBeVisible();
  await page.keyboard.press('Enter');
  // Attached, not visible: a caller may be holding the dialog's config request
  // on purpose, and waits for the part of the form it needs itself.
  await expect(page.locator('dialog-sync-cfg')).toBeAttached();
};
