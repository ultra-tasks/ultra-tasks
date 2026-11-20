import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import {
  archiveDoneTasks,
  closeClient,
  createSimulatedClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ProjectPage } from '../../pages/project.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';

/**
 * Shared steps for the first-sync acceptance specs. They run against the frozen
 * provider-migration harness (`npm run ultra-provider:harness`, port 4244) that serves
 * this web build and 83 synthetic accounts (`<name>@example.test`).
 *
 * All account-page selectors live here, in ONE place, and prefer roles and `name`
 * attributes so a restyle of the account page only needs this file.
 */
export const ACCOUNT_PASSWORD = 'test password for encrypted accounts';

export const ultraUrl = (): string => {
  const url = process.env.E2E_ULTRA_URL;
  if (!url) {
    throw new Error(
      'E2E_ULTRA_URL is required: start the provider-migration harness and set it ' +
        '(and E2E_BASE_URL) to its origin, for example http://127.0.0.1:4244',
    );
  }
  return url;
};

/**
 * Accounts are never deleted while the harness runs, so each test takes its own name
 * from the pool `first1..first24`. `E2E_FIRST_BASE` moves the window between runs.
 */
export const firstAccount = (index: number): string => {
  // `E2E_FIRST_ACCOUNTS=first8,first9,...` names unused accounts explicitly.
  const named = process.env.E2E_FIRST_ACCOUNTS?.split(',').map((name) => name.trim());
  return named?.[index] ?? `first${Number(process.env.E2E_FIRST_BASE ?? 1) + index}`;
};

export type DeviceKind = 'established' | 'first-run';

/** One browser context = one device with its own storage, as on a second phone or PC. */
export const newDevice = async (
  browser: Browser,
  name: string,
  kind: DeviceKind = 'established',
): Promise<SimulatedE2EClient> =>
  createSimulatedClient(browser, ultraUrl(), name, `${Date.now()}`, {
    // A real install has no onboarding flags yet: the welcome shows and the example task follows.
    allowExampleTasks: kind === 'first-run',
    allowOnboardingHints: kind === 'first-run',
    isNewInstallAppFeatures: kind === 'first-run',
  });

/** Serve another build's static assets while keeping this device on the same account API. */
export const useAccountAppBundle = async (
  page: Page,
  directory: string,
): Promise<() => Promise<void>> => {
  const origin = new URL(ultraUrl()).origin;
  const root = resolve(directory);
  const serveAsset = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/'))
      return route.fallback();
    const file = resolve(root, url.pathname === '/' ? 'index.html' : `.${url.pathname}`);
    const childPath = relative(root, file);
    if (isAbsolute(childPath) || childPath === '..' || childPath.startsWith(`..${sep}`))
      return route.fallback();
    const asset = await stat(file).catch(() => null);
    if (!asset?.isFile()) return route.fallback();
    await route.fulfill({ path: file });
  };
  const context = page.context();
  await context.route('**/*', serveAsset);
  return () => context.unroute('**/*', serveAsset);
};

export const closeDevices = async (...devices: SimulatedE2EClient[]): Promise<void> => {
  for (const device of devices) await closeClient(device);
};

/** Dismisses the first-run welcome the way the iPhone user did: Continue with the default. */
export const dismissFirstRunSetup = async (page: Page): Promise<void> => {
  const setup = page.locator('first-run-setup');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Continue' }).click();
  await expect(setup).toHaveCount(0);
};

export interface SeededTitles {
  task: string;
  subTask: string;
  done: string;
  archived: string;
  project: string;
  projectTask: string;
  note: string;
}

export const seedTitles = (stamp: string): SeededTitles => ({
  task: `Parent ${stamp}`,
  subTask: `Child ${stamp}`,
  done: `Finished ${stamp}`,
  archived: `Archived ${stamp}`,
  project: `Project ${stamp}`,
  projectTask: `Project task ${stamp}`,
  note: `Note ${stamp}`,
});

const markDone = async (page: Page, title: string): Promise<void> => {
  const task = page.locator(`task:not(.ng-animating):has-text("${title}")`).first();
  await task.waitFor({ state: 'visible' });
  await task.focus();
  await task.press('d');
  await expect(task).toHaveClass(/isDone/);
};

/**
 * Real, varied work on one device: a task with a subtask, finished and archived work,
 * a project with its own task, and a note, all created through the UI.
 */
export const seedRealData = async (
  device: SimulatedE2EClient,
  titles: SeededTitles,
): Promise<void> => {
  const { page } = device;
  // No title prefix: what is typed is what the other device must read back.
  const workView = new WorkViewPage(page);
  await page.goto('/#/tag/TODAY/tasks');
  await workView.waitForTaskList();

  await workView.addTask(titles.archived);
  await waitForTask(page, titles.archived);
  await markDone(page, titles.archived);
  await archiveDoneTasks(device);

  await page.goto('/#/tag/TODAY/tasks');
  await workView.waitForTaskList();
  await workView.addTask(titles.task);
  await waitForTask(page, titles.task);
  await workView.addSubTask(
    page.locator(`task:not(.ng-animating):has-text("${titles.task}")`).first(),
    titles.subTask,
  );
  await workView.addTask(titles.done);
  await waitForTask(page, titles.done);
  await markDone(page, titles.done);

  const projects = new ProjectPage(page);
  await projects.createProject(titles.project);
  await projects.navigateToProjectByName(titles.project);
  await workView.addTask(titles.projectTask);
  await waitForTask(page, titles.projectTask);
  await projects.addNote(titles.note);
  await waitForStatePersistence(page);
};

/** One real task: enough local data that automatic replacement would be a data-loss bug. */
export const addLocalTask = async (
  device: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  const workView = new WorkViewPage(device.page);
  await device.page.goto('/#/tag/TODAY/tasks');
  await workView.waitForTaskList();
  await workView.addTask(title);
  await waitForTask(device.page, title);
  await waitForStatePersistence(device.page);
};

export interface DeviceContent {
  tasks: { id: string; title: string; parentId: string | null; isDone: boolean }[];
  projects: string[];
  notes: string[];
}

/** Reads the live store, so the check does not depend on which view happens to be open. */
export const readContent = (page: Page): Promise<DeviceContent> =>
  page.evaluate(() => {
    type Entities<T> = { ids: string[]; entities: Record<string, T> };
    type State = {
      tasks: Entities<{ id: string; title: string; parentId?: string; isDone: boolean }>;
      projects: Entities<{ id: string; title: string }>;
      note: Entities<{ content: string }>;
    };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers.store;
    let state!: State;
    store
      .subscribe((value) => {
        state = value;
      })
      .unsubscribe();
    return {
      tasks: state.tasks.ids.map((id) => ({
        id,
        title: state.tasks.entities[id].title,
        parentId: state.tasks.entities[id].parentId || null,
        isDone: state.tasks.entities[id].isDone,
      })),
      projects: state.projects.ids.map((id) => state.projects.entities[id].title),
      notes: state.note.ids.map((id) => state.note.entities[id].content),
    };
  });

export const taskTitles = async (page: Page): Promise<string[]> =>
  (await readContent(page)).tasks.map((task) => task.title);

/** The archived task is only reachable through the worklog, as for a user. */
export const expectArchivedInWorklog = async (
  page: Page,
  title: string,
): Promise<void> => {
  await page.goto('/#/tag/TODAY/history');
  await expect
    .poll(
      async () => {
        for (const row of await page.locator('.week-row').all()) {
          await row.click({ timeout: 1000 }).catch(() => undefined);
        }
        return (await page.locator('body').innerText()).includes(title);
      },
      { message: `the archive should still hold "${title}"`, timeout: 30000 },
    )
    .toBe(true);
};

/** Everything `seedRealData` created is present, in the right shape. */
export const expectSeededContent = async (
  page: Page,
  titles: SeededTitles,
): Promise<void> => {
  await expect
    .poll(async () => (await readContent(page)).tasks.map((task) => task.title), {
      message: 'tasks from the account should be applied',
      timeout: 60000,
    })
    .toEqual(
      expect.arrayContaining([
        titles.task,
        titles.subTask,
        titles.done,
        titles.projectTask,
      ]),
    );
  const content = await readContent(page);
  const parent = content.tasks.find((task) => task.title === titles.task);
  const child = content.tasks.find((task) => task.title === titles.subTask);
  expect(child?.parentId).toBe(parent?.id);
  expect(content.tasks.find((task) => task.title === titles.done)?.isDone).toBe(true);
  expect(content.projects).toContain(titles.project);
  expect(content.notes.some((note) => note.includes(titles.note))).toBe(true);
};

/** Fills the account page sign-in. Only roles and field names: restyles must not break it. */
export const signIn = async (page: Page, account: string): Promise<void> => {
  await page.goto('/#/native-sync');
  const card = page.locator('native-sync');
  await expect(card).toBeVisible();
  const custom = card.getByRole('radio', { name: 'Custom server', exact: true });
  if (await custom.count()) await custom.check();
  const server = card.locator('input[name="server"]');
  if (await server.count()) await server.fill(ultraUrl());
  await card
    .locator('input[name="identifier"], input[name="email"]')
    .first()
    .fill(account);
  await card.locator('input[name="password"]').fill(ACCOUNT_PASSWORD);
  await card.locator('button[type="submit"]').first().click();
};

/** What a person sees a few seconds after signing in. */
export type FirstSyncOutcome =
  | 'tasks'
  | 'choice-dialog'
  | 'manual-source-choice'
  | 'error'
  | 'pending';

export const dataChoiceDialog = (page: Page): Locator =>
  page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: 'Download account data' }) });

export const replaceAccountData = async (page: Page): Promise<void> => {
  const dialog = dataChoiceDialog(page);
  const finish = page.locator('native-sync').getByRole('button', {
    name: 'Finish connecting',
    exact: true,
  });
  // The account page can still show its resume button while the choice dialog is open.
  await expect
    .poll(async () => (await dialog.isVisible()) || (await finish.isVisible()), {
      timeout: 30000,
    })
    .toBe(true);
  if (!(await dialog.isVisible())) await finish.click();
  await dialog
    .getByRole('button', { name: 'Replace account data with this device', exact: true })
    .click();
  await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
};

/** Classifies the screen so a failure names what the person is stuck on. */
export const firstSyncOutcome = async (
  page: Page,
  expectedTitle: string,
): Promise<FirstSyncOutcome> => {
  if (await page.locator('task').filter({ hasText: expectedTitle }).count())
    return 'tasks';
  if (await dataChoiceDialog(page).count()) return 'choice-dialog';
  if (
    await page
      .getByRole('button', {
        name: /Use the account.s existing data|Import this device.s data/,
      })
      .count()
  )
    return 'manual-source-choice';
  if (await page.locator('native-sync [role=alert]').count()) return 'error';
  return 'pending';
};

/** Device A: real data, signed in to a still-empty account (the first device migrates). */
export const connectFirstDevice = async (
  device: SimulatedE2EClient,
  account: string,
): Promise<void> => {
  await signIn(device.page, account);
  // Connected means: the account page offers an enabled "Sync now", or the first connection
  // finished and the app already moved on to the task workspace. The page leaves on its own
  // once the first sync ends, so waiting only for the button is a race.
  await expect
    .poll(
      async () => {
        if (!/native-sync/.test(device.page.url())) return 'workspace';
        const syncNow = device.page.getByRole('button', {
          name: 'Sync now',
          exact: true,
        });
        return (await syncNow.count()) && (await syncNow.isEnabled())
          ? 'account'
          : 'pending';
      },
      { timeout: 90000, message: 'the first device never finished connecting' },
    )
    .not.toBe('pending');
  await expect(device.page.locator('native-sync [role=alert]')).toHaveCount(0);
};

export const accountPage = (page: Page): Locator => page.locator('native-sync');

/** What the engine reports to every status surface (read through the mounted account page). */
export interface EngineView {
  phase: string;
  unlocked: boolean;
  linked: boolean;
  offline: boolean;
  error: string;
  pendingChanges: number;
  lastSyncedAt: number | null;
  emptyAccount: boolean;
  dataChoice: null | { deferred: boolean };
  connection: string;
}

type EngineSeam = Record<string, () => unknown>;

/**
 * Reads the engine state through the development-only seam `NativeSyncService` publishes
 * as `window.__e2eNativeSync` (stripped from production builds, like `__e2eTestHelpers`).
 * It checks the contract the status surfaces consume (`phase`, `dataChoice`, ...) without
 * depending on how a surface words it, so it works on any route.
 */
export const engineView = (page: Page): Promise<EngineView> =>
  page.evaluate(() => {
    const native = (window as unknown as { __e2eNativeSync?: EngineSeam })
      .__e2eNativeSync;
    if (!native) throw new Error('The development-only engine seam is not published');
    const choice = native['dataChoice']() as null | { deferred: boolean };
    return {
      phase: native['phase']() as string,
      unlocked: native['unlocked']() as boolean,
      linked: native['linked']() as boolean,
      offline: native['offline']() as boolean,
      error: native['error']() as string,
      pendingChanges: native['pendingChanges']() as number,
      lastSyncedAt: native['lastSyncedAt']() as number | null,
      emptyAccount: native['emptyAccount']() as boolean,
      dataChoice: choice ? { deferred: choice.deferred } : null,
      connection: (native['connection']?.() as string | undefined) ?? '',
    };
  });

/** Runs a public engine method, as a status surface's action button would. */
export const engineCall = (page: Page, method: string): Promise<void> =>
  page.evaluate(async (name) => {
    const native = (
      window as unknown as { __e2eNativeSync?: Record<string, () => Promise<void>> }
    ).__e2eNativeSync;
    if (!native) throw new Error('The development-only engine seam is not published');
    await native[name]();
  }, method);

export const tasksVisible = (page: Page, title: string): Locator =>
  page.locator('task').filter({ hasText: title });
