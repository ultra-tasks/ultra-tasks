import { Route } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';
import { waitForPluginAssets } from '../../helpers/plugin-test.helpers';

const GRAPH_LISTS = 'https://graph.microsoft.com/v1.0/me/todo/lists';
const CORS = {
  ['access-control-allow-origin']: '*',
  ['access-control-allow-headers']: 'authorization, content-type',
  ['access-control-allow-methods']: 'GET, POST, OPTIONS',
};

const json = (route: Route, body: unknown): Promise<void> =>
  route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ status: 200, headers: CORS, json: body });

const webConfigured =
  !!process.env.ULTRA_MS_TODO_OAUTH_CLIENT_ID && !!process.env.ULTRA_MS_TODO_WEB_ORIGIN;

test.describe('Microsoft To Do import plugin', () => {
  (webConfigured ? test.skip : test)(
    'hides the importer and its settings shortcut on an unconfigured build',
    async ({ page, workViewPage }) => {
      await workViewPage.waitForTaskList();
      await new ImportPage(page).navigateToImportPage();
      await expect(
        page.getByRole('button', { name: 'Import from Microsoft To Do' }),
      ).toHaveCount(0);
      await page.locator('config-page .settings-search input').fill('Microsoft To Do');
      await expect(
        page.getByRole('option', { name: /Import from Microsoft To Do/ }),
      ).toHaveCount(0);
    },
  );

  (webConfigured ? test : test.skip)(
    'signs in and imports a list with steps, notes and a repeat',
    async ({ page, workViewPage, projectPage, taskPage, testPrefix }) => {
      test.setTimeout(90000);
      await workViewPage.waitForTaskList();
      if (!(await waitForPluginAssets(page))) {
        throw new Error('Plugin assets not available — run `npm run plugins:build`');
      }
      const list = `${testPrefix}-Groceries`;
      const graphAuth: (string | undefined)[] = [];

      // Fake Microsoft: the authorize page redirects straight back to the app's
      // callback with the PKCE state; token and Graph answer with fixtures.
      await page.context().route('https://login.microsoftonline.com/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/authorize')) {
          expect(url.searchParams.get('scope')).toBe('Tasks.Read');
          expect(url.searchParams.get('code_challenge_method')).toBe('S256');
          const callback = new URL(url.searchParams.get('redirect_uri') as string);
          expect(callback.pathname).toBe('/assets/oauth-callback.html');
          callback.searchParams.set('code', 'fake-code');
          callback.searchParams.set('state', url.searchParams.get('state') as string);
          return route.fulfill({
            status: 302,
            headers: { location: callback.toString() },
          });
        }
        return json(route, {
          access_token: 'fake-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      });
      await page.context().route(`${GRAPH_LISTS}**`, (route) => {
        graphAuth.push(route.request().headers()['authorization']);
        const url = route.request().url();
        if (url.startsWith(`${GRAPH_LISTS}/L1/tasks`)) {
          return json(route, {
            value: [
              {
                id: 'T1',
                title: 'Weekly shop',
                status: 'notStarted',
                categories: ['errand'],
                body: { content: '<p>Bring bags</p>', contentType: 'html' },
                dueDateTime: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'UTC' },
                recurrence: {
                  pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
                  range: { type: 'noEnd' },
                },
                checklistItems: [
                  { id: 's1', displayName: 'Milk', isChecked: false },
                  { id: 's2', displayName: 'Bread', isChecked: true },
                ],
              },
            ],
          });
        }
        return json(route, {
          value: [{ id: 'L1', displayName: list, wellknownListName: 'none' }],
        });
      });

      const importPage = new ImportPage(page);
      await importPage.navigateToImportPage();
      await page.locator('config-page .settings-search input').fill('Microsoft To Do');
      await page.getByRole('option', { name: /Import from Microsoft To Do/ }).click();
      await page.getByRole('button', { name: 'Import from Microsoft To Do' }).click();

      await expect(page.locator('config-page')).toBeHidden();
      const frame = page.frameLocator('plugin-index iframe');
      await frame.getByRole('button', { name: 'Sign in with Microsoft' }).click();
      await expect(frame.getByText(`${list} — tasks: 1, steps: 2`)).toBeVisible();
      expect(graphAuth).toEqual(['Bearer fake-token', 'Bearer fake-token']);
      await frame.getByRole('button', { name: 'Import' }).click();
      await expect(frame.getByRole('heading', { name: 'Import finished' })).toBeVisible({
        timeout: 30000,
      });
      await expect(frame.getByText(`${list}: 1 of 1 tasks, 2 of 2 steps`)).toBeVisible();

      await projectPage.navigateToProjectByName(list);
      const root = taskPage.getTaskByText('Weekly shop').first();
      await expect(root).toBeVisible();
      expect(await taskPage.taskHasTag(root, 'errand')).toBe(true);
      // `.last()`: the parent task element contains its sub-tasks' text too
      expect(await taskPage.isTaskDone(taskPage.getTaskByText('Bread').last())).toBe(
        true,
      );
      expect(await taskPage.isTaskDone(taskPage.getTaskByText('Milk').last())).toBe(
        false,
      );
      // the repeat chip in the task's tag list
      await expect(
        root.locator('tag-list mat-icon', { hasText: 'repeat' }).first(),
      ).toBeVisible();
    },
  );
});
