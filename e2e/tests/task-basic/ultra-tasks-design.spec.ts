import { expect, test } from '../../fixtures/test.fixture';
import { openGlobalAddTaskBar } from '../../utils/element-helpers';
import { openProjectViewMenu } from '../../utils/project-view';

test('Ultra Tasks workspace stays readable across themes and narrow screens', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  for (const name of [
    'Plan the week',
    'Review the design proposal',
    'Prepare a project update',
    'Book a quiet hour for focused work',
    'Send feedback to the team',
  ]) {
    await workViewPage.addTask(name);
  }
  await openGlobalAddTaskBar(page);
  // One visible destination control (the project chip); the live region is
  // only announced to assistive tech.
  await expect(page.locator('add-task-bar.global .st-capture-context')).toHaveText(
    /Adding to Inbox/,
  );
  await expect(
    page.locator('add-task-bar.global .action-bar .action-btn').first(),
  ).toContainText('Inbox');
  await page.locator('add-task-bar.global .main-input').click();
  await page.screenshot({
    animations: 'disabled',
    path: '.tmp/e2e-test-results/ultra-tasks-capture.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('add-task-bar.global')).toHaveCount(0);
  await expect(page.locator('.st-brand')).toBeVisible();
  await expect(page.locator('.st-brand img')).toHaveJSProperty('complete', true);
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await expect(page.locator('body')).toHaveClass(dark ? /isDarkTheme/ : /isLightTheme/);
    await page.screenshot({
      animations: 'disabled',
      path: `.tmp/e2e-test-results/ultra-tasks-${dark ? 'dark' : 'light'}.png`,
      fullPage: true,
    });
  }
  await taskPage.openTaskDetail(taskPage.getTaskByText('Review the design proposal'));
  await expect(page.locator('task-detail-panel .st-planning-actions button')).toHaveCount(
    2,
  );
  await expect(page.locator('task-detail-panel')).toContainText('Description');
  await page.screenshot({
    path: '.tmp/e2e-test-results/ultra-tasks-details.png',
    fullPage: true,
  });
  await page.locator('.st-planning-actions button').first().click();
  await expect(page.locator('mat-dialog-container')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('mat-dialog-container')).toHaveCount(0);
  await page.locator('.st-brand').focus();
  await page.locator('.st-brand').press('Enter');
  await expect(page).toHaveURL(/tag\/TODAY\/tasks/);
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('work-view-page')).toHaveCount(1);
  await expect(page.locator('work-view-page segmented-button-group')).toHaveCount(0);
  await openProjectViewMenu(page);
  await expect(
    page.getByRole('menuitemradio', { name: 'Upcoming', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: '.tmp/e2e-test-results/ultra-tasks-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
