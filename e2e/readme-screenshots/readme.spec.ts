import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test as screenshotTest } from '../store-screenshots/fixture';
import { applyTheme, gotoAndSettle } from '../store-screenshots/helpers';
import { selectProjectView } from '../utils/project-view';
import { ImportPage } from '../pages/import.page';

const outputDir = path.resolve(__dirname, '../../docs/brand/screenshots');

// Reuse the real backup-import flow, with everyday examples and project sections.
// Changes here affect only the disposable screenshot dataset.
const test = screenshotTest.extend({
  seedFile: async ({ seedFile }, use) => {
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')) as {
      data: {
        task: { entities: Record<string, { title: string }> };
        section?: unknown;
      };
    };
    const titles: [string, string][] = [
      ['t-pr-review', 'Make space for the important work'],
      ['t-design-review', 'Design review with Carla'],
      ['t-release-handoff', 'Send the project proposal'],
      ['t-quarterly-plan', 'Draft the next project outline'],
      ['t-quarterly-plan-sub-1', 'Gather ideas and references'],
      ['t-quarterly-plan-sub-2', 'Sketch the first milestones'],
      ['t-release-notes', 'Write a short project update'],
    ];
    for (const [id, title] of titles) {
      seed.data.task.entities[id].title = title;
    }
    const sections = [
      {
        id: 'readme-this-week',
        title: 'This week',
        taskIds: ['t-design-review', 't-pr-review'],
      },
      { id: 'readme-next', title: 'Up next', taskIds: ['t-release-handoff'] },
      { id: 'readme-ideas', title: 'Ideas', taskIds: ['t-quarterly-plan'] },
    ].map((section) => ({
      ...section,
      contextId: 'work',
      contextType: 'PROJECT',
      isExpanded: true,
    }));
    seed.data.section = {
      ids: sections.map((section) => section.id),
      entities: Object.fromEntries(sections.map((section) => [section.id, section])),
    };
    const readmeSeed = path.join(path.dirname(seedFile), 'readme.json');
    fs.writeFileSync(readmeSeed, JSON.stringify(seed));
    await use(readmeSeed);
  },
  seededPage: async ({ page, seedFile }, use) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/config', { waitUntil: 'domcontentloaded' });
    await page
      .locator('config-page .settings-categories')
      .getByRole('button', { name: 'Import & export', exact: true })
      .click();
    await new ImportPage(page).importBackupFile(seedFile);
    await use(page);
  },
});

const capture = async (page: Page, name: string): Promise<void> => {
  await page.mouse.move(0, 0);
  // Let real startup/import notifications expire, including the disposable
  // browser context's persistent-storage notice. Do not hide app UI for a shot.
  await page.clock.runFor(4_000);
  await expect(page.locator('mat-snack-bar-container')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
};

const captureSocialPreview = async (page: Page): Promise<void> => {
  const logo = fs
    .readFileSync(path.resolve(__dirname, '../../src/assets/ultra-tasks/logo.svg'))
    .toString('base64');
  const shot = fs
    .readFileSync(path.join(outputDir, 'today-light.png'))
    .toString('base64');
  const preview = await page.context().newPage();
  try {
    await preview.setViewportSize({ width: 1280, height: 640 });
    await preview.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #f3f7f5; color: #153b3a;
          font-family: Arial, sans-serif; overflow: hidden; }
        main { padding: 56px; }
        .brand { display: flex; align-items: center; gap: 14px;
          font-size: 27px; font-weight: 700; }
        .brand img { width: 48px; height: 48px; }
        h1 { font-size: 54px; line-height: 1.08; letter-spacing: -2px;
          margin: 65px 0 24px; max-width: 490px; }
        h1 span { color: #075b5e; }
        p { font-size: 22px; line-height: 1.5; max-width: 405px; }
        footer { margin-top: 42px; color: #075b5e; font-size: 19px; }
        .app { position: absolute; left: 565px; top: 155px; width: 900px;
          border: 1px solid #d4e2de; border-radius: 16px;
          box-shadow: 0 26px 65px #153b3a24; }
      </style></head><body><main>
        <div class="brand"><img src="data:image/svg+xml;base64,${logo}" alt="">Ultra Tasks</div>
        <h1>A clearer day.<br><span>A little more you.</span></h1>
        <p>Tasks, planning and time tracking.<br>Free, open source, and yours.</p>
        <footer>Windows · macOS · Linux &nbsp; | &nbsp; ultratasks.app</footer>
        <img class="app" src="data:image/png;base64,${shot}" alt="Ultra Tasks Today">
      </main></body></html>`);
    await preview.locator('.app').evaluate((img: HTMLImageElement) => img.decode());
    await preview.screenshot({ path: path.join(outputDir, '../social-preview.png') });
  } finally {
    await preview.close();
  }
};

test.use({ locale: 'en', theme: 'light' });

test('capture the README product tour', async ({ seededPage: page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(outputDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await expect(page.locator('task').first()).toBeVisible();
  await capture(page, 'today-light');
  await captureSocialPreview(page);

  await applyTheme(page, 'dark');
  await capture(page, 'today-dark');

  await applyTheme(page, 'light');
  await gotoAndSettle(page, '/#/planner');
  await expect(page.locator('planner')).toBeVisible();
  await capture(page, 'upcoming');

  await gotoAndSettle(page, '/#/project/work/tasks');
  await selectProjectView(page, 'Board');
  await expect(page.locator('section-board')).toBeVisible();
  await expect(
    page.locator('section-board').getByText('This week', { exact: true }),
  ).toBeVisible();
  await capture(page, 'project-board');

  await applyTheme(page, 'dark');
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  const task = page
    .locator('task')
    .filter({ hasText: 'Make space for the important work' });
  await task.hover();
  await task.locator('.start-task-btn').click();
  await page.locator('.focus-btn-wrapper button').first().click();
  await page.locator('focus-mode-main .play-button').click();
  await page.clock.runFor(6500);
  await expect(page.locator('focus-mode-task-tracking')).toBeVisible();
  await page.clock.runFor(60_000);
  await capture(page, 'focus');
});
