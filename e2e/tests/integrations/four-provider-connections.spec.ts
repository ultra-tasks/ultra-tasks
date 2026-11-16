import { expect, test } from '../../fixtures/test.fixture';
import {
  FOUR_PROVIDERS,
  connectProvider,
  linkedTasks,
  mockProvider,
  openLinkedTaskList,
  refreshProviderItem,
} from '../../utils/four-provider-fixtures';
import { openIntegrations } from '../../utils/integration-workspace';

for (const key of FOUR_PROVIDERS) {
  test(`${key} connection retains a rejected edit and retries after permission is restored`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const source = await mockProvider(page, key);
    await connectProvider(page, key);
    const [original] = await linkedTasks(page);
    await openLinkedTaskList(page);
    source.rejectWrites = true;
    const task = page.locator(`task[data-task-id="${original.id}"]`);
    await task.locator('task-title').click();
    await task.locator('textarea').fill(`${key} retained edit`);
    await page.keyboard.press('Tab');
    await expect.poll(() => source.deniedWrites).toBe(1);
    expect(source.title).toBe(`${key} source item`);
    expect(source.creates).toEqual([]);
    await expect(task).toContainText(`${key} retained edit`);
    source.rejectWrites = false;
    await refreshProviderItem(page);
    await expect.poll(() => source.title).toBe(`${key} retained edit`);
    expect(source.writes).toHaveLength(1);
  });

  test(`${key} connection cancels queued edits on Stop tracking and never deletes remotely`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const source = await mockProvider(page, key);
    await connectProvider(page, key);
    const [original] = await linkedTasks(page);
    await openLinkedTaskList(page);
    let release!: () => void;
    source.writeBarrier = new Promise<void>((resolve) => (release = resolve));
    try {
      const task = page.locator(`task[data-task-id="${original.id}"]`);
      await task.locator('task-title').click();
      await task.locator('textarea').fill(`${key} first edit`);
      await page.keyboard.press('Tab');
      await expect.poll(() => source.startedWrites).toBe(1);
      await task.locator('task-title').click();
      await task.locator('textarea').fill(`${key} stopped edit`);
      await page.keyboard.press('Tab');
      await openIntegrations(page);
      await page.locator('.workspace-grid .integration-task input').check();
      await page.getByRole('button', { name: 'Hide', exact: true }).click();
      await page.locator('.tabs button').filter({ hasText: 'Hidden' }).click();
      await page.locator('.workspace-grid .integration-task input').check();
      await page.getByRole('button', { name: 'Stop tracking', exact: true }).click();
      await page
        .locator('dialog-confirm')
        .getByRole('button', { name: 'Stop tracking', exact: true })
        .click();
      await page.locator('dialog-confirm').waitFor({ state: 'hidden' });
      release();
      await expect.poll(() => source.writes.length).toBe(1);
      // A deliberate idle window proves a queued second write does not run.
      await page.waitForTimeout(500);
      expect(source.writes).toHaveLength(1);
      expect(source.title).toBe(`${key} first edit`);
      expect(source.requests.filter((request) => request.startsWith('DELETE '))).toEqual(
        [],
      );
      expect(source.creates).toEqual([]);
      await page.locator('.tabs button').filter({ hasText: 'Stopped' }).click();
      await expect(page.locator('.workspace-grid')).toContainText(`${key} stopped edit`);
    } finally {
      release();
    }
  });

  test(`${key} connection creates one issue for an explicitly enabled local task`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const source = await mockProvider(page, key);
    await connectProvider(page, key);
    await page
      .locator('.connection')
      .getByRole('button', { name: 'Connection settings', exact: true })
      .click();
    const dialog = page.locator('mat-dialog-container');
    const advanced = dialog.getByText('Advanced Config', { exact: true });
    await advanced.click();
    await dialog
      .getByRole('combobox', { name: 'Default Ultra Tasks Project', exact: true })
      .click();
    await page.getByRole('option', { name: 'Inbox', exact: true }).click();
    await dialog.getByText('Two-Way Sync (experimental)', { exact: true }).click();
    await dialog
      .getByRole('checkbox', { name: 'Auto-create issues for new tasks', exact: true })
      .check();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await openLinkedTaskList(page);
    await workViewPage.addTask(`${key} created locally`);
    await expect.poll(() => source.creates.length).toBe(1);
    await expect.poll(async () => (await linkedTasks(page)).length).toBe(2);
    expect(new Set((await linkedTasks(page)).map((task) => task.id)).size).toBe(2);
    await page.reload();
    await expect.poll(async () => (await linkedTasks(page)).length).toBe(2);
    expect(source.creates).toHaveLength(1);
  });
  test(`${key} connection imports, writes explicit changes, refreshes and retains identity`, async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    const source = await mockProvider(page, key);
    await connectProvider(page, key);
    expect(source.writes).toEqual([]);
    expect(
      source.authorizations.some((value) => value.includes('fixture-local-token')),
    ).toBe(true);
    const [original] = await linkedTasks(page);
    await openLinkedTaskList(page);
    const task = page.locator(`task[data-task-id="${original.id}"]`);
    await task.locator('task-title').click();
    await task.locator('textarea').fill(`${key} updated locally`);
    await page.keyboard.press('Tab');
    await expect(task.locator('task-title')).toContainText(`${key} updated locally`);
    await expect.poll(() => source.title).toBe(`${key} updated locally`);
    if (key !== 'TRELLO') {
      await taskPage.openTaskDetail(task);
      const editor = page
        .locator('task-detail-panel inline-markdown .cm-content')
        .first();
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.insertText(`${key} local description`);
      await page.keyboard.press('Escape');
      await editor.blur();
      await expect.poll(() => source.body).toBe(`${key} local description`);
    }
    await taskPage.markTaskAsDone(task);
    await expect.poll(() => source.done).toBe(true);
    expect(source.creates).toEqual([]);

    source.title = `${key} updated remotely`;
    source.body = `${key} remote description`;
    source.done = false;
    source.version++;
    await refreshProviderItem(page);
    await expect
      .poll(async () => (await linkedTasks(page))[0]?.title)
      .toContain('updated remotely');
    await expect.poll(async () => (await linkedTasks(page))[0]?.isDone).toBe(false);
    if (key !== 'TRELLO')
      await expect
        .poll(async () => (await linkedTasks(page))[0]?.notes)
        .toBe(`${key} remote description`);
    expect((await linkedTasks(page)).map((item) => item.id)).toEqual([original.id]);
    const count = source.writes.length;
    await page.reload();
    await refreshProviderItem(page);
    expect((await linkedTasks(page)).map((item) => item.id)).toEqual([original.id]);
    expect(source.writes).toHaveLength(count);
  });
}

test('TRELLO connection previews and moves completion to Done without archiving', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await workViewPage.waitForTaskList();
  const source = await mockProvider(page, 'TRELLO');
  await connectProvider(page, 'TRELLO', false, true);
  const [original] = await linkedTasks(page);
  await openLinkedTaskList(page);
  const task = page.locator(`task[data-task-id="${original.id}"]`);
  await taskPage.markTaskAsDone(task);
  await expect.poll(() => source.listId).toBe('list-done');
  expect(source.writes).toEqual([{ idList: 'list-done' }]);
  await task.locator('done-toggle').click();
  await expect.poll(() => source.listId).toBe('list-open');
  expect(source.writes[1]).toEqual({ idList: 'list-open', closed: false });
});
