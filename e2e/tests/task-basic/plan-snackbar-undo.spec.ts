import { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

const planTodayWithSnack = async (page: Page, row: Locator): Promise<Locator> => {
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const undo = page
    .locator('snack-custom')
    .getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible();
  return undo;
};

test('a fresh plan snack undoes its own task plan', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Fresh plan snack');
  await projectPage.navigateToProjectByName('Fresh plan snack');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix} Plan me`);
  const row = taskPage.getTaskByText(`${testPrefix} Plan me`);
  const undo = await planTodayWithSnack(page, row);
  await row.hover();
  await expect(row.locator('button[title*="Remove from"]')).toHaveCount(1);
  await undo.click();
  await row.hover();
  await expect(row.locator('button[title*="Remove from"]')).toHaveCount(0);
});

test('an older task A plan snack does not undo a later task B plan', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Plan snack identity');
  await projectPage.navigateToProjectByName('Plan snack identity');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix} Task A`);
  await workViewPage.addTask(`${testPrefix} Task B`);
  const a = taskPage.getTaskByText(`${testPrefix} Task A`);
  const b = taskPage.getTaskByText(`${testPrefix} Task B`);
  const undo = await planTodayWithSnack(page, a);
  await b.focus();
  await page.keyboard.press('Alt+T');
  await b.hover();
  await expect(b.locator('button[title*="Remove from"]')).toHaveCount(1);
  await undo.click();
  await b.hover();
  await expect(b.locator('button[title*="Remove from"]')).toHaveCount(1);
  await a.hover();
  await expect(a.locator('button[title*="Remove from"]')).toHaveCount(1);
});

test('an older plan snack does not undo a later unrelated priority edit', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Plan snack unrelated edit');
  await projectPage.navigateToProjectByName('Plan snack unrelated edit');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask(`${testPrefix} Task A`);
  await workViewPage.addTask(`${testPrefix} Task B`);
  const a = taskPage.getTaskByText(`${testPrefix} Task A`);
  const b = taskPage.getTaskByText(`${testPrefix} Task B`);
  const undo = await planTodayWithSnack(page, a);
  await b.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Priority/ }).click();
  await page.getByRole('menuitemradio', { name: /High/ }).click();
  await expect(b.locator('task-priority-indicator')).toHaveCount(1);
  await b.focus();
  await page.keyboard.press('Control+Z');
  await expect(b.locator('task-priority-indicator')).toHaveCount(0);
  await page.keyboard.press('Control+Y');
  await expect(b.locator('task-priority-indicator')).toHaveCount(1);
  await undo.click();
  await expect(b.locator('task-priority-indicator')).toHaveCount(1);
  await a.hover();
  await expect(a.locator('button[title*="Remove from"]')).toHaveCount(1);
});
