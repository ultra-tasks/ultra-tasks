import { expect, test } from '../../fixtures/test.fixture';
import { installDevErrorDialogHandler } from '../../utils/runtime-errors';
import { flushPendingWrites } from '../../utils/waits';

test('a reload warns while a task edit is waiting for a local write', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await workViewPage.addTask('Before reload');
  const task = page.locator('task').filter({ hasText: 'Before reload' });
  await expect(task).toBeVisible();
  await flushPendingWrites(page);

  // A second tab holds the same real lock used by IndexedDB operations.
  const lockPage = await page.context().newPage();
  await lockPage.goto('/favicon.ico');
  await lockPage.evaluate(() => {
    const w = window as Window & {
      __writeLockAcquired?: boolean;
      __releaseWriteLock?: () => void;
    };
    void navigator.locks.request('sp_op_log', async () => {
      w.__writeLockAcquired = true;
      await new Promise<void>((resolve) => (w.__releaseWriteLock = resolve));
    });
  });
  await expect
    .poll(() =>
      lockPage.evaluate(
        () => (window as Window & { __writeLockAcquired?: boolean }).__writeLockAcquired,
      ),
    )
    .toBe(true);

  // This test handles the browser's beforeunload prompt itself. The shared
  // fixture normally accepts such prompts so unrelated tests can navigate.
  page.removeAllListeners('dialog');
  try {
    const id = await task.getAttribute('data-task-id');
    await task.locator('task-title').click();
    const input = page.locator(`task[data-task-id="${id}"] textarea`).first();
    await input.fill('After reload');
    await page.keyboard.press('Tab');
    await expect(page.locator('task').filter({ hasText: 'After reload' })).toBeVisible();

    // The browser cannot await IndexedDB during beforeunload. Keep this page
    // open when it warns, then let the queued write finish before retrying.
    const beforeUnload = page.waitForEvent('dialog', { timeout: 10000 });
    const reloadRequest = page
      .evaluate(() => {
        window.setTimeout(() => window.location.reload(), 0);
      })
      .catch(() => undefined);
    const dialog = await beforeUnload;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await reloadRequest;
    await expect(page.locator('task').filter({ hasText: 'After reload' })).toBeVisible();
    await lockPage.evaluate(() =>
      (window as Window & { __releaseWriteLock?: () => void }).__releaseWriteLock?.(),
    );
    await flushPendingWrites(page);
    let unexpectedDialog = false;
    page.on('dialog', (unexpected) => {
      unexpectedDialog = true;
      void unexpected.accept();
    });
    await page.reload();
    expect(unexpectedDialog).toBe(false);
    await expect(page.locator('task').filter({ hasText: 'After reload' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    page.removeAllListeners('dialog');
    installDevErrorDialogHandler(page, 'page');
    await lockPage.evaluate(() =>
      (window as Window & { __releaseWriteLock?: () => void }).__releaseWriteLock?.(),
    );
    await lockPage.close();
  }
});
