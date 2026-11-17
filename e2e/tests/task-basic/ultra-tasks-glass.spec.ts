import { expect, test } from '../../fixtures/test.fixture';

test('top search and device-local glass control work and persist', async ({
  page,
  workViewPage,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  for (const title of [
    'Review the project proposal',
    'Plan a focused afternoon',
    'Share feedback with the team',
  ])
    await workViewPage.addTask(title);
  const items = page.locator('.nav-list .nav-item');
  await expect(items.first().locator('nav-item')).toContainText('Search');
  const searchEntry = page.locator('.st-search-entry').getByRole('menuitem', {
    name: 'Search',
    exact: true,
  });
  await searchEntry.focus();
  await searchEntry.press('Enter');
  const searchDialog = page.getByRole('dialog', { name: 'Search', exact: true });
  await expect(searchDialog).toBeVisible();
  await searchDialog.press('Escape');
  await expect(searchDialog).toBeHidden();
  await page.goto('/#/config?section=appearance');
  const toggle = page.getByRole('switch', { name: 'Glass appearance' });
  await expect(toggle).toBeChecked();
  // The web app draws its own blurred backdrop behind the glass surfaces.
  await expect(page.locator('body')).toHaveClass(/st-glass-bitmap/);
  await expect(page.locator('glass-backdrop canvas')).toBeAttached();
  await expect(page.locator('glass-settings .st-glass-background')).toBeVisible();
  // A Material switch updates its state a tick after the click, so click and then
  // wait for it instead of uncheck()/check(), which read the state right away.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('body')).toHaveClass(/st-solid/);
  await expect(page.locator('glass-backdrop')).toHaveCount(0);
  await expect(page.locator('glass-settings .st-glass-background')).toHaveCount(0);
  await page.reload();
  // Settings opens as a dialog; reopen it after the route restores the workspace.
  await page.goto('/#/config?section=appearance');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  for (const dark of [false, true]) {
    await page.goto('/#/config?section=appearance');
    await page
      .locator(
        `.dark-mode-select mat-button-toggle[value="${dark ? 'dark' : 'light'}"] button`,
      )
      .click();
    await page.goto('/#/project/INBOX_PROJECT/tasks');
    await workViewPage.waitForTaskList();
    await page.screenshot({
      path: `.tmp/e2e-test-results/glass-${dark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.nav-sidenav')).toHaveCSS('backdrop-filter', 'none');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.goto('/#/config?section=appearance');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await workViewPage.waitForTaskList();
  await expect(page.locator('.nav-sidenav')).toHaveCSS('backdrop-filter', 'none');
  await page.screenshot({
    path: '.tmp/e2e-test-results/glass-disabled.png',
    animations: 'disabled',
  });
});
