import type { ScopeInfo, SyncClient } from '@sp/sync-providers/ultra-tasks';

export const HISTORY_CHANGED = 'NATIVE_SYNC.ERROR_HISTORY_CHANGED';

// The app can still run with the earlier hosted SDK until the new SDK is released.
type RecoverySyncClient = SyncClient & {
  detachPersonalForRecovery(
    scopeId: string,
    preserve: (archive: unknown) => Promise<boolean>,
  ): Promise<boolean>;
};

export const supportsRecovery = (client?: SyncClient): client is RecoverySyncClient =>
  typeof (client as Partial<RecoverySyncClient> | undefined)
    ?.detachPersonalForRecovery === 'function';

export const isHistoryFailure = (message: string): boolean =>
  message.startsWith('Sync history changed.') ||
  message === 'Sync server omitted a record this device already has' ||
  message === 'Sync server returned an older record version';

export const personalRecoveryScope = (
  client: SyncClient,
  linkedScopeId?: string,
): string | undefined =>
  linkedScopeId ??
  Object.values(client.state.scopes).find((scope) => scope.info.kind === 'personal')?.info
    .id;

export const hasPendingPersonalSetup = (client: SyncClient, scopeId: string): boolean => {
  const journal:
    | (SyncClient['state']['migrations'][string] & { interruptedOutbox?: unknown })
    | undefined = client.state.migrations[scopeId];
  return !!journal && !journal.complete && !journal.interruptedOutbox;
};

export const wasRecoveredSetup = (scope: ScopeInfo): boolean =>
  (scope as ScopeInfo & { recoveredFromMigration?: boolean }).recoveredFromMigration ===
  true;

/** The SDK keeps the branch until the file and the working copy have been preserved. */
export const detachPersonal = (
  client: RecoverySyncClient,
  scopeId: string,
  saveArchive: (archive: unknown) => Promise<boolean>,
  preserveLocal: () => Promise<void>,
): Promise<boolean> =>
  client.detachPersonalForRecovery(scopeId, async (archive) => {
    if (!(await saveArchive(archive))) return false;
    await preserveLocal();
    return true;
  });
