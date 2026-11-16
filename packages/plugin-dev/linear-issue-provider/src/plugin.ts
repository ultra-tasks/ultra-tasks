import type {
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  asConfig,
  canConnect,
  COMMENTS_CONFIG,
  connectionCredential,
  isDoneMapping,
  pickSyncValues,
  registerIssueProvider,
  textMapping,
  t,
} from '../../issue-provider-kit';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Linear workflow state types that mean "done" (matches the built-in provider).
const DONE_STATE_TYPES = ['completed', 'canceled'];

interface LinearConfig {
  apiKey?: string;
  teamId?: string;
  projectId?: string;
}

interface LinearGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface LinearRawIssueReduced {
  id: string;
  identifier: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  state: { name: string; type: string };
}

interface LinearRawIssue extends LinearRawIssueReduced {
  description?: string;
  priority: number;
  createdAt: string;
  completedAt?: string;
  canceledAt?: string;
  dueDate?: string;
  assignee?: { id: string; name: string; avatarUrl?: string };
  creator?: { id: string; name: string };
  labels?: { nodes: Array<{ id: string; name: string; color: string }> };
  comments?: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user?: { id: string; name: string; avatarUrl?: string };
    }>;
  };
}

const mapIssue = (issue: LinearRawIssue): PluginIssue => ({
  id: issue.id,
  title: issue.title,
  body: issue.description || '',
  url: issue.url,
  state: issue.state?.name,
  lastUpdated: new Date(issue.updatedAt).getTime(),
  assignee: issue.assignee?.name,
  labels: (issue.labels?.nodes || []).map((label) => label.name),
  comments: (issue.comments?.nodes || [])
    .filter((comment) => !!comment.user)
    .map((comment) => ({
      author: comment.user!.name,
      body: comment.body || '',
      created: new Date(comment.createdAt).getTime(),
      avatarUrl: comment.user!.avatarUrl,
    })),
  identifier: issue.identifier,
  number: issue.number,
  summary: `${issue.identifier} ${issue.title}`,
  stateType: issue.state?.type,
  priority: issue.priority,
  creator: issue.creator?.name,
  createdAt: new Date(issue.createdAt).getTime(),
  completedAt: issue.completedAt ? new Date(issue.completedAt).getTime() : undefined,
});

const SEARCH_ISSUES_QUERY = `
  query SearchIssues($first: Int!, $team: TeamFilter, $project: NullableProjectFilter) {
    viewer {
      assignedIssues(
        first: $first,
        filter: {
          state: { type: { in: ["backlog", "unstarted", "started"] } },
          team: $team,
          project: $project
        }
      ) {
        nodes {
          id identifier number title updatedAt url
          state { id name type }
        }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id identifier number title description priority
      createdAt updatedAt completedAt canceledAt dueDate url
      state { id name type }
      team { id name key }
      assignee { id name avatarUrl }
      creator { id name }
      labels(first: 50) { nodes { id name color } }
      comments(first: 50) {
        nodes { id body createdAt user { id name avatarUrl } }
      }
    }
  }
`;

const GET_VIEWER_QUERY = `query GetViewer { viewer { id name } }`;

const graphql = async <T>(
  http: PluginHttp,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const res = await http.post<LinearGraphQLResponse<T>>(LINEAR_API_URL, {
    query,
    variables,
  });
  if (res?.errors?.length) {
    throw new Error(res.errors[0].message || 'Linear GraphQL error');
  }
  if (!res?.data) {
    throw new Error('No data returned from Linear');
  }
  return res.data;
};

const mapReduced = (issue: LinearRawIssueReduced): PluginSearchResult => ({
  id: issue.id,
  title: `${issue.identifier} ${issue.title}`,
  url: issue.url,
  status: issue.state?.name,
  // Provider-specific fields used for display + isDone mapping.
  identifier: issue.identifier,
  stateType: issue.state?.type,
});

const searchAssignedIssues = async (
  searchTerm: string,
  cfg: LinearConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const variables: Record<string, unknown> = { first: 50 };
  // Deliberate behavior change from the built-in provider: the old
  // LinearApiService accepted teamId/projectId but its callers never passed
  // them, so the "filter to specific team/project" config fields were inert.
  // Here we honor them as the labels promise. Empty fields = no filter (the
  // common case), so this only narrows results for users who set a value.
  if (cfg.teamId) {
    variables.team = { id: { eq: cfg.teamId } };
  }
  if (cfg.projectId) {
    variables.project = { id: { eq: cfg.projectId } };
  }

  const data = await graphql<{
    viewer: { assignedIssues: { nodes: LinearRawIssueReduced[] } };
  }>(http, SEARCH_ISSUES_QUERY, variables);

  let issues = data.viewer?.assignedIssues?.nodes || [];
  const term = searchTerm.trim().toLowerCase();
  if (term) {
    issues = issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(term) ||
        issue.identifier.toLowerCase().includes(term),
    );
  }
  return issues.map(mapReduced);
};

registerIssueProvider({
  configFields: [
    {
      key: 'apiKey',
      type: 'password',
      label: t('CFG.API_KEY'),
      required: true,
    },
    {
      key: 'apiKeyHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://linear.app/settings/account/security',
    },
    {
      key: 'teamId',
      type: 'select',
      label: t('CFG.TEAM_ID'),
      async loadOptions(_config, http) {
        const data = await graphql<{
          teams: { nodes: Array<{ id: string; name: string }> };
        }>(http, 'query ConnectionTeams { teams { nodes { id name } } }', {});
        return data.teams.nodes.map((team) => ({ label: team.name, value: team.id }));
      },
    },
    {
      key: 'projectId',
      type: 'select',
      label: t('CFG.PROJECT_ID'),
      advanced: true,
      async loadOptions(_config, http) {
        const data = await graphql<{
          projects: { nodes: Array<{ id: string; name: string }> };
        }>(http, 'query ConnectionProjects { projects { nodes { id name } } }', {});
        return data.projects.nodes.map((project) => ({
          label: project.name,
          value: project.id,
        }));
      },
    },
  ],

  getHeaders: async (config) => {
    const credential = await connectionCredential(config, 'apiKey');
    return {
      'Content-Type': 'application/json',
      Authorization: credential.isOAuth ? `Bearer ${credential.value}` : credential.value,
    };
  },

  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchAssignedIssues(searchTerm, asConfig<LinearConfig>(config), http);
  },

  async getById(
    issueId: string,
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const data = await graphql<{ issue: LinearRawIssue | null }>(http, GET_ISSUE_QUERY, {
      id: issueId,
    });
    const issue = data.issue;
    if (!issue) {
      throw new Error('No issue data returned from Linear');
    }

    return mapIssue(issue);
  },

  // Linear issue URLs require the workspace slug, which can't be derived from the
  // id + config alone. Returning '' makes the adapter fall back to getById().url,
  // matching the built-in provider's behavior.
  getIssueLink(): string {
    return '';
  },

  testConnection: (_config, http) =>
    canConnect(() => graphql(http, GET_VIEWER_QUERY, {})),

  getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchAssignedIssues('', asConfig<LinearConfig>(config), http);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text', hideEmpty: true },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  commentsConfig: COMMENTS_CONFIG,

  fieldMappings: [
    isDoneMapping({
      issueField: 'stateType',
      done: 'completed',
      open: 'unstarted',
      isDone: (issueValue) => DONE_STATE_TYPES.includes(issueValue as string),
    }),
    textMapping('title', 'title'),
    textMapping('notes', 'body', 'off'),
  ],

  async updateIssue(id, changes, _config, http): Promise<void> {
    const input: Record<string, unknown> = {};
    if ('title' in changes) input.title = changes.title;
    if ('body' in changes) input.description = changes.body;
    if ('stateType' in changes) {
      const data = await graphql<{
        issue: { team: { states: { nodes: { id: string; type: string }[] } } } | null;
      }>(
        http,
        `
          query IssueWorkflow($id: String!) {
            issue(id: $id) {
              team {
                states {
                  nodes {
                    id
                    type
                  }
                }
              }
            }
          }
        `,
        { id },
      );
      const states = data.issue?.team.states.nodes ?? [];
      const target = changes.stateType === 'completed' ? 'completed' : 'unstarted';
      const state =
        states.find((value) => value.type === target) ??
        (target === 'unstarted'
          ? states.find((value) => value.type === 'backlog')
          : undefined);
      if (!state) throw new Error('No matching Linear workflow state is available.');
      input.stateId = state.id;
    }
    if (!Object.keys(input).length) return;
    const data = await graphql<{ issueUpdate: { success: boolean } }>(
      http,
      `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }
      `,
      { id, input },
    );
    if (!data.issueUpdate?.success) throw new Error('Linear did not update the issue.');
  },

  async createIssue(title, config, http) {
    const cfg = asConfig<LinearConfig>(config);
    if (!cfg.teamId) throw new Error('Choose a Linear team before creating issues.');
    const input = {
      title,
      teamId: cfg.teamId,
      ...(cfg.projectId ? { projectId: cfg.projectId } : {}),
    };
    const data = await graphql<{
      issueCreate: { success: boolean; issue?: LinearRawIssue };
    }>(
      http,
      `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              number
              title
              description
              priority
              createdAt
              updatedAt
              url
              state {
                id
                name
                type
              }
            }
          }
        }
      `,
      { input },
    );
    if (!data.issueCreate?.success || !data.issueCreate.issue)
      throw new Error('Linear did not create the issue.');
    return {
      issueId: data.issueCreate.issue.id,
      issueNumber: data.issueCreate.issue.number,
      issueData: mapIssue(data.issueCreate.issue),
    };
  },

  extractSyncValues: (issue) => ({
    ...pickSyncValues('title', 'body')(issue),
    // Compare completion semantics, keeping started/backlog/cancelled workflow
    // details intact unless the user actually changes completion.
    stateType: DONE_STATE_TYPES.includes(String(issue.stateType))
      ? 'completed'
      : 'unstarted',
  }),
});
