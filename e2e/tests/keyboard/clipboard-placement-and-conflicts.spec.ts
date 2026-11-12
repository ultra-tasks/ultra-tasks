import { expect, test } from '../../fixtures/test.fixture';
import { waitForStatePersistence } from '../../utils/waits';
import { Page } from '@playwright/test';

const readCompletionTime = (page: Page, id: string): Promise<number | undefined> =>
  page.evaluate((taskId) => {
    type State = { tasks: { entities: Record<string, { doneOn?: number }> } };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (state: State) => void) => { unsubscribe(): void } };
        };
      }
    ).__e2eTestHelpers.store;
    let value: number | undefined;
    store
      .subscribe((state) => {
        value = state.tasks.entities[taskId].doneOn;
      })
      .unsubscribe();
    return value;
  }, id);

test('places copies and cut tasks after the focused task', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Clipboard placement source');
  await projectPage.navigateToProjectByName('Clipboard placement source');
  await workViewPage.waitForTaskList();
  const firstName = `${testPrefix}-First placement`;
  const secondName = `${testPrefix}-Second placement`;
  const thirdName = `${testPrefix}-Third placement`;
  for (const title of [firstName, secondName, thirdName]) {
    await workViewPage.addTask(title);
  }
  const firstId = await taskPage.getTaskByText(firstName).getAttribute('data-task-id');
  const secondId = await taskPage.getTaskByText(secondName).getAttribute('data-task-id');
  const first = page.locator(`task[data-task-id="${firstId}"]`);
  const second = page.locator(`task[data-task-id="${secondId}"]`);
  const rows = page.locator('.task-list-inner[data-id="UNDONE"] > task');

  await first.focus();
  await page.keyboard.press('Control+X');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+V');
  await expect(rows.first()).toHaveAttribute('data-task-id', firstId!);

  await second.focus();
  await page.keyboard.press('Control+C');
  await first.focus();
  await page.keyboard.press('Control+V');
  await expect(rows.first()).toHaveAttribute('data-task-id', firstId!);
  await expect(rows.nth(1)).toContainText(`${secondName} (copy)`);

  await projectPage.createProject('Clipboard placement destination');
  await projectPage.navigateToProjectByName('Clipboard placement destination');
  await workViewPage.waitForTaskList();
  const destinationFirst = `${testPrefix}-Destination first`;
  const destinationLast = `${testPrefix}-Destination last`;
  await workViewPage.addTask(destinationLast);
  await workViewPage.addTask(destinationFirst);
  await projectPage.navigateToProjectByName('Clipboard placement source');
  await second.focus();
  await page.keyboard.press('Control+X');
  await projectPage.navigateToProjectByName('Clipboard placement destination');
  await taskPage.getTaskByText(destinationFirst).focus();
  await page.keyboard.press('Control+V');
  await expect(rows.nth(0)).toContainText(destinationFirst);
  await expect(rows.nth(1)).toHaveAttribute('data-task-id', secondId!);
  await expect(rows.nth(2)).toContainText(destinationLast);
});

test('reorders completed project tasks without changing completion time', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Done clipboard order');
  await projectPage.navigateToProjectByName('Done clipboard order');
  await workViewPage.waitForTaskList();
  for (const suffix of ['First', 'Second', 'Third']) {
    const title = `${testPrefix}-${suffix}`;
    await workViewPage.addTask(title);
    await taskPage.getTaskByText(title).focus();
    await page.keyboard.press('d');
    await expect(
      page
        .locator('.task-list-inner[data-id="DONE"] > task.isDone')
        .filter({ hasText: title }),
    ).toHaveCount(1);
  }
  const done = page.locator(
    '.task-list-inner[data-id="DONE"] > task.isDone:not(.ng-animating)',
  );
  await expect(done).toHaveCount(3);
  const movingId = await done.first().getAttribute('data-task-id');
  const completion = await readCompletionTime(page, movingId!);
  await done.first().focus();
  await page.keyboard.press('Control+X');
  await done.last().focus();
  await page.keyboard.press('Control+V');
  await expect(done.last()).toHaveAttribute('data-task-id', movingId!);
  await page.keyboard.press('Control+Z');
  await expect(done.first()).toHaveAttribute('data-task-id', movingId!);
  await page.keyboard.press('Control+Y');
  await expect(done.last()).toHaveAttribute('data-task-id', movingId!);
  await expect.poll(() => readCompletionTime(page, movingId!)).toBe(completion);
  await waitForStatePersistence(page);
  await page.reload();
  await workViewPage.waitForTaskList();
  await expect(
    page
      .locator('.task-list-inner[data-id="DONE"] > task.isDone:not(.ng-animating)')
      .last(),
  ).toHaveAttribute('data-task-id', movingId!);
  const reloadedDone = page.locator(
    '.task-list-inner[data-id="DONE"] > task.isDone:not(.ng-animating)',
  );
  // After a keyboard move the list re-renders and focus returns to the moved task
  // a moment later. The next shortcut acts on the focused task, so wait for that,
  // as someone watching the focus ring does, rather than firing it into the gap.
  const movedRow = page.locator(`task[data-task-id="${movingId}"]`);
  await reloadedDone.last().focus();
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(reloadedDone.nth(1)).toHaveAttribute('data-task-id', movingId!);
  await expect(movedRow).toBeFocused();
  await page.keyboard.press('Control+Alt+ArrowUp');
  await expect(reloadedDone.first()).toHaveAttribute('data-task-id', movingId!);
  await expect(movedRow).toBeFocused();
  await page.keyboard.press('Control+Z');
  await expect(reloadedDone.nth(1)).toHaveAttribute('data-task-id', movingId!);
  await page.keyboard.press('Control+Y');
  await expect(reloadedDone.first()).toHaveAttribute('data-task-id', movingId!);
  const sourceBox = await reloadedDone.first().boundingBox();
  const targetBox = await reloadedDone.last().boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Completed task rows are not visible');
  const sourceHalfWidth = sourceBox.width / 2;
  const sourceHalfHeight = sourceBox.height / 2;
  const targetHalfWidth = targetBox.width / 2;
  const targetHalfHeight = targetBox.height / 2;
  const sourceX = sourceBox.x + sourceHalfWidth;
  const sourceY = sourceBox.y + sourceHalfHeight;
  const targetX = targetBox.x + targetHalfWidth;
  const targetY = targetBox.y + targetHalfHeight;
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 10, sourceY + 10, { steps: 5 });
  await page.mouse.move(targetX, targetY, { steps: 20 });
  await page.mouse.up();
  await expect(reloadedDone.first()).not.toHaveAttribute('data-task-id', movingId!);
  await page.keyboard.press('Control+Z');
  await expect(reloadedDone.first()).toHaveAttribute('data-task-id', movingId!);
  // Reordering never edits the completion time (checked exactly above, before the
  // reload). A reload replays the log, which re-reads the time stored with the
  // completion operation: a few milliseconds after the one the reducer stamped
  // live, whatever was reordered. Allow that gap, nothing like a re-completion.
  await expect
    .poll(async () =>
      Math.abs((await readCompletionTime(page, movingId!))! - completion!),
    )
    .toBeLessThan(1000);
});

test('reorders cut tasks in the project backlog', async ({
  page,
  workViewPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await page.evaluate(() => {
    const store = (
      window as unknown as {
        __e2eTestHelpers: { store: { dispatch: (action: unknown) => void } };
      }
    ).__e2eTestHelpers.store;
    store.dispatch({
      type: '[Project] Update Project',
      project: { id: 'INBOX_PROJECT', changes: { isEnableBacklog: true } },
    });
  });
  await page.goto('/#/project/INBOX_PROJECT/tasks?backlogPos=50');
  await workViewPage.waitForTaskList();
  const names = [`${testPrefix}-Backlog one`, `${testPrefix}-Backlog two`];
  for (const name of names) {
    await workViewPage.addTask(name);
    await taskPage.getTaskByText(name).focus();
    await page.keyboard.press('Shift+B');
    await expect(page.locator('.backlog task').filter({ hasText: name })).toHaveCount(1);
  }
  const backlog = page.locator('.backlog .task-list-inner[data-id="BACKLOG"] > task');
  const moving = backlog.filter({ hasText: names[0] });
  const target = backlog.filter({ hasText: names[1] });
  await moving.focus();
  await page.keyboard.press('Control+X');
  await target.focus();
  await page.keyboard.press('Control+V');
  await expect(backlog.last()).toContainText(names[0]);
});

test('places a cut unfinished task after its completed destination', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Move into Done');
  await projectPage.navigateToProjectByName('Move into Done');
  await workViewPage.waitForTaskList();
  const destinationName = `${testPrefix}-Already done`;
  const movingName = `${testPrefix}-To complete`;
  await workViewPage.addTask(destinationName);
  await taskPage.getTaskByText(destinationName).focus();
  await page.keyboard.press('d');
  const done = page.locator('.task-list-inner[data-id="DONE"] > task.isDone');
  await expect(done.filter({ hasText: destinationName })).toHaveCount(1);
  await workViewPage.addTask(movingName);
  await taskPage.getTaskByText(movingName).focus();
  await page.keyboard.press('Control+X');
  await done.filter({ hasText: destinationName }).focus();
  await page.keyboard.press('Control+V');
  await expect(done).toHaveCount(2);
  await expect(done.last()).toContainText(movingName);
});

test('promotes a cut subtask to the current project root', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Promote clipboard');
  await projectPage.navigateToProjectByName('Promote clipboard');
  await workViewPage.waitForTaskList();
  const parentName = `${testPrefix}-Parent`;
  const childName = `${testPrefix}-Child`;
  await workViewPage.addTask(parentName);
  const parent = taskPage.getTaskByText(parentName);
  await workViewPage.addSubTask(parent, childName);
  await parent.locator('task').filter({ hasText: childName }).focus();
  await page.keyboard.press('Control+X');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+V');
  await expect(parent.locator('task').filter({ hasText: childName })).toHaveCount(0);
  await expect(
    page
      .locator('.task-list-inner[data-list-id="PARENT"] > task')
      .filter({ hasText: childName }),
  ).toHaveCount(1);
});

test('offers an explicit safe replacement for a saved shortcut conflict', async ({
  page,
  workViewPage,
  settingsPage,
}) => {
  await workViewPage.waitForTaskList();
  await settingsPage.openSettingsSection('keyboard');
  const calendar = page.getByRole('textbox', { name: 'Go to Calendar', exact: true });
  const deadline = page.getByRole('textbox', { name: 'Set task deadline', exact: true });
  await calendar.focus();
  await page.keyboard.press('Shift+S');
  await expect(calendar).toHaveValue('Shift+S');
  const conflict = page
    .locator('keyboard-shortcut-conflicts .conflict-row')
    .filter({ hasText: 'Go to Calendar' });
  await expect(conflict).toContainText('Shift+C');
  await conflict.getByRole('button', { name: /Use suggested/ }).click();
  await expect(calendar).toHaveValue('Shift+C');
  await expect(deadline).toHaveValue('Shift+S');
  await waitForStatePersistence(page);
  await page.reload();
  await settingsPage.openSettingsSection('keyboard');
  await expect(calendar).toHaveValue('Shift+C');
  await expect(deadline).toHaveValue('Shift+S');
});

test('pastes several copied tasks in the order they were copied', async ({
  page,
  workViewPage,
  projectPage,
  taskPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Clipboard copy order');
  await projectPage.navigateToProjectByName('Clipboard copy order');
  await workViewPage.waitForTaskList();
  const titles = ['Alpha', 'Bravo', 'Charlie'].map((name) => `${testPrefix}-${name}`);
  for (const title of titles) await workViewPage.addTask(title);
  const rows = page.locator('.task-list-inner[data-id="UNDONE"] > task');
  await expect(rows).toHaveCount(3);

  const titleById = new Map<string, string>();
  for (const title of titles) {
    const id = await taskPage.getTaskByText(title).getAttribute('data-task-id');
    titleById.set(id!, title);
  }
  const listOrder = (
    await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id')))
  ).map((id) => titleById.get(id!)!);

  for (const title of titles) {
    await taskPage
      .getTaskByText(title)
      .locator('done-toggle')
      .click({
        modifiers: ['Control'],
      });
  }
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');

  // Where the copies land is the placement rule's business (after the focused
  // task). Whatever the place, they must keep the order they had in the list,
  // not come in back to front.
  await expect(rows).toHaveCount(6);
  const copies = rows.filter({ hasText: '(copy)' });
  await expect(copies).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(copies.nth(i)).toContainText(`${listOrder[i]} (copy)`);
  }
});
