import { expect, Page } from '@playwright/test';

/** Navigate without reloading, preserving sync-test barriers installed in the page. */
export const openIntegrations = async (page: Page): Promise<void> => {
  await page
    .locator('magic-side-nav')
    .getByRole('menuitem', { name: 'Integrations', exact: true })
    .click();
  await expect(page.locator('integrations-page')).toBeVisible();
};

export const openIntegrationSetup = async (page: Page): Promise<void> => {
  await openIntegrations(page);
  await page
    .locator('integrations-page')
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
};

/** Keep the source's configured destination and explicitly opt into supported writes. */
export const finishIntegrationSetup = async (page: Page): Promise<void> => {
  const setup = page.locator('integration-setup');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.locator('input[name="project-mode"]').nth(1).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  // The review step renders asynchronously; all() alone can return an empty list.
  await setup.locator('integration-fields select').first().waitFor();
  for (const select of await setup.locator('integration-fields select').all()) {
    if (
      (await select.inputValue()) !== 'off' &&
      (await select.locator('option[value="both"]').count())
    )
      await select.selectOption('both');
  }
  await setup.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(setup).toBeHidden();
};

export const leaveIntegrations = async (page: Page): Promise<void> => {
  await page
    .locator('magic-side-nav')
    .getByRole('menuitem', { name: 'Today', exact: false })
    .first()
    .click();
};
