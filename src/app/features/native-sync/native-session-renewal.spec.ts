import {
  AccountApiError,
  type AccountClient,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';
import { NativeSessionRenewal } from './native-session-renewal';

const account = (): jasmine.SpyObj<Pick<AccountClient, 'adoptTokens'>> & {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
} => {
  const spy = jasmine.createSpyObj<Pick<AccountClient, 'adoptTokens'>>('account', [
    'adoptTokens',
  ]);
  return Object.assign(spy, {
    tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 },
  });
};
const asClient = (value: object): AccountClient => value as unknown as AccountClient;

describe('NativeSessionRenewal', () => {
  let renewal: NativeSessionRenewal;
  beforeEach(() => (renewal = new NativeSessionRenewal()));

  describe('guard', () => {
    it('is invisible: answers and errors pass through unchanged', async () => {
      const answer = { ok: true };
      const guarded = renewal.guard(async (path) => {
        if (path === '/boom') throw new TypeError('Failed to fetch');
        return answer;
      });
      expect(await guarded('/me', undefined, 'token', 'GET')).toBe(answer);
      await expectAsync(guarded('/boom')).toBeRejectedWithError('Failed to fetch');
    });

    it('passes every argument on', async () => {
      const transport = jasmine.createSpy('transport').and.resolveTo({});
      await renewal.guard(transport as Transport)('/p', { a: 1 }, 'token', 'PUT');
      expect(transport).toHaveBeenCalledOnceWith('/p', { a: 1 }, 'token', 'PUT');
    });

    it('notes a refused refresh credential, and only that', async () => {
      const refused = new AccountApiError(401, 'refused');
      const guarded = renewal.guard(async (path, body) => {
        if (path === '/sessions/refresh' && body) throw refused;
        throw new AccountApiError(401, 'Unauthorized');
      });
      // An ordinary call refused with 401 says nothing about the refresh credential.
      await expectAsync(guarded('/sync/scopes', undefined, 'token')).toBeRejected();
      expect(renewal.renew(asClient(account()))).toBeTrue();
      renewal.reset();
      await expectAsync(
        guarded('/sessions/refresh', { refreshToken: 'r' }),
      ).toBeRejectedWith(refused);
      expect(renewal.renew(asClient(account()))).toBeFalse();
    });

    it('does not read a network failure of the refresh as a refused credential', async () => {
      const guarded = renewal.guard(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expectAsync(
        guarded('/sessions/refresh', { refreshToken: 'r' }),
      ).toBeRejected();
      await expectAsync(guarded('/sessions/refresh')).toBeRejected();
      expect(renewal.renew(asClient(account()))).toBeTrue();
    });

    it('does not read a server error of the refresh as a refused credential', async () => {
      const guarded = renewal.guard(async () => {
        throw new AccountApiError(503, 'Service Unavailable');
      });
      await expectAsync(
        guarded('/sessions/refresh', { refreshToken: 'r' }),
      ).toBeRejected();
      expect(renewal.renew(asClient(account()))).toBeTrue();
    });
  });

  describe('renew', () => {
    it('arranges one refresh through the SDK, by running the access token out', () => {
      const client = account();
      expect(renewal.renew(asClient(client))).toBeTrue();
      expect(client.adoptTokens).toHaveBeenCalledOnceWith({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 0,
      });
    });

    it('allows one renewal per streak of refusals, never a loop', () => {
      const client = account();
      expect(renewal.renew(asClient(client))).toBeTrue();
      expect(renewal.renew(asClient(client))).toBeFalse();
      expect(renewal.renew(asClient(client))).toBeFalse();
      expect(client.adoptTokens).toHaveBeenCalledTimes(1);
    });

    it('is armed again once a call went through', () => {
      const client = account();
      renewal.renew(asClient(client));
      renewal.succeeded();
      expect(renewal.renew(asClient(client))).toBeTrue();
    });

    it('has nothing to renew without a session', () => {
      expect(renewal.renew(undefined)).toBeFalse();
      expect(
        renewal.renew(asClient({ tokens: undefined, adoptTokens: () => undefined })),
      ).toBeFalse();
    });

    it('starts afresh for the next sign-in', async () => {
      await expectAsync(
        renewal.guard(async () => {
          throw new AccountApiError(401, 'refused');
        })('/sessions/refresh', { refreshToken: 'r' }),
      ).toBeRejected();
      expect(renewal.renew(asClient(account()))).toBeFalse();
      renewal.reset();
      expect(renewal.renew(asClient(account()))).toBeTrue();
    });
  });
});
