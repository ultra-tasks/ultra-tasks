import { expect, test } from '../../fixtures/test.fixture';

test('offers a skippable setup once and keeps the chosen appearance', async ({
  isolatedContext,
}) => {
  const page = await isolatedContext.newPage();
  await page.goto('/');
  const setup = page.locator('first-run-setup');
  await expect(setup).toBeVisible();
  await setup.locator('select').selectOption('dark');
  await expect(page.locator('body')).toHaveClass(/isDarkTheme/);
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.locator('onboarding-hint')).toContainText('to add your first task');
  await page.reload();
  await expect(page.locator('work-view')).toBeAttached();
  await expect(setup).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/isDarkTheme/);
});

test('Continue has the initial focus and the example task waits for the choice', async ({
  isolatedContext,
}) => {
  const page = await isolatedContext.newPage();
  await page.goto('/');
  const setup = page.locator('first-run-setup');
  await expect(setup).toBeVisible();
  // Enter on opening continues; it never skips.
  await expect(setup.getByRole('button', { name: 'Continue' })).toBeFocused();
  // "Start fresh" is offered over an empty workspace: nothing is seeded yet.
  const inboxRow = page.locator('nav-item').filter({ hasText: 'Inbox' }).first();
  await expect(inboxRow).not.toContainText(/\d/);
  await page.keyboard.press('Enter');
  await expect(setup).toHaveCount(0);
  await expect(inboxRow).toContainText('1');
});

test('restore opens the existing import settings without replacing data', async ({
  isolatedContext,
}) => {
  const page = await isolatedContext.newPage();
  await page.goto('/');
  const setup = page.locator('first-run-setup');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Restore backup' }).click();
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('file-imex')).toBeVisible();
  await expect(page.locator('file-imex input[type="file"]')).toHaveValue('');

  // Someone bringing their own data gets no example task, now or later.
  await page.goto('/#/project/INBOX_PROJECT/tasks');
  await expect(page.locator('work-view')).toBeAttached();
  await expect(page.locator('task')).toHaveCount(0);
});
