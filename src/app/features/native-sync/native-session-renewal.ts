import {
  AccountApiError,
  type AccountClient,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';

const REFRESH = '/sessions/refresh';

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

  /** Wraps the account transport to see whether the server refused the refresh credential itself. */
  guard(transport: Transport): Transport {
    return async (path, body, accessToken, method) => {
      try {
        return await transport(path, body, accessToken, method);
      } catch (error) {
        if (path === REFRESH && error instanceof AccountApiError && error.status === 401)
          this.refreshRefused = true;
        throw error;
      }
    };
  }

  /**
   * An ordinary call was refused with 401. When it is worth one renewal this arranges for the SDK
   * to refresh on its next request and returns true: the caller tries again. False means the
   * session has ended (the refresh credential was refused, or the renewal did not help).
   */
  renew(account: AccountClient | undefined): boolean {
    if (!account?.tokens || this.refreshRefused || this.renewed) return false;
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
