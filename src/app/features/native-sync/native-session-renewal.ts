import {
  AccountApiError,
  type AccountClient,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';

const REFRESH = '/sessions/refresh';

/** The platform refresh owner refused the credential, which may happen during `current`. */
export class NativeRefreshRefusedError extends AccountApiError {
  constructor() {
    super(401, 'Native refresh credential refused');
  }
}

/**
 * A 401 on an ordinary call does not yet mean the session is over.
 *
 * The SDK renews the short-lived access token early, by this device's clock. When that clock
 * steps backwards (a clock correction, a restored VM, a long sleep), the access token looks
 * valid for far too long, the server refuses it, and nothing renews it: a session whose refresh
 * credential is perfectly good would be sent to "sign in again".
 *
 * So one refusal of an ordinary call earns exactly one renewal, through the SDK's own refresh (it
 * runs one at a time and rotates the single-use credential and persists it before using it), and
 * one more try. Only the REFRESH being refused is a session that has ended: that credential is
 * never presented again, because replaying a consumed single-use credential revokes the session.
 */
export class NativeSessionRenewal {
  private refreshRefused = false;
  private renewed = false;
  get pending(): boolean {
    return this.renewed;
  }

  /** Prevents an account client from sending its refused refresh credential again. */
  guard(transport: Transport): Transport {
    // A queued SDK call can reach the transport after its in-flight refresh has settled.
    // Keep the refusal on this client even if a later sign-in resets the renewal state.
    let refused: AccountApiError | undefined;
    return async (path, body, accessToken, method) => {
      const isRefresh = path === REFRESH;
      if (isRefresh && refused) throw refused;
      try {
        return await transport(path, body, accessToken, method);
      } catch (error) {
        if (isRefresh && error instanceof AccountApiError && error.status === 401) {
          refused = error;
          this.refreshRefused = true;
        }
        throw error;
      }
    };
  }

  /**
   * An ordinary call was refused with 401. When it is worth one renewal this arranges for the SDK
   * to refresh on its next request and returns true: the caller tries again. False means the
   * session has ended (the refresh credential was refused, or the renewal did not help).
   */
  renew(account: AccountClient | undefined, error?: unknown): boolean {
    if (
      !account?.tokens ||
      this.refreshRefused ||
      this.renewed ||
      error instanceof NativeRefreshRefusedError
    )
      return false;
    this.renewed = true;
    // An access token that has run out makes the next request refresh first, in the SDK's own
    // single-flight path: never a second refresh next to it.
    account.adoptTokens({ ...account.tokens, expiresIn: 0 });
    return true;
  }

  /** A call went through: a later refusal may be renewed again. */
  succeeded(): void {
    this.renewed = false;
  }

  reset(): void {
    this.refreshRefused = false;
    this.renewed = false;
  }
}
