import { expect, test } from '../../fixtures/test.fixture';

const openGlobalSearch = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.keyboard.press('Control+F');
  await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.locator('search-page .search-field input')).toBeFocused();
};

test.describe('Search as a command bar', () => {
  test('lists places and actions while the field is empty', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await openGlobalSearch(page);

    const search = page.locator('search-page');
    await expect(search.getByRole('button', { name: /^Today/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /^Inbox/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /^Upcoming/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /^Settings/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /Add new task/ })).toBeVisible();
    // Nothing is marked as the match Enter would open until something is typed.
    await expect(page.locator('search-page .search-results.has-default')).toHaveCount(0);
  });

  test('goes to a place with the keyboard alone: type, Enter, and Escape returns', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await openGlobalSearch(page);

    await page.keyboard.type('upcom');
    await expect(page.locator('search-page .search-results.has-default')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/#\/planner/);
    await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toHaveCount(
      0,
    );

    // Escape closes the popup and leaves the page where it was.
    await openGlobalSearch(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toHaveCount(
      0,
    );
    await expect(page).toHaveURL(/\/#\/planner/);
  });

  test('runs an action from a place that is not the work view', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.goto('/#/planner');
    await page.locator('planner planner-day').first().waitFor();
    await openGlobalSearch(page);

    await page.keyboard.type('add new');
    await page.keyboard.press('Enter');
    await expect(page.locator('add-task-bar.global')).toBeVisible();
    await expect(page).toHaveURL(/\/#\/planner/);
  });

  test('previews a task from another list without leaving the page', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Peek me`;
    await workViewPage.addTask(title);
    await page.goto('/#/planner');
    await page.locator('planner planner-day').first().waitFor();
    await expect(page.locator('right-panel task-detail-panel')).toHaveCount(0);

    await openGlobalSearch(page);
    await page.keyboard.type(title);
    await expect(
      page.locator('search-page .search-result').filter({ hasText: title }),
    ).toHaveCount(1);
    await expect(page.locator('search-page .search-hint')).toBeVisible();
    await page.keyboard.press('Shift+Enter');

    await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('right-panel task-detail-panel')).toBeVisible();
    await expect(page.locator('right-panel task-detail-panel')).toContainText(title);
    // Still on Upcoming: previewing is not navigating.
    await expect(page).toHaveURL(/\/#\/planner/);

    await page.locator('right-panel .task-detail-close-btn').click();
    await expect(page.locator('right-panel task-detail-panel')).toHaveCount(0);
    await expect(page).toHaveURL(/\/#\/planner/);
  });
});
