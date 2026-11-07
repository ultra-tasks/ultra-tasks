import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';

test('one description editor, compact date controls and a pinned untimed calendar row', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Review the proposal');
  const task = taskPage.getTaskByText('Review the proposal');
  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add description' }).click();
  const panel = page.locator('task-detail-panel');
  const editor = panel.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await expect(editor).toBeEmpty();
  await expect(panel.locator('.st-planning-actions button')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Task list', exact: true })).toHaveCount(
    0,
  );
  const description =
    'A short description\n' +
    Array.from({ length: 35 }, (_, i) => `Detail ${i + 1}`).join('\n');
  await editor.fill(description);
  await panel.locator('task-title').click();
  await expect(task.locator('.task-description')).toHaveText('A short description');
  const scroll = panel.locator('.markdown-wrapper.is-scrollable');
  await expect(scroll).toHaveCSS('overflow-y', 'auto');
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await page.screenshot({ path: '.tmp/e2e-test-results/ui-refinement-description.png' });

  await task.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit description', exact: true }).click();
  await expect(editor).toBeFocused();

  await page.keyboard.press('Escape');
  await task.click({ button: 'right' });
  await expect(page.locator('.e2e-edit-tags-btn')).toHaveText(/Tags/);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'View Week' }).click();
  const floatingTask = page
    .locator('.floating-day schedule-event')
    .filter({ hasText: 'Review the proposal' });
  await expect(floatingTask).toBeVisible();
  await expect(
    page
      .locator('.grid-container schedule-event')
      .filter({ hasText: 'Review the proposal' }),
  ).toHaveCount(0);
  const weekHeight = await page
    .locator('.grid-container')
    .evaluate((el) => parseFloat(getComputedStyle(el).gridTemplateRows));
  await page.screenshot({
    path: '.tmp/e2e-test-results/ui-refinement-calendar-week.png',
  });
  await page.getByRole('button', { name: 'View Day' }).click();
  const dayGrid = page.locator('schedule-week:not([inert] *) .grid-container').first();
  await expect
    .poll(() =>
      dayGrid.evaluate((el) => parseFloat(getComputedStyle(el).gridTemplateRows)),
    )
    .toBe(weekHeight * 2);
  await expect(
    page
      .locator('schedule-week:not([inert] *) .floating-day schedule-event')
      .filter({ hasText: 'Review the proposal' }),
  ).toBeVisible();
});

test('description previews stay usable in a large task list', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Description seed');
  const seedId = (await taskPage
    .getTaskByText('Description seed')
    .getAttribute('data-task-id'))!;
  await page.evaluate((id) => {
    type Store = {
      dispatch: (action: unknown) => void;
      select: (
        selector: (state: {
          tasks: { entities: Record<string, Record<string, unknown>> };
        }) => Record<string, unknown>,
      ) => {
        subscribe: (callback: (task: Record<string, unknown>) => void) => {
          unsubscribe: () => void;
        };
      };
    };
    const store = (window as unknown as { __e2eTestHelpers: { store: Store } })
      .__e2eTestHelpers.store;
    let seed: Record<string, unknown> = {};
    store
      .select((state) => state.tasks.entities[id])
      .subscribe((task) => {
        seed = task;
      })
      .unsubscribe();
    for (let index = 0; index < 300; index++) {
      const task = {
        ...seed,
        id: `description-${index}`,
        title: `Description task ${index}`,
        notes: `Summary ${index}\nMore detail`,
        subTaskIds: [],
      };
      store.dispatch({
        type: '[Task Shared] addTask',
        task,
        workContextId: 'INBOX_PROJECT',
        workContextType: 'PROJECT',
        isAddToBacklog: false,
        isAddToBottom: true,
        isIgnoreShortSyntax: true,
        meta: {
          isPersistent: true,
          entityType: 'TASK',
          entityId: task.id,
          opType: 'CRT',
        },
      });
    }
  }, seedId);
  await expect(page.locator('task .task-description')).toHaveCount(300);
  const preview = page.locator('#t-description-299 .task-description');
  await expect(preview).toHaveText('Summary 299');
  await preview.click();
  await expect(
    page.locator('task-detail-panel .cm-content[contenteditable="true"]'),
  ).toBeFocused();
  await expect(page.locator('task-detail-panel')).toContainText('More detail');
});

test('desktop chrome, selected tags and long move menus follow the workspace layout', async ({
  page,
  workViewPage,
  taskPage,
  projectPage,
  tagPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workViewPage.waitForTaskList();
  for (let index = 1; index <= 9; index++) {
    await projectPage.createProject(`Project ${index}`);
  }
  await tagPage.createTag('Focus');
  await tagPage.createTag('Waiting');
  await page.goto('/#/tag/TODAY/tasks');
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Review menu details');
  const task = taskPage.getTaskByText('Review menu details');
  await task.click({ button: 'right' });
  await waitForMenuSettled(page);
  await page.locator('.e2e-edit-tags-btn').click();
  await waitForMenuSettled(page);
  const tag = page.getByRole('menuitemcheckbox', { name: 'Focus', exact: true });
  await expect(tag).toHaveAttribute('aria-checked', 'false');
  await tag.click();
  await expect(tag).toHaveAttribute('aria-checked', 'true');
  await expect(tag).toHaveClass(/is-selected/);
  await expect(tag.locator('.selection-checkmark')).toBeVisible();
  const icon = await tag.locator('.option-main-icon').boundingBox();
  const check = await tag.locator('.selection-checkmark').boundingBox();
  expect(check!.x).toBeGreaterThan(icon!.x);
  await page.screenshot({ path: '.tmp/e2e-test-results/ui-refinement-tags.png' });
  await page
    .locator('.cdk-overlay-backdrop')
    .last()
    .click({ position: { x: 0, y: 0 }, force: true });
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
  await task.click({ button: 'right' });
  await waitForMenuSettled(page);
  // Keyboard-open the submenu with the pointer parked away from moving rows.
  await page.mouse.move(5, 5);
  await page.getByRole('menuitem', { name: /Move to project or section/ }).press('Enter');
  await waitForMenuSettled(page);
  const menu = page.locator('.mat-menu-scrollable').last();
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(360);
  await menu.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: '.tmp/e2e-test-results/ui-refinement-move.png' });
  await page
    .locator('.cdk-overlay-backdrop')
    .last()
    .click({ position: { x: 0, y: 0 }, force: true });
  await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);

  // Exercise desktop shell geometry without accessing a personal desktop profile.
  await page.evaluate(() =>
    document.body.classList.add('isElectron', 'isObsidianStyleHeader'),
  );
  const bar = page.locator('.desktop-title-bar');
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.height).toBe(32);
  expect((await page.locator('.nav-sidenav').boundingBox())!.y).toBeGreaterThanOrEqual(
    32,
  );
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator('body')).toHaveClass(
      mode === 'dark' ? /isDarkTheme/ : /isLightTheme/,
    );
    await page.screenshot({
      path: `.tmp/e2e-test-results/ui-refinement-chrome-${mode}.png`,
    });
  }
  await page.evaluate(() => document.body.classList.add('isFullScreen'));
  await expect(bar).toBeHidden();
});
