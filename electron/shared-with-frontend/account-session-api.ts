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
}

/** Which account a new-device trust marker belongs to: the server and SHA-256 keys of its names. */
export interface DeviceTrustRequest {
  serverId: string;
  /** Hex SHA-256 of the lower-cased email (and of any other name the account signed in with). */
  keys: string[];
}

export interface AccountSessionStoreApi {
  /** `null` when nothing is stored. Rejects when protected storage is unavailable. */
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * The new-device trust marker of the account (JSON `DeviceTrustRequest`), or `null`. It
   * outlives sign-out: the device stays recognised until the account is deleted.
   */
  loadDeviceToken(request: string): Promise<string | null>;
  /** JSON `DeviceTrustRequest & { token }`. */
  saveDeviceToken(request: string): Promise<void>;
  /** Only deleting the account forgets its marker. */
  forgetDeviceToken(request: string): Promise<void>;
}
