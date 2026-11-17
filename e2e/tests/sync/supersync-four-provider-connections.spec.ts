import { expect, test } from '../../fixtures/supersync.fixture';
import { TaskPage } from '../../pages/task.page';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  FOUR_PROVIDERS,
  connectProvider,
  linkedTasks,
  mockProvider,
  openLinkedTaskList,
  refreshProviderItem,
} from '../../utils/four-provider-fixtures';

const sync = async (client: SimulatedE2EClient): Promise<void> => {
  await client.sync.triggerSync();
  await expect(client.sync.syncConfirmedIcon).toBeVisible();
  await expect(client.sync.syncSpinner).toBeHidden();
  expect(await client.sync.hasSyncError()).toBe(false);
};

test.describe('@supersync four-provider owner handoff', () => {
  for (const key of FOUR_PROVIDERS) {
    test(`${key}: peer edits wait for the owner and retain one source identity`, async ({
      browser,
      baseURL,
      testRunId,
    }) => {
      const user = await createTestUser(`${testRunId}-${key}`);
      const owner = await createSimulatedClient(
        browser,
        baseURL!,
        'Owner',
        `${testRunId}-owner`,
      );
      const peer = await createSimulatedClient(
        browser,
        baseURL!,
        'Peer',
        `${testRunId}-peer`,
      );
      try {
        const source = await mockProvider(owner.page, key);
        const peerSource = await mockProvider(peer.page, key);
        await owner.sync.setupSuperSync(getSuperSyncConfig(user));
        await connectProvider(owner.page, key);
        const [original] = await linkedTasks(owner.page);
        await sync(owner);
        await peer.sync.setupSuperSync(getSuperSyncConfig(user));
        await sync(peer);
        await expect
          .poll(async () => (await linkedTasks(peer.page)).map((t) => t.id))
          .toEqual([original.id]);
        await openLinkedTaskList(peer.page);
        const task = peer.page.locator(`task[data-task-id="${original.id}"]`);
        await task.locator('task-title').click();
        await expect(task.locator('textarea')).toBeFocused();
        await task.locator('textarea').fill(`${key} peer edit`);
        await peer.page.keyboard.press('Tab');
        await expect
          .poll(async () => (await linkedTasks(peer.page))[0].title)
          .toContain('peer edit');
        const peerTasks = new TaskPage(peer.page);
        await peerTasks.openTaskDetail(task);
        await expect(peer.page.locator('integration-task-source')).toContainText(
          'Waiting for',
        );
        if (key !== 'TRELLO') {
          const editor = peer.page
            .locator('task-detail-panel inline-markdown .cm-content')
            .first();
          await editor.click();
          await peer.page.keyboard.press('ControlOrMeta+a');
          await peer.page.keyboard.insertText(`${key} peer description`);
          await peer.page.keyboard.press('Escape');
          await editor.blur();
          await expect
            .poll(async () => (await linkedTasks(peer.page))[0].notes)
            .toBe(`${key} peer description`);
        }
        await peerTasks.markTaskAsDone(task);
        expect(peerSource.writes).toEqual([]);
        expect(peerSource.creates).toEqual([]);
        await sync(peer);
        await sync(owner);
        await refreshProviderItem(owner.page);
        await expect.poll(() => source.title).toBe(`${key} peer edit`);
        await expect.poll(() => source.done).toBe(true);
        if (key !== 'TRELLO') expect(source.body).toBe(`${key} peer description`);
        await sync(owner);
        await sync(peer);
        await refreshProviderItem(owner.page);
        expect(source.writes).toHaveLength(1);
        expect(source.creates).toEqual([]);
        expect((await linkedTasks(owner.page)).map((t) => t.id)).toEqual([original.id]);
        expect((await linkedTasks(peer.page)).map((t) => t.id)).toEqual([original.id]);
      } finally {
        await closeClient(owner);
        await closeClient(peer);
      }
    });
  }
});
