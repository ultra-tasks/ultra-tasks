import { signal, type Signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  AccountApiError,
  type AccountClient,
  type DeviceVerification,
} from '@sp/sync-providers/ultra-tasks';
import { IS_ELECTRON } from '../../app.constants';
import { T } from '../../t.const';
import type { DeviceVerificationView } from './account-sync.types';

/** The server stops accepting a challenge after this many wrong codes, resends included. */
export const MAX_CODE_ATTEMPTS = 5;
const CODE_LENGTH = 8;

/** How this installation is listed among the account's devices. */
export const deviceLabel = (): string =>
  `Ultra Tasks (${
    Capacitor.isNativePlatform()
      ? Capacitor.getPlatform()
      : IS_ELECTRON
        ? 'desktop'
        : 'web'
  })`;

/** What the account server's machine-readable reasons mean to the person, in the app's words. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  client_update_required: T.ACCOUNT_DEVICE.ERROR_UPDATE,
  session_limit: T.ACCOUNT_DEVICE.ERROR_SESSION_LIMIT,
  verification_rate_limited: T.ACCOUNT_DEVICE.ERROR_RATE_LIMITED,
  email_delivery_failed: T.ACCOUNT_DEVICE.ERROR_EMAIL,
  resend_too_soon: T.ACCOUNT_DEVICE.ERROR_RESEND_SOON,
  resend_limit: T.ACCOUNT_DEVICE.ERROR_RESEND_LIMIT,
};

/**
 * Turns the server's answer to a sign-in step into a translation key. Only the stable `code`
 * and the status are read, never the message text. Anything that is not about new-device
 * verification (a wrong password, no network) passes through unchanged.
 */
export const explainDeviceError = (
  error: unknown,
  step: 'sign-in' | 'verify' | 'resend',
): unknown => {
  if (!(error instanceof AccountApiError)) return error;
  let key = error.code ? CODE_KEYS[error.code] : undefined;
  if (!key && step === 'verify') {
    // Generic on purpose: the server never says whether a code was wrong, old or locked.
    if (error.status === 401) key = T.ACCOUNT_DEVICE.ERROR_CODE;
    else if (error.status === 400) key = T.ACCOUNT_DEVICE.ERROR_CODE_FORMAT;
  }
  if (!key && step === 'resend' && error.status === 401)
    key = T.ACCOUNT_DEVICE.ERROR_ENDED;
  if (!key && error.status === 429) key = T.ACCOUNT_DEVICE.ERROR_TOO_MANY;
  return key ? new Error(key, { cause: error }) : error;
};

const seconds = (value: number): number => value * 1000;

/** The step as the page shows it; the code itself and the challenge token stay in the client. */
const viewOf = (
  verification: DeviceVerification,
  now: number,
): DeviceVerificationView => ({
  emailHint: verification.emailHint,
  expiresAt: now + seconds(verification.expiresIn),
  resendAfter: verification.resendAfter,
  resendsLeft: verification.resendsLeft ?? null,
  issuedAt: now,
});

export interface DeviceVerificationHost {
  /** The account client that is waiting for the code. */
  account(): AccountClient | undefined;
  /** Opens the session once the server accepted the code: the path every sign-in shares. */
  finishLogin(): Promise<void>;
  /** Backs out of the sign-in: closes the account client and forgets everything about it. */
  abandon(): Promise<void>;
}

/**
 * Sign-in on a device the account does not recognise yet: the server wants the code it just
 * emailed before it issues a session. State and decisions only; the SDK performs the calls
 * and {@link NativeSyncService} opens the session, exactly as after a two-factor code.
 *
 * Nothing is signed in while the step is pending, and ending it for any reason (Back, a
 * lock, five wrong codes, a challenge the server closed) leaves the account unconfigured.
 */
export class NativeDeviceVerification {
  private readonly view = signal<DeviceVerificationView | null>(null);
  /** The pending step, or null. */
  readonly pending: Signal<DeviceVerificationView | null> = this.view.asReadonly();
  private wrongCodes = 0;

  constructor(private readonly host: DeviceVerificationHost) {}

  /** The password was accepted and the server sent a code. */
  begin(verification: DeviceVerification, now = Date.now()): void {
    this.wrongCodes = 0;
    this.view.set(viewOf(verification, now));
  }

  /** The code the person typed (spaces and dashes are fine). */
  async complete(code: string): Promise<void> {
    const account = this.host.account();
    if (!account || !this.view()) throw new Error(T.ACCOUNT_DEVICE.ERROR_ENDED);
    const digits = code.replace(/\D/g, '');
    // A malformed code never costs one of the five attempts.
    if (digits.length !== CODE_LENGTH)
      throw new Error(T.ACCOUNT_DEVICE.ERROR_CODE_FORMAT);
    try {
      await account.completeDeviceVerification(digits);
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 401 && !error.code) {
        // The challenge stays pending for another try, until the server has had enough.
        if (++this.wrongCodes >= MAX_CODE_ATTEMPTS) {
          await this.cancel();
          throw new Error(T.ACCOUNT_DEVICE.ERROR_LOCKED, { cause: error });
        }
      }
      throw explainDeviceError(error, 'verify');
    }
    // Accepted: the session exists. The step stays on screen until the account is open so the
    // sign-in form never flashes back in between.
    try {
      await this.host.finishLogin();
    } finally {
      this.reset();
    }
  }

  /** A replacement code. The server enforces the cooldown, the resend limit and the budget. */
  async resend(): Promise<void> {
    const account = this.host.account();
    if (!account || !this.view()) throw new Error(T.ACCOUNT_DEVICE.ERROR_ENDED);
    try {
      this.view.set(viewOf(await account.resendDeviceVerification(), Date.now()));
    } catch (error) {
      // The SDK drops a challenge the server closed (expired, locked or mail that could not
      // be sent): there is nothing left to type a code into.
      if (
        error instanceof AccountApiError &&
        (error.status === 401 || error.status === 503)
      )
        await this.cancel();
      throw explainDeviceError(error, 'resend');
    }
  }

  /** Back: nothing was signed in, so there is nothing to undo but the pending challenge. */
  async cancel(): Promise<void> {
    this.reset();
    await this.host.abandon();
  }

  /** The vault closed or the sign-in restarted: forget the step. */
  reset(): void {
    this.wrongCodes = 0;
    this.view.set(null);
  }
}
