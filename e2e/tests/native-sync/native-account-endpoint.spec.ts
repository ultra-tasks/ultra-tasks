import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/** The sign-in step of the account page, in one place. */
const fillSignIn = async (
  page: Page,
  { server, email, password }: { server?: string; email?: string; password: string },
): Promise<void> => {
  const account = page.locator('native-sync');
  if (server !== undefined)
    await account.getByLabel('Ultra Tasks server URL').fill(server);
  if (email !== undefined) await account.getByLabel('Email', { exact: true }).fill(email);
  await account.getByLabel('Password', { exact: true }).fill(password);
};
const submitSignIn = (page: Page): Promise<void> =>
  page
    .locator('native-sync')
    .getByRole('button', { name: 'Sign in', exact: true })
    .click();

test('native account setup checks the entered HTTPS server before sending credentials', async ({
  page,
}) => {
  const requests: { url: string; method: string; body: string | null }[] = [];
  await page.route('**/capabilities', async (route) => {
    const request = route.request();
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    });
    await route.fulfill({ json: { protocol: 1, serverId: 'unsupported-test-server' } });
  });
  await page.goto('/#/native-sync');
  const account = page.locator('native-sync');
  await expect(account).toBeVisible();
  // With an official server built in, its address stays hidden until Custom server is chosen.
  const customServer = account.getByRole('radio', { name: 'Custom server', exact: true });
  if (await customServer.count()) {
    await expect(account.getByLabel('Ultra Tasks server URL')).toHaveCount(0);
    await customServer.check();
  }
  await fillSignIn(page, {
    server: 'https://account.example.test/',
    email: 'test-user',
    password: 'test-password',
  });
  await submitSignIn(page);
  await expect(account.getByRole('alert').locator('p')).toHaveText(
    'Unsupported account server',
  );
  expect(requests).toEqual([
    {
      url: 'https://account.example.test/api/v2/accounts/capabilities',
      method: 'GET',
      body: null,
    },
  ]);

  // The address the user actually selected is validated, inline under its field.
  await fillSignIn(page, {
    server: 'http://remote.example.test',
    password: 'test-password',
  });
  await submitSignIn(page);
  const problem = account.getByRole('alert');
  await expect(problem).toContainText('Use an HTTPS server URL');
  await expect(problem).toHaveCount(1);
  await expect(account.getByLabel('Ultra Tasks server URL')).toBeFocused();
  expect(requests).toHaveLength(1);
});

test('the account page opens the account website at its sign-up view for the selected server', async ({
  page,
}) => {
  await page
    .context()
    .route('https://account.example.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>account website</title>' }),
    );
  await page.goto('/#/native-sync');
  const account = page.locator('native-sync');
  await expect(account).toBeVisible();
  const customServer = account.getByRole('radio', { name: 'Custom server', exact: true });
  if (await customServer.count()) await customServer.check();
  await account
    .getByLabel('Ultra Tasks server URL')
    .fill('https://account.example.test/');

  const signUp = page.context().waitForEvent('page');
  await account.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await signUp).url()).toBe('https://account.example.test/account?view=signup');

  const recovery = page.context().waitForEvent('page');
  await account.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  expect((await recovery).url()).toBe('https://account.example.test/account');
});
