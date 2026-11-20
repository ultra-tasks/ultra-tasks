import { expect, test, type Route } from '@playwright/test';
import { flushPendingWrites } from '../../utils/waits';
import {
  addLocalTask,
  closeDevices,
  connectFirstDevice,
  engineCall,
  engineView,
  newDevice,
  signIn,
  taskTitles,
} from './native-account-helpers';

const ACCOUNT = process.env.E2E_ULTRA_TAB_ACCOUNT ?? 'personaltab';
const INITIAL_TASK = 'Task already in the account';
const OTHER_TAB_TASK = 'Task written in the other tab';
const OTHER_DEVICE_TASK = 'Task from the other device';

test('@ultra preserves a shared local edit made during an account download', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = await newDevice(browser, 'Sync tab');
  const remote = await newDevice(browser, 'Other device');
  const tab = await owner.context.newPage();
  let releaseDownload: () => void = () => undefined;
  try {
    await addLocalTask(owner, INITIAL_TASK);
    await connectFirstDevice(owner, ACCOUNT);
    await signIn(remote.page, ACCOUNT);
    await expect.poll(() => taskTitles(remote.page)).toContain(INITIAL_TASK);
    // Model the startup race in which both pages pass the single-tab check.
    // Keep all IndexedDB stores, write locks and account sync behavior real.
    await tab.addInitScript(() => {
      const NativeChannel = window.BroadcastChannel;
      window.BroadcastChannel = class extends NativeChannel {
        constructor(name: string) {
          super(name === 'superProductivityTab' ? 'isolated-startup-check' : name);
        }
      };
    });
    await tab.goto('/');
    await tab.waitForFunction(() => '__e2eTestHelpers' in window);
    await expect.poll(() => taskTitles(tab)).toContain(INITIAL_TASK);

    let markDownloadStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => (markDownloadStarted = resolve));
    const hold = new Promise<void>((resolve) => (releaseDownload = resolve));
    const changes = '**/api/v2/accounts/sync/scopes/*/changes*';
    const pauseDownload = async (route: Route): Promise<void> => {
      markDownloadStarted();
      await hold;
      await route.continue();
    };
    await owner.page.route(changes, pauseDownload);
    await addLocalTask(remote, OTHER_DEVICE_TASK);
    await engineCall(remote.page, 'syncNow');
    await Promise.all([
      engineCall(owner.page, 'syncNow'),
      (async () => {
        try {
          await started;
          await addLocalTask({ ...owner, page: tab }, OTHER_TAB_TASK);
          await flushPendingWrites(tab);
          expect(await taskTitles(owner.page)).not.toContain(OTHER_TAB_TASK);
        } finally {
          releaseDownload();
        }
      })(),
    ]);
    await owner.page.unroute(changes, pauseDownload);

    // The syncing tab must keep the shared op log intact for the next boot.
    const afterApply = await engineView(owner.page);
    await tab.close();
    await owner.page.reload();
    await owner.page.waitForFunction(() => '__e2eTestHelpers' in window);
    await expect
      .poll(() => taskTitles(owner.page), { timeout: 20_000 })
      .toContain(OTHER_TAB_TASK);
    expect(afterApply.error).toBe('NATIVE_SYNC.ERROR_RELOAD_TAB');
    expect(afterApply.unlocked).toBe(true);

    await signIn(owner.page, ACCOUNT);
    await expect.poll(() => engineView(owner.page)).toMatchObject({ linked: true });
    await engineCall(owner.page, 'syncNow');
    await engineCall(remote.page, 'syncNow');
    const expected = [INITIAL_TASK, OTHER_TAB_TASK, OTHER_DEVICE_TASK];
    for (const page of [owner.page, remote.page])
      await expect.poll(() => taskTitles(page)).toEqual(expect.arrayContaining(expected));
  } finally {
    releaseDownload();
    await tab.close();
    await closeDevices(owner, remote);
  }
});
