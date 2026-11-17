import { type Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';

/**
 * Below 960px the shell is compact: the side nav is a rail and a panel opens as a
 * bottom sheet instead of a column that squeezes the list (docs/styling-guide.md).
 * From 960px up nothing changes. A panel that is open when the window crosses the
 * line moves to the other form and stays open.
 *
 * On a phone (under 600px) the nav is the Browse drawer: its header and footer stay in
 * reach, touch screens get no keyboard hints, the Browse tab marks every page that is
 * none of the three tabs, and the bottom nav steps aside for the on-screen keyboard.
 */

const PHONE = { width: 360, height: 800 };
// Short enough that the drawer's own rows overflow it, so the header and footer have
// something to stay in front of.
const SHORT_PHONE = { width: 360, height: 400 };

const navWidth = (page: Page): Promise<number> =>
  page
    .locator('.nav-sidenav')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));

const hasHorizontalOverflow = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

// A touch pointerdown switches the input intent to touch, as a finger would.
const switchToTouch = async (page: Page): Promise<void> => {
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
  );
  await expect(page.locator('body')).toHaveClass(/isTouchPrimary/);
};

test.describe('Compact shell (960px)', () => {
  test('moves an open task panel between the column and the sheet at the 960px line', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    test.setTimeout(90000);
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Compact shell task');
    const task = page.locator('task').first();
    await expect(task).toBeVisible();
    await taskPage.openTaskDetail(task);

    const column = page.locator('right-panel.isOpen task-detail-panel');
    const sheet = page.locator('.bottom-panel-sheet task-detail-panel');
    await expect(column).toBeVisible();
    await expect(sheet).toHaveCount(0);
    expect(await navWidth(page)).toBeGreaterThan(200);

    // One pixel under the line: a rail and a sheet, and the page keeps the width.
    await page.setViewportSize({ width: 959, height: 800 });
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await expect(page.locator('right-panel.isOpen')).toHaveCount(0);
    await expect.poll(() => navWidth(page)).toBeLessThanOrEqual(64);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Back on the line: the column returns with the task still open.
    await page.setViewportSize({ width: 960, height: 800 });
    await expect(column).toBeVisible({ timeout: 10000 });
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => navWidth(page)).toBeGreaterThan(200);

    // A tablet in portrait: the same, down to 600px.
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await expect(column).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe('Phone shell (touch)', () => {
  // isMobile makes Chromium report `pointer: coarse`, which puts detect-it in
  // touchOnly mode, as on an Android/iOS device. The viewport starts desktop-sized so
  // the shared add-task flow works, then shrinks.
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test('the Browse drawer keeps Close and Help/Settings in reach and shows no keyboard hints', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize(SHORT_PHONE);
    await switchToTouch(page);

    await page.locator('mobile-bottom-nav .e2e-bottom-nav-browse').tap();
    const drawer = page.locator('.nav-sidenav.mobile');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.nav-shortcut:visible')).toHaveCount(0);

    const overflows = await drawer.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflows, 'the drawer must overflow a 400px screen for this check').toBe(
      true,
    );

    await drawer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const edges = await drawer.evaluate((el) => {
      const rect = (selector: string): { top: number; bottom: number } => {
        const box = el.querySelector(selector)!.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
      };
      const own = el.getBoundingClientRect();
      return {
        drawerTop: Math.round(own.top),
        drawerBottom: Math.round(own.bottom),
        header: rect('.nav-header'),
        footer: rect('.drawer-footer'),
      };
    });
    // Scrolled to the very end, the header still sits on the top edge and the footer
    // on the bottom edge.
    expect(edges.header.top).toBe(edges.drawerTop);
    expect(edges.footer.bottom).toBe(edges.drawerBottom);
    await expect(drawer.locator('.mobile-menu-close')).toBeInViewport();
    await expect(drawer.locator('.drawer-footer a[href*="config"]')).toBeInViewport();
  });

  test('the Browse tab marks a project page as the place you are', async ({
    page,
    workViewPage,
    projectPage,
    testPrefix,
  }) => {
    test.setTimeout(90000);
    await workViewPage.waitForTaskList();
    await projectPage.createProject('Compact project');
    const projectName = `${testPrefix}-Compact project`;
    await page.setViewportSize(PHONE);
    await switchToTouch(page);

    const today = page.locator('mobile-bottom-nav .e2e-bottom-nav-today');
    const browse = page.locator('mobile-bottom-nav .e2e-bottom-nav-browse');
    await browse.tap();
    await page
      .locator('magic-side-nav nav-list-tree nav-item .nav-link', {
        hasText: projectName,
      })
      .tap();
    await expect(page.locator('.nav-sidenav.mobile')).toBeHidden();

    // The project is a page of its own, and none of the three tabs.
    await expect(page).toHaveURL(/#\/project\//);
    await expect(browse).toHaveClass(/active/);
    await expect(today).not.toHaveClass(/active/);
  });

  test('the bottom nav steps aside while the keyboard is up', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    await page.setViewportSize(PHONE);
    await switchToTouch(page);

    const pill = page.locator('mobile-bottom-nav .mobile-bottom-nav');
    const insetBottom = (): Promise<string> =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue('--shell-inset-bottom').trim(),
      );
    await expect(pill).toBeVisible();
    expect(await insetBottom()).not.toBe('0px');

    // The class the native keyboard tracking puts on <body>.
    await page.evaluate(() => document.body.classList.add('isKeyboardVisible'));
    await expect(pill).toBeHidden();
    expect(await insetBottom()).toBe('0px');

    await page.evaluate(() => document.body.classList.remove('isKeyboardVisible'));
    await expect(pill).toBeVisible();
  });
});
