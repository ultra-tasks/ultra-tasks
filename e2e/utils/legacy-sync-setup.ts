import { expect, type Page } from '@playwright/test';
import { openSyncSetup } from './open-sync-setup';

/**
 * Restore a saved, disabled legacy connection through the existing persistent
 * config action. Retired providers are deliberately absent from fresh setup;
 * provider regression suites exercise the returning-connection path instead.
 * The app captures the action normally, preserving tasks and operation history.
 */
export const restoreSavedSuperSyncConnection = async (page: Page): Promise<boolean> => {
  const result = await page.evaluate(async () => {
    type State = {
      globalConfig: { sync: { syncProvider: string | null; isEnabled: boolean } };
    };
    type Store = {
      subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
      dispatch: (action: unknown) => void;
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store: Store } })
      .__e2eTestHelpers?.store;
    if (!store) return null; // Released clients retain the original provider picker.
    let sync!: State['globalConfig']['sync'];
    store.subscribe((state) => (sync = state.globalConfig.sync)).unsubscribe();
    if (sync.syncProvider === 'SuperSync') return null;
    if (sync.isEnabled) throw new Error('Disconnect the current sync provider first.');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const previousSeq = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('ops').objectStore('ops').openCursor(null, 'prev');
      request.onsuccess = () => resolve(Number(request.result?.key ?? 0));
      request.onerror = () => reject(request.error);
    });
    db.close();
    store.dispatch({
      type: '[Global Config] Update Global Config Section',
      sectionKey: 'sync',
      sectionCfg: { syncProvider: 'SuperSync', isEnabled: false },
      isSkipSnack: true,
      meta: {
        isPersistent: true,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'sync',
        opType: 'UPD',
      },
    });
    return { previousSeq };
  });
  if (!result) return false;
  await expect
    .poll(
      () =>
        page.evaluate(async (previousSeq) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('SUP_OPS');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<boolean>((resolve, reject) => {
              const request = db
                .transaction('ops')
                .objectStore('ops')
                .openCursor(IDBKeyRange.lowerBound(previousSeq, true));
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return resolve(false);
                const op = cursor.value.op;
                const rawPayload = op.p ?? op.payload;
                const payload = rawPayload?.actionPayload ?? rawPayload;
                if (
                  (op.e ?? op.entityType) === 'GLOBAL_CONFIG' &&
                  payload?.sectionKey === 'sync' &&
                  payload?.sectionCfg?.syncProvider === 'SuperSync' &&
                  payload?.sectionCfg?.isEnabled === false
                )
                  return resolve(true);
                cursor.continue();
              };
              request.onerror = () => reject(request.error);
            });
          } finally {
            db.close();
          }
        }, result.previousSeq),
      { timeout: 10000 },
    )
    .toBe(true);
  return true;
};

/** Follow the production disconnect/save/reopen flow before changing providers. */
export const disconnectBeforeProviderSwitch = async (
  page: Page,
  target: 'SuperSync' | 'WebDAV',
): Promise<void> => {
  const dialog = page.locator('dialog-sync-cfg');
  const picker = dialog.locator('mat-select').first();
  const selected = picker.locator('.mat-mdc-select-value-text, .mat-select-value-text');
  if ((await selected.innerText()).includes(target)) return;
  const enabled = dialog.getByRole('checkbox', { name: /^Enable syncing$/i });
  if (!(await enabled.count()) || !(await enabled.isChecked())) return;
  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  // Sync is now off, so the header button is gone: reopen from the command bar.
  await openSyncSetup(page);
  await expect(picker).toBeVisible();
};
