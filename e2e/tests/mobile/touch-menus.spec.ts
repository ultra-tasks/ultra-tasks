import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import { waitForMenuSettled } from '../../utils/waits';

/**
 * Phone menus: side-nav rows open their menu on long-press instead of showing
 * a ⋮ button each, and the task menu fits a 360×800 screen down to Delete.
 */

// Longer than the app's long-press (600ms) and the touch drag delay (500ms).
const LONG_PRESS_MS = 800;
const PHONE = { width: 360, height: 800 };

const longPress = async (page: Page, target: Locator): Promise<void> => {
  // Raw touch events skip actionability: wait until the target has stopped
  // moving (e.g. a drawer sliding in) and is the element at its center.
  await target.tap({ trial: true });
  const box = await target.boundingBox();
  if (!box) throw new Error('Long-press target has no bounding box');
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const x = box.x + halfWidth;
  const y = box.y + halfHeight;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    // The gesture is defined by elapsed time, so this delay is the behavior.
    await page.waitForTimeout(LONG_PRESS_MS);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
};

const swipeLeft = async (page: Page, target: Locator): Promise<void> => {
  // Shrinking the viewport and switching input intent can still move the row.
  // CDP uses absolute coordinates, so wait for the same actionability as a tap.
  await target.tap({ trial: true });
  const box = await target.boundingBox();
  if (!box) throw new Error('Swipe target has no bounding box');
  const startOffset = box.width * 0.8;
  const halfHeight = box.height / 2;
  const stepWidth = box.width * 0.1;
  const x = box.x + startOffset;
  const y = box.y + halfHeight;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 5; step++) {
      const distance = stepWidth * step;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - distance, y }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
};

// The shared add-task flow clicks with a mouse; a touch pointerdown switches
// the input intent back to touch, as a finger would.
const switchToTouch = async (page: Page): Promise<void> => {
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
  );
  await expect(page.locator('body')).toHaveClass(/isTouchPrimary/);
};

test.describe('Phone menus (touch)', () => {
  // isMobile makes Chromium report `pointer: coarse`, which puts detect-it in
  // touchOnly mode, as on an Android/iOS device. The viewport starts
  // desktop-sized so the shared add-task flow works, then shrinks.
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('side-nav rows open their menu on long-press, not via a ⋮ button', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Long-press project');
    const projectName = `${testPrefix}-Long-press project`;
    await page.setViewportSize(PHONE);
    await switchToTouch(page);
    const url = page.url();

    await page.locator('mobile-bottom-nav .e2e-bottom-nav-browse').tap();
    // A project row sits in the drag tree: holding still must open its menu
    // rather than start a drag.
    const projectRow = page.locator('magic-side-nav nav-list-tree nav-item .nav-link', {
      hasText: projectName,
    });
    await expect(projectRow).toBeVisible();
    await longPress(page, projectRow);
    await waitForMenuSettled(page);
    await expect(page.locator('.mat-mdc-menu-content work-context-menu')).toBeVisible();
    await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
    // Releasing the press neither followed the link nor let the following
    // click land on the backdrop and close the menu again.
    expect(page.url()).toBe(url);
    const backdrop = page.locator('.cdk-overlay-backdrop').last();
    // A closing menu keeps its backdrop in the DOM while it fades out; only an
    // open one carries the showing class.
    await expect(backdrop).toHaveClass(/cdk-overlay-backdrop-showing/);
    // Escape would close the drawer too; the backdrop closes only the menu.
    // Tap a corner far from the menu, which opens next to the row.
    await backdrop.tap({ position: { x: 10, y: 780 } });
    await expect(page.locator('.mat-mdc-menu-panel')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test('the swipe-left task menu fits a phone screen down to Delete', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();
    const title = `${testPrefix}-Phone menu task`;
    await workViewPage.addTask(title);
    const task = taskPage.getTaskByText(title);
    await page.setViewportSize(PHONE);
    await switchToTouch(page);

    await swipeLeft(page, task);
    const menu = page.locator('.mat-mdc-menu-panel').first();
    await expect(menu).toBeVisible();
    await waitForMenuSettled(page);

    // The date shortcuts carry visible labels: tooltips never show on touch.
    await expect(menu.locator('.quick-access-label')).toHaveText([
      'Today',
      // Short weekday names for tomorrow and the first day of next week.
      /^\w{2,4}$/,
      /^\w{2,4}$/,
      'Date',
      // Added to Today, so it is scheduled and can be cleared.
      'Clear',
    ]);
    await expect(menu.getByRole('menuitem', { name: /Delete task/ })).toBeInViewport({
      ratio: 1,
    });
  });
});
