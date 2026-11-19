import { expect, test } from '@playwright/test';
import {
  accountPage,
  closeDevices,
  connectFirstDevice,
  dismissFirstRunSetup,
  expectArchivedInWorklog,
  expectSeededContent,
  firstAccount,
  firstSyncOutcome,
  newDevice,
  seedRealData,
  seedTitles,
  signIn,
  taskTitles,
} from './native-account-helpers';

/**
 * Incident (2026-11): an iPhone with nothing but the first-run example task signed in to
 * the populated account, saw "Account unlocked" and no tasks. The data-source choice sat
 * below the card and was never clicked.
 *
 * Expected: an empty device downloads the account's data by itself (discover, complete
 * fetch, decrypt, validate, apply) and ends on the task workspace. The first-run example
 * task does not count as local data.
 *
 * Run (harness on 4244, serving this build):
 *   E2E_BASE_URL=http://127.0.0.1:4244 E2E_ULTRA_URL=http://127.0.0.1:4244 E2E_WORKERS=1 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/first-sync-empty-device.spec.ts \
 *     --project=chromium --retries=0
 */
test.describe('@ultra first sync on an empty device', () => {
  test.describe.configure({ timeout: 360000 });

  test('downloads the account by itself, without any source choice, and ends on the tasks', async ({
    browser,
  }) => {
    const account = firstAccount(0);
    const titles = seedTitles(`${Date.now()}`);
    const desktop = await newDevice(browser, 'Desktop');
    const phone = await newDevice(browser, 'Phone', 'first-run');
    try {
      await seedRealData(desktop, titles);
      await connectFirstDevice(desktop, account);

      await dismissFirstRunSetup(phone.page);
      // The precondition of the incident: the new device already holds the example task.
      await expect
        .poll(() => taskTitles(phone.page), { message: 'first-run example task' })
        .toContain('Optional: getting started tips');

      await signIn(phone.page, account);

      // Nobody should have to find a button: the screen must go straight to the tasks. While
      // the download runs a surface may still show its own controls, so judge the settled
      // state, and name what the person is stuck on if it never settles.
      await expect
        .poll(() => firstSyncOutcome(phone.page, titles.task), {
          message: 'what the phone shows after signing in',
          timeout: 90000,
        })
        .toBe('tasks');

      await expectSeededContent(phone.page, titles);
      expect(await taskTitles(phone.page)).not.toContain(
        'Optional: getting started tips',
      );
      await expectArchivedInWorklog(phone.page, titles.archived);

      // It finished on its own, so the account page reports a settled, error-free state.
      await phone.page.goto('/#/native-sync');
      await expect(accountPage(phone.page)).toContainText(/Up to date|Sync complete/);
      await expect(accountPage(phone.page).locator('[role=alert]')).toHaveCount(0);
    } finally {
      await closeDevices(desktop, phone);
    }
  });
});
