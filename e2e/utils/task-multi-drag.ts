import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { waitForMenuSettled } from './waits';

const BAR = 'task-multi-select-bar .bar';
export const selectDragTasks = async (page: Page, names: string[]): Promise<void> => {
  const bar = page.locator(BAR);
  if (await bar.isVisible())
    await bar.getByRole('button', { name: 'Clear selection' }).click();
  for (const name of names)
    await page
      .locator('task')
      .filter({ has: page.locator('task-title', { hasText: name }) })
      .first()
      .locator('.task-title')
      .first()
      .click({ modifiers: ['Control'] });
  await expect(bar).toContainText(names.length + ' selected');
};
export const startTaskDrag = async (page: Page, source: Locator): Promise<void> => {
  await expect(source).toBeVisible();
  await source.scrollIntoViewIfNeeded();
  await source.hover();
  const box = await source.boundingBox();
  if (!box) throw new Error('Missing drag source');
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  await page.mouse.move(box.x + halfWidth, box.y + halfHeight);
  await page.mouse.down();
  await page.mouse.move(box.x + halfWidth + 12, box.y + halfHeight + 12, { steps: 5 });
  await expect(page.locator('.cdk-drag-preview')).toBeVisible();
};
export const dropTaskDrag = async (
  page: Page,
  target: Locator,
  options: boolean | { atStart?: boolean; isCancelled?: boolean } = false,
): Promise<void> => {
  const atStart = typeof options === 'boolean' ? options : (options.atStart ?? false);
  const isCancelled = typeof options === 'object' && options.isCancelled === true;
  const inner = target.locator('.task-list-inner');
  const isListTarget = (await inner.count()) > 0;
  const dropTarget = isListTarget ? inner : target;
  const expectsPlaceholder =
    isListTarget && !isCancelled && (await page.locator('.cdk-drag-preview').count()) > 0;
  const moveToTarget = async (): Promise<void> => {
    const box = await dropTarget.boundingBox();
    if (!box) throw new Error('Missing drop target');
    const centerOffset = box.width / 2;
    await page.mouse.move(box.x + centerOffset, box.y + (atStart ? 3 : box.height / 2));
  };
  // Enter directly: passing through other lists can insert placeholders that
  // shift the intended target. Re-read its box until CDK confirms entry.
  if (expectsPlaceholder) {
    await expect
      .poll(
        async () => {
          await moveToTarget();
          return dropTarget.locator('.cdk-drag-placeholder').count();
        },
        { timeout: 5000 },
      )
      .toBe(1);
  } else {
    // Sidebar drops and pointer release after Escape have no list placeholder.
    await moveToTarget();
  }
  // Entering an empty list inserts a placeholder and can shift its geometry.
  const enteredBox = await dropTarget.boundingBox();
  const enteredHalfWidth = enteredBox ? enteredBox.width / 2 : 0;
  if (enteredBox)
    await page.mouse.move(
      enteredBox.x + enteredHalfWidth,
      enteredBox.y + (atStart ? 3 : enteredBox.height / 2),
      { steps: 5 },
    );
  if (expectsPlaceholder)
    await expect(dropTarget.locator('.cdk-drag-placeholder')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.cdk-drag-preview')).toHaveCount(0);
};
export const createDragSection = async (page: Page, name: string): Promise<void> => {
  await page.locator('.project-settings-btn').click();
  await waitForMenuSettled(page);
  await page.getByRole('menuitem', { name: 'Add Section' }).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.locator('input[type="text"]').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
};
