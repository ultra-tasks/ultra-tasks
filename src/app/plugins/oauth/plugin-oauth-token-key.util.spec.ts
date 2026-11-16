import {
  GOOGLE_CALENDAR_PLUGIN_ID,
  PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY,
  shouldScopePluginOAuth,
  withPluginOAuthTokenKey,
} from './plugin-oauth-token-key.util';

describe('plugin-oauth-token-key.util', () => {
  it('scopes OAuth for bundled calendar and issue providers', () => {
    expect(shouldScopePluginOAuth(GOOGLE_CALENDAR_PLUGIN_ID)).toBeTrue();
    for (const id of [
      'github-issue-provider',
      'gitlab-issue-provider',
      'linear-issue-provider',
      'trello-issue-provider',
    ]) {
      expect(shouldScopePluginOAuth(id)).toBeTrue();
    }
    expect(shouldScopePluginOAuth('uploaded-oauth-plugin')).toBeFalse();
  });

  it('adds the transient token key only for Google Calendar', () => {
    expect(
      withPluginOAuthTokenKey(
        GOOGLE_CALENDAR_PLUGIN_ID,
        { readCalendarIds: [] },
        'provider-a',
      ),
    ).toEqual({
      readCalendarIds: [],
      [PLUGIN_OAUTH_TOKEN_KEY_CFG_KEY]: 'provider-a',
    });

    expect(
      withPluginOAuthTokenKey('uploaded-oauth-plugin', { value: 1 }, 'provider-a'),
    ).toEqual({ value: 1 });
  });

  it('isolates non-scoped plugin config writes from the stored provider', () => {
    const stored = { calendarId: 'original' };
    const config = withPluginOAuthTokenKey('caldav-provider', stored, 'provider-a');
    config['calendarId'] = 'changed-by-plugin';
    expect(stored.calendarId).toBe('original');
  });
});
