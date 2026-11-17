import { expect, Page } from '@playwright/test';
import { openIntegrationSetup, openIntegrations } from './integration-workspace';

export const FOUR_PROVIDERS = ['GITHUB', 'GITLAB', 'LINEAR', 'TRELLO'] as const;
export type TestProvider = (typeof FOUR_PROVIDERS)[number];
const NAMES: Record<TestProvider, string> = {
  GITHUB: 'GitHub Issues',
  GITLAB: 'GitLab',
  LINEAR: 'Linear Issues',
  TRELLO: 'Trello Issues',
};

/** HTTP fixtures exercise the shipped connectors, host bridge, reducers and UI. */
interface MockSource {
  title: string;
  body: string;
  done: boolean;
  version: number;
  writes: Record<string, unknown>[];
  creates: Record<string, unknown>[];
  rejectWrites: boolean;
  requests: string[];
  authorizations: string[];
  deniedWrites: number;
  startedWrites: number;
  writeBarrier?: Promise<void>;
  listId: string;
}
export const mockProvider = async (
  page: Page,
  key: TestProvider,
): Promise<MockSource> => {
  const source: MockSource = {
    title: `${key} source item`,
    body: 'Source description',
    done: false,
    version: 1,
    writes: [] as Record<string, unknown>[],
    creates: [] as Record<string, unknown>[],
    rejectWrites: false,
    requests: [] as string[],
    authorizations: [] as string[],
    deniedWrites: 0,
    startedWrites: 0,
    listId: 'list-open',
  };
  const stamp = (): string =>
    new Date(Date.UTC(2026, 10, 1, 0, source.version)).toISOString();
  const github = (): Record<string, unknown> => ({
    id: 1042,
    number: 42,
    title: source.title,
    body: source.body,
    state: source.done ? 'closed' : 'open',
    html_url: 'https://github.com/demo/product-app/issues/42',
    url: 'https://api.github.com/repos/demo/product-app/issues/42',
    created_at: stamp(),
    updated_at: stamp(),
    comments: 0,
    labels: [],
    user: { login: 'demo' },
    milestone: null,
  });
  const gitlab = (): Record<string, unknown> => ({
    id: 1042,
    iid: 42,
    title: source.title,
    description: source.body,
    state: source.done ? 'closed' : 'opened',
    web_url: 'https://gitlab.com/demo/product-app/-/issues/42',
    references: { full: 'demo/product-app#42' },
    _links: { self: 'https://gitlab.com/api/v4/projects/demo%2Fproduct-app/issues/42' },
    author: { username: 'demo' },
    labels: [],
    weight: 5,
    created_at: stamp(),
    updated_at: stamp(),
    user_notes_count: 0,
  });
  const linear = (): Record<string, unknown> => ({
    id: 'linear-issue-42',
    identifier: 'DEMO-42',
    number: 42,
    title: source.title,
    description: source.body,
    state: {
      id: source.done ? 'completed-state' : 'started-state',
      type: source.done ? 'completed' : 'started',
      name: source.done ? 'Done' : 'In progress',
    },
    team: { id: 'team-1', name: 'Demo' },
    priority: 0,
    url: 'https://linear.app/demo/issue/DEMO-42',
    createdAt: stamp(),
    updatedAt: stamp(),
    labels: { nodes: [] },
    comments: { nodes: [] },
  });
  const trello = (): Record<string, unknown> => ({
    id: 'card-42',
    idShort: 42,
    shortLink: 'cardLink42',
    name: source.title,
    desc: source.body,
    url: 'https://trello.com/c/cardLink42',
    closed: source.done && source.listId !== 'list-done',
    idBoard: 'board-1',
    idList: source.listId,
    dateLastActivity: stamp(),
    labels: [],
    members: [],
    attachments: [],
    due: null,
  });
  const origin = {
    GITHUB: 'https://api.github.com/**',
    GITLAB: 'https://gitlab.com/api/**',
    LINEAR: 'https://api.linear.app/graphql',
    TRELLO: 'https://api.trello.com/**',
  }[key];
  await page.route(origin, async (route) => {
    const request = route.request();
    source.requests.push(`${request.method()} ${request.url()}`);
    source.authorizations.push(
      request.headers()['authorization'] ?? request.headers()['private-token'] ?? '',
    );
    const url = new URL(request.url());
    const body = request.postDataJSON() as Record<string, unknown> | null;
    const query = String(body?.['query'] ?? '');
    const variables = (body?.['variables'] ?? {}) as Record<string, unknown>;
    const isGraphql = key === 'LINEAR';
    const creating = isGraphql
      ? query.includes('issueCreate(')
      : request.method() === 'POST';
    const writing = isGraphql
      ? query.includes('issueUpdate(')
      : ['PUT', 'PATCH'].includes(request.method());
    if (creating || writing) {
      source.startedWrites++;
      if (source.writeBarrier) await source.writeBarrier;
      if (source.rejectWrites) {
        source.deniedWrites++;
        return route.fulfill({
          status: 403,
          json: { message: 'Write permission revoked' },
        });
      }
      const input = (isGraphql ? variables['input'] : body) as Record<string, unknown>;
      (creating ? source.creates : source.writes).push(input);
      if (typeof input['title'] === 'string') source.title = input['title'];
      if (typeof input['name'] === 'string') source.title = input['name'];
      if (typeof input['body'] === 'string') source.body = input['body'];
      if (typeof input['description'] === 'string') source.body = input['description'];
      if ('state' in input) source.done = input['state'] === 'closed';
      if ('state_event' in input) source.done = input['state_event'] === 'close';
      if ('closed' in input)
        source.done = input['closed'] === true || input['closed'] === 'true';
      if ('stateId' in input) source.done = input['stateId'] === 'completed-state';
      if (typeof input['idList'] === 'string') {
        source.listId = input['idList'];
        source.done = source.listId === 'list-done';
      }
      source.version++;
    }
    let json: unknown;
    if (key === 'GITHUB')
      json = url.pathname.includes('/search/issues')
        ? { items: [github()] }
        : url.pathname.endsWith('/comments')
          ? []
          : github();
    if (key === 'GITLAB')
      json = url.pathname.endsWith('/notes')
        ? []
        : /\/issues\/42$/.test(url.pathname) || creating || writing
          ? gitlab()
          : [gitlab()];
    if (key === 'TRELLO')
      json = url.pathname.endsWith('/organizations')
        ? []
        : url.pathname.endsWith('/boards')
          ? [{ id: 'board-1', name: 'Demo board' }]
          : url.pathname.endsWith('/lists')
            ? [
                { id: 'list-open', name: 'To do' },
                { id: 'list-done', name: 'Done' },
              ]
            : url.pathname.endsWith('/cards') && !creating
              ? [trello()]
              : url.pathname.endsWith('/search')
                ? { cards: [trello()] }
                : trello();
    if (key === 'LINEAR')
      json = {
        data: query.includes('ConnectionTeams')
          ? { teams: { nodes: [{ id: 'team-1', name: 'Demo team' }] } }
          : query.includes('ConnectionProjects')
            ? { projects: { nodes: [{ id: 'project-1', name: 'Demo project' }] } }
            : query.includes('assignedIssues')
              ? { viewer: { assignedIssues: { nodes: [linear()] } } }
              : query.includes('IssueWorkflow')
                ? {
                    issue: {
                      team: {
                        states: {
                          nodes: [
                            { id: 'canceled-state', type: 'canceled' },
                            { id: 'completed-state', type: 'completed' },
                            { id: 'unstarted-state', type: 'unstarted' },
                          ],
                        },
                      },
                    },
                  }
                : creating
                  ? { issueCreate: { success: true, issue: linear() } }
                  : writing
                    ? { issueUpdate: { success: true } }
                    : query.includes('GetViewer')
                      ? { viewer: { id: 'viewer-1', name: 'Demo' } }
                      : { issue: linear() },
      };
    if (creating) {
      if (key === 'GITHUB') json = { ...github(), id: 1043, number: 43 };
      if (key === 'GITLAB')
        json = {
          ...gitlab(),
          id: 1043,
          iid: 43,
          references: { full: 'demo/product-app#43' },
        };
      if (key === 'LINEAR')
        json = {
          data: {
            issueCreate: {
              success: true,
              issue: {
                ...linear(),
                id: 'linear-issue-43',
                number: 43,
                identifier: 'DEMO-43',
              },
            },
          },
        };
      if (key === 'TRELLO')
        json = { ...trello(), id: 'card-43', idShort: 43, shortLink: 'cardLink43' };
    }
    return route.fulfill({ json });
  });
  return source;
};

export const connectProvider = async (
  page: Page,
  key: TestProvider,
  signIn = false,
  doneList = false,
): Promise<void> => {
  await openIntegrationSetup(page);
  await page.locator('.provider-choice').filter({ hasText: NAMES[key] }).click();
  const dialog = page.locator('mat-dialog-container');
  // GitHub focuses the repository field after opening. Wait for that handoff
  // so it cannot redirect a token fill into that field mid-action.
  if (key === 'GITHUB') await expect(dialog.locator('input').first()).toBeFocused();
  if (key === 'GITHUB' || key === 'GITLAB') {
    await dialog.locator('input').first().fill('demo/product-app');
    if (!signIn)
      await dialog.locator('input[type="password"]').first().fill('fixture-local-token');
  } else {
    if (key === 'TRELLO' && !signIn)
      await dialog.locator('input[type="password"]').first().fill('fixture-public-key');
    if (!signIn)
      await dialog.locator('input[type="password"]').last().fill('fixture-local-token');
  }
  if (signIn) {
    await dialog
      .getByRole('button', {
        name: new RegExp(
          `Sign in with ${key === 'GITLAB' ? 'GitLab' : key === 'LINEAR' ? 'Linear' : 'Trello'}`,
        ),
      })
      .click();
    await expect(dialog).toContainText('Connected');
  }
  if (key === 'LINEAR' || key === 'TRELLO') {
    if (!signIn) await dialog.getByRole('button', { name: /Load Options/ }).click();
    const select = dialog.getByRole('combobox').first();
    await select.click();
    await page
      .getByRole('option', {
        name: key === 'TRELLO' ? 'Demo board' : 'Demo team',
        exact: true,
      })
      .click();
  }
  if (doneList) {
    await dialog.getByRole('button', { name: /Reload Options/ }).click();
    await dialog.getByRole('combobox', { name: /Default Trello list/ }).click();
    await page.getByRole('option', { name: 'To do', exact: true }).click();
    await dialog
      .getByRole('checkbox', { name: 'Complete cards by moving them to a Done list' })
      .check();
    await dialog.getByRole('combobox', { name: /Done list/ }).click();
    await page.getByRole('option', { name: 'Done', exact: true }).click();
    await expect(dialog).toContainText('without archiving it');
  }
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const setup = page.locator('integration-setup');
  await setup.locator('input[name="integration-mode"][value="sync"]').check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.locator('input[name="project-mode"]').nth(1).check();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.locator('integration-fields select').first().waitFor();
  for (const select of await setup.locator('integration-fields select').all()) {
    if (await select.locator('option[value="both"]').count())
      await select.selectOption('both');
  }
  await setup.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(setup).toBeHidden();
  const source = page.locator('.source-browser');
  await source.locator('input[name="browse-mode"][value="sync"]').check();
  await source
    .locator('input')
    .first()
    .fill(key === 'GITHUB' ? 'is:open' : 'source item');
  await source.getByRole('button', { name: 'Search source', exact: true }).click();
  await source.locator('.integration-task input').first().check();
  await source.getByRole('button', { name: /Add selected items/ }).click();
  await expect(page.locator('.workspace-grid .integration-task')).toHaveCount(1);
  await source.getByRole('button', { name: 'Close', exact: true }).click();
};

export const refreshProviderItem = async (page: Page): Promise<void> => {
  await openIntegrations(page);
  await page.locator('.workspace-grid .integration-task input').first().check();
  await page.getByRole('button', { name: 'Refresh selected', exact: true }).click();
  await expect(page.locator('.feedback')).toBeVisible();
};

export const linkedTasks = async (
  page: Page,
): Promise<
  Array<{
    id: string;
    title: string;
    notes?: string;
    isDone: boolean;
    issueProviderId: string;
    projectId: string;
  }>
> => {
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
  );
  return page.evaluate(() => {
    type State = {
      tasks: {
        entities: Record<
          string,
          {
            id: string;
            title: string;
            notes?: string;
            isDone: boolean;
            issueProviderId: string;
            projectId: string;
          }
        >;
      };
    };
    let state!: State;
    (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: State) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return Object.values(state.tasks.entities).filter((task) => !!task.issueProviderId);
  });
};

export const openLinkedTaskList = async (page: Page): Promise<void> => {
  const [task] = await linkedTasks(page);
  await page.evaluate((projectId) => {
    window.location.hash = `#/project/${projectId}/tasks`;
  }, task.projectId);
  await expect(page.locator('task').filter({ hasText: 'source item' })).toBeVisible();
};
