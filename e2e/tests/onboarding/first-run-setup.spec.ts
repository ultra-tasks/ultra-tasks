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
});
