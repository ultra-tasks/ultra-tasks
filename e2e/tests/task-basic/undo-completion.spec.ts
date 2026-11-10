import { expect, test } from '../../fixtures/test.fixture';

test('completion clears earlier task history without undoing another edit', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Completion history');
  await projectPage.navigateToProjectByName('Completion history');
  await workViewPage.waitForTaskList();
  const original = `${testPrefix} Original`;
  const renamed = `${testPrefix} Renamed`;
  await workViewPage.addTask(original);
  const task = taskPage.getTaskByText(original);
  const id = await task.getAttribute('data-task-id');
  await task.focus();
  await page.keyboard.press('Enter');
  const editor = page.locator(`task[data-task-id="${id}"] textarea`).first();
  await expect(editor).toBeVisible();
  await editor.fill(renamed);
  await editor.press('Tab');
  await expect(taskPage.getTaskByText(renamed)).toBeVisible();
  await page.locator(`task[data-task-id="${id}"]`).focus();
  await page.keyboard.press('Control+Z');
  await expect(taskPage.getTaskByText(original)).toBeVisible();
  await page.keyboard.press('Control+Y');
  await expect(taskPage.getTaskByText(renamed)).toBeVisible();

  await page.locator(`task[data-task-id="${id}"]`).focus();
  await page.keyboard.press('d');
  const done = page
    .locator('.task-list-inner[data-id="DONE"] > task.isDone')
    .filter({ hasText: renamed });
  await expect(done).toHaveCount(1);
  await page.keyboard.press('Control+Z');
  await expect(done).toHaveCount(1);
  await expect(taskPage.getTaskByText(original)).toHaveCount(0);
});
