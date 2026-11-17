import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';

/**
 * Issue #10542: hover controls paint the row token, which is transparent by
 * default and was a 10% white on the (since removed) Velvet theme, so a long
 * title shows through the play and detail icons. The host keeps that token as a
 * gradient over an opaque underlay: the card surface (--card-bg) the rows sit
 * on, so the controls blend into the row instead of showing a patch.
 *
 * Run: npm run e2e:file e2e/tests/task-list-basic/task-hover-controls-opaque-10542.spec.ts -- --retries=0
 */

const LONG_TITLE =
  'Write the insurance follow-up and include the claim number, the adjuster name, and the photos of the damaged roof';

type HoverUnderlay = {
  backgroundColor: string;
  surfaceBg: string;
  backgroundImage: string;
  display: string;
  titleRight: number;
  controlsLeft: number;
};

const readUnderlay = (page: Page): Promise<HoverUnderlay> =>
  page.evaluate(() => {
    const controls = document.querySelector('task-hover-controls');
    const title = document.querySelector('task task-title');
    if (!controls || !title) {
      throw new Error('hover controls or title missing');
    }
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--card-bg)';
    document.body.appendChild(probe);
    const surfaceBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cs = getComputedStyle(controls);
    return {
      backgroundColor: cs.backgroundColor,
      surfaceBg,
      backgroundImage: cs.backgroundImage,
      display: cs.display,
      titleRight: title.getBoundingClientRect().right,
      controlsLeft: controls.getBoundingClientRect().left,
    };
  });

const expectOpaqueUnderlay = async (page: Page): Promise<void> => {
  const underlay = await readUnderlay(page);
  expect(underlay.backgroundColor).toBe(underlay.surfaceBg);
  expect(underlay.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(underlay.backgroundImage).toContain('linear-gradient');
  expect(underlay.titleRight).toBeGreaterThan(underlay.controlsLeft);
};

test.describe('Task hover controls cover the title', () => {
  test('stays opaque over a long title on the default look', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask(LONG_TITLE);

    const task = page.locator('task').first();
    const row = task.locator('.first-line');
    const widthBefore = await row.evaluate((el) => el.getBoundingClientRect().width);

    await task.hover();
    await expect(task.locator('task-hover-controls')).toBeVisible();

    const widthAfter = await row.evaluate((el) => el.getBoundingClientRect().width);
    expect(widthAfter).toBe(widthBefore);

    await expectOpaqueUnderlay(page);

    // Hover controls are a pointer affordance: under touch input they are hidden.
    // The rule keys on the input intent (`isTouchPrimary`), not `isTouchOnly`.
    await page.evaluate(() => document.body.classList.add('isTouchPrimary'));
    const touch = await readUnderlay(page);
    expect(touch.display).toBe('none');
    await page.evaluate(() => document.body.classList.remove('isTouchPrimary'));
    await task.hover();
    await expect(task.locator('task-hover-controls')).toBeVisible();

    await task.locator('.start-task-btn').click();
    await expect(task).toHaveClass(/isCurrent/);
    await task.hover();
    await expectOpaqueUnderlay(page);

    await task
      .locator('task-hover-controls button')
      .filter({ has: page.locator('mat-icon', { hasText: /^pause$/ }) })
      .click();
    await expect(task).not.toHaveClass(/isCurrent/);

    await taskPage.openTaskDetail(task);
    await expect(task).toHaveClass(/isSelected/);
    await task.hover();
    await expectOpaqueUnderlay(page);
  });

  // The Velvet theme made the row token a 10% white, so what lay under the
  // hover controls showed through. Recreate that token in dark mode.
  test('stays opaque when the row token is translucent in dark mode', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.evaluate(() => {
      localStorage.setItem('DARK_MODE', 'dark');
    });
    await page.reload();
    await workViewPage.waitForTaskList();
    await page.addStyleTag({
      content: 'body { --task-c-bg: rgba(255, 255, 255, 0.1); }',
    });
    await workViewPage.addTask(LONG_TITLE);

    const task = page.locator('task').first();
    await task.hover();
    await expect(task.locator('task-hover-controls')).toBeVisible();
    await expectOpaqueUnderlay(page);
  });
});
