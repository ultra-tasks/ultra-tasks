import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  addLocalTask,
  closeDevices,
  connectFirstDevice,
  engineCall,
  engineView,
  newDevice,
  signIn,
  taskTitles,
  ultraUrl,
} from './native-account-helpers';

const setDatabaseAvailable = async (
  request: APIRequestContext,
  available: boolean,
): Promise<void> => {
  expect(
    (
      await request.put(`${ultraUrl()}/provider-database-availability`, {
        data: { available },
      })
    ).ok(),
  ).toBe(true);
};

// Avoid waiting out an otherwise valid access token so the next real request takes the
// refresh path. The auth transport and server still see the original refresh credential.
const expireAccessToken = (page: Page): Promise<void> =>
  page.evaluate(() => {
    type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };
    const { account } = (
      window as unknown as {
        __e2eNativeSync: {
          account: { tokens: Tokens; adoptTokens: (tokens: Tokens) => void };
        };
      }
    ).__e2eNativeSync;
    account.adoptTokens({ ...account.tokens, expiresIn: 0 });
  });

test('@ultra a database outage preserves the unlocked account and queued edits', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const writer = await newDevice(browser, 'Outage writer');
  const peer = await newDevice(browser, 'Outage peer');
  const outageTask = 'Edit entered during the database outage';
  const initialTask = 'Existing task before the database outage';
  const account = 'sessionoutage';
  try {
    await addLocalTask(writer, initialTask);
    await connectFirstDevice(writer, account);
    await signIn(peer.page, account);
    await expect
      .poll(() => taskTitles(peer.page), { timeout: 30_000 })
      .toContain(initialTask);

    await setDatabaseAvailable(request, false);
    const failedReads: number[] = [];
    writer.page.on('response', (response) => {
      if (new URL(response.url()).pathname.endsWith('/sync/scopes') && !response.ok())
        failedReads.push(response.status());
    });
    await addLocalTask(writer, outageTask);
    await engineCall(writer.page, 'syncNow');
    expect(failedReads).toContain(503);
    expect(await engineView(writer.page)).toMatchObject({
      unlocked: true,
      linked: true,
      offline: true,
      error: '',
    });
    expect((await engineView(writer.page)).pendingChanges).toBeGreaterThan(0);
    expect(await taskTitles(writer.page)).toContain(outageTask);
    expect(await taskTitles(peer.page)).not.toContain(outageTask);

    await expireAccessToken(writer.page);
    const refresh = writer.page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/sessions/refresh'),
    );
    await engineCall(writer.page, 'syncNow');
    expect((await refresh).status()).toBe(503);
    expect(await engineView(writer.page)).toMatchObject({
      unlocked: true,
      offline: true,
    });

    await setDatabaseAvailable(request, true);
    // Exercise the existing reconnect handling without reopening the sign-in form.
    await writer.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect
      .poll(() => engineView(writer.page), { timeout: 30_000 })
      .toMatchObject({
        unlocked: true,
        linked: true,
        offline: false,
        pendingChanges: 0,
        error: '',
      });
    await engineCall(peer.page, 'syncNow');
    await expect
      .poll(() => taskTitles(peer.page), { timeout: 30_000 })
      .toContain(outageTask);
  } finally {
    await setDatabaseAvailable(request, true);
    await closeDevices(writer, peer);
  }
});
