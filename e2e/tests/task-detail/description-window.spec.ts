import { expect, test } from '../../fixtures/test.fixture';
import { fillMarkdownEditor } from '../../utils/markdown-editor';
import { flushPendingWrites } from '../../utils/waits';

test('task description uses a bounded window and preserves formatting and saved content', async ({
  page,
  workViewPage,
  taskPage,
  settingsPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workViewPage.waitForTaskList();
  await expect(
    page.getByRole('button', { name: 'Show/hide calendar panel' }),
  ).toHaveCount(0);
  await workViewPage.addTask('Description window task');
  await settingsPage.openSettingsSection('appFeatures');
  const settingsBox = await page.locator('.settings-window').boundingBox();
  expect(settingsBox).toBeTruthy();
  await settingsPage.closeSettings();

  await taskPage.openTaskDetail(taskPage.getTaskByText('Description window task'));
  const markdown = page.locator('task-detail-panel inline-markdown').first();
  await markdown.hover();
  await markdown.getByRole('button', { name: 'Open description editor' }).click();
  const dialog = page.locator('dialog-fullscreen-markdown');
  await expect(dialog.getByRole('heading', { name: 'Description' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Bold/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Italic/ })).toBeVisible();
  await expect
    .poll(async () => (await dialog.boundingBox())?.width)
    .toBeCloseTo(settingsBox!.width, 0);
  const box = await dialog.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.height).toBeLessThan(960);
  expect(box!.y).toBeGreaterThan(0);
  const content = '**Important context**\n\n' + 'Project information\n'.repeat(100);
  await fillMarkdownEditor(dialog, content);
  await expect(dialog.getByRole('heading', { name: 'Description' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: /^Bold/ })).toBeInViewport();
  await expect
    .poll(() =>
      dialog.locator('.cm-scroller').evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('body')).toHaveClass(
      theme === 'dark' ? /isDarkTheme/ : /isLightTheme/,
    );
    await expect(dialog.locator('#T-save-note')).toBeInViewport();
    await page.screenshot({
      path: `.tmp/e2e-test-results/description-window-${theme}.png`,
    });
  }
  await dialog.locator('#T-save-note').click();
  await expect(dialog).toHaveCount(0);
  await expect(markdown).toContainText('Important context');
  await flushPendingWrites(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await taskPage.openTaskDetail(taskPage.getTaskByText('Description window task'));
  await expect(page.locator('task-detail-panel inline-markdown').first()).toContainText(
    'Important context',
  );
  await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('schedule')).toBeVisible();
});

test.describe('touch description editor', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Nothing Phone 1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    contextOptions: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  });

  test('keeps the editor, formatting tools and save action inside a phone viewport', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.evaluate(() => localStorage.setItem('superTasksGlassEnabled', 'false'));
    await page.reload();
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Mobile description task');
    // The capture helper uses a mouse and keyboard. Switch input intent before
    // tapping the row so its title no longer intercepts the first touch.
    await page.locator('main-header').tap({ position: { x: 2, y: 2 } });
    const task = taskPage.getTaskByText('Mobile description task');
    await expect(task.locator('task-title')).toHaveCSS('pointer-events', 'none');
    await task.tap();
    const markdown = page.locator('task-detail-panel inline-markdown').first();
    await expect(markdown).toBeVisible();
    await markdown.getByRole('button', { name: 'Open description editor' }).click();
    const dialog = page.locator('dialog-fullscreen-markdown');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThan(390);
    await fillMarkdownEditor(dialog, 'A description from a phone');
    await expect(dialog.getByRole('button', { name: /^Bold/ })).toBeInViewport();
    await expect(dialog.locator('#T-save-note')).toBeInViewport();
    await page.screenshot({
      path: '.tmp/e2e-test-results/description-window-mobile.png',
    });
    await dialog.locator('#T-save-note').click();
    await expect(markdown).toContainText('A description from a phone');
    await expect(page.locator('.e2e-toggle-schedule-day-panel')).toHaveCount(0);
  });
});
