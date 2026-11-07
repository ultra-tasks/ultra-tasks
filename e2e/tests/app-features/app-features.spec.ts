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
      label: 'Issues panel',
      locator: (page: Page) => page.locator('.e2e-toggle-issue-provider-panel'),
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
    test(`Element assigned with App feature ${feature.title ?? feature.label} is only visible if feature is enabled`, async ({
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

  test('Issues panel app feature hides the mobile drawer panel option', async ({
    page,
    settingsPage,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const featureSwitch = page.getByRole('switch', {
      name: 'Issues panel',
      exact: true,
    });
    // On phones the right-panel toggles are action rows in the Browse drawer.
    const drawer = page.locator('.nav-sidenav.mobile');
    const issuePanelRow = drawer.getByRole('menuitem', { name: /Issue Provider Panel/ });
    const notesRow = drawer.getByRole('menuitem', { name: /Project Notes/ });
    const browseButton = page.locator('mobile-bottom-nav .e2e-bottom-nav-browse');

    await goToMainView(page);
    await expect(page.locator('mobile-bottom-nav')).toBeVisible();
    await browseButton.click();
    await expect(issuePanelRow).toBeVisible();
    await page.locator('.mobile-menu-close').click();
    await expect(drawer).toBeHidden();

    await goToAppFeatures(settingsPage);
    await expect(featureSwitch).toBeVisible();
    await expect(featureSwitch).toBeChecked();
    await featureSwitch.click();
    await expect(featureSwitch).not.toBeChecked();

    await goToMainView(page);
    await expect(page.locator('mobile-bottom-nav')).toBeVisible();
    await browseButton.click();
    await expect(notesRow).toBeVisible();
    await expect(issuePanelRow).not.toBeAttached();
  });
});
