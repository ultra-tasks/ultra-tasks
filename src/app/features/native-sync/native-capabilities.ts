import type { AccountClient, Capabilities } from '@sp/sync-providers/ultra-tasks';

/** How long a restored session waits for the server to say what it can do now. */
export const CAPABILITIES_WAIT_MS = 3000;

/** What the server answers when asked who it is and what it supports. */
export type FreshCapabilities = Capabilities | 'other-server' | undefined;

/**
 * The server's current capabilities for a session restored from OS-protected storage.
 *
 * The copy cached at sign-in goes stale: after a server upgrade `personalReplacement`,
 * `personalRealtime` and the like would stay hidden for as long as the session lives. This asks
 * again, and only ever HELPS: it is bounded (a server that cannot be reached must not delay
 * opening the vault), it never throws, and anything it cannot use leaves the cached copy alone.
 *
 * - the current capabilities when the same server answered;
 * - `'other-server'` when a different server answers at this address (the remembered session
 *   does not belong to it);
 * - `undefined` when the server cannot be reached in time or answers nonsense.
 */
export const freshCapabilities = async (
  account: AccountClient,
  serverId: string,
  waitMs = CAPABILITIES_WAIT_MS,
): Promise<FreshCapabilities> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = (await Promise.race([
      account.transport('/capabilities'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Capabilities request timed out')),
          waitMs,
        );
      }),
    ])) as Capabilities | undefined;
    if (
      answer?.protocol !== 2 ||
      typeof answer.serverId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(answer.serverId) ||
      typeof answer.features !== 'object' ||
      answer.features === null
    )
      return undefined;
    return answer.serverId === serverId ? answer : 'other-server';
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};
