import { expect, test } from '../../fixtures/test.fixture';

test('plans an Inbox task from Upcoming and keeps it after reload', async ({
  page,
  workViewPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Plan this Inbox task');

  await page.goto('/#/planner');
  const planner = page.locator('planner');
  await planner.locator('planner-day').first().waitFor();
  await planner.locator('.inbox-toggle').click();
  const inboxTask = planner
    .locator('.inbox-task')
    .filter({ hasText: 'Plan this Inbox task' });
  await expect(inboxTask).toBeVisible();

  // Keyboard and touch users can open the existing scheduling dialog too.
  await inboxTask.getByRole('button', { name: 'Schedule task' }).click();
  await expect(page.locator('dialog-schedule-task')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog-schedule-task')).toHaveCount(0);

  const destination = planner.locator('planner-day').nth(1);
  const dropZone = destination.locator('.normal-tasks-items');
  const sourceBox = await inboxTask.boundingBox();
  const targetBox = await dropZone.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  const sx = sourceBox!.x + 30;
  const sourceHalfHeight = sourceBox!.height / 2;
  const targetHalfWidth = targetBox!.width / 2;
  const targetHalfHeight = targetBox!.height / 2;
  const sy = sourceBox!.y + sourceHalfHeight;
  const tx = targetBox!.x + targetHalfWidth;
  const ty = targetBox!.y + targetHalfHeight;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 10, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.up();

  await expect(inboxTask).toHaveCount(0);
  await expect(
    destination.locator('planner-task').filter({ hasText: 'Plan this Inbox task' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('planner-task').filter({ hasText: 'Plan this Inbox task' }),
  ).toBeVisible();
});
