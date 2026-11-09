import { expect, test } from '../../fixtures/test.fixture';
import { createHeaderCounters } from '../../utils/header-counters';
import { waitForAppReady } from '../../utils/waits';

test('reorders counters after the habit view finishes opening', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  await createHeaderCounters(page, ['First counter', 'Second counter', 'Third counter']);
  await page.goto('/#/habits');
  await waitForAppReady(page, { routeRegex: /#\/habits/, selector: '.habit-grid' });
  await expect(page.locator('.ng-animating')).toHaveCount(0);

  const rows = page.locator('.habit-row');
  await expect(rows).toHaveCount(3);
  const before = await rows.locator('.habit-name').allTextContents();
  const from = await rows.last().boundingBox();
  const to = await rows.first().boundingBox();
  if (!from || !to) throw new Error('Counter drag targets are missing');

  const halfHeight = from.height / 2;
  const centerY = from.y + halfHeight;
  await page.mouse.move(from.x + 30, centerY);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, centerY - 10, { steps: 3 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
  await page.mouse.move(to.x + 30, to.y + 5, { steps: 25 });
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toBeHidden();
  await expect
    .poll(() => rows.locator('.habit-name').allTextContents())
    .not.toEqual(before);
});

test('reenables a counter from the disabled list', async ({ page, workViewPage }) => {
  await workViewPage.waitForTaskList();
  await createHeaderCounters(page, ['Disabled counter witness']);
  await page.goto('/#/habits');
  await waitForAppReady(page, { routeRegex: /#\/habits/, selector: '.habit-grid' });
  await expect(page.locator('.ng-animating')).toHaveCount(0);
  await page
    .locator('.habit-row:visible')
    .getByRole('button', { name: 'Disabled counter witness', exact: true })
    .click();
  const dialog = page.locator('dialog-simple-counter-edit-settings');
  const enabled = dialog.getByRole('switch', { name: 'Enabled', exact: true });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(dialog).toBeHidden();

  await page.locator('.disabled-section-header').click();
  const disabled = page
    .locator('.disabled-item')
    .filter({ hasText: 'Disabled counter witness' });
  await disabled.getByRole('button', { name: 'Enabled', exact: true }).click();
  await expect(page.locator('.habit-row:visible .habit-name')).toHaveText(
    'Disabled counter witness',
  );
});
