import {
  AccountApiError,
  type AccountClient,
  type DeviceVerification,
} from '@sp/sync-providers/ultra-tasks';
import { T } from '../../t.const';
import {
  deviceLabel,
  explainDeviceError,
  MAX_CODE_ATTEMPTS,
  NativeDeviceVerification,
  type DeviceVerificationHost,
} from './native-device-verification';

const verification = (over: Partial<DeviceVerification> = {}): DeviceVerification => ({
  kind: 'email',
  token: 'C'.repeat(43),
  expiresIn: 600,
  resendAfter: 30,
  resendsLeft: 3,
  emailHint: 'a***@example.test',
  ...over,
});

const refused = (status: number, code?: string): AccountApiError =>
  new AccountApiError(status, 'Server text that must never be shown', code);

describe('explainDeviceError', () => {
  it('names each reason the server gives in the app’s own words', () => {
    const cases: [number, string, string][] = [
      [426, 'client_update_required', T.ACCOUNT_DEVICE.ERROR_UPDATE],
      [409, 'session_limit', T.ACCOUNT_DEVICE.ERROR_SESSION_LIMIT],
      [429, 'verification_rate_limited', T.ACCOUNT_DEVICE.ERROR_RATE_LIMITED],
      [503, 'email_delivery_failed', T.ACCOUNT_DEVICE.ERROR_EMAIL],
      [429, 'resend_too_soon', T.ACCOUNT_DEVICE.ERROR_RESEND_SOON],
      [429, 'resend_limit', T.ACCOUNT_DEVICE.ERROR_RESEND_LIMIT],
    ];
    for (const [status, code, key] of cases)
      for (const step of ['sign-in', 'verify', 'resend'] as const) {
        const explained = explainDeviceError(refused(status, code), step) as Error;
        expect(explained.message).toBe(key);
        expect(explained.message).not.toContain('Server text');
      }
  });

  it('keeps the original error as its cause', () => {
    const original = refused(426, 'client_update_required');
    expect((explainDeviceError(original, 'sign-in') as Error).cause).toBe(original);
  });

  it('reads a wrong, old or locked code as one generic answer, and a malformed one as such', () => {
    expect((explainDeviceError(refused(401), 'verify') as Error).message).toBe(
      T.ACCOUNT_DEVICE.ERROR_CODE,
    );
    expect((explainDeviceError(refused(400), 'verify') as Error).message).toBe(
      T.ACCOUNT_DEVICE.ERROR_CODE_FORMAT,
    );
  });

  it('says a closed challenge is over when asking for a new code', () => {
    expect((explainDeviceError(refused(401), 'resend') as Error).message).toBe(
      T.ACCOUNT_DEVICE.ERROR_ENDED,
    );
  });

  it('turns a bare rate limit into a calm "wait" and leaves everything else alone', () => {
    expect((explainDeviceError(refused(429), 'sign-in') as Error).message).toBe(
      T.ACCOUNT_DEVICE.ERROR_TOO_MANY,
    );
    // A wrong password is not this feature's business.
    const wrongPassword = refused(401);
    expect(explainDeviceError(wrongPassword, 'sign-in')).toBe(wrongPassword);
    const offline = new TypeError('Failed to fetch');
    expect(explainDeviceError(offline, 'verify')).toBe(offline);
    const other = refused(500);
    expect(explainDeviceError(other, 'resend')).toBe(other);
    expect(explainDeviceError('boom', 'sign-in')).toBe('boom');
  });
});

describe('deviceLabel', () => {
  it('lists this installation as Ultra Tasks on its platform', () => {
    expect(deviceLabel()).toBe('Ultra Tasks (web)');
  });
});

describe('NativeDeviceVerification', () => {
  let client: jasmine.SpyObj<
    Pick<AccountClient, 'completeDeviceVerification' | 'resendDeviceVerification'>
  >;
  let host: jasmine.SpyObj<DeviceVerificationHost>;
  let step: NativeDeviceVerification;
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    client = jasmine.createSpyObj('client', [
      'completeDeviceVerification',
      'resendDeviceVerification',
    ]);
    client.completeDeviceVerification.and.resolveTo();
    client.resendDeviceVerification.and.resolveTo(verification());
    host = jasmine.createSpyObj<DeviceVerificationHost>('host', [
      'account',
      'finishLogin',
      'abandon',
    ]);
    host.account.and.returnValue(client as unknown as AccountClient);
    host.finishLogin.and.resolveTo();
    host.abandon.and.resolveTo();
    step = new NativeDeviceVerification(host);
  });

  describe('when the server asks for a code', () => {
    it('shows what the person needs and nothing that lets anyone skip the code', () => {
      expect(step.pending()).toBeNull();
      step.begin(verification({ resendsLeft: undefined }), NOW);
      expect(step.pending()).toEqual({
        emailHint: 'a***@example.test',
        expiresAt: NOW + 600_000,
        resendAfter: 30,
        resendsLeft: null,
        issuedAt: NOW,
      });
      // The challenge handle stays in the client.
      expect(JSON.stringify(step.pending())).not.toContain('C'.repeat(43));
    });
  });

  describe('typing the code', () => {
    beforeEach(() => step.begin(verification(), NOW));

    it('sends the eight digits, however they were typed, then opens the account', async () => {
      await step.complete(' 1234-5678 ');
      expect(client.completeDeviceVerification).toHaveBeenCalledOnceWith('12345678');
      expect(host.finishLogin).toHaveBeenCalledTimes(1);
      expect(step.pending()).toBeNull();
      expect(host.abandon).not.toHaveBeenCalled();
    });

    it('keeps the step on screen until the account is open, so nothing flashes back', async () => {
      let seen: unknown = 'unset';
      host.finishLogin.and.callFake(async () => {
        seen = step.pending();
      });
      await step.complete('12345678');
      expect(seen).not.toBeNull();
      expect(step.pending()).toBeNull();
    });

    it('does not spend an attempt on something that is not eight digits', async () => {
      for (const bad of ['', '1234567', '123456789', 'abcdefgh'])
        await expectAsync(step.complete(bad)).toBeRejectedWithError(
          T.ACCOUNT_DEVICE.ERROR_CODE_FORMAT,
        );
      expect(client.completeDeviceVerification).not.toHaveBeenCalled();
      expect(step.pending()).not.toBeNull();
    });

    it('keeps the step open after a wrong code, with one generic answer', async () => {
      client.completeDeviceVerification.and.rejectWith(refused(401));
      await expectAsync(step.complete('00000000')).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_CODE,
      );
      expect(step.pending()).not.toBeNull();
      expect(host.finishLogin).not.toHaveBeenCalled();
      expect(host.abandon).not.toHaveBeenCalled();
      client.completeDeviceVerification.and.resolveTo();
      await step.complete('12345678');
      expect(host.finishLogin).toHaveBeenCalled();
    });

    it('ends the sign-in at the fifth wrong code, as the server does, and says to start again', async () => {
      client.completeDeviceVerification.and.rejectWith(refused(401));
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++)
        await expectAsync(step.complete('00000000')).toBeRejectedWithError(
          T.ACCOUNT_DEVICE.ERROR_CODE,
        );
      await expectAsync(step.complete('00000000')).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_LOCKED,
      );
      expect(step.pending()).toBeNull();
      expect(host.abandon).toHaveBeenCalledTimes(1);
      expect(client.completeDeviceVerification).toHaveBeenCalledTimes(MAX_CODE_ATTEMPTS);
      // Nothing left to type a code into.
      await expectAsync(step.complete('12345678')).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_ENDED,
      );
    });

    it('counts attempts per challenge: a new sign-in starts again at zero', async () => {
      client.completeDeviceVerification.and.rejectWith(refused(401));
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++)
        await expectAsync(step.complete('00000000')).toBeRejectedWith(jasmine.anything());
      step.begin(verification({ token: 'D'.repeat(43) }), NOW + 1);
      await expectAsync(step.complete('00000000')).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_CODE,
      );
      expect(host.abandon).not.toHaveBeenCalled();
    });

    it('does not count a refusal that is not about the code (too many devices)', async () => {
      client.completeDeviceVerification.and.rejectWith(refused(409, 'session_limit'));
      for (let i = 0; i < MAX_CODE_ATTEMPTS + 1; i++)
        await expectAsync(step.complete('12345678')).toBeRejectedWithError(
          T.ACCOUNT_DEVICE.ERROR_SESSION_LIMIT,
        );
      expect(step.pending()).not.toBeNull();
    });

    it('ends the step when opening the account fails after the server accepted the code', async () => {
      host.finishLogin.and.rejectWith(new Error('NATIVE_SYNC.ERROR_TAB'));
      await expectAsync(step.complete('12345678')).toBeRejectedWithError(
        'NATIVE_SYNC.ERROR_TAB',
      );
      expect(step.pending()).toBeNull();
    });

    it('has nothing to complete once the sign-in is gone', async () => {
      host.account.and.returnValue(undefined);
      await expectAsync(step.complete('12345678')).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_ENDED,
      );
    });
  });

  describe('asking for a new code', () => {
    beforeEach(() => step.begin(verification(), NOW));

    it('replaces the code and restarts the cooldown with what the server says', async () => {
      client.resendDeviceVerification.and.resolveTo(
        verification({ resendsLeft: 2, expiresIn: 540 }),
      );
      const before = Date.now();
      await step.resend();
      const view = step.pending()!;
      expect(view.resendsLeft).toBe(2);
      expect(view.issuedAt).toBeGreaterThanOrEqual(before);
      // Asking again does not extend the code's life: the server's remaining time wins.
      expect(view.expiresAt - view.issuedAt).toBe(540_000);
      expect(host.abandon).not.toHaveBeenCalled();
    });

    it('keeps the step when the server only says "not yet" or "no more"', async () => {
      for (const code of [
        'resend_too_soon',
        'resend_limit',
        'verification_rate_limited',
      ]) {
        client.resendDeviceVerification.and.rejectWith(refused(429, code));
        await expectAsync(step.resend()).toBeRejected();
        expect(step.pending()).not.toBeNull();
      }
      expect(host.abandon).not.toHaveBeenCalled();
    });

    it('ends the sign-in when the server closed the challenge', async () => {
      client.resendDeviceVerification.and.rejectWith(refused(401));
      await expectAsync(step.resend()).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_ENDED,
      );
      expect(step.pending()).toBeNull();
      expect(host.abandon).toHaveBeenCalledTimes(1);
    });

    it('ends the sign-in, and says why, when the email could not be sent', async () => {
      client.resendDeviceVerification.and.rejectWith(
        refused(503, 'email_delivery_failed'),
      );
      await expectAsync(step.resend()).toBeRejectedWithError(
        T.ACCOUNT_DEVICE.ERROR_EMAIL,
      );
      expect(step.pending()).toBeNull();
      expect(host.abandon).toHaveBeenCalledTimes(1);
    });

    it('keeps the step when the network fails', async () => {
      client.resendDeviceVerification.and.rejectWith(new TypeError('Failed to fetch'));
      await expectAsync(step.resend()).toBeRejectedWithError('Failed to fetch');
      expect(step.pending()).not.toBeNull();
    });
  });

  describe('Back', () => {
    it('forgets the challenge and backs out of the sign-in, signing nothing in', async () => {
      step.begin(verification(), NOW);
      await step.cancel();
      expect(step.pending()).toBeNull();
      expect(host.abandon).toHaveBeenCalledTimes(1);
      expect(host.finishLogin).not.toHaveBeenCalled();
    });

    it('can be reset without touching the sign-in (the vault closed on its own)', () => {
      step.begin(verification(), NOW);
      step.reset();
      expect(step.pending()).toBeNull();
      expect(host.abandon).not.toHaveBeenCalled();
    });
  });
});
