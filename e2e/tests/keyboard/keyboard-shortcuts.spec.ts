import { expect, test } from '../../fixtures/test.fixture';
import { cssSelectors } from '../../constants/selectors';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * Keyboard Shortcuts E2E Tests
 *
 * Tests keyboard navigation and shortcuts:
 * - Add task via keyboard
 * - Navigate via keyboard
 * - Mark task done via keyboard
 */

const { ADD_TASK_INPUT, DETAIL_PANEL } = cssSelectors;

test.describe('Keyboard Shortcuts', () => {
  test('starts with conflict-free shortcuts and keeps them after reload', async ({
    page,
    workViewPage,
    settingsPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await settingsPage.openSettingsSection('keyboard');
    const calendar = page.getByRole('textbox', { name: 'Go to Calendar', exact: true });
    const deadline = page.getByRole('textbox', {
      name: 'Set task deadline',
      exact: true,
    });
    const today = page.getByRole('textbox', {
      name: 'Schedule task for today',
      exact: true,
    });
    const search = page.getByRole('textbox', { name: 'Show search bar', exact: true });
    await expect(calendar).toHaveValue('Shift+C');
    await expect(deadline).toHaveValue('Shift+S');
    await expect(today).toHaveValue('Alt+T');
    await expect(search).toHaveValue('Ctrl+F');
    await expect(page.locator('keyboard-shortcut-conflicts .conflict-row')).toHaveCount(
      0,
    );
    await page.reload();
    await settingsPage.openSettingsSection('keyboard');
    await expect(calendar).toHaveValue('Shift+C');
    await expect(deadline).toHaveValue('Shift+S');
    await expect(today).toHaveValue('Alt+T');
    await expect(search).toHaveValue('Ctrl+F');
    await expect(page.locator('keyboard-shortcut-conflicts .conflict-row')).toHaveCount(
      0,
    );
    await settingsPage.closeSettings();

    await page.keyboard.press('Shift+Slash');
    const guide = page.locator('dialog-keyboard-shortcuts');
    await expect(guide).toBeVisible();
    await expect(guide.locator('.shortcut-conflict')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();

    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Default shortcuts`;
    await workViewPage.addTask(title);
    await taskPage.getTaskByText(title).focus();
    await page.keyboard.press('Shift+S');
    await expect(page.locator('dialog-deadline')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog-deadline')).toBeHidden();
    await taskPage.getTaskByText(title).focus();
    await page.keyboard.press('Alt+T');
    await page.keyboard.press('Shift+T');
    await expect(page).toHaveURL(/\/tag\/TODAY\/tasks/);
    await expect(
      page
        .locator('.task-list-inner[data-id="UNDONE"] > task:not(.ng-animating)')
        .filter({ hasText: title }),
    ).toBeVisible();
    await page.keyboard.press('Shift+C');
    await expect(page).toHaveURL(/\/schedule/);
  });

  test('shows the search shortcut without changing the accessible action name', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const search = page
      .locator('.st-search-entry')
      .getByRole('menuitem', { name: 'Search', exact: true });
    await expect(search.locator('kbd')).toHaveText('Ctrl+F');
    await expect(search).toHaveAttribute('aria-description', 'Ctrl+F');
    await search.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeVisible();
  });

  test('undoes and redoes a priority change', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Undo priority`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await task.focus();
    await page.keyboard.press('q');
    await page.getByRole('menuitem', { name: 'Priority' }).hover();
    await page.getByRole('menuitemradio', { name: 'High' }).click();
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    await expect(task.locator('task-priority-indicator')).toHaveCount(1);
    await task.focus();
    await page.keyboard.press('Control+Z');
    await expect(task.locator('task-priority-indicator')).toHaveCount(0);
    await page.keyboard.press('Control+Y');
    await expect(task.locator('task-priority-indicator')).toHaveCount(1);
  });

  test('undoes and redoes saved task notes', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Undo notes`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await taskPage.openTaskDetail(task);
    const notes = page.locator('task-detail-panel inline-markdown').first();
    const editor = notes.locator('.cm-content');
    await editor.click();
    await page.keyboard.type('A saved note');
    await editor.press('Tab');
    await expect(notes).toContainText('A saved note');
    await waitForStatePersistence(page);
    await task.focus();
    await page.keyboard.press('Control+Z');
    await expect(notes).not.toContainText('A saved note');
    await page.keyboard.press('Control+Shift+Z');
    await expect(notes).toContainText('A saved note');
  });

  test('copies a focused task and pastes a duplicate', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Clipboard task`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await task.focus();
    await page.keyboard.press('Control+C');
    await page.keyboard.press('Control+V');
    await expect(taskPage.getTaskByText(`${title} (copy)`)).toBeVisible();
  });

  test('cuts a task and pastes it into another project', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Clipboard source');
    await projectPage.createProject('Clipboard destination');
    await projectPage.navigateToProjectByName('Clipboard source');
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Move clipboard task`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await task.focus();
    await page.keyboard.press('Control+X');
    await expect(task).toBeVisible();
    await projectPage.navigateToProjectByName('Clipboard destination');
    await workViewPage.waitForTaskList();
    await page.keyboard.press('Control+V');
    await expect(
      page.locator('task:visible').filter({ hasText: title }).first(),
    ).toBeVisible();
    await projectPage.navigateToProjectByName('Clipboard source');
    await expect(page.locator('task:visible').filter({ hasText: title })).toHaveCount(0);
  });

  test('reorders a cut task after a focused task in its project', async ({
    page,
    workViewPage,
    projectPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Clipboard reorder');
    await projectPage.navigateToProjectByName('Clipboard reorder');
    await workViewPage.waitForTaskList();
    const one = `${testPrefix}-First`;
    const two = `${testPrefix}-Second`;
    await workViewPage.addTask(one);
    await workViewPage.addTask(two);
    const first = taskPage.getTaskByText(one);
    const second = taskPage.getTaskByText(two);
    await second.focus();
    await page.keyboard.press('Control+X');
    await first.focus();
    await page.keyboard.press('Control+V');
    const rows = page.locator(
      '.task-list-inner[data-list-id="PARENT"][data-id="UNDONE"] > task',
    );
    await expect(rows.nth(0)).toContainText(one);
    await expect(rows.nth(1)).toContainText(two);
  });

  test('moves a cut subtask under a different parent', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const one = `${testPrefix}-Original parent`;
    const two = `${testPrefix}-New parent`;
    const child = `${testPrefix}-Moved child`;
    await workViewPage.addTask(one);
    await workViewPage.addTask(two);
    const first = taskPage.getTaskByText(one);
    const second = taskPage.getTaskByText(two);
    await workViewPage.addSubTask(first, child);
    const subtask = first.locator('task').filter({ hasText: child });
    await subtask.focus();
    await page.keyboard.press('Control+X');
    await second.focus();
    await page.keyboard.press('Control+V');
    await expect(first.locator('task').filter({ hasText: child })).toHaveCount(0);
    await expect(second.locator('task').filter({ hasText: child })).toHaveCount(1);
  });

  test('persists and uses remapped task clipboard shortcuts', async ({
    page,
    workViewPage,
    settingsPage,
    taskPage,
    testPrefix,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await workViewPage.waitForTaskList();
    await settingsPage.openSettingsSection('keyboard');
    const copy = page.getByRole('textbox', {
      name: 'Copy focused or selected tasks',
      exact: true,
    });
    const paste = page.getByRole('textbox', { name: 'Paste tasks', exact: true });
    await copy.focus();
    await page.keyboard.press('Alt+C');
    await paste.focus();
    await page.keyboard.press('Alt+V');
    await expect(copy).toHaveValue('Alt+C');
    await expect(paste).toHaveValue('Alt+V');
    await waitForStatePersistence(page);
    await page.reload();
    await settingsPage.openSettingsSection('keyboard');
    await expect(copy).toHaveValue('Alt+C');
    await expect(paste).toHaveValue('Alt+V');
    await settingsPage.closeSettings();
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Remapped clipboard`;
    await workViewPage.addTask(title);
    await taskPage.getTaskByText(title).focus();
    await page.keyboard.press('Alt+C');
    await expect
      .poll(() =>
        page.evaluate(async (expectedTitle) => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              if (!item.types.includes('text/html')) continue;
              const html = await (await item.getType('text/html')).text();
              if (
                html.includes('data-ultratasks-task-clipboard') &&
                html.includes(expectedTitle)
              )
                return true;
            }
          } catch {
            // The write can finish between read() and getType(). Poll again.
          }
          return false;
        }, title),
      )
      .toBe(true);
    await page.keyboard.press('Alt+V');
    await expect(taskPage.getTaskByText(`${title} (copy)`)).toBeVisible();
  });

  test('mixes native and remapped task clipboard shortcuts', async ({
    page,
    workViewPage,
    settingsPage,
    taskPage,
    testPrefix,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await workViewPage.waitForTaskList();
    await settingsPage.openSettingsSection('keyboard');
    const copy = page.getByRole('textbox', {
      name: 'Copy focused or selected tasks',
      exact: true,
    });
    const paste = page.getByRole('textbox', { name: 'Paste tasks', exact: true });
    await copy.focus();
    await page.keyboard.press('Alt+C');
    await settingsPage.closeSettings();
    const title = `${testPrefix}-Mixed clipboard`;
    await workViewPage.addTask(title);
    await taskPage.getTaskByText(title).focus();
    await page.keyboard.press('Alt+C');
    await expect
      .poll(() =>
        page.evaluate(async (expectedTitle) => {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              if (!item.types.includes('text/html')) continue;
              const html = await (await item.getType('text/html')).text();
              if (
                html.includes('data-ultratasks-task-clipboard') &&
                html.includes(expectedTitle)
              )
                return true;
            }
          } catch {
            // The write can finish between read() and getType(). Poll again.
          }
          return false;
        }, title),
      )
      .toBe(true);
    await page.keyboard.press('Control+V');
    await expect(taskPage.getTaskByText(`${title} (copy)`)).toHaveCount(1);

    await settingsPage.openSettingsSection('keyboard');
    await copy.focus();
    await page.keyboard.press('Control+C');
    await paste.focus();
    await page.keyboard.press('Alt+V');
    await settingsPage.closeSettings();
    await taskPage.getTaskByText(title).filter({ hasNotText: '(copy)' }).focus();
    await page.keyboard.press('Control+C');
    await page.keyboard.press('Alt+V');
    await expect(taskPage.getTaskByText(`${title} (copy)`)).toHaveCount(2);
  });

  test('undoes and redoes an estimate change', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Undo estimate`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await task.focus();
    await page.keyboard.press('t');
    const dialog = page.locator('dialog-time-estimate');
    // Visible is not ready: a value typed before the dialog has written its
    // initial value shows in the field but is dropped from the form model, so the
    // save keeps the old estimate. Wait out the open animation first.
    const dialogOpening = page.locator('.mdc-dialog--opening');
    await expect(dialog).toBeVisible();
    await expect(dialogOpening).toHaveCount(0);
    await dialog.locator('input').nth(1).fill('30m');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const estimate = task.locator('.time-val').last();
    await expect(estimate).toContainText('30m');
    await task.focus();
    await page.keyboard.press('Control+Z');
    await expect(estimate).not.toContainText('30m');
    await page.keyboard.press('Control+Y');
    await expect(estimate).toContainText('30m');

    // The same form must submit once when Enter is pressed in the estimate input.
    await task.focus();
    await page.keyboard.press('t');
    await expect(dialog).toBeVisible();
    await expect(dialogOpening).toHaveCount(0);
    const estimateInput = dialog.locator('input').nth(1);
    await estimateInput.fill('45m');
    await estimateInput.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(estimate).toContainText('45m');
    await task.focus();
    await page.keyboard.press('Control+Z');
    await expect(estimate).toContainText('30m');
  });

  test('should keep an assigned shortcut after Escape and reload', async ({
    page,
    settingsPage,
  }) => {
    // Every shortcut sits behind the Keyboard section's "More options" toggle.
    await settingsPage.openSettingsSection('keyboard');

    const shortcutInput = page.locator('keyboard-input input').first();
    await expect(shortcutInput).toBeVisible();
    const assignedShortcut = await shortcutInput.inputValue();
    expect(assignedShortcut).not.toBe('');

    await shortcutInput.focus();
    await page.keyboard.press('Escape');
    await expect(shortcutInput).toHaveValue(assignedShortcut);

    // Settings is a dialog over the workspace, so a reload lands on the
    // workspace; reopen the section to read the stored shortcut.
    await page.reload();
    await settingsPage.openSettingsSection('keyboard');
    const reloadedShortcutInput = page.locator('keyboard-input input').first();
    await expect(reloadedShortcutInput).toHaveValue(assignedShortcut);
  });

  test('should focus add task input with Shift+A', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    const addTaskInput = page.locator(ADD_TASK_INPUT);
    await expect(addTaskInput).toHaveCount(0);

    await page.keyboard.press('Shift+A');
    await expect(addTaskInput).toBeFocused();
  });

  test('should persist and apply a remapped add-task shortcut', async ({
    page,
    workViewPage,
    settingsPage,
  }) => {
    await workViewPage.waitForTaskList();
    await settingsPage.openSettingsSection('keyboard');

    const shortcutInput = page.getByRole('textbox', {
      name: 'Add new task',
      exact: true,
    });
    await expect(shortcutInput).toHaveValue('Shift+A');
    await shortcutInput.focus();
    await page.keyboard.press('Shift+V');
    await expect(shortcutInput).toHaveValue('Shift+V');

    await waitForStatePersistence(page);
    await page.reload();
    await settingsPage.openSettingsSection('keyboard');
    await expect(shortcutInput).toHaveValue('Shift+V');

    // The settings window keeps the workspace route, so close it explicitly.
    await settingsPage.closeSettings();
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();
    const addTaskInput = page.locator(ADD_TASK_INPUT);
    await expect(addTaskInput).toHaveCount(0);

    await page.keyboard.press('Shift+V');
    await expect(addTaskInput).toBeFocused();
  });

  test('should move task focus with J and K', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const olderTaskTitle = `${testPrefix}-Task One`;
    const newerTaskTitle = `${testPrefix}-Task Two`;
    await workViewPage.addTask(olderTaskTitle);
    await workViewPage.addTask(newerTaskTitle);

    const newerTask = taskPage.getTaskByText(newerTaskTitle);
    const olderTask = taskPage.getTaskByText(olderTaskTitle);
    await newerTask.focus();
    await expect(newerTask).toBeFocused();

    await page.keyboard.press('j');
    await expect(olderTask).toBeFocused();

    await page.keyboard.press('k');
    await expect(newerTask).toBeFocused();
  });

  test('should unfocus the current task with Escape', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-Escape Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(task).not.toBeFocused();

    // With no task focused, the navigation keys stop moving focus around.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('task:focus')).toHaveCount(0);
  });

  test('should mark a focused task done with D', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-Keyboard Done Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    await page.keyboard.press('d');
    const doneTask = page
      .locator('.task-list-inner[data-id="DONE"] > task.isDone')
      .filter({ hasText: taskName });
    await expect(doneTask).toHaveCount(1);
  });

  test('should open the focused task detail panel with I', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const taskName = `${testPrefix}-Detail Task`;
    await workViewPage.addTask(taskName);

    const task = taskPage.getTaskByText(taskName);
    await task.focus();
    await expect(task).toBeFocused();

    await page.keyboard.press('i');

    const detailPanel = page.locator(DETAIL_PANEL);
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel.locator('task-title')).toContainText(taskName);
  });
});
