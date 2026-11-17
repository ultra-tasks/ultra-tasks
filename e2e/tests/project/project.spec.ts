import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import { WorkViewPage } from '../../pages/work-view.page';

test.describe('Project', () => {
  let projectPage: ProjectPage;
  let workViewPage: WorkViewPage;

  test.beforeEach(async ({ page, testPrefix }) => {
    projectPage = new ProjectPage(page, testPrefix);
    workViewPage = new WorkViewPage(page, testPrefix);

    // Wait for app to be ready
    await workViewPage.waitForTaskList();
  });

  test('move done tasks to archive without error', async ({ page }) => {
    // First navigate to Inbox project (not Today view) since archive button only shows in project views
    const inboxMenuItem = page.locator('magic-side-nav button:has-text("Inbox")');
    await inboxMenuItem.click();

    // Add tasks using the page object method
    await workViewPage.addTask('Test task 1', true); // skipClose=true to keep input open
    await workViewPage.addTask('Test task 2');

    // Mark first task as done
    const firstTask = page.locator('task').first();
    await firstTask.hover();
    const doneBtn = firstTask.locator('done-toggle');
    await doneBtn.waitFor({ state: 'visible' });
    await doneBtn.click();

    // Archive button should be visible in the done tasks section
    const archiveBtn = page.locator('.e2e-move-done-to-archive');
    await archiveBtn.waitFor({ state: 'visible' });
    await archiveBtn.click();

    // Verify one task remains and no error
    const tasks = page.locator('task');
    await expect(tasks).toHaveCount(1);
    await expect(projectPage.globalErrorAlert).not.toBeVisible();
  });

  test('navigate to project settings', async ({ page, settingsPage }) => {
    // Navigate to Inbox project
    const inboxMenuItem = page.locator('magic-side-nav button:has-text("Inbox")');
    await inboxMenuItem.click();
    // Let the (lazy) project route commit first. Settings is a dialog route whose guard
    // cancels its own navigation, so a click that supersedes a still-pending project
    // navigation leaves the URL on the previous page (a race on the unbundled dev server).
    await expect(page).toHaveURL(/INBOX_PROJECT/);

    // Open settings via the Settings nav item
    const settingsMenuItem = page
      .locator('magic-side-nav a[href="#/config"]')
      .or(page.locator('magic-side-nav a.tour-settingsMenuBtn'))
      .first();
    await settingsMenuItem.click();

    // Settings is a window over the project, not a page with project tabs: it
    // has no "Project" tab to pick, and the project stays behind it.
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('.page-settings')).toBeVisible();
    await expect(page.locator('.settings-categories button').first()).toBeVisible();
    await settingsPage.closeSettings();
    await expect(page).toHaveURL(/INBOX_PROJECT/);
  });
});
