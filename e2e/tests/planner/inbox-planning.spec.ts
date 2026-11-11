import { expect, test } from '../../fixtures/test.fixture';

// The toggle sits with Upcoming's page title; the panel lists unscheduled tasks.
const toggle = 'page-title .planner-unscheduled-toggle';

test('plans an unscheduled task from the Upcoming panel and keeps it after reload', async ({
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
  await page.locator(toggle).click();
  const panel = planner.locator('planner-unscheduled-panel');
  const row = panel.locator('.row').filter({ hasText: 'Plan this Inbox task' });
  await expect(row).toBeVisible();

  // Keyboard and touch users can open the existing scheduling dialog too.
  await row.getByRole('button', { name: 'Schedule task' }).click();
  await expect(page.locator('dialog-schedule-task')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog-schedule-task')).toHaveCount(0);

  const destination = planner.locator('planner-day').nth(1);
  const dropZone = destination.locator('.normal-tasks-items');
  const sourceBox = await row.boundingBox();
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

  await expect(row).toHaveCount(0);
  await expect(
    destination.locator('planner-task').filter({ hasText: 'Plan this Inbox task' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('planner-task').filter({ hasText: 'Plan this Inbox task' }),
  ).toBeVisible();
});

test('the panel remembers it was open and filters unscheduled tasks by project', async ({
  page,
  workViewPage,
  projectPage,
  testPrefix,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Filter project');
  await projectPage.navigateToProjectByName('Filter project');
  await workViewPage.addTask(`${testPrefix}-in the project`);
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix}-in the inbox`);

  await page.goto('/#/planner');
  await page.locator('planner planner-day').first().waitFor();
  await page.locator(toggle).click();
  const panel = page.locator('planner-unscheduled-panel');
  await expect(panel.locator('.row')).toHaveCount(2);

  // Open state and filter are device-local and survive a reload.
  await panel.getByRole('button', { name: 'Show tasks from' }).click();
  // Scoped to the open menu: the side nav has an Inbox menu item too.
  await page
    .locator('.mat-mdc-menu-panel')
    .getByRole('menuitem', { name: 'Inbox' })
    .click();
  await expect(panel.locator('.row')).toHaveCount(1);
  await expect(panel.locator('.row')).toContainText('in the inbox');
  await page.reload();
  await expect(panel.locator('.row')).toHaveCount(1);
  await expect(page.locator(toggle)).toHaveAttribute('aria-expanded', 'true');

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(page.locator(toggle)).toHaveAttribute('aria-expanded', 'false');
});
