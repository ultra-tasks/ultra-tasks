import { expect, test, type Page } from '@playwright/test';
import {
  addLocalTask,
  closeDevices,
  connectFirstDevice,
  dataChoiceDialog,
  engineCall,
  engineView,
  expectSeededContent,
  firstAccount,
  newDevice,
  seedRealData,
  seedTitles,
  signIn,
  taskTitles,
} from './native-account-helpers';
import { readRecoveryRing } from '../../utils/recovery-ring-helpers';

/**
 * Both sides hold real data: the choice is never made silently. A focused dialog appears
 * right after sign-in, replacement needs a second, explicit confirmation (the shared
 * destructive confirmation dialog), and closing the dialog leaves the connection visibly
 * unfinished instead of completing onboarding.
 *
 *   E2E_BASE_URL=http://127.0.0.1:4244 E2E_ULTRA_URL=http://127.0.0.1:4244 E2E_WORKERS=1 \
 *   npm run quiet -- e2e:file e2e/tests/native-sync/first-sync-both-populated.spec.ts \
 *     --project=chromium --retries=0
 */
const chooseDownload = async (page: Page): Promise<void> => {
  const dialog = dataChoiceDialog(page);
  // The established flow had no dialog: its stand-in is the account page button.
  const established = page.getByRole('button', {
    name: /Use the account.s existing data/,
  });
  await expect(dialog.or(established).first()).toBeVisible({ timeout: 90000 });
  // The page may show its own card for a moment before the dialog covers it: the dialog wins.
  if (!(await dialog.isVisible()))
    await dialog.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Download account data' }).click();
    return;
  }
  await established.click();
};

test.describe('@ultra first sync with data on both sides', () => {
  test.describe.configure({ timeout: 360000 });

  test('asks immediately and downloads the account data on request, keeping a recovery copy', async ({
    browser,
  }) => {
    const account = firstAccount(1);
    const titles = seedTitles(`${Date.now()}`);
    const desktop = await newDevice(browser, 'Desktop');
    const other = await newDevice(browser, 'Other');
    const localTitle = `Local only ${Date.now()}`;
    try {
      await seedRealData(desktop, titles);
      await connectFirstDevice(desktop, account);
      await addLocalTask(other, localTitle);

      await signIn(other.page, account);

      const dialog = dataChoiceDialog(other.page);
      await expect(dialog, 'a choice dialog right after sign-in').toBeVisible({
        timeout: 90000,
      });
      await expect(
        dialog.getByRole('button', { name: 'Download account data' }),
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', { name: 'Replace account data with this device' }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Decide later' })).toBeVisible();
      // It is a real modal dialog: focus starts on it (never on a button, so Enter cannot pick
      // a side) and keyboard focus cannot leave it.
      await expect(dialog).toBeFocused();
      await other.page.keyboard.press('Tab');
      await other.page.keyboard.press('Tab');
      await other.page.keyboard.press('Tab');
      await other.page.keyboard.press('Tab');
      expect(
        await other.page.evaluate(
          () => !!document.activeElement?.closest('[role="dialog"]'),
        ),
      ).toBe(true);
      // Nothing is replaced until a button is pressed.
      expect(await taskTitles(other.page)).toContain(localTitle);
      expect(await taskTitles(other.page)).not.toContain(titles.task);

      await dialog.getByRole('button', { name: 'Download account data' }).click();

      await expectSeededContent(other.page, titles);
      expect(await taskTitles(other.page)).not.toContain(localTitle);
      await expect(dataChoiceDialog(other.page)).toHaveCount(0);
      // This device's own tasks are kept as a recovery copy on this device.
      const ring = await readRecoveryRing(other.page);
      expect(
        ring.some((entry) => entry.reason === 'REMOTE_IMPORT' && entry.taskCount >= 1),
        JSON.stringify(ring),
      ).toBe(true);
    } finally {
      await closeDevices(desktop, other);
    }
  });

  test('replaces the account with this device only after an explicit confirmation, and the other device converges', async ({
    browser,
  }) => {
    const account = firstAccount(2);
    const titles = seedTitles(`${Date.now()}`);
    const desktop = await newDevice(browser, 'Desktop');
    const other = await newDevice(browser, 'Other');
    const localTitle = `Replacement ${Date.now()}`;
    try {
      await seedRealData(desktop, titles);
      await connectFirstDevice(desktop, account);
      await addLocalTask(other, localTitle);

      await signIn(other.page, account);
      const dialog = dataChoiceDialog(other.page);
      await expect(dialog).toBeVisible({ timeout: 90000 });

      await dialog
        .getByRole('button', { name: 'Replace account data with this device' })
        .click();
      // A second, plain-language step; it never reads as a merge, says what each side holds,
      // and is honest that the recovery copy covers THIS device only.
      const confirm = other.page.locator('dialog-confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText(/every device/i);
      await expect(confirm).toContainText(/recovery copy of this device/i);
      await expect(confirm).toContainText(/In your account: Tasks: \d+/);
      await expect(confirm).toContainText(/On this device: Tasks: \d+/);
      await expect(confirm).not.toContainText(/merge/i);
      // Focus starts on the safe button: Enter on a freshly opened confirmation replaces nothing.
      await expect(
        confirm.getByRole('button', { name: 'Back', exact: true }),
      ).toBeFocused();

      // Going back changes nothing and returns to the choice.
      await confirm.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(dataChoiceDialog(other.page)).toBeVisible();
      expect(await taskTitles(other.page)).not.toContain(titles.task);
      await dataChoiceDialog(other.page)
        .getByRole('button', { name: 'Replace account data with this device' })
        .click();
      await other.page.locator('dialog-confirm button[e2e="confirmBtn"]').click();

      await expect(dataChoiceDialog(other.page)).toHaveCount(0, { timeout: 90000 });
      // The device already holds its own task, so judge the switch by the engine finishing it.
      await expect
        .poll(() => engineView(other.page).then((view) => view.phase), { timeout: 90000 })
        .toBe('synced');
      expect((await engineView(other.page)).lastSyncedAt).not.toBeNull();
      expect(await taskTitles(other.page)).toContain(localTitle);
      const ring = await readRecoveryRing(other.page);
      expect(
        ring.some((entry) => entry.reason === 'LOCAL_IMPORT'),
        JSON.stringify(ring),
      ).toBe(true);

      // The first device downloads the replacement by itself.
      const sync = desktop.page.getByRole('button', { name: 'Sync now', exact: true });
      if (await sync.isEnabled().catch(() => false)) await sync.click();
      await expect
        .poll(() => taskTitles(desktop.page), { timeout: 120000 })
        .toContain(localTitle);
      expect(await taskTitles(desktop.page)).not.toContain(titles.task);
    } finally {
      await closeDevices(desktop, other);
    }
  });

  test('"Decide later" leaves the connection unfinished and resuming completes it', async ({
    browser,
  }) => {
    const account = firstAccount(3);
    const titles = seedTitles(`${Date.now()}`);
    const desktop = await newDevice(browser, 'Desktop');
    const other = await newDevice(browser, 'Other');
    const localTitle = `Not decided ${Date.now()}`;
    try {
      await seedRealData(desktop, titles);
      await connectFirstDevice(desktop, account);
      await addLocalTask(other, localTitle);

      await signIn(other.page, account);
      const dialog = dataChoiceDialog(other.page);
      await expect(dialog).toBeVisible({ timeout: 90000 });
      await dialog.getByRole('button', { name: 'Decide later' }).click();
      await expect(dataChoiceDialog(other.page)).toHaveCount(0);

      // Nothing changed, nothing claims success, and the unfinished state stays visible.
      expect(await taskTitles(other.page)).toContain(localTitle);
      expect(await taskTitles(other.page)).not.toContain(titles.task);
      await expect
        .poll(() => engineView(other.page).then((view) => view.phase))
        .toBe('choose-data');
      const view = await engineView(other.page);
      expect(view.dataChoice?.deferred).toBe(true);
      expect(view.lastSyncedAt).toBeNull();
      await expect(other.page.locator('native-sync')).not.toContainText(
        /Up to date|Sync complete/,
      );

      // "Finish connecting" brings the same choice back.
      await engineCall(other.page, 'resumeDataConnection');
      await expect(dataChoiceDialog(other.page)).toBeVisible();
      await dataChoiceDialog(other.page)
        .getByRole('button', { name: 'Download account data' })
        .click();
      await expectSeededContent(other.page, titles);
    } finally {
      await closeDevices(desktop, other);
    }
  });

  test('refuses to replace this device when it changed while the choice was applied', async ({
    browser,
  }) => {
    const account = firstAccount(4);
    const titles = seedTitles(`${Date.now()}`);
    const desktop = await newDevice(browser, 'Desktop');
    const other = await newDevice(browser, 'Other');
    const localTitle = `Before choosing ${Date.now()}`;
    const lateTitle = `While switching ${Date.now()}`;
    try {
      await seedRealData(desktop, titles);
      await connectFirstDevice(desktop, account);
      await addLocalTask(other, localTitle);

      await signIn(other.page, account);
      await expect
        .poll(
          async () =>
            (await dataChoiceDialog(other.page).count()) ||
            (await other.page
              .getByRole('button', { name: /Use the account.s existing data/ })
              .count()),
          { timeout: 90000 },
        )
        .toBeGreaterThan(0);

      // Hold the account's changes so the switch is still running while the person edits.
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await other.page.route(
        '**/api/v2/accounts/sync/scopes/*/changes*',
        async (route) => {
          await held;
          await route.continue();
        },
      );
      await chooseDownload(other.page);
      await addLocalTask(other, lateTitle);
      release();

      // The person is told, in words, that nothing was replaced. The account page shows the
      // engine's last error, so open it (a choice dialog would already be on top of any page).
      await other.page.goto('/#/native-sync');
      await expect(
        other.page
          .locator('[role=alert], [role=dialog]')
          .filter({ hasText: /changed while/i })
          .first(),
      ).toBeVisible({ timeout: 60000 });
      // The change made meanwhile is never overwritten: it is still here, the account is not applied.
      expect(await taskTitles(other.page)).toEqual(
        expect.arrayContaining([localTitle, lateTitle]),
      );
      expect(await taskTitles(other.page)).not.toContain(titles.task);
    } finally {
      await closeDevices(desktop, other);
    }
  });
});
