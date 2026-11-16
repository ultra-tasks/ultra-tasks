import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;
const getOAuthToken = vi.fn();
const getSecret = vi.fn();
beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: (value: IssueProviderPluginDefinition) => {
      definition = value;
    },
    translate: (key: string) => key,
    getOAuthToken,
    getSecret,
  };
  await import('./plugin');
});
beforeEach(() => {
  getOAuthToken.mockReset().mockResolvedValue(null);
  getSecret.mockReset().mockResolvedValue(null);
});
const issue = {
  number: 42,
  title: 'Private issue',
  body: 'Notes',
  state: 'open',
  comments: 0,
  html_url: 'https://github.com/team/repo/issues/42',
  updated_at: '2026-11-15T10:00:00Z',
  labels: [{ name: 'bug' }],
};

describe('GitHub connection boundaries', () => {
  it('assigns existing repository labels without creating labels remotely', async () => {
    const get = vi.fn().mockResolvedValue([{ name: 'bug' }]);
    const patch = vi.fn();
    const post = vi.fn();
    await definition.updateIssue!('42', { labels: ['bug'] }, { repo: 'team/repo' }, {
      get,
      patch,
      post,
    } as unknown as PluginHttp);
    expect(patch).toHaveBeenCalledWith(
      'https://api.github.com/repos/team/repo/issues/42',
      { labels: ['bug'] },
    );
    await expect(
      definition.updateIssue!(
        '42',
        { labels: ['new-remote-label'] },
        { repo: 'team/repo' },
        { get, patch, post } as unknown as PluginHttp,
      ),
    ).rejects.toThrow();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
  it('uses the connection-specific OAuth grant for private repositories', async () => {
    getOAuthToken.mockResolvedValue('connection-access');
    const headers = await definition.getHeaders({
      repo: 'team/repo',
      __spOAuthTokenKey: 'connection-a',
    });
    expect(getOAuthToken).toHaveBeenCalledWith('connection-a');
    expect(headers.Authorization).toBe('token connection-access');
  });
  it('loads a newly pasted token from the local connection store', async () => {
    getSecret.mockResolvedValue('local-token');
    const headers = await definition.getHeaders({
      repo: 'team/repo',
      token: null,
      __spOAuthTokenKey: 'connection-a',
    });
    expect(getSecret).toHaveBeenCalledWith(
      'connection__connection-a__token__https%3A%2F%2Fapi.github.com',
    );
    expect(headers.Authorization).toBe('token local-token');
  });
  it('does not send the github.com OAuth grant to a custom API host', async () => {
    const headers = await definition.getHeaders({
      repo: 'team/repo',
      token: 'enterprise-token',
      apiBaseUrl: 'https://github.example.test/api/v3',
      __spOAuthTokenKey: 'connection-a',
    });
    expect(getOAuthToken).not.toHaveBeenCalled();
    expect(headers.Authorization).toBe('token enterprise-token');
  });
  it('does not reuse a local public-host credential after changing API origin', async () => {
    getSecret.mockImplementation(async (key: string) =>
      key === 'connection__connection-a__token__https%3A%2F%2Fapi.github.com'
        ? 'github-only-token'
        : null,
    );
    const headers = await definition.getHeaders({
      repo: 'team/repo',
      apiBaseUrl: 'https://github.example.test/api/v3',
      __spOAuthTokenKey: 'connection-a',
    });
    expect(headers.Authorization).toBeUndefined();
    expect(getSecret).toHaveBeenCalledWith(
      'connection__connection-a__token__https%3A%2F%2Fgithub.example.test',
    );
  });
  it('keeps issue requests repository-qualified while retaining released-client numeric ids', async () => {
    const get = vi.fn().mockResolvedValue(issue);
    const first = await definition.getById('42', { repo: 'team/first' }, {
      get,
    } as unknown as PluginHttp);
    await definition.getById('42', { repo: 'team/second' }, {
      get,
    } as unknown as PluginHttp);
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      'https://api.github.com/repos/team/first/issues/42',
      'https://api.github.com/repos/team/second/issues/42',
    ]);
    expect(first.id).toBe('42');
  });
  it('excludes pull requests unless explicitly selected', async () => {
    const get = vi.fn().mockResolvedValue({ items: [] });
    await definition.searchIssues('term', { repo: 'team/repo' }, {
      get,
    } as unknown as PluginHttp);
    expect(new URL(get.mock.calls[0][0]).searchParams.get('q')).toContain('is:issue');
    await definition.searchIssues(
      'term',
      { repo: 'team/repo', includePullRequests: true },
      { get } as unknown as PluginHttp,
    );
    expect(new URL(get.mock.calls[1][0]).searchParams.get('q')).not.toContain('is:issue');
  });
  it('offers explicit label/tag mapping with no writes enabled by default', () => {
    const mapping = definition.fieldMappings?.find(
      (value) => value.taskField === 'tagIds',
    );
    expect(mapping?.issueField).toBe('labels');
    expect(mapping?.defaultDirection).toBe('off');
    expect(mapping?.toIssueValue(['bug'], { issueId: '42' })).toEqual(['bug']);
  });
  it('reports revoked write permission and never creates as a fallback', async () => {
    const patch = vi.fn().mockRejectedValue({ status: 403 });
    const post = vi.fn();
    await expect(
      definition.updateIssue!('42', { title: 'New' }, { repo: 'team/repo' }, {
        patch,
        post,
      } as unknown as PluginHttp),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
