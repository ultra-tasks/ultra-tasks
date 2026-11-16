import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;
beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: (value: IssueProviderPluginDefinition) => {
      definition = value;
    },
    translate: (key: string) => key,
  };
  await import('./plugin');
});

const issue = {
  id: 'issue-1',
  identifier: 'ENG-42',
  number: 42,
  title: 'A task',
  description: 'Description',
  url: 'https://linear.app/test/issue/ENG-42',
  state: { id: 'done', name: 'Done', type: 'completed' },
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  priority: 2,
};

describe('Linear write-back', () => {
  it('compares completion without rewriting started or cancelled workflow details', () => {
    expect(
      definition.extractSyncValues!({
        ...issue,
        state: 'In progress',
        stateType: 'started',
      }).stateType,
    ).toBe('unstarted');
    expect(
      definition.extractSyncValues!({
        ...issue,
        state: 'Cancelled',
        stateType: 'canceled',
      }).stateType,
    ).toBe('completed');
  });
  it('resolves the issue team’s completed state, never its cancelled state', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          issue: {
            team: {
              states: {
                nodes: [
                  { id: 'cancel', type: 'canceled' },
                  { id: 'done', type: 'completed' },
                ],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ data: { issueUpdate: { success: true } } });
    await definition.updateIssue!('issue-1', { stateType: 'completed' }, {}, {
      post,
    } as unknown as PluginHttp);
    expect(post.mock.calls[1][1].variables).toEqual({
      id: 'issue-1',
      input: { stateId: 'done' },
    });
  });

  it('reopens into an unstarted state without changing project membership', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          issue: {
            team: {
              states: {
                nodes: [
                  { id: 'backlog', type: 'backlog' },
                  { id: 'todo', type: 'unstarted' },
                ],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({ data: { issueUpdate: { success: true } } });
    await definition.updateIssue!(
      'issue-1',
      { stateType: 'unstarted' },
      { projectId: 'other-project' },
      { post } as unknown as PluginHttp,
    );
    expect(post.mock.calls[1][1].variables.input).toEqual({ stateId: 'todo' });
  });

  it('writes only title and description when status did not change', async () => {
    const post = vi.fn().mockResolvedValue({ data: { issueUpdate: { success: true } } });
    await definition.updateIssue!(
      'issue-1',
      { title: 'New title', body: '', priority: 4 },
      {},
      { post } as unknown as PluginHttp,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].variables.input).toEqual({
      title: 'New title',
      description: '',
    });
  });

  it('refuses an unavailable workflow state without sending an update', async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { issue: { team: { states: { nodes: [] } } } } });
    await expect(
      definition.updateIssue!('issue-1', { stateType: 'completed' }, {}, {
        post,
      } as unknown as PluginHttp),
    ).rejects.toThrow(/workflow state/i);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('creates in an explicit team and optional project, keeping their identities separate', async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { issueCreate: { success: true, issue } } });
    const result = await definition.createIssue!(
      'A task',
      { teamId: 'team-1', projectId: 'project-2' },
      { post } as unknown as PluginHttp,
    );
    expect(post.mock.calls[0][1].variables.input).toEqual({
      title: 'A task',
      teamId: 'team-1',
      projectId: 'project-2',
    });
    expect(result).toMatchObject({
      issueId: 'issue-1',
      issueNumber: 42,
      issueData: { stateType: 'completed', body: 'Description' },
    });
  });

  it('does not use a project as a team when creating', async () => {
    const post = vi.fn();
    await expect(
      definition.createIssue!('A task', { projectId: 'project-2' }, {
        post,
      } as unknown as PluginHttp),
    ).rejects.toThrow(/team/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('propagates GraphQL mutation failures rather than acknowledging a write', async () => {
    const post = vi.fn().mockResolvedValue({ data: { issueUpdate: { success: false } } });
    await expect(
      definition.updateIssue!('issue-1', { title: 'New' }, {}, {
        post,
      } as unknown as PluginHttp),
    ).rejects.toThrow();
  });
});
