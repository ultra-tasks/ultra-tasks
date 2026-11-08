import { expect, test } from '../../fixtures/test.fixture';
import { expectNoGlobalError } from '../../utils/assertions';

const openSetup = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/#/integrations');
  await page
    .locator('integrations-page')
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
};

test.describe('Integration setup', () => {
  test('should render after reload without waiting for browser idle', async ({
    page,
    workViewPage,
  }) => {
    // Reproduce idle starvation matching the empty sidebar in run 39134085117:
    // the panel opens after reload before the browser grants an idle callback.
    await page.addInitScript(() => {
      let nextId = 0;
      window.requestIdleCallback = () => ++nextId;
      window.cancelIdleCallback = () => {};
    });
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect(page.locator('.e2e-toggle-issue-provider-panel')).not.toBeAttached();
    await page.keyboard.press('p');
    await expect(page.locator('integrations-page')).toBeVisible();
    await expect(page.locator('issue-panel')).not.toBeAttached();
    await page
      .locator('integrations-page')
      .getByRole('button', { name: 'Connect account', exact: true })
      .click();
    await expect(
      page.locator('integration-setup .provider-choice').first(),
    ).toBeVisible();
  });

  test('should open all dialogs without error', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    await openSetup(page);
    await page.locator('integration-setup .provider-choice').first().waitFor();

    // Start capturing page errors only after the panel is settled so we don't
    // pick up unrelated startup noise (vite overlay, lazy-chunk warnings, etc.)
    // that the surrounding suite tolerates.
    const pageErrors: string[] = [];
    const onPageError = (error: Error): void => {
      pageErrors.push(error.message);
    };
    page.on('pageerror', onPageError);

    // Get all buttons in the issue provider setup overview
    const setupButtons = page.locator('integration-setup .provider-choice');
    const buttonCount = await setupButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click each button and close the dialog
    const providerNames = await setupButtons.locator('span').allTextContents();
    let openedDialogCount = 0;
    for (const name of providerNames) {
      const button = setupButtons.filter({ hasText: name.trim() });

      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();

      // Wait for dialog to open
      const dialogContainer = page.locator('mat-dialog-container');
      await expect(dialogContainer).toBeVisible({ timeout: 5000 });
      openedDialogCount++;

      // Close the dialog from within the dialog container. Cancel is found by
      // name: the "Test connection" action now sits before it at the start.
      const cancelBtn = dialogContainer.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });
      await expect(cancelBtn).toBeVisible({ timeout: 5000 });
      await cancelBtn.click();

      // Wait for dialog to close
      await expect(dialogContainer).toBeHidden({ timeout: 5000 });

      // Ensure we're back on the issue provider panel
      await expect(page.locator('integration-setup')).toBeVisible({
        timeout: 3000,
      });
    }

    expect(openedDialogCount).toBe(buttonCount);
    page.off('pageerror', onPageError);
    await expectNoGlobalError(page);
    expect(pageErrors).toEqual([]);
  });
});
