/**
 * What a trusted desktop device keeps in OS-protected storage so the unlocked account
 * survives restarts, updates and sleep. Owned by the main process; the renderer reaches
 * it only through the one-shot `consumeAccountSessionStore` capability.
 *
 * Never the account password. Never stored in renderer storage.
 */
export interface StoredAccountSession {
  v: 1;
  serverUrl: string;
  accountId: string;
  serverId: string;
  /** base64url vault master key (what the password unwraps). */
  masterKey: string;
  /** The current single-use refresh credential; rewritten on every rotation. */
  refreshToken: string;
  /** Opaque new-device trust marker (account SDK 0.1.5 and later); absent until then. */
  deviceToken?: string;
}

export interface AccountSessionStoreApi {
  /** `null` when nothing is stored. Rejects when protected storage is unavailable. */
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}
