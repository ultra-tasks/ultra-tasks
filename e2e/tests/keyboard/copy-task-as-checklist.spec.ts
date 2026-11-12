import { expect, test } from '../../fixtures/test.fixture';

declare global {
  interface Window {
    __copiedText?: string;
  }
}

test.describe('Copy task as markdown checklist', () => {
  test('Ctrl+C on a focused task copies it and its sub tasks', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Parent task');

    const parent = taskPage.getTaskByText('Parent task');
    await workViewPage.addSubTask(parent, 'Sub one');
    await workViewPage.addSubTask(parent, 'Sub two');

    // Ctrl+C is a native copy event: the app puts the checklist on the event's
    // clipboardData and the browser hands that to the OS clipboard. clipboard-read
    // cannot be granted in this browser context, so read back what the app set on
    // the event. This listener is added after the app's own, so it runs after it.
    await page.evaluate(() => {
      document.addEventListener('copy', (event) => {
        window.__copiedText = event.clipboardData?.getData('text/plain');
      });
    });

    await parent.focus();
    await page.keyboard.press('Control+c');

    await expect
      .poll(() => page.evaluate(() => window.__copiedText))
      .toBe(`- [ ] ${testPrefix}-Parent task\n  - [ ] Sub one\n  - [ ] Sub two`);
  });
});
