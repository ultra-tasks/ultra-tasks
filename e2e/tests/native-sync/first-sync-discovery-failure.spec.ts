import { expect, test, type Request } from '@playwright/test';
import {
  accountPage,
  closeDevices,
  connectFirstDevice,
  dismissFirstRunSetup,
  engineView,
  expectSeededContent,
  firstAccount,
  newDevice,
  seedRealData,
  seedTitles,
  signIn,
  taskTitles,
} from './native-account-helpers';

/**
 * Not being able to look is not the same as there being nothing to find. If the first
 * look at the account fails (or only part of it arrives), the device keeps the vault
 * open, creates no empty personal dataset, and tries again until the whole account has
 * been fetched.
 *
 *   E2E_BASE_URL=http://127.0.0.1:4244 E2E_ULTRA_URL=http://127.0.0.1:4244 E2E_WORKERS=1 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/first-sync-discovery-failure.spec.ts \
 *     --project=chromium --retries=0
 */
const failures = [
  {
    name: 'listing the scopes',
    route: '**/api/v2/accounts/sync/scopes',
    read: /\/api\/v2\/accounts\/sync\/scopes$/,
  },
  {
    name: 'downloading the personal snapshot',
    route: '**/api/v2/accounts/sync/scopes/*/snapshot',
    read: /\/sync\/scopes\/[^/]+\/snapshot$/,
  },
] as const;

test.describe('@ultra first sync when the account cannot be read', () => {
  test.describe.configure({ timeout: 360000 });

  failures.forEach((failure, index) => {
    test(`${failure.name} fails: nothing is created, sign-in survives, and a retry downloads the account`, async ({
      browser,
    }) => {
      const account = firstAccount(5 + index);
      const titles = seedTitles(`${Date.now()}`);
      const desktop = await newDevice(browser, 'Desktop');
      const phone = await newDevice(browser, 'Phone', 'first-run');
      const created: string[] = [];
      try {
        await seedRealData(desktop, titles);
        await connectFirstDevice(desktop, account);
        await dismissFirstRunSetup(phone.page);

        phone.page.on('request', (request: Request) => {
          if (
            request.method() === 'POST' &&
            /\/api\/v2\/accounts\/sync\/scopes$/.test(request.url())
          )
            created.push(request.url());
        });
        let blocked = true;
        await phone.page.route(failure.route, (route) => {
          if (!blocked) return route.continue();
          // Only the read is cut: a creation request must never be sent at all.
          return route.request().method() === 'GET' ? route.abort() : route.continue();
        });

        const cutRead = phone.page.waitForEvent('requestfailed', {
          predicate: (request) => failure.read.test(request.url()),
          timeout: 60000,
        });
        await signIn(phone.page, account);
        await cutRead.catch(() => {
          throw new Error(
            `Signing in never made the device try ${failure.name}: it waits for a button instead`,
          );
        });
        await phone.page.waitForTimeout(1000);

        // Signing in worked; only the look at the account failed. The form must not come back.
        await expect(
          accountPage(phone.page).locator('input[name="password"]'),
          'sign-in survives a failed look at the account',
        ).toHaveCount(0);

        // The account was never looked at, so there is nothing to show and nothing to decide.
        await expect
          .poll(() => engineView(phone.page).then((view) => view.connection), {
            message: 'the failed look leaves the connection unfinished',
            timeout: 60000,
          })
          .toBe('failed');
        const failed = await engineView(phone.page);
        // Unreachable is calm ("offline"), and the unfinished connection says why in words.
        expect(failed.offline).toBe(true);
        expect(failed.error).toBe('ACCOUNT_DATA.ERROR_DISCOVERY');
        expect(failed.phase).toBe('choose-data');
        expect(failed.unlocked, 'sign-in survives the failed look').toBe(true);
        expect(failed.linked).toBe(false);
        expect(failed.dataChoice).toBeNull();
        expect(failed.lastSyncedAt).toBeNull();
        expect(failed.emptyAccount, 'a failed fetch is not an empty account').toBe(false);
        expect(await taskTitles(phone.page)).not.toContain(titles.task);
        expect(created, 'no empty personal dataset may be created').toEqual([]);

        // Connectivity returns: the device retries by itself and downloads the account.
        blocked = false;
        await phone.page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expectSeededContent(phone.page, titles);
        expect(created).toEqual([]);
      } finally {
        await closeDevices(desktop, phone);
      }
    });
  });
});
