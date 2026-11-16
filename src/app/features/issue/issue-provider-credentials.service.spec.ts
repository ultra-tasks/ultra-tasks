import { TestBed } from '@angular/core/testing';
import {
  IssueProviderCredentialsService,
  connectionSecretKey,
} from './issue-provider-credentials.service';
import { PluginSecretService } from '../../plugins/secret/plugin-secret.service';
import { PluginOAuthBridgeService } from '../../plugins/oauth/plugin-oauth-bridge.service';
import { IssueProvider } from './issue.model';

describe('IssueProviderCredentialsService local storage', () => {
  let service: IssueProviderCredentialsService;
  let secrets: PluginSecretService;
  let oauth: jasmine.SpyObj<PluginOAuthBridgeService>;
  const provider = (token: string): IssueProvider =>
    ({
      id: 'credential-unit-connection',
      issueProviderKey: 'GITHUB',
      pluginId: 'github-issue-provider',
      isEnabled: true,
      pluginConfig: { repo: 'test/repo', token },
    }) as IssueProvider;

  beforeEach(() => {
    oauth = jasmine.createSpyObj('OAuth', ['getOAuthToken']);
    oauth.getOAuthToken.and.resolveTo(null);
    TestBed.configureTestingModule({
      providers: [{ provide: PluginOAuthBridgeService, useValue: oauth }],
    });
    service = TestBed.inject(IssueProviderCredentialsService);
    secrets = TestBed.inject(PluginSecretService);
  });
  afterEach(async () => {
    await secrets.deleteSecret(
      'github-issue-provider',
      connectionSecretKey(
        'credential-unit-connection',
        'token',
        'https://api.github.com',
      ),
    );
    await secrets.deleteSecret(
      'gitlab-issue-provider',
      connectionSecretKey('credential-gitlab', 'token', 'https://gitlab.com'),
    );
  });

  it('stores a new token locally and keeps it out of the provider sent to sync', async () => {
    const original = provider('new-private-token');
    const saved = await service.save(original);
    expect(
      (saved as { pluginConfig: Record<string, unknown> }).pluginConfig['token'],
    ).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('new-private-token');
    expect(
      await secrets.getSecret(
        'github-issue-provider',
        connectionSecretKey(original.id, 'token', 'https://api.github.com'),
      ),
    ).toBe('new-private-token');
    expect(await service.hasLocalCredential(saved)).toBeTrue();
    expect(
      (original as { pluginConfig: Record<string, unknown> }).pluginConfig['token'],
    ).toBe('new-private-token');
  });

  it('preserves an old synced credential for released clients while new credentials stay local', async () => {
    const saved = await service.save(
      provider('replacement-local-token'),
      provider('existing-synced-token'),
    );
    expect(JSON.stringify(saved)).not.toContain('replacement-local-token');
    expect(JSON.stringify(saved)).toContain('existing-synced-token');
    expect(
      await secrets.getSecret(
        'github-issue-provider',
        connectionSecretKey(
          'credential-unit-connection',
          'token',
          'https://api.github.com',
        ),
      ),
    ).toBe('replacement-local-token');
  });

  it('does not send a gitlab.com OAuth token to a self-managed instance', async () => {
    const credential = await service.gitlabToken({
      id: 'credential-gitlab',
      token: 'self-managed-token',
      gitlabBaseUrl: 'https://gitlab.example.test',
    });
    expect(credential).toEqual({ value: 'self-managed-token', isOAuth: false });
    expect(oauth.getOAuthToken).not.toHaveBeenCalled();
  });

  it('requires a new local GitHub credential after the source origin changes', async () => {
    const saved = await service.save(provider('github-only-token'));
    const changed = {
      ...saved,
      pluginConfig: {
        repo: 'test/repo',
        apiBaseUrl: 'https://github.example.test/api/v3',
      },
    } as IssueProvider;
    expect(await service.hasLocalCredential(saved)).toBeTrue();
    expect(await service.hasLocalCredential(changed)).toBeFalse();
  });

  it('does not reuse a newly pasted gitlab.com token on a self-managed origin', async () => {
    await secrets.setSecret(
      'gitlab-issue-provider',
      connectionSecretKey('credential-gitlab', 'token', 'https://gitlab.com'),
      'gitlab-com-only-token',
    );
    const credential = await service.gitlabToken({
      id: 'credential-gitlab',
      token: null,
      gitlabBaseUrl: 'https://gitlab.example.test',
    });
    expect(credential).toEqual({ value: '', isOAuth: false });
  });
});
