import { expect, type Page } from '@playwright/test';

/** Create real header actions so layout tests do not depend on default button counts. */
export const createHeaderCounters = async (
  page: Page,
  titles: string[],
): Promise<void> => {
  await page.goto('/#/habits');
  await page.waitForURL(/habits/);

  for (const title of titles) {
    await page.locator('.add-habit-btn').click();
    const dialog = page.locator('dialog-simple-counter-edit-settings');
    await expect(dialog).toBeVisible();
    await dialog.locator('formly-form input').first().fill(title);
    await dialog.locator('mat-select').first().click();
    await page.locator('mat-option:has-text("Click Counter")').click();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeHidden();
  }

  await page.goto('/#/tag/TODAY/tasks');
  await page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
  await expect(page.locator('.counters-action-group simple-counter-button')).toHaveCount(
    titles.length,
  );
};
