import { expect, test, type Page, type Route } from '@playwright/test';
import {
  archiveTask,
  createSimulatedClient,
  expectExactTaskTime,
  markTaskDone,
  renameTask,
  recordTaskTimeDelta,
} from '../../utils/supersync-helpers';
import { waitForStatePersistence } from '../../utils/waits';
import {
  addLocalTask,
  closeDevices,
  connectFirstDevice,
  engineCall,
  engineView,
  newDevice,
  readContent,
  signIn,
  taskTitles,
  ultraUrl,
  useAccountAppBundle,
} from './native-account-helpers';

// Run against a fresh provider-migration harness, which seeds these test accounts.
// The mixed-version tests also need E2E_ULTRA_BASELINE_DIST pointing at the earlier browser build.
// Each browser context has its own task database, vault and device signing key.
const WORKLOG_DAY = '2026-11-18';
const MINUTE = 60_000;
const ACCOUNT_API = '**/api/v2/accounts/**';

const disconnectSync = async (page: Page): Promise<() => Promise<void>> => {
  // Sync goes offline while the browser can still load the lazy Finish Day view.
  const abort = (route: Route): Promise<void> => route.abort('internetdisconnected');
  await page.route(ACCOUNT_API, abort);
  return () => page.unroute(ACCOUNT_API, abort);
};

const pauseBeforeApplying = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const { bridge } = (
      window as unknown as { __e2eNativeSync: { bridge: { apply: () => Promise<void> } } }
    ).__e2eNativeSync;
    bridge.apply = () => {
      document.documentElement.dataset['syncApplyPaused'] = 'true';
      return new Promise<void>(() => undefined);
    };
  });

const archivedTime = (page: Page, title: string): Promise<number | null> =>
  page.evaluate(
    async ({ taskTitle, day }) => {
      type Task = { title: string; timeSpentOnDay: Record<string, number> };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('SUP_OPS');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const archive = await new Promise<
          { data?: { task?: { entities: Record<string, Task> } } } | undefined
        >((resolve, reject) => {
          const request = db
            .transaction('archive_young', 'readonly')
            .objectStore('archive_young')
            .get('current');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const task = Object.values(archive?.data?.task?.entities ?? {}).find(
          (item) => item.title === taskTitle,
        );
        return task?.timeSpentOnDay[day] ?? null;
      } finally {
        db.close();
      }
    },
    { taskTitle: title, day: WORKLOG_DAY },
  );

/** The real persisted task edit used by the notes editor, without driving 100,000 keystrokes. */
const taskNote = (
  page: Page,
  title: string,
  replacement?: string,
): Promise<string | null> =>
  page.evaluate(
    async ({ taskTitle, nextNote }) => {
      type Task = { id: string; title: string; notes: string };
      type State = { tasks: { entities: Record<string, Task> } };
      const { store, flushPendingWrites } = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
              dispatch: (action: unknown) => void;
            };
            flushPendingWrites: () => Promise<void>;
          };
        }
      ).__e2eTestHelpers;
      let state!: State;
      store.subscribe((next) => (state = next)).unsubscribe();
      const task = Object.values(state.tasks.entities).find(
        (item) => item.title === taskTitle,
      );
      if (!task) return null;
      if (nextNote === undefined) return task.notes;
      store.dispatch({
        type: '[Task Shared] updateTask',
        task: { id: task.id, changes: { notes: nextNote } },
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'UPD',
        },
      });
      await flushPendingWrites();
      return nextNote;
    },
    { taskTitle: title, nextNote: replacement },
  );

const waitForLinked = async (page: Page, title: string): Promise<void> => {
  await expect
    .poll(() => engineView(page), { timeout: 60000 })
    .toMatchObject({
      linked: true,
      error: '',
    });
  await expect.poll(() => taskTitles(page), { timeout: 30000 }).toContain(title);
};

test.describe('@ultra personal sync preserves edits', () => {
  test.describe.configure({ timeout: 180000 });

  for (const uploadFirst of ['archive', 'timer'] as const) {
    test(`keeps offline time when the ${uploadFirst} uploads first`, async ({
      browser,
    }) => {
      const account =
        uploadFirst === 'archive' ? 'personaleditarchive' : 'personaledittimer';
      const title = 'Archived task with concurrent tracked time';
      const archiveDevice = await newDevice(browser, 'Archive device');
      const timerDevice = await newDevice(browser, 'Timer device');
      try {
        await addLocalTask(archiveDevice, title);
        await recordTaskTimeDelta(archiveDevice, title, WORKLOG_DAY, 10 * MINUTE);
        await connectFirstDevice(archiveDevice, account);
        await signIn(timerDevice.page, account);
        await waitForLinked(timerDevice.page, title);
        await expectExactTaskTime(timerDevice, title, 10 * MINUTE);

        // Both devices work from the same base, then reconnect in a controlled order.
        const reconnect = {
          archive: await disconnectSync(archiveDevice.page),
          timer: await disconnectSync(timerDevice.page),
        };
        await recordTaskTimeDelta(timerDevice, title, WORKLOG_DAY, 5 * MINUTE);
        await expectExactTaskTime(timerDevice, title, 15 * MINUTE);
        await archiveTask(archiveDevice, title);
        await expect
          .poll(() => archivedTime(archiveDevice.page, title))
          .toBe(10 * MINUTE);

        const [first, second] =
          uploadFirst === 'archive'
            ? [archiveDevice, timerDevice]
            : [timerDevice, archiveDevice];
        await reconnect[uploadFirst]();
        await engineCall(first.page, 'syncNow');
        expect(await engineView(first.page)).toMatchObject({
          error: '',
          pendingChanges: 0,
        });
        await reconnect[uploadFirst === 'archive' ? 'timer' : 'archive']();
        await engineCall(second.page, 'syncNow');

        // Repeated sync must neither drop nor double-count the five minutes.
        for (const device of [first, second]) await engineCall(device.page, 'syncNow');
        for (const device of [timerDevice, archiveDevice]) {
          await expect
            .poll(() => archivedTime(device.page, title), {
              message: `${device.clientName} should persist all 15 minutes in the archive`,
              timeout: 15000,
            })
            .toBe(15 * MINUTE);
          expect(await taskTitles(device.page)).not.toContain(title);
          await device.page.reload();
          await expect.poll(() => archivedTime(device.page, title)).toBe(15 * MINUTE);
        }
      } finally {
        await closeDevices(archiveDevice, timerDevice);
      }
    });
  }

  for (const restart of [false, true]) {
    const scenario = restart ? ' and the timer restarts before applying' : '';
    test(`keeps only the unuploaded timer delta when an older device archives${scenario}`, async ({
      browser,
    }) => {
      const baselineDist = process.env.E2E_ULTRA_BASELINE_DIST;
      test.skip(
        !baselineDist,
        'Requires a browser build from before the tracked-time fix',
      );
      const account = restart ? 'personaleditrestart' : 'personaleditold';
      const title = 'Archived task with time previously synced by another device';
      const archiver = await createSimulatedClient(
        browser,
        ultraUrl(),
        'Older archiver',
        'mixed',
        {
          serviceWorkers: 'block',
          seedBeforeBoot: async (page) => {
            await useAccountAppBundle(page, baselineDist!);
          },
        },
      );
      const timer = await newDevice(browser, 'Updated timer');
      try {
        await addLocalTask(archiver, title);
        await recordTaskTimeDelta(archiver, title, WORKLOG_DAY, 10 * MINUTE);
        await connectFirstDevice(archiver, account);
        await signIn(timer.page, account);
        await waitForLinked(timer.page, title);

        await recordTaskTimeDelta(timer, title, WORKLOG_DAY, 5 * MINUTE);
        await engineCall(timer.page, 'syncNow');
        await engineCall(archiver.page, 'syncNow');
        await expectExactTaskTime(archiver, title, 15 * MINUTE);

        const reconnect = await disconnectSync(timer.page);
        await recordTaskTimeDelta(timer, title, WORKLOG_DAY, 2 * MINUTE);
        await expectExactTaskTime(timer, title, 17 * MINUTE);
        await archiveTask(archiver, title);
        await engineCall(archiver.page, 'syncNow');
        await expect.poll(() => archivedTime(archiver.page, title)).toBe(15 * MINUTE);

        if (restart) await pauseBeforeApplying(timer.page);
        await reconnect();
        if (restart) {
          // The upload has been acknowledged into SDK storage, but the app's local
          // snapshot is still the active task. A restart discards the in-memory bridge.
          const interrupted = engineCall(timer.page, 'syncNow').catch(() => undefined);
          await timer.page.locator('html[data-sync-apply-paused=true]').waitFor();
          await timer.page.reload();
          await interrupted;
          await signIn(timer.page, account);
          await expect
            .poll(() => engineView(timer.page), { timeout: 60000 })
            .toMatchObject({
              linked: true,
              error: '',
            });
        } else await engineCall(timer.page, 'syncNow');
        await expect.poll(() => archivedTime(timer.page, title)).toBe(17 * MINUTE);
        await engineCall(timer.page, 'syncNow');
        await engineCall(archiver.page, 'syncNow');
        for (const device of [timer, archiver]) {
          await device.page.reload();
          await expect.poll(() => archivedTime(device.page, title)).toBe(17 * MINUTE);
        }
      } finally {
        await closeDevices(archiver, timer);
      }
    });
  }

  test('syncs a long task note and an independent edit queued after it', async ({
    browser,
  }) => {
    const account = 'personaleditnote';
    const title = 'Task with a long note';
    const laterTask = 'Task created after the long note';
    const note = 'Follow up on the project. '.repeat(4000).slice(0, 100_000);
    expect(note).toHaveLength(100_000);
    const writer = await newDevice(browser, 'Writer');
    const peer = await newDevice(browser, 'Peer');
    const transactionStatuses: number[] = [];
    writer.page.on('response', (response) => {
      if (response.url().endsWith('/transactions'))
        transactionStatuses.push(response.status());
    });
    try {
      await addLocalTask(writer, title);
      await connectFirstDevice(writer, account);
      await signIn(peer.page, account);
      await waitForLinked(peer.page, title);

      await taskNote(writer.page, title, note);
      expect((await taskNote(writer.page, title)) === note).toBe(true);
      await engineCall(writer.page, 'syncNow');
      await addLocalTask(writer, laterTask);
      await engineCall(writer.page, 'syncNow');
      await engineCall(peer.page, 'syncNow');

      await expect
        .poll(() => taskTitles(peer.page), {
          message: `the later task should reach the peer (upload responses: ${transactionStatuses.join(', ')})`,
          timeout: 15000,
        })
        .toContain(laterTask);
      expect((await taskNote(peer.page, title)) === note).toBe(true);
      for (const device of [writer, peer]) {
        await device.page.reload();
        await device.page.waitForFunction(() => '__e2eTestHelpers' in window);
        await expect.poll(() => taskTitles(device.page)).toContain(laterTask);
        expect((await taskNote(device.page, title)) === note).toBe(true);
      }
    } finally {
      await closeDevices(writer, peer);
    }
  });

  test('keeps a rejected task note editable while a later task syncs', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const account = 'personaleditoversize';
    const title = 'Task with a record over the limit';
    const laterTask = 'Task created after the rejected upload';
    const note = 'Review the remaining draft notes. '.repeat(25500);
    const shortened = 'Review the remaining draft notes.';
    const writer = await newDevice(browser, 'Writer with a rejected note');
    const peer = await newDevice(browser, 'Peer receiving independent work');
    const responses: number[] = [];
    writer.page.on('response', (response) => {
      if (response.url().endsWith('/transactions')) responses.push(response.status());
    });
    try {
      await addLocalTask(writer, title);
      await connectFirstDevice(writer, account);
      await signIn(peer.page, account);
      await waitForLinked(peer.page, title);

      await taskNote(writer.page, title, note);
      await engineCall(writer.page, 'syncNow');
      expect(responses.some((status) => status === 400 || status === 422)).toBe(true);

      await addLocalTask(writer, laterTask);
      await engineCall(writer.page, 'syncNow');
      await engineCall(peer.page, 'syncNow');
      await expect
        .poll(() => taskTitles(peer.page), { timeout: 15000 })
        .toContain(laterTask);
      expect((await taskNote(peer.page, title)) === note).toBe(false);
      await expect
        .poll(() => engineView(writer.page))
        .toMatchObject({
          linked: true,
          error: 'NATIVE_SYNC.UPLOAD_DRAFTS',
        });

      await writer.page.reload();
      await writer.page.waitForFunction(() => '__e2eTestHelpers' in window);
      await expect
        .poll(async () => (await taskNote(writer.page, title)) === note)
        .toBe(true);
      await signIn(writer.page, account);
      await expect.poll(async () => (await engineView(writer.page)).linked).toBe(true);
      await taskNote(writer.page, title, shortened);
      await engineCall(writer.page, 'syncNow');
      await engineCall(peer.page, 'syncNow');
      await expect.poll(() => taskNote(peer.page, title)).toBe(shortened);
      await expect.poll(() => engineView(writer.page)).toMatchObject({ error: '' });
    } finally {
      await closeDevices(writer, peer);
    }
  });
  test('does not undo a remote completion when an offline device renames the same task', async ({
    browser,
  }) => {
    // A stock disposable harness can run just this test with
    // E2E_ULTRA_COMPLETION_ACCOUNT=personaledittimer; do not reuse that account in parallel.
    const account = process.env.E2E_ULTRA_COMPLETION_ACCOUNT ?? 'personaleditcompletion';
    const title = 'Concurrent completion marker';
    const renamed = title + ' renamed';
    const desktop = await newDevice(browser, 'Completing device');
    const phone = await newDevice(browser, 'Renaming device');
    const fresh = await newDevice(browser, 'Fresh device');
    const completed = (page: Page, match: string): Promise<boolean | undefined> =>
      readContent(page).then(
        ({ tasks }) => tasks.find((task) => task.title === match)?.isDone,
      );
    const expectCompletion = (
      page: Page,
      match: string,
      isDone: boolean,
    ): Promise<void> =>
      expect.poll(() => completed(page, match), { timeout: 30000 }).toBe(isDone);

    try {
      await addLocalTask(desktop, title);
      await connectFirstDevice(desktop, account);
      await signIn(phone.page, account);
      await expectCompletion(phone.page, title, false);
      await expect.poll(async () => (await engineView(phone.page)).linked).toBe(true);

      const reconnect = await disconnectSync(phone.page);
      await phone.page.goto('/#/tag/TODAY/tasks');
      await renameTask(phone, title, renamed);
      await expectCompletion(phone.page, renamed, false);

      await desktop.page.goto('/#/tag/TODAY/tasks');
      await markTaskDone(desktop, title);
      await waitForStatePersistence(desktop.page);
      const lastSync = (await engineView(desktop.page)).lastSyncedAt ?? 0;
      await engineCall(desktop.page, 'syncNow');
      await expect
        .poll(async () => (await engineView(desktop.page)).lastSyncedAt ?? 0)
        .toBeGreaterThan(lastSync);
      await expectCompletion(desktop.page, title, true);

      await reconnect();
      await engineCall(phone.page, 'syncNow');
      // Any spurious intent created during apply can be uploaded on a later pass.
      await engineCall(phone.page, 'syncNow');
      await engineCall(desktop.page, 'syncNow');
      await signIn(fresh.page, account);
      for (const device of [fresh, desktop, phone]) {
        await expectCompletion(device.page, renamed, true);
      }
    } finally {
      await closeDevices(desktop, phone, fresh);
    }
  });
});
