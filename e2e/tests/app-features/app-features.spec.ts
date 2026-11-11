import { Page } from 'playwright/test';
import { test, expect } from '../../fixtures/test.fixture';
import { SettingsPage } from '../../pages/settings.page';
import { waitForAngularStability } from '../../utils/waits';

// Open the settings window on "App features" with every switch reachable:
// Planner, Boards and Project notes are always shown, the rest sit behind the
// section's "More options" toggle.
const goToAppFeatures = async (settingsPage: SettingsPage): Promise<void> => {
  await settingsPage.openSettingsSection('appFeatures');
};

// Navigate to main view and wait for it to be ready
const goToMainView = async (page: Page): Promise<void> => {
  await page.goto('/#/tag/TODAY/tasks');
  await waitForAngularStability(page);
};

test.describe('App Features', () => {
  // check simple feature toggles which effectively just hide ui elements
  [
    {
      label: 'Calendar',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Calendar' }),
    },
    {
      label: 'Upcoming',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Upcoming' }),
    },
    {
      label: 'Boards',
      locator: (page: Page) => page.getByRole('menuitem', { name: 'Boards' }),
    },
    {
      label: 'Project notes',
      locator: (page: Page) => page.locator('.e2e-toggle-notes-btn'),
    },
    {
      label: 'Sync button',
      locator: (page: Page) => page.locator('.sync-btn'),
    },
  ].forEach((feature) => {
    test(`Element assigned with App feature ${feature.label} is only visible if feature is enabled`, async ({
      page,
      settingsPage,
    }) => {
      const featureElement = feature.locator(page);

      // elements on settings page
      const featureSwitch = page.getByRole('switch', {
        name: feature.label,
        exact: true,
      });

      // Go to settings page
      await goToAppFeatures(settingsPage);
      await expect(featureSwitch).toBeVisible();

      // Ensure feature is enabled (all features are enabled by default)
      await expect(featureSwitch).toBeChecked();

      // Click switch to disable and wait for state change
      await featureSwitch.click();
      await expect(featureSwitch).not.toBeChecked();

      // Navigate to main view
      await goToMainView(page);

      // Feature's element should not be present when disabled
      await expect(featureElement).not.toBeAttached();

      // Re-enable the feature
      await goToAppFeatures(settingsPage);
      await expect(featureSwitch).toBeVisible();

      // Click toggle button to enable and verify state change
      await featureSwitch.click();
      await expect(featureSwitch).toBeChecked();

      // Go back to main view and expect feature's element to be visible
      await goToMainView(page);
      await expect(featureElement).toBeAttached();
    });
  });

  test('the retired issues panel has no desktop or mobile toggle', async ({
    page,
    settingsPage,
  }) => {
    await goToMainView(page);
    await expect(page.locator('.e2e-toggle-issue-provider-panel')).not.toBeAttached();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('mobile-bottom-nav')).toBeVisible();
    await expect(page.locator('.e2e-toggle-issue-provider-panel')).not.toBeAttached();
    await page.locator('mobile-bottom-nav .tour-navMenuBtn').click();
    const drawer = page.locator('.nav-sidenav.mobile');
    await expect(
      drawer.getByRole('menuitem', { name: /Issue Provider Panel/ }),
    ).not.toBeAttached();
    await expect(drawer.getByRole('menuitem', { name: /Project Notes/ })).toBeVisible();
    // Nothing is connected, so Integrations has no sidebar row yet; the
    // workspace stays reachable by its route.
    await expect(
      page
        .locator('magic-side-nav')
        .getByRole('menuitem', { name: 'Integrations', exact: true }),
    ).toHaveCount(0);
    await page.goto('/#/integrations');
    await expect(page.locator('integrations-page')).toBeVisible();
    await goToAppFeatures(settingsPage);
    await expect(
      page.getByRole('switch', { name: 'Issues panel', exact: true }),
    ).not.toBeAttached();
  });
});
