import { readFile } from 'node:fs/promises';
import { expect, test } from '../../fixtures/test.fixture';

const githubIssue = (number: number, title: string): Record<string, unknown> => ({
  id: number + 1000,
  number,
  title,
  body: 'Source description',
  state: 'open',
  html_url: `https://github.com/demo/product-app/issues/${number}`,
  url: `https://api.github.com/repos/demo/product-app/issues/${number}`,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-08T10:00:00Z',
  comments: 0,
  user: { login: 'demo' },
  assignee: { login: 'demo' },
  labels: [],
  milestone: null,
});

test('integration setup imports snapshots and keeps stopped source identities excluded after reload', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  const issues = [
    githubIssue(142, 'Synced source item'),
    githubIssue(163, 'Imported source item'),
  ];
  const writes: string[] = [];
  await page.route('https://api.github.com/**', (route) => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.method());
    const url = request.url();
    return route.fulfill({
      json: url.includes('/search/issues')
        ? { items: issues }
        : url.includes('/comments')
          ? []
          : (issues.find((i) => url.endsWith(`/${i['number']}`)) ?? {}),
    });
  });
  await page.goto('/#/integrations');
  const workspace = page.locator('integrations-page');
  await workspace.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.locator('.provider-choice').filter({ hasText: 'GitHub Issues' }).click();
  const credentials = page.locator('mat-dialog-container');
  await credentials.locator('input').first().fill('demo/product-app');
  await credentials.getByRole('button', { name: 'Save', exact: true }).click();
  const setup = page.locator('integration-setup');
  await expect(setup).toContainText('Future changes stay separate');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(setup).toContainText('Map projects and tags');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(setup).toContainText('Completion write-back closes or reopens the issue');
  await expect(setup.locator('integration-fields select')).toHaveCount(3);
  await setup.getByRole('button', { name: 'Save connection', exact: true }).click();
  const source = page.locator('.source-browser');
  await source.locator('input').first().fill('is:open');
  await source.getByRole('button', { name: 'Search source', exact: true }).click();
  await source.locator('.integration-task input').first().check();
  await source.getByRole('button', { name: /Add selected items/ }).click();
  await expect(workspace.locator('.workspace-grid .integration-task')).toHaveCount(1);
  await source.locator('input[type="radio"][value="import"]').check();
  await source.locator('.integration-task input').first().check();
  await source.getByRole('button', { name: /Add selected items/ }).click();
  await expect(workspace.locator('.workspace-grid .integration-task')).toHaveCount(2);
  await source.getByRole('button', { name: 'Close', exact: true }).click();

  // Per-item policies use the same connector capability table as setup.
  const synced = workspace
    .locator('.workspace-grid .integration-task')
    .filter({ hasText: 'Synced source item' });
  await synced.getByRole('button', { name: 'Field settings', exact: true }).click();
  const itemSettings = page.locator('integration-item-dialog');
  await itemSettings
    .getByRole('combobox', { name: 'Title', exact: true })
    .selectOption('off');
  await itemSettings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(itemSettings).toBeHidden();

  // Verify that the saved policy affects a real connector refresh, not just the form.
  issues[0] = {
    ...githubIssue(142, 'Remote title after local-only policy'),
    updated_at: '2026-11-09T10:00:00Z',
  };
  await synced.locator('input').check();
  await workspace.getByRole('button', { name: 'Refresh selected', exact: true }).click();
  await expect(workspace.locator('.feedback')).toBeVisible();
  await expect(synced).toContainText('Synced source item');
  await expect(workspace).not.toContainText('Remote title after local-only policy');
  const downloading = page.waitForEvent('download');
  await workspace
    .getByRole('button', { name: 'Export selected as ICS', exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('ultratasks.ics');
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toContain('BEGIN:VCALENDAR');
  expect(exported).not.toContain('Source description');

  await synced.locator('input').check();
  await workspace.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(workspace.locator('.workspace-grid .integration-task')).toHaveCount(1);
  await workspace.locator('.tabs button').filter({ hasText: 'Hidden' }).click();
  await expect(workspace.locator('.workspace-grid .integration-task')).toContainText(
    'Synced source item',
  );
  await workspace.locator('.workspace-grid .integration-task input').check();
  await workspace.getByRole('button', { name: 'Stop tracking', exact: true }).click();
  await page
    .locator('dialog-confirm')
    .getByRole('button', { name: 'Stop tracking', exact: true })
    .click();
  await page.locator('dialog-confirm').waitFor({ state: 'hidden' });
  await page.reload();
  await workspace.locator('.tabs button').filter({ hasText: 'Stopped' }).click();
  await expect(workspace.locator('.workspace-grid .integration-task')).toContainText(
    'Synced source item',
  );
  await expect(workspace.locator('.workspace-grid h2')).toContainText('GitHub Issues');
  await workspace
    .getByRole('button', { name: 'Browse source items', exact: true })
    .click();
  await source.locator('input').first().fill('is:open');
  const searched = page.waitForRequest((request) =>
    request.url().includes('api.github.com/search/issues'),
  );
  await source.getByRole('button', { name: 'Search source', exact: true }).click();
  await searched;
  await expect(source.locator('.integration-task')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Trello setup explains that completion archives cards and offers a local-only choice', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await page.goto('/#/integrations');
  await page
    .locator('integrations-page')
    .getByRole('button', { name: 'Connect account', exact: true })
    .click();
  await page.locator('.provider-choice').filter({ hasText: 'Trello Issues' }).click();
  const dialog = page.locator('mat-dialog-container');
  // Credentials are never submitted: explain connector behavior before authorization.
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'Trello completion currently means archiving a card',
  );
  await dialog.getByText('Two-Way Sync (experimental)', { exact: true }).click();
  await dialog
    .getByRole('combobox', { name: 'Status sync direction', exact: true })
    .click();
  await page.getByRole('option', { name: 'Off', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('integration-setup')).toBeVisible();
});
