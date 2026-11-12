import { expect, test } from '../../fixtures/test.fixture';

test('undoes and redoes adding an unscheduled task to Today', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Add to Today history');
  await projectPage.navigateToProjectByName('Add to Today history');
  await workViewPage.waitForTaskList();
  const title = `${testPrefix} Plan me`;
  await workViewPage.addTask(title);
  const task = taskPage.getTaskByText(title);
  const id = await task.getAttribute('data-task-id');
  const row = page.locator(`task[data-task-id="${id}"]`);
  const removeFromToday = row.locator('button[title*="Remove from"]');

  await row.hover();
  await expect(removeFromToday).toHaveCount(0);

  await row.focus();
  await page.keyboard.press('Alt+T');
  await row.hover();
  await expect(removeFromToday).toHaveCount(1);

  await page.keyboard.press('Control+Z');
  await row.hover();
  await expect(removeFromToday).toHaveCount(0);

  await page.keyboard.press('Control+Y');
  await row.hover();
  await expect(removeFromToday).toHaveCount(1);
});
