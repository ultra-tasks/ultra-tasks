import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_PASSWORD,
  engineCall,
  engineView,
  ultraUrl,
} from './native-account-helpers';

/**
 * A trusted desktop device is recognised by the account server: it is asked for the emailed
 * code once, and the marker the server then issues is kept in OS-protected storage (DPAPI on
 * Windows), so quitting, relaunching, signing out and signing in again never asks again.
 *
 * Real Electron, real server with new-device email verification ON (the harness exposes its
 * outbox at `/__mail`):
 *   npm run quiet -- electron:build
 *   ULTRA_ELECTRON_EXECUTABLE=node_modules/electron/dist/electron.exe \
 *   ULTRA_ELECTRON_APP=<repository root> E2E_BASE_URL=http://127.0.0.1:4248 \
 *   E2E_ULTRA_URL=http://127.0.0.1:4248 E2E_WORKERS=1 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/desktop-device-verification.spec.ts \
 *     --project=chromium --retries=0
 *
 * Each scenario uses its own account (`device<N>@example.test`, `E2E_DESKTOP_DEVICE_BASE`
 * moves the window) and its own profile.
 */
const executable = process.env.ULTRA_ELECTRON_EXECUTABLE;
const appDir = process.env.ULTRA_ELECTRON_APP ?? process.cwd();
const base = Number(process.env.E2E_DESKTOP_DEVICE_BASE ?? 11);
const emailOf = (index: number): string => `device${base + index}@example.test`;

interface Desktop {
  app: ElectronApplication;
  page: Page;
}

const profileDir = (name: string): string =>
  path.resolve(process.cwd(), '.tmp', 'desktop-profiles', name);
const deviceFile = (profile: string): string => path.join(profile, 'account-devices.enc');
const sessionFile = (profile: string): string =>
  path.join(profile, 'account-session.enc');

/** `fresh` is the first start of a profile: it sets the first-run flags and reloads once. */
const launch = async (profile: string, fresh = false): Promise<Desktop> => {
  const app = await _electron.launch({
    executablePath: executable!,
    args: [
      appDir,
      '--custom-url=' + ultraUrl() + '/#/native-sync',
      '--user-data-dir=' + profile,
      '--disable-tray',
      '--no-sandbox',
    ],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const page = await app.firstWindow();
  await page.addInitScript(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  if (fresh) await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('native-sync')).toBeVisible({ timeout: 60000 });
  return { app, page };
};

/** Quit the way a person does; if the app does not leave in time, say so instead of hanging. */
const quit = async (desktop: Desktop): Promise<void> => {
  const closing = desktop.app.close();
  await Promise.race([
    closing,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('The app did not quit within 30 s')), 30000),
    ),
  ]).catch(async (error) => {
    desktop.app.process().kill();
    throw error;
  });
};

const signIn = async (page: Page, email: string): Promise<void> => {
  const card = page.locator('native-sync');
  // Right after a route change the leaving page can still be mounted next to the entering one.
  await expect(card).toHaveCount(1);
  const server = card.locator('input[name="server"]');
  if (await server.count()) await server.fill(ultraUrl());
  await card.locator('input[name="identifier"]').fill(email);
  await card.locator('input[name="password"]').fill(ACCOUNT_PASSWORD);
  await card.locator('button[type="submit"]').click();
};

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

const codesFor = async (email: string): Promise<string[]> =>
  (
    (await (await fetch(`${ultraUrl()}/__mail`)).json()) as {
      email: string;
      kind: string;
      token: string;
    }[]
  )
    .filter((mail) => mail.email === email && mail.kind === 'device')
    .map((mail) => mail.token);

const verifyStep = (page: Page): ReturnType<Page['getByRole']> =>
  page.locator('native-sync').getByRole('heading', { name: 'Verify this device' });

/** Signs in on a device the account does not know and types the code the server emailed. */
const signInWithCode = async (page: Page, email: string): Promise<void> => {
  const sent = (await codesFor(email)).length;
  await signIn(page, email);
  await expect(verifyStep(page)).toBeVisible({ timeout: 60000 });
  let codes: string[] = [];
  await expect
    .poll(async () => (codes = await codesFor(email)).length)
    .toBeGreaterThan(sent);
  const field = page.locator('native-sync').getByLabel('Verification code');
  await field.fill(codes[codes.length - 1]);
  await field.press('Enter');
  await waitSynced(page);
};

/** What the account holds for this installation, read straight from the live engine. */
const deviceToken = (page: Page): Promise<string | undefined> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __e2eNativeSync: { account?: { deviceToken?: string } };
        }
      ).__e2eNativeSync.account?.deviceToken,
  );

test.describe('@ultra desktop: the device is recognised across restarts', () => {
  test.skip(
    !executable,
    'ULTRA_ELECTRON_EXECUTABLE (the real Electron binary) is required',
  );
  test.describe.configure({ mode: 'serial', timeout: 420000 });

  test('code once, then quit, relaunch, sign out and sign in: no second code, protected at rest', async () => {
    const email = emailOf(0);
    const profile = profileDir('device-trust');
    fs.rmSync(profile, { recursive: true, force: true });
    let desktop = await launch(profile, true);
    try {
      const sent = (await codesFor(email)).length;
      await signInWithCode(desktop.page, email);
      expect(await codesFor(email)).toHaveLength(sent + 1);

      // The marker is in OS-protected storage and nowhere in the clear.
      const token = await deviceToken(desktop.page);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await expect.poll(() => fs.existsSync(deviceFile(profile))).toBe(true);
      const stored = fs.readFileSync(deviceFile(profile));
      expect(stored.toString('utf8')).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(
        Buffer.from(stored.toString('utf8'), 'base64').includes(Buffer.from(token!)),
      ).toBe(false);
      expect(stored.includes(Buffer.from(token!))).toBe(false);
      expect(stored.includes(Buffer.from(email))).toBe(false);
      const renderer = await desktop.page.evaluate(
        (values) => {
          const dump = JSON.stringify([
            ...Object.entries(localStorage),
            ...Object.entries(sessionStorage),
          ]);
          return values.map((value) => dump.includes(value));
        },
        [token!, 'ultra-native-device-trust'],
      );
      expect(renderer, 'the marker never reaches renderer storage').toEqual([
        false,
        false,
      ]);

      // Quit and come back: the session is restored without a password or a code.
      await quit(desktop);
      desktop = await launch(profile);
      await waitSynced(desktop.page);
      await expect(verifyStep(desktop.page)).toHaveCount(0);

      // Sign out, then sign in with the password: the device is still recognised.
      await engineCall(desktop.page, 'logout');
      await expect
        .poll(async () => (await engineView(desktop.page)).phase)
        .toBe('signed-out');
      expect(fs.existsSync(sessionFile(profile)), 'sign-out forgets the session').toBe(
        false,
      );
      expect(fs.existsSync(deviceFile(profile)), 'but not the device').toBe(true);
      await signIn(desktop.page, email);
      await waitSynced(desktop.page);
      await expect(verifyStep(desktop.page)).toHaveCount(0);
      expect(await codesFor(email)).toHaveLength(sent + 1);
      expect(await deviceToken(desktop.page)).toBe(token);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('without its stored marker the device is asked for a code again', async () => {
    const email = emailOf(1);
    const profile = profileDir('device-trust-lost');
    fs.rmSync(profile, { recursive: true, force: true });
    let desktop = await launch(profile, true);
    try {
      const sent = (await codesFor(email)).length;
      await signInWithCode(desktop.page, email);
      await expect.poll(() => fs.existsSync(deviceFile(profile))).toBe(true);
      await quit(desktop);

      // The OS credential store lost it (a new Windows profile, a reinstall): nothing else
      // can stand in for it.
      fs.rmSync(deviceFile(profile));
      desktop = await launch(profile);
      await waitSynced(desktop.page);
      await engineCall(desktop.page, 'logout');
      await expect
        .poll(async () => (await engineView(desktop.page)).phase)
        .toBe('signed-out');
      await signInWithCode(desktop.page, email);
      expect(await codesFor(email)).toHaveLength(sent + 2);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });
});
