import { signal } from '@angular/core';
import { AccountApiError, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import type { AccountDataSummary } from './account-sync.types';

/**
 * Why an attempt failed, in the only terms the status surfaces need:
 * - `offline`: the device or the server could not be reached (or answered with a gateway
 *   error). Calm status, automatic retry. NEVER a revocation.
 * - `auth`: the server refused the session (HTTP 401 on a refresh): sign in again.
 * - `data`: what arrived could not be verified, decrypted or validated.
 * - `other`: anything else; shown as a failure with Retry.
 */
export type FailureKind = 'offline' | 'auth' | 'data' | 'other';

// `SyncClient.syncAll` returns per-dataset failures as plain messages, so the browsers'
// wording for "the request never completed" has to be recognised there. A TypeError is
// only a network failure when it reads like one: a programming error must stay visible.
const NETWORK_MESSAGE =
  /failed to fetch|networkerror|network request failed|load failed|timed out|fetch failed|net::err|internet/i;
const DATA_MESSAGE =
  /ERROR_DATA|malformed|could not be validated|decrypt|authentication failed|unsupported/i;
// A proxy's HTML error page fails `response.json()` with a SyntaxError.
const BAD_GATEWAY_BODY = /json|unexpected (token|end)|unexpected character/i;
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);

export const classifyFailure = (error: unknown): FailureKind => {
  if (error instanceof AccountApiError) {
    if (error.status === 401) return 'auth';
    return GATEWAY_STATUSES.has(error.status) ? 'offline' : 'other';
  }
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (error instanceof SyntaxError && BAD_GATEWAY_BODY.test(message)) return 'offline';
  if (NETWORK_MESSAGE.test(message)) return 'offline';
  if (DATA_MESSAGE.test(message)) return 'data';
  return 'other';
};

/** Upper bound shown to people; the real queue can be longer. */
export const MAX_PENDING_COUNT = 9999;

/**
 * Unsent local change intents across every dataset: bounded, derived from the encrypted
 * sync state, and never carrying content. A mutation sent without an answer counts as one.
 */
export const countPendingChanges = (client: SyncClient | undefined): number => {
  const scopes = client?.state?.scopes;
  if (!scopes) return 0;
  let count = 0;
  for (const scope of Object.values(scopes))
    if (!scope.revoked) count += scope.intents.length + (scope.uncertain ? 1 : 0);
  return Math.min(count, MAX_PENDING_COUNT);
};

/**
 * Presentation facts about the last attempts. Everything here is derived from engine
 * events and nothing is synced or persisted by this class.
 */
export class NativeSyncHealth {
  /** The last attempt failed because the device or the server was unreachable. */
  readonly offline = signal(false);
  /** Last fully successful sync (including the apply), in ms since epoch. */
  readonly lastSyncedAt = signal<number | null>(null);
  /** Unsent local change intents (bounded count, never content). */
  readonly pendingChanges = signal(0);
  /** The last complete fetch found no tasks in the account. */
  readonly emptyAccount = signal(false);
  /** The server refused the session: only a new sign-in helps. */
  readonly reauth = signal(false);
  /** A local edit happened that has not been captured into an intent yet. */
  private uncaptured = false;
  /** The dataset version `emptyAccount` was last measured for. */
  private emptyChecked = '';

  /**
   * "Up to date, no tasks yet" is only true after a complete fetch found none. Measured again
   * only when the dataset moved; unreadable data is reported by the sync itself, never as "empty".
   */
  refreshEmpty(
    client: SyncClient | undefined,
    scopeId: string | undefined,
    measure: (client: SyncClient, scopeId: string) => AccountDataSummary,
  ): void {
    const scope = scopeId ? client?.state.scopes[scopeId] : undefined;
    if (!client || !scopeId || !scope) return;
    const marker = `${scopeId}:${scope.info.sequence}:${scope.info.generation}`;
    if (marker === this.emptyChecked) return;
    try {
      this.emptyAccount.set(!measure(client, scopeId).hasUserData);
      this.emptyChecked = marker;
    } catch {
      /* Left as it was. */
    }
  }

  /** The vault closed: what was true of the open account is not true any more. */
  closed(): void {
    this.offline.set(false);
    this.pendingChanges.set(0);
    this.emptyAccount.set(false);
    this.emptyChecked = '';
  }

  noteLocalEdit(client: SyncClient | undefined): void {
    this.uncaptured = true;
    this.refreshPending(client);
  }

  /** Call after edits were captured into intents (or when none are outstanding). */
  captured(client: SyncClient | undefined): void {
    this.uncaptured = false;
    this.refreshPending(client);
  }

  refreshPending(client: SyncClient | undefined): void {
    const count = countPendingChanges(client) + (this.uncaptured ? 1 : 0);
    this.pendingChanges.set(Math.min(count, MAX_PENDING_COUNT));
  }

  succeeded(at: number): void {
    this.offline.set(false);
    this.reauth.set(false);
    this.lastSyncedAt.set(at);
  }

  failed(kind: FailureKind): void {
    this.offline.set(kind === 'offline');
    if (kind === 'auth') this.reauth.set(true);
  }

  reset(): void {
    this.offline.set(false);
    this.lastSyncedAt.set(null);
    this.pendingChanges.set(0);
    this.emptyAccount.set(false);
    this.reauth.set(false);
    this.uncaptured = false;
    this.emptyChecked = '';
  }
}
