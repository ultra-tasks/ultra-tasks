import { expect, test } from '@playwright/test';
import {
  addLocalTask,
  closeDevices,
  dataChoiceDialog,
  engineCall,
  engineView,
  newDevice,
  signIn,
  taskTitles,
} from './native-account-helpers';

const failures = [
  {
    step: 'creating the personal scope',
    account: 'empty',
    path: '/sync/scopes',
    result: { state: 'migrating', sequence: 0 },
  },
  {
    step: 'completing the first upload',
    account: 'offline',
    path: '/migration/finish',
    result: { complete: true },
  },
];

for (const { step, account, path, result } of failures) {
  test(`@ultra resumes setup after losing the response for ${step}`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const initialTask = 'Task before interrupted setup';
    const laterTask = 'Task created while setup was interrupted';
    const source = await newDevice(browser, 'First upload device');
    const peer = await newDevice(browser, 'Peer after interruption');
    const syncRoute = '**/api/v2/accounts/sync/**';
    let serverCommitted = false;

    try {
      await addLocalTask(source, initialTask);
      await source.page.route(syncRoute, async (route) => {
        if (serverCommitted) return route.abort('connectionreset');
        const request = route.request();
        if (request.method() !== 'POST' || !request.url().endsWith(path))
          return route.fallback();
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        expect(await committed.json()).toMatchObject(result);
        serverCommitted = true;
        // The fault is on the real response, after the database committed the change.
        await route.abort('connectionreset');
      });
      await signIn(source.page, account);
      await expect.poll(() => serverCommitted, { timeout: 30_000 }).toBe(true);
      await expect
        .poll(() => engineView(source.page), { timeout: 30_000 })
        .toMatchObject({ unlocked: true, linked: false, connection: 'failed' });
      await signIn(peer.page, account);
      if (result.state === 'migrating') {
        await expect
          .poll(() => engineView(peer.page), { timeout: 30_000 })
          .toMatchObject({ unlocked: true, linked: false, connection: 'waiting' });
      } else {
        await expect
          .poll(() => taskTitles(peer.page), { timeout: 30_000 })
          .toContain(initialTask);
      }

      await addLocalTask(source, laterTask);
      await source.page.reload();
      await source.page.unroute(syncRoute);
      await signIn(source.page, account);
      await expect
        .poll(() => engineView(source.page), {
          message: 'the original device should finish setup after reopening',
          timeout: 30_000,
        })
        .toMatchObject({ linked: true, error: '', pendingChanges: 0 });
      await engineCall(peer.page, 'syncNow');
      for (const device of [source, peer]) {
        await expect
          .poll(() => taskTitles(device.page), { timeout: 30_000 })
          .toEqual(expect.arrayContaining([initialTask, laterTask]));
        await device.page.reload();
        await device.page.waitForFunction(() => '__e2eTestHelpers' in window);
        await expect
          .poll(() => taskTitles(device.page), { timeout: 30_000 })
          .toEqual(expect.arrayContaining([initialTask, laterTask]));
      }
    } finally {
      await closeDevices(source, peer);
    }
  });
}

test('@ultra can restart an empty interrupted setup on a different device', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const account = 'davremote';
  const originalTask = 'Task kept on the interrupted device';
  const newTask = 'Task from the new setup device';
  const original = await newDevice(browser, 'Unavailable source device');
  const replacement = await newDevice(browser, 'Restarting setup here');
  const observer = await newDevice(browser, 'New sync recipient');
  const syncRoute = '**/api/v2/accounts/sync/**';
  let oldScopeId: string | undefined;

  try {
    await addLocalTask(original, originalTask);
    await original.page.route(syncRoute, async (route) => {
      if (oldScopeId) return route.abort('connectionreset');
      const request = route.request();
      if (request.method() !== 'POST' || !request.url().endsWith('/sync/scopes'))
        return route.fallback();
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      const scope = (await committed.json()) as {
        id: string;
        sequence: number;
        state: string;
      };
      expect(scope).toMatchObject({ state: 'migrating', sequence: 0 });
      oldScopeId = scope.id;
      await route.abort('connectionreset');
    });
    await signIn(original.page, account);
    await expect.poll(() => oldScopeId, { timeout: 30_000 }).toBeTruthy();
    await addLocalTask(replacement, newTask);
    await signIn(replacement.page, account);
    await expect
      .poll(() => engineView(replacement.page), { timeout: 30_000 })
      .toMatchObject({ linked: false, connection: 'waiting' });
    const restart = replacement.page.getByRole('button', {
      name: 'Restart setup on this device',
    });
    await expect(restart).toBeVisible();
    const newScope = replacement.page.waitForResponse(
      (reply) =>
        reply.url().endsWith('/sync/scopes') &&
        reply.request().method() === 'POST' &&
        reply.ok(),
    );
    await restart.click();
    await replacement.page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
    expect((await (await newScope).json()).id).not.toBe(oldScopeId);
    await expect
      .poll(() => engineView(replacement.page), { timeout: 30_000 })
      .toMatchObject({ linked: true, error: '' });
    await signIn(observer.page, account);
    await expect
      .poll(() => taskTitles(observer.page), { timeout: 30_000 })
      .toContain(newTask);
    expect(await taskTitles(observer.page)).not.toContain(originalTask);

    await original.page.unroute(syncRoute);
    const retiredStatus = await original.page.evaluate(async (scopeId) => {
      const { account: clientAccount } = (
        window as unknown as {
          __e2eNativeSync: {
            client: { account: { request: (path: string) => Promise<unknown> } };
          };
        }
      ).__e2eNativeSync.client;
      try {
        await clientAccount.request(`/sync/scopes/${scopeId}/snapshot`);
        return 200;
      } catch (error) {
        return (error as { status?: number }).status;
      }
    }, oldScopeId);
    expect(retiredStatus).toBe(404);
    await engineCall(original.page, 'syncNow');
    await expect(dataChoiceDialog(original.page)).toBeVisible({ timeout: 30_000 });
    expect(await taskTitles(original.page)).toContain(originalTask);
    expect(await taskTitles(original.page)).not.toContain(newTask);
  } finally {
    await closeDevices(original, replacement, observer);
  }
});

test('@ultra recovers uploaded records from an abandoned setup and preserves local edits', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const account = 'latepreflight';
  const uploaded = 'Task uploaded before setup stopped';
  const unsent = 'Task still on the device that started setup';
  const local = 'Task already on the recovery device';
  const later = 'Task synced after recovering setup';
  const afterRejoin = 'Task synced by the original device after choosing data';
  const source = await newDevice(browser, 'Interrupted upload source');
  const recovering = await newDevice(browser, 'Setup recovery device');
  const observer = await newDevice(browser, 'Setup recovery observer');
  const syncRoute = '**/api/v2/accounts/sync/**';
  let staged = false;

  try {
    await addLocalTask(source, uploaded);
    await source.page.route(syncRoute, async (route) => {
      if (staged) return route.abort('connectionreset');
      const request = route.request();
      if (request.method() !== 'POST' || !request.url().endsWith('/transactions'))
        return route.fallback();
      // Initial batches also contain settings. Stop on the signed transaction for
      // this actual task so the test distinguishes uploaded data from local-only edits.
      const taskRecordId = await source.page.evaluate((title) => {
        type Journal = {
          records: {
            entityId: string;
            value?: { path?: string[]; data?: { title?: string } };
          }[];
        };
        const { client } = (
          window as unknown as {
            __e2eNativeSync: {
              client: { state: { migrations: Record<string, Journal> } };
            };
          }
        ).__e2eNativeSync;
        return Object.values(client.state.migrations)
          .flatMap(({ records }) => records)
          .find(({ value }) => value?.path?.[0] === 'task' && value.data?.title === title)
          ?.entityId;
      }, uploaded);
      expect(taskRecordId).toBeTruthy();
      const body = request.postDataJSON() as {
        writes: { record: { header: { entityId: string } } }[];
      };
      if (!body.writes.some(({ record }) => record.header.entityId === taskRecordId))
        return route.fallback();
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      expect((await committed.json()).sequence).toBeGreaterThan(0);
      staged = true;
      await route.abort('connectionreset');
    });
    await signIn(source.page, account);
    await expect.poll(() => staged, { timeout: 30_000 }).toBe(true);
    await addLocalTask(source, unsent);

    await addLocalTask(recovering, local);
    await signIn(recovering.page, account);
    await expect
      .poll(() => engineView(recovering.page), { timeout: 30_000 })
      .toMatchObject({ linked: false, connection: 'waiting' });
    const recover = recovering.page.getByRole('button', {
      name: 'Recover uploaded setup data',
    });
    await expect(recover).toBeVisible();
    await recover.click();
    await recovering.page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
    const choice = dataChoiceDialog(recovering.page);
    await expect(choice).toBeVisible({ timeout: 30_000 });
    expect(await taskTitles(recovering.page)).toContain(local);
    await choice.getByRole('button', { name: 'Download account data' }).click();
    await expect.poll(() => taskTitles(recovering.page)).toContain(uploaded);
    await addLocalTask(recovering, later);
    await engineCall(recovering.page, 'syncNow');

    await signIn(observer.page, account);
    await expect
      .poll(() => taskTitles(observer.page))
      .toEqual(expect.arrayContaining([uploaded, later]));
    expect(await taskTitles(observer.page)).not.toContain(unsent);

    await source.page.unroute(syncRoute);
    await engineCall(source.page, 'resumeDataConnection');
    const sourceChoice = dataChoiceDialog(source.page);
    await expect(sourceChoice).toBeVisible({ timeout: 30_000 });
    expect(await taskTitles(source.page)).toEqual(
      expect.arrayContaining([uploaded, unsent]),
    );
    expect(await taskTitles(source.page)).not.toContain(later);
    await sourceChoice.getByRole('button', { name: 'Download account data' }).click();
    await expect
      .poll(() => engineView(source.page))
      .toMatchObject({ linked: true, error: '' });
    await addLocalTask(source, afterRejoin);
    await engineCall(source.page, 'syncNow');
    await engineCall(observer.page, 'syncNow');
    await expect.poll(() => taskTitles(observer.page)).toContain(afterRejoin);
  } finally {
    await closeDevices(source, recovering, observer);
  }
});
