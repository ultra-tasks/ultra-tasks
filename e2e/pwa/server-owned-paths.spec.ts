import { expect, test } from '../fixtures/test.fixture';
import { waitForAppReady } from '../utils/waits';

// The hosted app shares an origin with the account dashboard and API. Once the
// service worker controls the page, navigations to server-owned paths must reach
// the network instead of being answered with the app's index.html.
test.describe('Production PWA server-owned paths', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.post('/__e2e/pwa/version/v1');
    expect(response.ok()).toBeTruthy();
  });

  test('leaves /account, /oauth/callback and /api to the network', async ({
    page,
    isolatedContext,
  }) => {
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return registration?.active?.state === 'activated'
              ? registration.active.scriptURL
              : null;
          }),
        { timeout: 30000 },
      )
      .toMatch(/\/sw\.js$/);

    // The first document can install the worker without being controlled by it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
      )
      .toMatch(/\/sw\.js$/);

    await page.goto('/account?view=login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('PWA_E2E_ACCOUNT_DASHBOARD');

    await page.goto('/oauth/callback/google?code=x', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('PWA_E2E_OAUTH_CALLBACK');

    const api = await page.evaluate(async () =>
      (await fetch('/api/v2/accounts/ping')).json(),
    );
    expect(api).toEqual({ owner: 'server' });
  });
});
