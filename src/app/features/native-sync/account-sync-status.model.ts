import type { AccountPhase } from './account-sync.types';

/** One row of the audit's status table. Stable ids: tests and CSS hooks may rely on them. */
export type AccountStatusId =
  | 'local-only'
  | 'signing-in'
  | 'verify-device'
  | 'choose-data'
  | 'downloading'
  | 'applying'
  | 'syncing'
  | 'up-to-date'
  | 'up-to-date-empty'
  | 'offline'
  | 'locked'
  | 'reauth'
  | 'error'
  /** A legacy provider (OneDrive/WebDAV/SuperSync) is chosen but needs the user's attention. */
  | 'provider-attention';

export type AccountStatusSeverity = 'neutral' | 'progress' | 'ok' | 'warning' | 'error';

/** What the primary affordance of the status does when activated. */
export type AccountStatusAction =
  | 'sync'
  | 'open-account'
  | 'choose-data'
  | 'unlock'
  | 'sign-in'
  | 'retry'
  | 'setup'
  | null;

/**
 * The single, read-only description of "where is my sync?" for every surface.
 * Derived from live engine state; never persisted or synced.
 */
export interface AccountSyncStatus {
  id: AccountStatusId;
  /** Which engine a manual sync reaches right now. Native account and legacy provider never both. */
  engine: 'account' | 'provider' | null;
  /** An account or provider is configured on this device (locked, offline or reconnect-needed included). */
  configured: boolean;
  severity: AccountStatusSeverity;
  /** Work is running: animate the icon. */
  busy: boolean;
  /** Icon name; `isSvgIcon` tells which registry it belongs to (built-in SVG vs Material ligature). */
  icon: string;
  isSvgIcon: boolean;
  /** Translation key (T.ACCOUNT_STATUS.*) of the one-line label; also the accessible name. */
  labelKey: string;
  /** Optional translation key of a second line. */
  detailKey: string | null;
  /** Failure reason or message when `id === 'error'` (a translation key or a plain message). */
  reason: string | null;
  action: AccountStatusAction;
  /** Translation key of the action's button label. */
  actionLabelKey: string | null;
  /** Last fully successful account sync (ms since epoch); null when unknown. */
  lastSyncedAt: number | null;
  /** Unsent local change intents; 0 when unknown. */
  pendingChanges: number;
  /** The account engine's phase, for consumers that need more than the headline. */
  phase: AccountPhase | null;
}
