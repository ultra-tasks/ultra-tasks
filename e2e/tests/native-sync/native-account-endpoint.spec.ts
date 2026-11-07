import { expect, test } from '../../fixtures/test.fixture';

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
  await account.locator('input[name="server"]').fill('https://account.example.test/');
  await account.locator('input[name="identifier"]').fill('test-user');
  await account.locator('input[name="password"]').fill('test-password');
  await account.locator('button[type="submit"]').click();
  await expect(account.getByRole('alert')).toHaveText('Unsupported account server');
  expect(requests).toEqual([
    {
      url: 'https://account.example.test/api/v2/accounts/capabilities',
      method: 'GET',
      body: null,
    },
  ]);

  await account.locator('input[name="server"]').fill('http://remote.example.test');
  await account.locator('input[name="password"]').fill('test-password');
  await account.locator('button[type="submit"]').click();
  await expect(account.getByRole('alert')).toContainText('Use an HTTPS server URL');
  expect(requests).toHaveLength(1);
});
