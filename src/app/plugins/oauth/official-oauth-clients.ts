import { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { getEnvOptional } from '../../util/env';
import { T } from '../../t.const';

export type OfficialOAuthProvider = 'GITHUB' | 'GITLAB' | 'LINEAR' | 'TRELLO';
export interface OfficialOAuthClient {
  pluginId: string;
  label: string;
  flow: 'pkce' | 'device';
  config: OAuthFlowConfig;
}

/** Public client ids only. No client secrets are compiled into installed apps. */
export const buildOfficialOAuthClients = (
  read: (key: string) => string | undefined,
): Partial<Record<OfficialOAuthProvider, OfficialOAuthClient>> => {
  const clients: Partial<Record<OfficialOAuthProvider, OfficialOAuthClient>> = {};
  const callback = 'http://127.0.0.1:18194/plugin-oauth-callback';
  const labels = {
    GITHUB: T.F.ISSUE.DIALOG.SIGN_IN_GITHUB,
    GITLAB: T.F.ISSUE.DIALOG.SIGN_IN_GITLAB,
    LINEAR: T.F.ISSUE.DIALOG.SIGN_IN_LINEAR,
    TRELLO: T.F.ISSUE.DIALOG.SIGN_IN_TRELLO,
  };
  const add = (
    provider: OfficialOAuthProvider,
    pluginId: string,
    config: Omit<OAuthFlowConfig, 'clientId'>,
    flow: OfficialOAuthClient['flow'] = 'pkce',
  ): void => {
    const clientId = read(`${provider}_OAUTH_CLIENT_ID`)?.trim();
    if (!clientId) return;
    clients[provider] = {
      pluginId,
      label: labels[provider],
      flow,
      config: {
        ...config,
        clientId,
        ...(flow === 'pkce' ? { webClientId: clientId, redirectUri: callback } : {}),
      },
    };
  };
  add(
    'GITHUB',
    'github-issue-provider',
    {
      authUrl: 'https://github.com/login/device',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    },
    'device',
  );
  add('GITLAB', 'gitlab-issue-provider', {
    authUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scopes: ['api'],
  });
  add('LINEAR', 'linear-issue-provider', {
    authUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    // Linear's authorization endpoint requires comma-separated scope names.
    scopes: ['read,issues:create'],
    extraAuthParams: { prompt: 'consent' },
  });
  add('TRELLO', 'trello-issue-provider', {
    authUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: [
      'read:board:trello',
      'write:board:trello',
      'read:member:trello',
      'read:organization:trello',
      'offline_access',
    ],
    extraAuthParams: { prompt: 'consent' },
    nativeRedirectUri: 'https://ultratasks.app/oauth-callback/',
  });
  return clients;
};

export const OFFICIAL_OAUTH_CLIENTS = buildOfficialOAuthClients(getEnvOptional);
export const officialOAuthForPlugin = (
  pluginId: string,
): OfficialOAuthClient | undefined =>
  Object.values(OFFICIAL_OAUTH_CLIENTS).find((client) => client.pluginId === pluginId);
