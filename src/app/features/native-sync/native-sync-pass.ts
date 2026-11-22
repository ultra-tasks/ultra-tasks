import { AccountApiError, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import { HISTORY_CHANGED, isHistoryFailure } from './native-personal-recovery';

type DetailedSyncClient = SyncClient & {
  syncAllDetailed?(): Promise<Record<string, Error>>;
};

interface PersonalSyncPass {
  canApply: boolean;
  quotaBlocked: boolean;
  error?: Error;
}

/** The older SDK returns only messages; never infer a verified pull from one. */
export const syncPersonalPass = async (
  client: DetailedSyncClient,
  scopeId?: string,
): Promise<PersonalSyncPass> => {
  const failures = await (client.syncAllDetailed?.() ?? client.syncAll());
  const personalError = scopeId ? failures[scopeId] : undefined;
  if (
    personalError &&
    isHistoryFailure(
      typeof personalError === 'string' ? personalError : personalError.message,
    )
  ) {
    throw new Error(HISTORY_CHANGED);
  }

  const personal = scopeId ? client.state.scopes[scopeId] : undefined;
  const quotaBlocked =
    personalError instanceof AccountApiError &&
    personalError.status === 413 &&
    'verifiedPull' in personalError &&
    personalError.verifiedPull === true;
  const canApply =
    !!personal?.downloaded &&
    personal.info.kind === 'personal' &&
    personal.info.state === 'active' &&
    !personal.revoked &&
    (!personalError || quotaBlocked);

  const remaining = Object.entries(failures)
    .filter(([id]) => !(canApply && quotaBlocked && id === scopeId))
    .map(([, error]) => error);
  const error =
    remaining.find((failure): failure is Error => failure instanceof Error) ??
    (remaining.length ? new Error(remaining.join('; ')) : undefined);
  return { canApply, quotaBlocked: canApply && quotaBlocked, error };
};
