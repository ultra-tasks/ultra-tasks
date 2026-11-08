import {
  openIntegrationSetup,
  finishIntegrationSetup,
  leaveIntegrations,
} from '../../utils/integration-workspace';
import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { expectNoGlobalError } from '../../utils/assertions';

/**
 * #10024: with issue auto-create enabled, adding a task whose title carries
 * short syntax ("Write report #work @tomorrow") raced the auto-create effect
 * against the short-syntax effect. The issue was created FROM the raw title
 * (tokens included), and the issue-number write-back then overwrote the
 * locally cleaned title with the raw one.
 *
 * Unlike the unit specs (which subscribe to the auto-create effect alone and
 * mock task reads/writes), this runs the real path — both effects and the
 * real reducer — and holds the create response until short syntax has landed
 * locally, which is exactly the reported timing.
 *
 * The add-task bar parses the exact text it submits before it dispatches
 * (it waits for the parse, see `_parseInputBeforeAdd`), so it never hands the
 * effects a raw title any more. Every other caller of `TaskService.add` still
 * does (focus-mode selector, schedule slot, deep links, plugin and REST API),
 * and that is the input from the report. The test dispatches the same
 * `addTask` action `TaskService.add` builds, with the RAW title, into the real
 * store, and holds the lazy date-parser module (imported on the first
 * date-token parse) until the raw title has landed, so the race is certain
 * rather than timing luck. The hold matches the parser chunk by name in dev
 * and falls back to same-origin lazy chunks for CI's built app.
 */
type TaskSnapshot = {
  title: string;
  dueDay: string | null;
  tagTitles: string[];
} | null;

const getTaskSnapshot = async (page: Page, title: string): Promise<TaskSnapshot> =>
  page.evaluate((needle) => {
    type TaskLike = {
      title?: string;
      dueDay?: string | null;
      tagIds?: string[];
    };
    type TagLike = { id?: string; title?: string };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      tag?: { entities?: Record<string, TagLike | undefined> };
    };
    type StoreSubscription = { unsubscribe: () => void };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => StoreSubscription;
    };

    const helpers = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers;
    if (!helpers?.store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let latestState: StoreState | undefined;
    helpers.store
      .subscribe((state) => {
        latestState = state;
      })
      .unsubscribe();

    const task = Object.values(latestState?.tasks?.entities ?? {}).find((candidate) =>
      candidate?.title?.includes(needle),
    );
    if (!task) {
      return null;
    }
    const tagsById = latestState?.tag?.entities ?? {};
    return {
      title: task.title ?? '',
      dueDay: task.dueDay ?? null,
      tagTitles: (task.tagIds ?? [])
        .map((id) => tagsById[id]?.title)
        .filter((t): t is string => !!t),
    };
  }, title);

/** Tomorrow as a db date string, resolved on the app's clock (see #10024 rollover note). */
const getTomorrowDbDate = async (page: Page): Promise<string> =>
  page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  });

/**
 * Dispatches the `addTask` action `TaskService.add` builds for a title typed
 * anywhere but the add-task bar: the title goes in untouched, short syntax and
 * all, and it is the effects that parse it.
 */
const dispatchAddTaskWithRawTitle = async (
  page: Page,
  projectName: string,
  title: string,
): Promise<void> =>
  page.evaluate(
    ({ projectName: name, title: rawTitle }) => {
      type StoreState = {
        projects?: {
          entities?: Record<string, { id?: string; title?: string } | undefined>;
        };
      };
      type StoreLike = {
        subscribe: (next: (state: StoreState) => void) => { unsubscribe: () => void };
        dispatch: (action: unknown) => void;
      };
      const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
        .__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing');
      }
      let latestState: StoreState | undefined;
      store
        .subscribe((state) => {
          latestState = state;
        })
        .unsubscribe();
      const project = Object.values(latestState?.projects?.entities ?? {}).find(
        (candidate) => candidate?.title === name,
      );
      if (!project?.id) {
        throw new Error(`project "${name}" not found`);
      }
      const id = `e2e-10024-${Date.now()}`;
      store.dispatch({
        type: '[Task Shared] addTask',
        task: {
          id,
          projectId: project.id,
          title: rawTitle,
          subTaskIds: [],
          timeSpentOnDay: {},
          timeSpent: 0,
          timeEstimate: 0,
          isDone: false,
          tagIds: [],
          created: Date.now(),
          attachments: [],
        },
        workContextId: project.id,
        workContextType: 'PROJECT',
        isAddToBacklog: false,
        isAddToBottom: false,
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'CRT' },
      });
    },
    { projectName, title },
  );

test('auto-created issue excludes short syntax tokens (#10024)', async ({
  page,
  workViewPage,
  projectPage,
  tagPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createAndGoToTestProject();
  // An existing tag keeps the short-syntax effect from opening its
  // new-tag confirmation dialog mid-race.
  await tagPage.createTag('work');

  const projectName = `${testPrefix}-Test Project`;
  const cleanTitle = `${testPrefix}-Write report`;

  // The auto-create effect must not see the raw title, and the write-back
  // must not clobber the cleaned one. Hold the create response until short
  // syntax has landed on the task.
  let outgoingCreateTitle: string | null = null;
  let releaseCreate!: () => void;
  const createReleased = new Promise<void>((resolve): void => {
    releaseCreate = resolve;
  });

  const mkIssue = (title: string): Record<string, unknown> => ({
    id: 42,
    number: 42,
    title,
    body: 'Issue body',
    state: 'open',
    html_url: 'https://github.com/e2e/repro/issues/42',
    created_at: '2026-01-01T12:00:00Z',
    updated_at: '2026-01-01T12:00:00Z',
    comments: 0,
    labels: [],
  });

  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    const isCreate =
      route.request().method() === 'POST' && /\/repos\/e2e\/repro\/issues\/?$/.test(url);
    if (isCreate) {
      outgoingCreateTitle =
        (route.request().postDataJSON() as { title?: string })?.title ?? null;
      await createReleased;
      await route.fulfill({ json: mkIssue(cleanTitle) });
      return;
    }
    await route.fulfill({
      json: url.includes('/search/issues') ? { items: [] } : mkIssue(cleanTitle),
    });
  });

  // Configure GitHub Issues with auto-create bound to the test project
  await openIntegrationSetup(page);
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  const repoInput = dialog.locator('input[id*="repo"]');
  const tokenInput = dialog.locator('input[id*="token"]');
  // MatDialog focuses its first field only once the open animation ends. A
  // fill racing that autofocus types the token into the repo field, and the
  // auto-create then fails on the missing token.
  await expect(repoInput).toBeFocused();
  await repoInput.fill('e2e/repro');
  await tokenInput.fill('e2e-token');
  await expect(repoInput).toHaveValue('e2e/repro');
  await expect(tokenInput).toHaveValue('e2e-token');

  await dialog.getByRole('button', { name: /Advanced Config/i }).click();
  await dialog.locator('mat-select[id*="defaultProjectId"]').click();
  await page.getByRole('option', { name: projectName }).click();

  await dialog.getByRole('button', { name: /Two-Way Sync/i }).click();
  // A click while the section is still expanding can focus the checkbox
  // without toggling it, saving the provider with auto-create off (#11077).
  // check() throws when the click did not toggle; retry until it did.
  const autoCreateCheckbox = dialog.locator('input[id*="isAutoCreateIssues"]');
  await expect(async () => {
    await autoCreateCheckbox.check();
  }).toPass();

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await finishIntegrationSetup(page);
  await leaveIntegrations(page);

  // Hold the date parser's lazy chunk (see file comment) so the dispatched
  // action carries the raw title. CI serves the built app, whose lazy chunks
  // are `chunk-<hash>.js`, so the parser cannot be matched by name there:
  // hold every same-origin lazy-chunk request instead. Registered only once
  // the provider dialog is closed — at that point the parser's chunk is the
  // only dynamic import left to happen, because none of the setup titles
  // carried date syntax to load it earlier.
  let releaseChrono!: () => void;
  const chronoReleased = new Promise<void>((resolve): void => {
    releaseChrono = resolve;
  });
  const appOrigin = new URL(page.url()).origin;
  await page.route(
    (url): boolean =>
      url.origin === appOrigin &&
      (url.href.includes('chrono') || /(^|\/)chunk-[^/]+\.m?js$/.test(url.pathname)),
    async (route) => {
      await chronoReleased;
      await route.continue();
    },
  );

  // The reported case: raw tokens in the title of an auto-created task
  const tomorrowBeforeAdd = await getTomorrowDbDate(page);
  const rawTitle = `${testPrefix}-Write report #work @tomorrow`;
  await dispatchAddTaskWithRawTitle(page, projectName, rawTitle);
  // The hold must actually gate the parse — in dev AND built assets. If it
  // did not, the short-syntax effect would clean the title before this
  // assertion and the rest would pass trivially, so prove the raw title is on
  // the task before letting parsing proceed.
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toBe(rawTitle);
  releaseChrono();

  // Short syntax lands locally while the create response is held — the exact
  // race from the report. The task title must lose both tokens.
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toBe(cleanTitle);
  releaseCreate();

  // Write-back prefixes the issue number once the create resolves
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toMatch(/^#42 /);

  const task = await getTaskSnapshot(page, cleanTitle);
  expect(task).not.toBeNull();
  // The outgoing issue never carried the tokens
  expect(outgoingCreateTitle).toBe(cleanTitle);
  // And the write-back kept the locally cleaned title
  expect(task!.title).toBe(`#42 ${cleanTitle}`);
  // Short syntax side effects survived the round trip
  expect(task!.tagTitles).toContain('work');
  const tomorrowAfterAssert = await getTomorrowDbDate(page);
  expect([tomorrowBeforeAdd, tomorrowAfterAssert]).toContain(task!.dueDay);

  await expectNoGlobalError(page);
});
