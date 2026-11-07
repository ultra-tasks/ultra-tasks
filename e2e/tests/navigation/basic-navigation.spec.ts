import { test, expect } from '../../fixtures/test.fixture';

test.describe('Basic Navigation', () => {
  test('should navigate between main views', async ({ page, workViewPage }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();

    // Verify we're on work view
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();

    // Navigate to schedule view
    await page.goto('/#/schedule');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/schedule/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to history (merged Quick History + Worklog)
    await page.goto('/#/tag/TODAY/history');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/history/);
    await expect(page.locator('history')).toBeVisible();

    // Legacy worklog route still opens the full History view
    await page.goto('/#/tag/TODAY/worklog');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/worklog/);
    await expect(page.locator('history .total-time')).toBeVisible();

    // Legacy Quick History route now also opens the unified History view
    await page.goto('/#/tag/TODAY/quick-history');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/quick-history/);
    await expect(page.locator('history .total-time')).toBeVisible();

    // Navigate to metrics
    await page.goto('/#/tag/TODAY/metrics');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/metrics/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to planner
    await page.goto('/#/planner');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/planner/);
    await expect(page.locator('.route-wrapper')).toBeVisible();

    // Navigate to daily summary
    await page.goto('/#/tag/TODAY/daily-summary');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/daily-summary/);
    await expect(page.locator('daily-summary')).toBeVisible();

    // Navigate to settings. They open as a dialog over the current view (the
    // route stays where it was), so the dialog is what proves they opened.
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.page-settings')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    // Navigate back to work view
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });

  test('should navigate using side nav buttons', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    // Wait for work view to be ready
    await workViewPage.waitForTaskList();
    const sideNav = page.locator('magic-side-nav');

    // Settings opens as a dialog over the current view instead of a route
    await sideNav.getByText('Settings', { exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.page-settings')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await settingsPage.closeSettings();

    // Side nav buttons change the route: Planner, then back via the Today tag
    await sideNav.getByText('Upcoming', { exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/planner/);

    await sideNav.getByText('Today', { exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/#\/tag\/TODAY/);
    await expect(page.locator('task-list').first()).toBeVisible();
  });
});
