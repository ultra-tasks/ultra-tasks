import { expect, test } from '../../fixtures/test.fixture';

test.describe('Calendar polish', () => {
  test('marks today in the header and the column', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/schedule');
    await page.locator('schedule schedule-week').waitFor();

    await expect(page.locator('schedule .week-header-dates .day.is-today')).toHaveCount(
      1,
    );
    await expect(page.locator('schedule .col.is-today').first()).toBeAttached();
  });

  test('an empty week shows one line and a way to plan unscheduled tasks', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/schedule');
    await page.locator('schedule schedule-week').waitFor();

    const empty = page.locator('schedule .empty-week');
    await expect(empty).toContainText('Nothing scheduled this week');
    await expect(empty.getByRole('button')).toHaveCount(1);

    await empty.getByRole('button', { name: 'Plan unscheduled tasks' }).click();
    await expect(page).toHaveURL(/\/#\/planner/);
    await expect(page.locator('planner-unscheduled-panel')).toBeVisible();
  });

  test('the empty-week line goes away once something is scheduled', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize({ width: 1440, height: 900 });
    await workViewPage.addTask('Planned for today #today');
    await page.goto('/#/schedule');
    await page.locator('schedule schedule-week').waitFor();

    await expect(page.locator('schedule .empty-week')).toHaveCount(0);
  });
});
