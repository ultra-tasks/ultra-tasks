import { createHash } from 'node:crypto';
import { expect, test } from '../../fixtures/test.fixture';
import {
  connectProvider,
  mockProvider,
  refreshProviderItem,
} from '../../utils/four-provider-fixtures';

// Keep authorization and source requests inside this test's mock routes.
test.use({ serviceWorkers: 'block' });

for (const key of ['GITLAB', 'LINEAR', 'TRELLO'] as const) {
  test(`${key} public-client sign-in completes PKCE and imports without a pasted token`, async ({
    page,
    workViewPage,
  }) => {
    const context = page.context();
    await workViewPage.waitForTaskList();
    const source = await mockProvider(page, key);
    const authUrl = {
      GITLAB: 'https://gitlab.com/oauth/authorize**',
      LINEAR: 'https://linear.app/oauth/authorize**',
      TRELLO: 'https://auth.atlassian.com/authorize**',
    }[key];
    const tokenUrl = {
      GITLAB: 'https://gitlab.com/oauth/token',
      LINEAR: 'https://api.linear.app/oauth/token',
      TRELLO: 'https://auth.atlassian.com/oauth/token',
    }[key];
    let challenge = '';
    let redirectUri = '';
    let exchanged = false;
    await context.route(authUrl, async (route) => {
      const url = new URL(route.request().url());
      challenge = url.searchParams.get('code_challenge')!;
      redirectUri = url.searchParams.get('redirect_uri')!;
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('client_secret')).toBeNull();
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', 'fixture-code');
      callback.searchParams.set('state', url.searchParams.get('state')!);
      await route.fulfill({
        contentType: 'text/html',
        body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
      });
    });
    await context.route(tokenUrl, async (route) => {
      const request = route.request();
      const data =
        key === 'TRELLO'
          ? request.postDataJSON()
          : Object.fromEntries(new URLSearchParams(request.postData()!));
      expect(data.client_secret).toBeUndefined();
      expect(data.code).toBe('fixture-code');
      expect(data.redirect_uri).toBe(redirectUri);
      expect(createHash('sha256').update(data.code_verifier).digest('base64url')).toBe(
        challenge,
      );
      exchanged = true;
      await route.fulfill({
        headers: { ['access-control-allow-origin']: '*' },
        json: {
          access_token: 'fixture-oauth-access',
          refresh_token: 'fixture-oauth-refresh',
          expires_in: 3600,
        },
      });
    });
    await connectProvider(page, key, true);
    expect(exchanged).toBe(true);
    expect(source.authorizations).toContain('Bearer fixture-oauth-access');
    expect(source.writes).toEqual([]);
    expect(source.creates).toEqual([]);
    await page.reload();
    await refreshProviderItem(page);
    expect(source.authorizations.at(-1)).toBe('Bearer fixture-oauth-access');
    expect(source.writes).toEqual([]);
  });
}
