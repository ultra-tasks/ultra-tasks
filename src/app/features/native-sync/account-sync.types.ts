/**
 * The one vocabulary every account surface (header, mobile navigation, Account dialog,
 * Settings, search commands, account page) uses for "where is my account sync?".
 * `NativeSyncService.phase` derives it from engine events and confirmed local commits;
 * it is not persisted and not synced.
 */
export type AccountPhase =
  /** No Ultra Tasks account is configured on this device. */
  | 'signed-out'
  /** Password, browser return or two-factor step in progress. */
  | 'signing-in'
  /** Waiting for the new-device email code. */
  | 'verify-device'
  /** The vault is open but the data source is undecided (or the choice was deferred). */
  | 'choose-data'
  /** Fetching the encrypted account data. */
  | 'downloading'
  /** Writing downloaded data into this device. */
  | 'applying'
  /** Incremental upload and download. */
  | 'syncing'
  /** Initial apply finished, nothing pending, no error. */
  | 'synced'
  /** A configured account whose vault is not open (for example protected storage unavailable). */
  | 'locked'
  /** The session was revoked or expired: sign in again. The configured identity is kept. */
  | 'reauth';

/** Bounded counts of what a dataset holds, safe to show in a dialog. Never carries content. */
export interface AccountDataSummary {
  tasks: number;
  projects: number;
  notes: number;
  archived: number;
  /** True when there is anything beyond first-run defaults and the example task. */
  hasUserData: boolean;
}

/**
 * Both sides hold real data (or the user deferred the choice). Cleared once the user
 * downloads the account copy or replaces it with this device.
 */
export interface AccountDataChoice {
  local: AccountDataSummary;
  account: AccountDataSummary;
  /** When the choice became necessary, in ms since epoch. */
  since: number;
  /** The user closed the dialog without deciding: show "Data connection not finished". */
  deferred: boolean;
}

/**
 * Where the first connection of this device to the account's data stands. It explains
 * `phase` (`discovering` is still "Signing in", `downloading` and `applying` map to the
 * phases of the same name, `uploading` is "Syncing changes") and carries the two states
 * that need an action: `failed` (the account could not be read: Retry) and `waiting`
 * (another device is still setting the account up).
 */
export type DataConnectionState =
  | 'idle'
  | 'discovering'
  | 'downloading'
  | 'applying'
  | 'uploading'
  | 'failed'
  | 'waiting';

/** What a session that cannot sync on its own needs from the person. */
export type AccountReconnect = 'unlock' | 'sign-in' | null;

/**
 * The emailed-code step of a sign-in on a new device: the server answered the password with
 * "send a code" instead of a session. Nothing is signed in while this is pending.
 */
export interface DeviceVerificationView {
  /** Masked address the code went to, such as `d***@example.test`; never the full address. */
  emailHint: string;
  /** When the code stops working (ms since epoch). Asking for a new code does not extend it. */
  expiresAt: number;
  /** Seconds to wait between codes, counted from `issuedAt` (the server's cooldown). */
  resendAfter: number;
  /** Codes that can still be requested for this sign-in; null when the server did not say. */
  resendsLeft: number | null;
  /** When the code that is valid now was sent (ms since epoch). */
  issuedAt: number;
}
