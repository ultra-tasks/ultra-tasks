import { buildOfficialOAuthClients } from './official-oauth-clients';

describe('official provider registrations', () => {
  it('offers no sign-in buttons without registered clients', () => {
    expect(buildOfficialOAuthClients(() => undefined)).toEqual({});
  });
  it('uses public clients without secrets and preserves provider-specific protocols', () => {
    const clients = buildOfficialOAuthClients((key) => `${key}-public`);
    expect(Object.keys(clients)).toEqual(['GITHUB', 'GITLAB', 'LINEAR', 'TRELLO']);
    expect(clients.GITHUB?.flow).toBe('device');
    expect(clients.GITHUB?.config.webClientId).toBeUndefined();
    expect(clients.LINEAR?.config.scopes).toEqual(['read,issues:create']);
    expect(clients.TRELLO?.config.nativeRedirectUri).toBe(
      'https://ultratasks.app/oauth-callback/',
    );
    for (const client of Object.values(clients))
      expect(client.config.clientSecret).toBeUndefined();
  });
});
