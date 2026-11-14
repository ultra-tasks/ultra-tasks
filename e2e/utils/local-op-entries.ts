import type { Page } from '@playwright/test';

export interface LocalOpEntry {
  opType: string;
  entityType: string;
  entityId: string | undefined;
  source: string | undefined;
  isSynced: boolean;
  isRejected: boolean;
  /** True when the op's payload contains `payloadNeedle` (false without one). */
  payloadMatches: boolean;
}

/**
 * Every entry of this client's local op log (`SUP_OPS`/`ops`), stripped to
 * metadata. `payloadNeedle` (e.g. a unique task title) marks the entries whose
 * payload contains it, without returning the payload. Call it only after the
 * app has booted.
 */
export const readLocalOpEntries = async (
  page: Page,
  payloadNeedle?: string,
): Promise<LocalOpEntry[]> =>
  page.evaluate(async (needle) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('SUP_OPS');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('ops')) {
        return [];
      }
      type CompactEntry = {
        op: {
          o?: string;
          e?: string;
          d?: string;
          p?: unknown;
          opType?: string;
          entityType?: string;
          entityId?: string;
          payload?: unknown;
        };
        source?: string;
        syncedAt?: number;
        rejectedAt?: number;
      };
      const entries = await new Promise<CompactEntry[]>((resolve, reject) => {
        const tx = db.transaction('ops', 'readonly');
        const request = tx.objectStore('ops').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return entries.map((entry) => {
        const payload = entry.op.p ?? entry.op.payload;
        return {
          opType: entry.op.o ?? entry.op.opType ?? '',
          entityType: entry.op.e ?? entry.op.entityType ?? '',
          entityId: entry.op.d ?? entry.op.entityId,
          source: entry.source,
          isSynced: entry.syncedAt !== undefined,
          isRejected: entry.rejectedAt !== undefined,
          payloadMatches:
            !!needle && payload !== undefined && JSON.stringify(payload).includes(needle),
        };
      });
    } finally {
      db.close();
    }
  }, payloadNeedle);
