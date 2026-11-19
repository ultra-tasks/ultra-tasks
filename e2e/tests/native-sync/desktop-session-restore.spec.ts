import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AccountClient, httpTransport } from '@ultra-tasks/account-crypto/client';
import { WorkViewPage } from '../../pages/work-view.page';
import { startAccountProxy, type AccountProxy } from './account-proxy';
import {
  ACCOUNT_PASSWORD,
  engineView,
  taskTitles,
  ultraUrl,
} from './native-account-helpers';

/**
 * A trusted desktop device stays signed in across quit, relaunch, sleep and a revoked
 * session, in the REAL Electron app with the REAL OS-protected storage (DPAPI on Windows).
 *
 * Needs the built app and the harness. A same-origin proxy sits between them so a scenario
 * can take the account server away and bring it back without taking the app shell with it.
 *
 *   npm run quiet -- electron:build
 *   ULTRA_ELECTRON_EXECUTABLE=node_modules/electron/dist/electron.exe \
 *   ULTRA_ELECTRON_APP=<repository root> E2E_BASE_URL=http://127.0.0.1:4244 \
 *   E2E_ULTRA_URL=http://127.0.0.1:4244 E2E_WORKERS=1 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/desktop-session-restore.spec.ts \
 *     --project=chromium --retries=0
 *
 * Each scenario uses its own synthetic account (`restore1`..`restore24`) and profile.
 */
const executable = process.env.ULTRA_ELECTRON_EXECUTABLE;
const appDir = process.env.ULTRA_ELECTRON_APP ?? process.cwd();
const accounts = (
  process.env.E2E_RESTORE_ACCOUNTS ??
  'restore1,restore2,restore3,restore4,restore5,restore6'
)
  .split(',')
  .map((name) => name.trim());

const REFRESH = '/api/v2/accounts/sessions/refresh';
/** One read of a dataset's changes = one sync of it (a sync also lists the datasets, twice). */
const UPLOAD = /\/api\/v2\/accounts\/sync\/scopes\/[^/]+\/transactions$/;
const CHANGES = /\/api\/v2\/accounts\/sync\/scopes\/[^/]+\/changes$/;

interface Desktop {
  app: ElectronApplication;
  page: Page;
}

const profileDir = (name: string): string =>
  path.resolve(process.cwd(), '.tmp', 'desktop-profiles', name);
const sessionFile = (profile: string): string =>
  path.join(profile, 'account-session.enc');
const mainLog = (profile: string): string => {
  const file = path.join(profile, 'logs', 'main.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

/**
 * `fresh` is the first start of a profile: it sets the first-run flags and reloads once.
 * A later start must NOT reload: a reload while the restored session renews its credential
 * would interrupt the very rotation this spec measures.
 */
const launch = async (
  proxy: AccountProxy,
  profile: string,
  fresh = false,
): Promise<Desktop> => {
  const app = await _electron.launch({
    executablePath: executable!,
    args: [
      appDir,
      '--custom-url=' + proxy.origin + '/#/native-sync',
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

const signInWithPassword = async (
  page: Page,
  origin: string,
  account: string,
): Promise<void> => {
  const card = page.locator('native-sync');
  // Right after a route change the leaving page can still be mounted next to the entering one.
  await expect(card).toHaveCount(1);
  // A configured account signing in again to its own server has no address field.
  const server = card.locator('input[name="server"]');
  if (await server.count()) await server.fill(origin);
  await card.locator('input[name="identifier"]').fill(account);
  await card.locator('input[name="password"]').fill(ACCOUNT_PASSWORD);
  await card.locator('button[type="submit"]').click();
};

const waitSynced = async (page: Page): Promise<void> => {
  await expect
    .poll(
      async () => {
        const view = await engineView(page);
        return view.phase === 'synced' && view.lastSyncedAt !== null;
      },
      { message: 'the account reaches "synced"', timeout: 90000 },
    )
    .toBe(true);
};

const addTask = async (page: Page, title: string): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/tag/TODAY/tasks';
  });
  const work = new WorkViewPage(page);
  await work.waitForTaskList();
  await work.addTask(title);
  await expect.poll(() => taskTitles(page)).toContain(title);
};

const secrets = (page: Page): Promise<{ master: string; refresh: string }> =>
  page.evaluate(() => {
    const native = (
      window as unknown as {
        __e2eNativeSync: {
          account: { tokens: { refreshToken: string }; unlocked: { masterKey: string } };
        };
      }
    ).__e2eNativeSync;
    return {
      master: native.account.unlocked.masterKey,
      refresh: native.account.tokens.refreshToken,
    };
  });

/** What a power-management wake looks like to the app: the OS event, then the page's own. */
const wake = async (desktop: Desktop): Promise<void> => {
  await desktop.app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('suspend');
    powerMonitor.emit('resume');
  });
  await desktop.page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

/** The access credential expired during the night: the next request must renew it. */
const expireAccessToken = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const native = (
      window as unknown as {
        __e2eNativeSync: {
          account: {
            tokens: { accessToken: string; refreshToken: string; expiresIn: number };
            adoptTokens(tokens: object): void;
          };
        };
      }
    ).__e2eNativeSync;
    native.account.adoptTokens({ ...native.account.tokens, expiresIn: 0 });
  });

/** A second session of the same account revokes the app's session, as the dashboard would. */
const revokeOtherSessions = async (account: string): Promise<number> => {
  const admin = new AccountClient(httpTransport(ultraUrl()));
  await admin.login(account, ACCOUNT_PASSWORD, 'Revoking test session');
  const sessions = await admin.request<{ id: string; current: boolean }[]>('/sessions');
  const others = sessions.filter((session) => !session.current);
  for (const session of others)
    await admin.request('/sessions/revoke', { sessionId: session.id });
  return others.length;
};

test.describe('@ultra desktop: the trusted device stays signed in', () => {
  test.skip(
    !executable,
    'ULTRA_ELECTRON_EXECUTABLE (the real Electron binary) is required',
  );
  test.describe.configure({ mode: 'serial', timeout: 420000 });

  let proxy: AccountProxy;
  test.beforeEach(async () => {
    proxy = await startAccountProxy(ultraUrl());
  });
  test.afterEach(async () => {
    await proxy.close();
  });

  test('quit and relaunch: still signed in, no password, credential rotated, protected at rest', async () => {
    const profile = profileDir('restart');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Desktop task ${Date.now()}`;
    let desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[0]);
      await waitSynced(desktop.page);
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);

      // Protected at rest: encrypted by the OS, and nowhere in renderer storage in the clear.
      const before = await secrets(desktop.page);
      expect(fs.existsSync(sessionFile(profile))).toBe(true);
      const stored = fs.readFileSync(sessionFile(profile), 'utf8');
      expect(stored).toMatch(/^[A-Za-z0-9+/=]+$/);
      const raw = Buffer.from(stored, 'base64');
      expect(raw.includes(Buffer.from(before.master))).toBe(false);
      expect(raw.includes(Buffer.from(before.refresh))).toBe(false);
      expect(raw.includes(Buffer.from(ACCOUNT_PASSWORD))).toBe(false);
      const renderer = await desktop.page.evaluate(
        (values) => {
          const dump = JSON.stringify([
            ...Object.entries(localStorage),
            ...Object.entries(sessionStorage),
          ]);
          return values.map((value) => dump.includes(value));
        },
        [before.master, before.refresh, ACCOUNT_PASSWORD],
      );
      expect(renderer).toEqual([false, false, false]);
      const savedBytes = fs.readFileSync(sessionFile(profile));

      await quit(desktop);
      proxy.reset();
      desktop = await launch(proxy, profile);

      // Back without being asked for anything.
      await waitSynced(desktop.page);
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toHaveCount(0);
      expect(await taskTitles(desktop.page)).toContain(title);
      const after = await secrets(desktop.page);
      expect(after.master).toBe(before.master);
      // The single-use credential was renewed exactly once and the new one persisted.
      expect(after.refresh).not.toBe(before.refresh);
      expect(proxy.count(REFRESH)).toBe(1);
      expect(fs.readFileSync(sessionFile(profile)).equals(savedBytes)).toBe(false);
      // The restart is attributable: the first run recorded how it ended.
      await expect
        .poll(() => mainLog(profile), { timeout: 15000 })
        .toMatch(/lifecycle: previous run ended: user-quit/);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('sleep and wake with an expired access token: one renewal, one sync, nothing asked', async () => {
    const profile = profileDir('wake');
    fs.rmSync(profile, { recursive: true, force: true });
    const desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[0]);
      await waitSynced(desktop.page);
      // Let the sign-in's own sync and any realtime echo settle before counting.
      await desktop.page.waitForTimeout(4000);
      const before = await secrets(desktop.page);
      const savedBytes = fs.readFileSync(sessionFile(profile));
      await expireAccessToken(desktop.page);
      proxy.reset();

      await wake(desktop);

      await expect.poll(() => proxy.count(REFRESH), { timeout: 20000 }).toBe(1);
      await desktop.page.waitForTimeout(5000);
      // The OS resume, "online" and "visible" arrived together: one renewal, one sync.
      expect(proxy.count(REFRESH)).toBe(1);
      expect(proxy.countMatching(CHANGES)).toBe(1);
      const view = await engineView(desktop.page);
      expect(view.phase).toBe('synced');
      expect(view.offline).toBe(false);
      expect(view.error).toBe('');
      expect((await secrets(desktop.page)).refresh).not.toBe(before.refresh);
      expect(fs.readFileSync(sessionFile(profile)).equals(savedBytes)).toBe(false);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('no network at wake, then back: offline with edits saved, no prompt, one renewal on recovery', async () => {
    const profile = profileDir('offline-wake');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Edited offline ${Date.now()}`;
    const desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[0]);
      await waitSynced(desktop.page);
      await desktop.page.waitForTimeout(4000);
      const before = await secrets(desktop.page);
      const lastSynced = (await engineView(desktop.page)).lastSyncedAt!;
      await expireAccessToken(desktop.page);
      proxy.mode = 'down';
      proxy.reset();

      await wake(desktop);
      await expect
        .poll(async () => (await engineView(desktop.page)).offline, { timeout: 30000 })
        .toBe(true);
      let view = await engineView(desktop.page);
      // Still the same configured, unlocked account; calm, not a sign-in prompt.
      expect(view.unlocked).toBe(true);
      expect(view.phase).not.toBe('reauth');
      expect(view.phase).not.toBe('locked');
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toHaveCount(0);

      // An edit made now is saved on this device and counted, never lost.
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBeGreaterThan(0);
      view = await engineView(desktop.page);
      expect(view.lastSyncedAt).toBe(lastSynced);
      // The renewals attempted while the server was away never reached it: nothing was consumed.
      expect(proxy.count(REFRESH)).toBe(0);

      // The network returns: one renewal (the failed ones never reached the server), then synced.
      proxy.mode = 'up';
      proxy.reset();
      await desktop.page.evaluate(() => window.dispatchEvent(new Event('online')));
      await waitSynced(desktop.page);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);
      view = await engineView(desktop.page);
      expect(view.offline).toBe(false);
      expect(view.error).toBe('');
      expect(view.lastSyncedAt!).toBeGreaterThan(lastSynced);
      expect(proxy.count(REFRESH)).toBe(1);
      // The pending edit went up exactly once.
      expect(proxy.countMatching(UPLOAD)).toBe(1);
      expect((await secrets(desktop.page)).refresh).not.toBe(before.refresh);
      expect(await taskTitles(desktop.page)).toContain(title);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('relaunch while the server cannot be reached: the vault opens locally, edits intact, then it recovers', async () => {
    const profile = profileDir('offline-start');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Before the outage ${Date.now()}`;
    let desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[1]);
      await waitSynced(desktop.page);
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);
      const savedBytes = fs.readFileSync(sessionFile(profile));
      await quit(desktop);

      proxy.mode = 'down';
      desktop = await launch(proxy, profile);
      await expect
        .poll(async () => (await engineView(desktop.page)).unlocked, { timeout: 60000 })
        .toBe(true);
      if (process.env.E2E_DEBUG_ENGINE)
        for (let i = 0; i < 6; i++) {
          console.log('engine', JSON.stringify(await engineView(desktop.page)));
          await desktop.page.waitForTimeout(2000);
        }
      await expect
        .poll(async () => (await engineView(desktop.page)).offline, { timeout: 30000 })
        .toBe(true);
      expect(await taskTitles(desktop.page)).toContain(title);
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toHaveCount(0);
      // Nothing was spent or forgotten while offline.
      expect(fs.readFileSync(sessionFile(profile)).equals(savedBytes)).toBe(true);
      expect(proxy.count(REFRESH)).toBe(0);

      proxy.mode = 'up';
      proxy.reset();
      await desktop.page.evaluate(() => window.dispatchEvent(new Event('online')));
      // The restored "last synced" time already reads as synced, so wait for the recovery itself.
      await expect
        .poll(async () => (await engineView(desktop.page)).offline, { timeout: 30000 })
        .toBe(false);
      await waitSynced(desktop.page);
      expect(proxy.count(REFRESH)).toBe(1);
      expect((await engineView(desktop.page)).error).toBe('');
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('a revoked session ends in "sign in again": identity and tasks kept, stored session removed, no loop', async () => {
    const profile = profileDir('revoked');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Survives revocation ${Date.now()}`;
    let desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[2]);
      await waitSynced(desktop.page);
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);
      await quit(desktop);

      // The dashboard (or another device) revokes this device's session.
      expect(await revokeOtherSessions(accounts[2])).toBeGreaterThan(0);

      proxy.reset();
      desktop = await launch(proxy, profile);
      await expect
        .poll(async () => (await engineView(desktop.page)).phase, { timeout: 60000 })
        .toBe('reauth');
      const view = await engineView(desktop.page);
      expect(view.unlocked).toBe(false);
      // The configured account stays: this is not "set up sync", it is "sign in again".
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toBeVisible();
      expect(
        await desktop.page.evaluate(() => localStorage.getItem('ultra-native-server')),
      ).toBe(proxy.origin);
      expect(fs.existsSync(sessionFile(profile))).toBe(false);
      // No loop: one refused attempt, then it waits for the person.
      await desktop.page.waitForTimeout(8000);
      expect(proxy.count(REFRESH)).toBe(1);

      // Signing in again restores everything, with the local task still there.
      await signInWithPassword(desktop.page, proxy.origin, accounts[2]);
      await waitSynced(desktop.page);
      expect(await taskTitles(desktop.page)).toContain(title);
      expect((await engineView(desktop.page)).phase).toBe('synced');
      expect(fs.existsSync(sessionFile(profile))).toBe(true);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('a lost refresh response: the replay of the consumed credential reads as "sign in again", once, with edits kept', async () => {
    const profile = profileDir('lost-response');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Kept through a lost response ${Date.now()}`;
    const desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[3]);
      await waitSynced(desktop.page);
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);
      await desktop.page.waitForTimeout(3000);
      await expireAccessToken(desktop.page);
      proxy.mode = 'drop-refresh-response';
      proxy.reset();

      // The renewal reaches the server (the credential is consumed) but its answer is lost.
      // The device cannot know: it retries, which replays the consumed credential. The
      // server's reuse detection revokes the session by design (no leeway), and the app must
      // say "sign in again" and stop, not loop.
      await wake(desktop);
      await expect
        .poll(async () => (await engineView(desktop.page)).phase, { timeout: 60000 })
        .toBe('reauth');
      await desktop.page.waitForTimeout(8000);
      expect(proxy.count(REFRESH)).toBe(2);
      expect(fs.existsSync(sessionFile(profile))).toBe(false);
      expect(await taskTitles(desktop.page)).toContain(title);
      // The account page offers the sign-in; the configured account was not forgotten.
      await desktop.page.evaluate(() => {
        window.location.hash = '#/native-sync';
      });
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toBeVisible();
      expect(
        await desktop.page.evaluate(() => localStorage.getItem('ultra-native-server')),
      ).toBe(proxy.origin);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('protected storage that cannot be read keeps the account locked, never reset, and the password recovers', async () => {
    const profile = profileDir('storage-unavailable');
    fs.rmSync(profile, { recursive: true, force: true });
    const title = `Local edit ${Date.now()}`;
    let desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[4]);
      await waitSynced(desktop.page);
      await addTask(desktop.page, title);
      await expect
        .poll(async () => (await engineView(desktop.page)).pendingChanges, {
          timeout: 30000,
        })
        .toBe(0);
      await quit(desktop);

      // The OS credential store cannot open what it once sealed (profile or keychain changed).
      const unreadable = Buffer.from('this is not a protected blob'.repeat(4)).toString(
        'base64',
      );
      fs.writeFileSync(sessionFile(profile), unreadable, 'utf8');
      proxy.reset();

      desktop = await launch(proxy, profile);
      await expect
        .poll(async () => (await engineView(desktop.page)).phase, { timeout: 60000 })
        .toBe('locked');
      const view = await engineView(desktop.page);
      expect(view.unlocked).toBe(false);
      expect(
        await desktop.page.evaluate(() =>
          (
            window as unknown as { __e2eNativeSync: { lockReason(): string | null } }
          ).__e2eNativeSync.lockReason(),
        ),
      ).toBe('storage-unavailable');
      // Configured identity and local tasks stay; no credential was cleared; nothing reached the server.
      expect(
        await desktop.page.evaluate(() => localStorage.getItem('ultra-native-server')),
      ).toBe(proxy.origin);
      expect(fs.readFileSync(sessionFile(profile), 'utf8')).toBe(unreadable);
      expect(proxy.count(REFRESH)).toBe(0);
      await desktop.page.evaluate(() => {
        window.location.hash = '#/tag/TODAY/tasks';
      });
      await expect.poll(() => taskTitles(desktop.page)).toContain(title);

      // The recovery action is the normal sign-in; it writes a readable session again.
      await desktop.page.evaluate(() => {
        window.location.hash = '#/native-sync';
      });
      await signInWithPassword(desktop.page, proxy.origin, accounts[4]);
      await waitSynced(desktop.page);
      expect(fs.readFileSync(sessionFile(profile), 'utf8')).not.toBe(unreadable);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });

  test('explicit lock forgets the remembered session: the next start asks for the password', async () => {
    const profile = profileDir('explicit-lock');
    fs.rmSync(profile, { recursive: true, force: true });
    let desktop = await launch(proxy, profile, true);
    try {
      await signInWithPassword(desktop.page, proxy.origin, accounts[5]);
      await waitSynced(desktop.page);
      expect(fs.existsSync(sessionFile(profile))).toBe(true);
      await desktop.page.evaluate(() =>
        (
          window as unknown as { __e2eNativeSync: { lock(): Promise<void> } }
        ).__e2eNativeSync.lock(),
      );
      await expect
        .poll(() => fs.existsSync(sessionFile(profile)), { timeout: 15000 })
        .toBe(false);
      await quit(desktop);

      proxy.reset();
      desktop = await launch(proxy, profile);
      await expect(
        desktop.page.locator('native-sync input[name="password"]'),
      ).toBeVisible();
      const view = await engineView(desktop.page);
      expect(view.unlocked).toBe(false);
      expect(view.phase).toBe('locked');
      expect(proxy.count(REFRESH)).toBe(0);
    } finally {
      await desktop.app.close().catch(() => undefined);
    }
  });
});
