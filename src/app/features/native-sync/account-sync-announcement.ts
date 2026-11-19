import { linkedSignal, type Signal } from '@angular/core';
import type { AccountStatusId, AccountSyncStatus } from './account-sync-status.model';

/** What the header's polite live region says, and what it needs to remember to stay quiet. */
export interface SyncAnnouncement {
  /** Translation key of the status to read out; null until something meaningful happens. */
  labelKey: string | null;
  /** The status the last call saw, so a repeat of it changes nothing. */
  id: AccountStatusId | null;
  /** The last status that was not routine syncing: what a return to "up to date" recovers from. */
  settledId: AccountStatusId | null;
}

const UP_TO_DATE_IDS: ReadonlySet<AccountStatusId> = new Set<AccountStatusId>([
  'up-to-date',
  'up-to-date-empty',
]);

/**
 * Decides what a screen reader hears when the status changes. Only meaningful transitions
 * speak: the first value is silent (it is not a change), routine incremental syncing never
 * speaks (it repeats every minute), and "up to date" is announced only when it ends something
 * that was not up to date, such as offline, a failure, a locked account or the first download.
 * Every other state is announced when it begins.
 */
export const nextAnnouncement = (
  previous: SyncAnnouncement | undefined,
  status: Pick<AccountSyncStatus, 'id' | 'labelKey'>,
): SyncAnnouncement => {
  const { id } = status;
  if (!previous) {
    return { labelKey: null, id, settledId: id === 'syncing' ? null : id };
  }
  if (previous.id === id) {
    return previous;
  }
  if (id === 'syncing') {
    return { ...previous, id };
  }
  const isRecovery =
    UP_TO_DATE_IDS.has(id) &&
    !!previous.settledId &&
    !UP_TO_DATE_IDS.has(previous.settledId);
  const isAnnounced = !UP_TO_DATE_IDS.has(id) || isRecovery;
  return {
    labelKey: isAnnounced ? status.labelKey : previous.labelKey,
    id,
    settledId: id,
  };
};

/**
 * What a screen reader hears for a status signal: {@link nextAnnouncement} applied to each change,
 * remembering the last one. Read it in a template; the first read is the (silent) first render.
 */
export const announcementFor = (
  status: Signal<Pick<AccountSyncStatus, 'id' | 'labelKey'>>,
): Signal<SyncAnnouncement> =>
  linkedSignal<Pick<AccountSyncStatus, 'id' | 'labelKey'>, SyncAnnouncement>({
    source: () => {
      const { id, labelKey } = status();
      return { id, labelKey };
    },
    computation: (next, previous) => nextAnnouncement(previous?.value, next),
  });
