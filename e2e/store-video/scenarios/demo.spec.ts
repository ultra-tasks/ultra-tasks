/** An Ultra Tasks product tour, recorded from real interactions and sample data. */
import { expect, test } from '../fixture';
import { hold } from '../helpers';
import { selectProjectView } from '../../utils/project-view';
import {
  createPointer,
  loopBoundary,
  markScene,
  nextScene,
  showEndCard,
  showOverlay,
} from '../../video-kit';

test.describe('@video Ultra Tasks demo', () => {
  test.skip(process.env.REEL_VARIANT !== 'demo', 'requires REEL_VARIANT=demo');
  test.use({ locale: 'en', theme: 'light' });

  test('capture, edit, plan and focus', async ({ seededPage: page, markBeatsStart }) => {
    test.setTimeout(180_000);
    const pointer = createPointer(page);
    await page.clock.resume();
    // Prepare a representative board with real controls before recording.
    await page.goto('/#/project/work/tasks');
    await expect(page.locator('task').first()).toBeVisible();
    await selectProjectView(page, 'Board');
    const projectBoard = page.locator('section-board');
    await expect(projectBoard).toBeVisible();
    for (const name of ['In progress', 'Up next']) {
      await projectBoard.getByRole('button', { name: 'Add section' }).click();
      const dialog = page.locator('mat-dialog-container');
      await dialog.locator('input[type="text"]').first().fill(name);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    const ungrouped = projectBoard.locator('section.column[data-section-id="none"]');
    const active = projectBoard
      .locator('section.column')
      .filter({ hasText: 'In progress' });
    await pointer.drag(
      ungrouped.locator('planner-task').first(),
      active.locator('.task-items'),
    );
    await expect(active.locator('planner-task')).toHaveCount(1);
    await selectProjectView(page, 'List');
    await page.goto('/#/tag/TODAY/tasks');
    await expect(page.locator('task').first()).toBeVisible();
    await pointer.park();
    await loopBoundary(page, 'out', 0);
    markBeatsStart();
    await loopBoundary(page, 'in', 450);
    markScene(page, 'A clearer day');
    await showOverlay(page, 'A clearer day, one task at a time.');
    await hold(2200);

    await nextScene(page, { caption: 'Capture a task in seconds.', pointer });
    await page.keyboard.press('Shift+A');
    const input = page.locator('add-task-bar.global .main-input').first();
    await expect(input).toBeFocused();
    await input.pressSequentially('Plan the launch 1h', { delay: 65 });
    await hold(700);
    await page.keyboard.press('Enter');
    const created = page.locator('task').filter({ hasText: 'Plan the launch' }).first();
    await expect(created).toBeVisible();
    const taskId = await created.getAttribute('data-task-id');
    expect(taskId).toBeTruthy();
    const task = page.locator(`task[data-task-id="${taskId}"]`);
    await hold(1400);
    await page.keyboard.press('Escape');
    await expect(page.locator('add-task-bar.global')).toBeHidden();

    await nextScene(page, { caption: 'Edit the details as plans change.', pointer });
    const title = task.locator('task-title');
    await pointer.glideTo(title);
    await title.click();
    const editor = task.locator('textarea');
    await expect(editor).toBeVisible();
    await editor.fill('');
    await editor.pressSequentially('Plan and share the launch', { delay: 55 });
    await page.keyboard.press('Tab');
    await expect(task).toContainText('Plan and share the launch');
    await hold(1800);

    await nextScene(page, {
      caption: 'Make room for the days ahead.',
      pointer,
      setup: async () => {
        await page.goto('/#/planner');
        await expect(page.locator('planner')).toBeVisible();
      },
    });
    await hold(3500);

    await nextScene(page, {
      caption: 'See projects as boards or lists.',
      pointer,
      setup: async () => {
        await page.goto('/#/project/work/tasks');
        await expect(page.locator('task').first()).toBeVisible();
      },
    });
    const view = page.getByRole('button', { name: 'Project view', exact: true });
    await pointer.glideTo(view);
    await view.click();
    const board = page.getByRole('menuitemradio', { name: 'Board', exact: true });
    await expect(board).toBeVisible();
    await pointer.glideTo(board);
    await board.click();
    await expect(page.locator('section-board')).toBeVisible();
    await hold(3000);

    await nextScene(page, {
      caption: 'Start a timer. Find your focus.',
      pointer,
      setup: async () => {
        await page.goto('/#/tag/TODAY/tasks');
        await expect(
          page.locator('task').filter({ hasText: 'Plan and share the launch' }).first(),
        ).toBeVisible();
      },
    });
    const focusedTask = page
      .locator('task')
      .filter({ hasText: 'Plan and share the launch' })
      .first();
    await pointer.glideTo(focusedTask);
    const start = focusedTask.locator('.start-task-btn');
    await expect(start).toBeVisible();
    await pointer.glideTo(start);
    await start.click();
    await expect(focusedTask).toHaveClass(/isCurrent/);
    const focus = page.locator('.focus-btn-wrapper button').first();
    await pointer.glideTo(focus);
    await focus.click();
    const play = page.locator('focus-mode-main .play-button');
    await expect(play).toBeVisible();
    await pointer.glideTo(play);
    await play.click();
    await expect(page.locator('focus-mode-task-tracking')).toBeVisible({
      timeout: 15_000,
    });
    await hold(3200);

    await nextScene(page, { pointer, label: 'Ultra Tasks' });
    markScene(page, 'Ultra Tasks');
    await showEndCard(page, {
      title: 'A clearer day. A little more you.',
      subtitle: 'Ultra Tasks · free and open source',
      stats: ['ultratasks.app'],
      logo: { src: '/assets/ultra-tasks/logo.svg' },
    });
    await hold(3000);
    await loopBoundary(page, 'out', 350);
  });
});
