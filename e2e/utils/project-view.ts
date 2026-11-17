import { expect, Page } from '@playwright/test';

// Below 600px (the phone breakpoint) the header has room for one button beside the
// title, so the project view lives in the single "Page options" menu instead of its
// own "Project view" button.
const PHONE_MAX_WIDTH = 599;

export const openProjectViewMenu = async (page: Page): Promise<void> => {
  const isPhone = (page.viewportSize()?.width ?? Infinity) <= PHONE_MAX_WIDTH;
  const button = isPhone
    ? page.getByRole('button', { name: /^Page options/ })
    : page.getByRole('button', { name: 'Project view', exact: true });
  const list = page.getByRole('menuitemradio', { name: 'List', exact: true });
  if (!(await list.isVisible())) await button.click();
  await expect(list).toBeVisible();
};

export const selectProjectView = async (
  page: Page,
  view: 'List' | 'Board' | 'Calendar' | 'Upcoming',
): Promise<void> => {
  await openProjectViewMenu(page);
  await page.getByRole('menuitemradio', { name: view, exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: view, exact: true })).toBeHidden();
};
