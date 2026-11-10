import { expect, test } from '../../fixtures/test.fixture';

test('undoes priority on a linked task and the title on a read-only import', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  const original = `${testPrefix} Linked task`;
  const renamed = `${testPrefix} Renamed task`;
  await workViewPage.addTask(original);
  const taskId = (await taskPage.getTaskByText(original).getAttribute('data-task-id'))!;
  await page.evaluate((id) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[IssueProvider/API] Upsert IssueProvider',
      issueProvider: {
        id: 'provider-1',
        issueProviderKey: 'JIRA',
        isEnabled: false,
        host: null,
        userName: null,
        password: null,
        transitionConfig: {},
        availableTransitions: [],
      },
    });
    store.dispatch({
      type: '[Task Shared] updateTask',
      task: {
        id,
        changes: {
          issueId: 'issue-1',
          issueProviderId: 'provider-1',
          issueType: 'JIRA',
          integration: {
            providerId: 'provider-1',
            providerKey: 'JIRA',
            remoteId: 'issue-1',
            mode: 'import',
          },
        },
      },
      meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'UPD' },
    });
  }, taskId);

  const row = page.locator(`task[data-task-id="${taskId}"]`);
  await row.focus();
  await page.keyboard.press('q');
  await page.getByRole('menuitem', { name: 'Priority' }).hover();
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await expect(row.locator('task-priority-indicator')).toHaveCount(1);
  await row.focus();
  await page.keyboard.press('Control+Z');
  await expect(row.locator('task-priority-indicator')).toHaveCount(0);
  await page.keyboard.press('Control+Y');
  await expect(row.locator('task-priority-indicator')).toHaveCount(1);

  await row.focus();
  await page.keyboard.press('Enter');
  const editor = row.locator('textarea').first();
  await expect(editor).toBeVisible();
  await editor.fill(renamed);
  await editor.press('Tab');
  await expect(row).toContainText(renamed);
  await row.focus();
  await page.keyboard.press('Control+Z');
  await expect(row).toContainText(original);
  await page.keyboard.press('Control+Y');
  await expect(row).toContainText(renamed);
});
