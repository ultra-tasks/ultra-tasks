import { inject, Injectable } from '@angular/core';
import { PluginSecretService } from '../../plugins/secret/plugin-secret.service';
import { PluginOAuthBridgeService } from '../../plugins/oauth/plugin-oauth-bridge.service';
import { OFFICIAL_OAUTH_CLIENTS } from '../../plugins/oauth/official-oauth-clients';
import { IssueProvider, IssueProviderKey } from './issue.model';
import { IssueProviderOwnershipService } from './issue-provider-ownership.service';

const CREDENTIALS = {
  GITHUB: { pluginId: 'github-issue-provider', field: 'token' },
  GITLAB: { pluginId: 'gitlab-issue-provider', field: 'token' },
  LINEAR: { pluginId: 'linear-issue-provider', field: 'apiKey' },
  TRELLO: { pluginId: 'trello-issue-provider', field: 'token' },
} as const;

export const providerCredential = (
  key: IssueProviderKey,
): (typeof CREDENTIALS)[keyof typeof CREDENTIALS] | undefined =>
  CREDENTIALS[key as keyof typeof CREDENTIALS];
export const connectionSecretKey = (
  id: string,
  field: string,
  sourceUrl?: string,
): string =>
  `connection__${id}__${field}${sourceUrl ? `__${encodeURIComponent(new URL(sourceUrl).origin)}` : ''}`;

const credentialSourceUrl = (provider: Partial<IssueProvider>): string | undefined => {
  if (provider.issueProviderKey === 'GITLAB')
    return provider.gitlabBaseUrl || 'https://gitlab.com';
  if (provider.issueProviderKey === 'GITHUB') {
    const cfg = 'pluginConfig' in provider ? provider.pluginConfig : {};
    return String(cfg?.['apiBaseUrl'] || 'https://api.github.com');
  }
  return undefined;
};

@Injectable({ providedIn: 'root' })
export class IssueProviderCredentialsService {
  private readonly _secrets = inject(PluginSecretService);
  private readonly _oauth = inject(PluginOAuthBridgeService);
  private readonly _ownership = inject(IssueProviderOwnershipService);

  async hasLocalCredential(provider: Partial<IssueProvider>): Promise<boolean> {
    const cfg =
      provider.issueProviderKey && providerCredential(provider.issueProviderKey);
    return !!(
      cfg &&
      provider.id &&
      (await this._secrets.getSecret(
        cfg.pluginId,
        connectionSecretKey(provider.id, cfg.field, credentialSourceUrl(provider)),
      ))
    );
  }

  /** New tokens are device-local. Keep a pre-existing synced credential for released clients. */
  async save(
    provider: Partial<IssueProvider>,
    previous?: IssueProvider,
  ): Promise<Partial<IssueProvider>> {
    const cfg =
      provider.issueProviderKey && providerCredential(provider.issueProviderKey);
    if (!cfg || !provider.id) return provider;
    const providerId = provider.id;
    if (!previous && !provider.integrationOwnerId)
      provider = { ...provider, ...(await this._ownership.claim()) };
    const config = 'pluginConfig' in provider ? provider.pluginConfig : provider;
    const value = config && (config as Record<string, unknown>)[cfg.field];
    if (typeof value !== 'string' || !value.trim()) return provider;
    await this._ownership.assertOwner(provider);
    await this._secrets.setSecret(
      cfg.pluginId,
      connectionSecretKey(providerId, cfg.field, credentialSourceUrl(provider)),
      value.trim(),
    );
    const previousConfig =
      previous && ('pluginConfig' in previous ? previous.pluginConfig : previous);
    const legacy =
      previousConfig && (previousConfig as unknown as Record<string, unknown>)[cfg.field];
    const clean = {
      ...config,
      [cfg.field]: typeof legacy === 'string' && legacy ? legacy : null,
    };
    return 'pluginConfig' in provider
      ? { ...provider, pluginConfig: clean }
      : { ...provider, ...clean };
  }

  async gitlabToken(cfg: {
    id?: string;
    token: string | null;
    gitlabBaseUrl?: string | null;
  }): Promise<{ value: string; isOAuth: boolean }> {
    if (cfg.id) {
      const base = (cfg.gitlabBaseUrl || 'https://gitlab.com/').replace(/\/+$/, '');
      if (base === 'https://gitlab.com') {
        const oauth = await this._oauth.getOAuthToken(
          'gitlab-issue-provider',
          OFFICIAL_OAUTH_CLIENTS.GITLAB?.config,
          cfg.id,
        );
        if (oauth) return { value: oauth, isOAuth: true };
      }
      const stored = await this._secrets.getSecret(
        'gitlab-issue-provider',
        connectionSecretKey(cfg.id, 'token', cfg.gitlabBaseUrl || 'https://gitlab.com'),
      );
      if (stored) return { value: stored, isOAuth: false };
    }
    return { value: cfg.token || '', isOAuth: false };
  }
}
