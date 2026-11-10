import { expect, test } from '../../fixtures/test.fixture';

test('search actions open the existing composer and Focus overlay', async ({ page }) => {
  await page.getByText('Search', { exact: true }).first().click();
  const search = page.locator('dialog-search');
  await expect(search).toBeVisible();
  await search.getByRole('button', { name: /Add new task/ }).click();
  await expect(page.locator('add-task-bar.global')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('add-task-bar.global')).toHaveCount(0);

  await page.getByText('Search', { exact: true }).first().click();
  await search.getByRole('button', { name: /Enter focus mode/ }).click();
  await expect(page.locator('focus-mode-overlay')).toBeVisible();
  await expect(page.locator('focus-mode-main .play-button')).toBeDisabled();
  await page.locator('focus-mode-overlay .close-btn').click();
  await expect(page.locator('focus-mode-overlay')).toHaveCount(0);
});

test('the task-panel close action returns to the task list', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.addTask('Review the task panel');
  const task = taskPage.getTaskByText('Review the task panel');
  await taskPage.openTaskDetail(task);
  await page.locator('right-panel .task-detail-close-btn').click();
  await expect(page.locator('right-panel task-detail-panel')).toHaveCount(0);
  await expect(task).toBeVisible();
});

test('Calendar and Upcoming remain usable at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/schedule');
  await expect(page.locator('schedule .schedule-nav-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View day' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.goto('/#/planner');
  await expect(page.locator('planner-day').first()).toBeVisible();
  await expect(page.locator('planner .inbox-toggle')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
