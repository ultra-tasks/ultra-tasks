import { expect, test } from '../../fixtures/test.fixture';
import { Locator, Page } from '@playwright/test';

const editTitle = async (page: Page, task: Locator, value: string): Promise<void> => {
  const id = await task.getAttribute('data-task-id');
  await task.focus();
  await page.keyboard.press('Enter');
  const editor = page.locator(`task[data-task-id="${id}"] textarea`).first();
  await expect(editor).toBeVisible();
  await editor.fill(value);
  await editor.press('Tab');
};

test('undoes and redoes a plain saved title', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const original = `${testPrefix} Original title`;
  const updated = `${testPrefix} Updated title`;
  await workViewPage.addTask(original);
  await editTitle(page, taskPage.getTaskByText(original), updated);
  const task = taskPage.getTaskByText(updated);
  await expect(task).toBeVisible();
  await task.focus();
  await page.keyboard.press('Control+Z');
  await expect(taskPage.getTaskByText(original)).toBeVisible();
  await page.keyboard.press('Control+Y');
  await expect(taskPage.getTaskByText(updated)).toBeVisible();
});

test('does not undo an older edit across title short syntax', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const original = `${testPrefix} Original title`;
  const updated = `${testPrefix} Updated title`;
  await workViewPage.addTask(original);
  await editTitle(page, taskPage.getTaskByText(original), updated);
  await editTitle(page, taskPage.getTaskByText(updated), `${updated} p1`);
  const task = taskPage.getTaskByText(updated);
  await expect(task.locator('task-priority-indicator')).toHaveCount(1);
  await task.focus();
  await page.keyboard.press('Control+Z');
  await expect(taskPage.getTaskByText(original)).toHaveCount(0);
  await expect(taskPage.getTaskByText(updated)).toBeVisible();
  await expect(task.locator('task-priority-indicator')).toHaveCount(1);
});
