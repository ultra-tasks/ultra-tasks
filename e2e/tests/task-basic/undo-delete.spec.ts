import { expect, test } from '../../fixtures/test.fixture';

test('undoes and redoes deleting a task', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Delete history');
  await projectPage.navigateToProjectByName('Delete history');
  await workViewPage.waitForTaskList();
  const title = `${testPrefix} Delete me`;
  await workViewPage.addTask(title);
  await workViewPage.addTask(`${testPrefix} Neighbour`);
  const task = taskPage.getTaskByText(title);
  const id = await task.getAttribute('data-task-id');
  const row = page.locator(`task[data-task-id="${id}"]`);
  const confirm = page.locator('mat-dialog-actions button:has-text("Delete")');

  // Delete confirmation is on at the defaults, so Backspace opens the dialog.
  await expect(async () => {
    if (!(await confirm.isVisible())) {
      await row.focus();
      await page.keyboard.press('Backspace');
    }
    await expect(confirm).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 15000 });
  await confirm.click();
  await expect(row).toHaveCount(0);

  await page.keyboard.press('Control+Z');
  await expect(row).toHaveCount(1);

  await page.keyboard.press('Control+Y');
  await expect(row).toHaveCount(0);

  await page.keyboard.press('Control+Z');
  await expect(row).toHaveCount(1);
  await expect(taskPage.getTaskByText(`${testPrefix} Neighbour`)).toBeVisible();
});
