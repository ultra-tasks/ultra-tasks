import type { Page } from '@playwright/test';

/**
 * Structural state readers for tag delete and archive sync E2E regressions.
 *
 * They read entity facts (ids, tagIds, projectId, dueDay) straight from the
 * NgRx store or the IndexedDB archive. Only ids and structural fields are
 * returned; titles never leave the page here so nothing user-like is logged.
 */

/** Structural fields of a task, as stored in the live state or the archive. */
export interface AuditTaskFacts {
  id: string;
  projectId: string | null;
  tagIds: string[];
  parentId: string | null;
  subTaskIds: string[];
  dueDay: string | null;
  isDone: boolean;
}

type RawTask = {
  id: string;
  title?: string;
  projectId?: string | null;
  tagIds?: string[];
  parentId?: string | null;
  subTaskIds?: string[];
  dueDay?: string | null;
  isDone?: boolean;
};

/**
 * One archived task from this client's young archive (`SUP_OPS`/`archive_young`,
 * key `current`, `.data.task.entities[id]`), or null when it is not there.
 * Call it only after the app has booted (the DB is opened without a version).
 */
export const getArchiveYoungTask = async (
  page: Page,
  taskId: string,
): Promise<AuditTaskFacts | null> =>
  page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('archive_young')) {
        return null;
      }
      const archive = await new Promise<
        | {
            data?: {
              task?: {
                ids?: string[];
                entities?: Record<
                  string,
                  {
                    id: string;
                    projectId?: string | null;
                    tagIds?: string[];
                    parentId?: string | null;
                    subTaskIds?: string[];
                    dueDay?: string | null;
                    isDone?: boolean;
                  }
                >;
              };
            };
          }
        | undefined
      >((resolve, reject) => {
        const tx = db.transaction('archive_young', 'readonly');
        const request = tx.objectStore('archive_young').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const t = archive?.data?.task?.entities?.[id];
      if (!t) {
        return null;
      }
      return {
        id: t.id,
        projectId: t.projectId ?? null,
        tagIds: [...(t.tagIds ?? [])],
        parentId: t.parentId ?? null,
        subTaskIds: [...(t.subTaskIds ?? [])],
        dueDay: t.dueDay ?? null,
        isDone: !!t.isDone,
      };
    } finally {
      db.close();
    }
  }, taskId);

/**
 * The store helper is attached after bootstrap via a dynamic import, so right
 * after a reload it can still be missing. Wait for it instead of throwing.
 */
const waitForStoreHelper = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __e2eTestHelpers?: { store?: unknown } }).__e2eTestHelpers
        ?.store,
    undefined,
    { timeout: 10000 },
  );
};

type StoreRoot = {
  tasks: { ids: string[]; entities: Record<string, RawTask | undefined> };
  tag: { ids: string[]; entities: Record<string, { id: string; title: string }> };
};

/**
 * Live NgRx store task, or null when `tasks.entities` has no such id. Archived
 * tasks are not in the live store, so null after an archive is the expected
 * result for an archived id.
 */
export const getStoreTask = async (
  page: Page,
  taskId: string,
): Promise<AuditTaskFacts | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((id) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('E2E store helper is not available');
    }
    let root: StoreRoot | undefined;
    // The NgRx store replays its current value synchronously on subscribe.
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const t = root?.tasks.entities[id];
    if (!t) {
      return null;
    }
    return {
      id: t.id,
      projectId: t.projectId ?? null,
      tagIds: [...(t.tagIds ?? [])],
      parentId: t.parentId ?? null,
      subTaskIds: [...(t.subTaskIds ?? [])],
      dueDay: t.dueDay ?? null,
      isDone: !!t.isDone,
    };
  }, taskId);
};

/** Id of the tag whose title equals `title`, or null when no such tag exists. */
export const getStoreTagIdByTitle = async (
  page: Page,
  title: string,
): Promise<string | null> => {
  await waitForStoreHelper(page);
  return page.evaluate((wantedTitle) => {
    const store = (
      window as unknown as {
        __e2eTestHelpers?: {
          store?: {
            subscribe: (f: (root: unknown) => void) => { unsubscribe: () => void };
          };
        };
      }
    ).__e2eTestHelpers?.store;
    if (!store) {
      throw new Error('E2E store helper is not available');
    }
    let root: StoreRoot | undefined;
    store.subscribe((value) => (root = value as StoreRoot)).unsubscribe();
    const tag = Object.values(root?.tag.entities ?? {}).find(
      (t) => !!t && t.title === wantedTitle,
    );
    return tag?.id ?? null;
  }, title);
};
