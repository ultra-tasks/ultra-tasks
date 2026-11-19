import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  accountPage,
  closeDevices,
  engineCall,
  engineView,
  newDevice,
  signIn,
  ultraUrl,
} from './native-account-helpers';

/**
 * New-device email verification, in a real browser against the real server.
 *
 * The server asks a device it does not recognise for the code it just emailed. Each browser
 * context is one device with its own storage, so a second context is "a new device". The
 * harness exposes its outbox at `/__mail` (kind `device` carries the 8-digit code).
 *
 * Needs the harness with the feature ON (the OFF harness never asks for a code):
 *   E2E_WORKERS=3 E2E_BASE_URL=http://127.0.0.1:4248 E2E_ULTRA_URL=http://127.0.0.1:4248 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/device-verification.spec.ts \
 *     --project=chromium --retries=0
 *
 * Accounts are single-use for the life of a harness: `device1..device16@example.test` (check
 * on) and `optout1..optout4@example.test` (opted out). `E2E_DEVICE_BASE` / `E2E_OPTOUT_BASE`
 * move the window; `E2E_DEVICE_ACCOUNTS` / `E2E_OPTOUT_ACCOUNTS` name them explicitly.
 */
interface Mail {
  email: string;
  kind: string;
  token: string;
}

const account = (index: number, kind: 'device' | 'optout' = 'device'): string => {
  const named = process.env[`E2E_${kind.toUpperCase()}_ACCOUNTS`]
    ?.split(',')
    .map((name) => name.trim());
  const base = Number(process.env[`E2E_${kind.toUpperCase()}_BASE`] ?? 1);
  return named?.[index] ?? `${kind}${base + index}@example.test`;
};

/** Every code the server has emailed to an address, oldest first. */
const codesFor = async (email: string): Promise<string[]> =>
  ((await (await fetch(`${ultraUrl()}/__mail`)).json()) as Mail[])
    .filter((mail) => mail.email === email && mail.kind === 'device')
    .map((mail) => mail.token);

/** The code of the email that arrives after `already` earlier ones. */
const nextCode = async (email: string, already: number): Promise<string> => {
  let codes: string[] = [];
  await expect
    .poll(async () => (codes = await codesFor(email)).length, {
      message: `an emailed code for ${email}`,
      timeout: 30000,
    })
    .toBeGreaterThan(already);
  return codes[codes.length - 1];
};

/** Something other than the code, as far as a person could tell. */
const wrongCode = (code: string): string =>
  String((Number(code) + 1) % 100_000_000).padStart(8, '0');

const step = (page: Page): Locator =>
  accountPage(page).getByRole('heading', { name: 'Verify this device' });
const codeField = (page: Page): Locator =>
  accountPage(page).getByLabel('Verification code');
const verifyButton = (page: Page): Locator =>
  accountPage(page).getByRole('button', { name: 'Verify', exact: true });
const resendButton = (page: Page): Locator =>
  accountPage(page).getByRole('button', { name: 'Send a new code' });
const backButton = (page: Page): Locator =>
  accountPage(page).getByRole('button', { name: 'Back', exact: true });
const alert = (page: Page): Locator => accountPage(page).getByRole('alert');

/** Signed in and settled, judged by the engine so it holds on whichever page the app lands on. */
const waitSynced = async (page: Page): Promise<void> => {
  await expect
    .poll(
      async () => {
        const view = await engineView(page);
        return view.unlocked && view.phase === 'synced' && view.lastSyncedAt !== null;
      },
      { message: 'the account reaches "synced"', timeout: 90000 },
    )
    .toBe(true);
};

const storedAccounts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('ultra-native-account:')),
  );

test.describe('@ultra new-device email verification', () => {
  test.describe.configure({ mode: 'parallel', timeout: 240000 });

  test('a new device enters the emailed code, and is recognised after signing out and in', async ({
    browser,
  }) => {
    const email = account(0);
    const laptop = await newDevice(browser, 'Laptop');
    const { page } = laptop;
    try {
      const sent = (await codesFor(email)).length;
      await signIn(page, email);

      // The password was right, but nothing is signed in: the step asks for the code.
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      await expect(codeField(page)).toBeFocused();
      await expect(accountPage(page)).toContainText(
        /We emailed a code to \w\*\*\*@example\.test/,
      );
      // Only the masked address is shown, never the address or the code.
      await expect(accountPage(page)).not.toContainText(email);
      await expect(accountPage(page).locator('.status')).toHaveCount(0);
      await expect(
        accountPage(page).getByRole('button', { name: 'Sync now' }),
      ).toHaveCount(0);
      expect(await engineView(page)).toMatchObject({
        phase: 'verify-device',
        unlocked: false,
        linked: false,
      });
      expect(await storedAccounts(page)).toEqual([]);

      const code = await nextCode(email, sent);
      await codeField(page).fill(`${code.slice(0, 4)} ${code.slice(4)}`);
      await codeField(page).press('Enter');
      await waitSynced(page);
      await expect(step(page)).toHaveCount(0);

      // Signing out keeps this device recognised: the next password sign-in needs no code.
      await engineCall(page, 'logout');
      await expect.poll(() => storedAccounts(page)).toEqual([]);
      await signIn(page, email);
      await waitSynced(page);
      expect(await codesFor(email)).toHaveLength(sent + 1);
    } finally {
      await closeDevices(laptop);
    }
  });

  test('a different device, a new browser context, is asked for a code again', async ({
    browser,
  }) => {
    const email = account(1);
    const laptop = await newDevice(browser, 'Laptop');
    const phone = await newDevice(browser, 'Phone');
    try {
      const sent = (await codesFor(email)).length;
      await signIn(laptop.page, email);
      await expect(step(laptop.page)).toBeVisible({ timeout: 60000 });
      await codeField(laptop.page).fill(await nextCode(email, sent));
      await verifyButton(laptop.page).click();
      await waitSynced(laptop.page);

      // The laptop is trusted; the phone has never signed in, and the code is not shared.
      await signIn(phone.page, email);
      await expect(step(phone.page)).toBeVisible({ timeout: 60000 });
      const second = await nextCode(email, sent + 1);
      expect(await codesFor(email)).toHaveLength(sent + 2);
      expect(await engineView(phone.page)).toMatchObject({
        phase: 'verify-device',
        unlocked: false,
      });
      await codeField(phone.page).fill(second);
      await verifyButton(phone.page).click();
      await waitSynced(phone.page);
    } finally {
      await closeDevices(laptop, phone);
    }
  });

  test('a wrong code is an inline error and five of them end the sign-in', async ({
    browser,
  }) => {
    const email = account(2);
    const laptop = await newDevice(browser, 'Laptop');
    const { page } = laptop;
    try {
      const sent = (await codesFor(email)).length;
      await signIn(page, email);
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      const code = await nextCode(email, sent);

      for (let attempt = 1; attempt <= 4; attempt++) {
        await codeField(page).fill(wrongCode(code));
        await verifyButton(page).click();
        // One generic answer, in the card, with the cursor back on the field.
        await expect(alert(page)).toHaveCount(1);
        await expect(alert(page)).toContainText('That code did not work or has expired.');
        await expect(step(page)).toBeVisible();
        await expect(codeField(page)).toBeFocused();
      }

      // The fifth wrong code is the last the server would take: the sign-in ends, saying so.
      await codeField(page).fill(wrongCode(code));
      await verifyButton(page).click();
      await expect(alert(page)).toContainText('Too many wrong codes');
      await expect(step(page)).toHaveCount(0);
      await expect(page.locator('native-sync input[name="identifier"]')).toBeVisible();
      expect(await engineView(page)).toMatchObject({
        phase: 'signed-out',
        unlocked: false,
      });
      expect(await storedAccounts(page)).toEqual([]);

      // Signing in again starts a fresh challenge, and the right code is accepted.
      await signIn(page, email);
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      await codeField(page).fill(await nextCode(email, sent + 1));
      await verifyButton(page).click();
      await waitSynced(page);
    } finally {
      await closeDevices(laptop);
    }
  });

  test('"Send a new code" waits out the server’s cooldown, then replaces the code', async ({
    browser,
  }) => {
    const email = account(3);
    const laptop = await newDevice(browser, 'Laptop');
    const { page } = laptop;
    try {
      const sent = (await codesFor(email)).length;
      await signIn(page, email);
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      const first = await nextCode(email, sent);

      // The countdown is visible and the button is unavailable, but still in the tab order.
      await expect(resendButton(page)).toHaveAttribute('aria-disabled', 'true');
      await expect(accountPage(page)).toContainText(/New code available in \d+ s/);
      await expect(resendButton(page)).toHaveJSProperty('disabled', false);
      await resendButton(page).click({ force: true });
      expect(await codesFor(email)).toHaveLength(sent + 1);

      // After the server's 30 seconds it is available, and says so for screen readers too.
      await expect(resendButton(page)).not.toHaveAttribute('aria-disabled', 'true', {
        timeout: 45000,
      });
      await expect(accountPage(page).locator('[role="status"]')).toContainText(
        'You can send a new code now.',
      );
      await resendButton(page).click();
      const second = await nextCode(email, sent + 1);
      expect(second).not.toBe(first);
      await expect(accountPage(page).locator('[role="status"]')).toContainText(
        /A new code was sent to \w\*\*\*@example\.test\./,
      );
      await expect(resendButton(page)).toHaveAttribute('aria-disabled', 'true');

      // The old code no longer works; the new one does.
      await codeField(page).fill(first);
      await verifyButton(page).click();
      await expect(alert(page)).toContainText('That code did not work or has expired.');
      await codeField(page).fill(second);
      await verifyButton(page).click();
      await waitSynced(page);
    } finally {
      await closeDevices(laptop);
    }
  });

  test('an account that opted out of the check signs in without a code', async ({
    browser,
  }) => {
    const email = account(0, 'optout');
    const laptop = await newDevice(browser, 'Laptop');
    const { page } = laptop;
    try {
      const sent = (await codesFor(email)).length;
      await signIn(page, email);
      await waitSynced(page);
      await expect(step(page)).toHaveCount(0);
      expect(await codesFor(email)).toHaveLength(sent);
    } finally {
      await closeDevices(laptop);
    }
  });

  test('Back cancels the sign-in and leaves the account unconfigured', async ({
    browser,
  }) => {
    const email = account(4);
    const laptop = await newDevice(browser, 'Laptop');
    const { page } = laptop;
    try {
      const sent = (await codesFor(email)).length;
      await signIn(page, email);
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      await backButton(page).click();

      await expect(step(page)).toHaveCount(0);
      await expect(page.locator('native-sync input[name="identifier"]')).toBeVisible();
      await expect(alert(page)).toHaveCount(0);
      expect(await engineView(page)).toMatchObject({
        phase: 'signed-out',
        unlocked: false,
        linked: false,
      });
      expect(await storedAccounts(page)).toEqual([]);
      // Nothing was trusted by backing out: signing in again asks for a fresh code.
      expect(
        await page.evaluate(() => localStorage.getItem('ultra-native-device-trust')),
      ).toBeNull();

      await signIn(page, email);
      await expect(step(page)).toBeVisible({ timeout: 60000 });
      await codeField(page).fill(await nextCode(email, sent + 1));
      await codeField(page).press('Enter');
      await waitSynced(page);
    } finally {
      await closeDevices(laptop);
    }
  });
});
