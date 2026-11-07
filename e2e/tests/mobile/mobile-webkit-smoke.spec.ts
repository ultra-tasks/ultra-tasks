import { expect, test } from '../../fixtures/test.fixture';

test.describe('Mobile WebKit smoke', () => {
  test('supports touch navigation and task creation', async ({ page, testPrefix }) => {
    const mobileNav = page.locator('mobile-bottom-nav');
    await expect(mobileNav).toBeVisible();

    await mobileNav.getByRole('button', { name: 'Upcoming', exact: true }).tap();
    await expect(page).toHaveURL(/\/#\/planner/);
    await expect(page.locator('planner')).toBeVisible();

    await mobileNav.getByRole('button', { name: 'Today', exact: true }).tap();
    await expect(page).toHaveURL(/\/#\/tag\/TODAY\/tasks/);
    await expect(page.locator('task-list').first()).toBeVisible();

    // The bottom nav has no add button: phones add through the list's inline row.
    await page.locator('.task-list-add-action').first().tap();
    const taskTitle = `${testPrefix}-MobileWebKit`;
    const addTaskInput = page.locator('add-task-bar .main-input');
    await expect(addTaskInput).toBeVisible();
    await addTaskInput.fill(taskTitle);
    await page.locator('.e2e-add-task-submit').tap();

    await expect(page.locator('task').filter({ hasText: taskTitle })).toHaveCount(1);
  });
});
