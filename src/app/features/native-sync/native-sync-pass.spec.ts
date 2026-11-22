import { AccountApiError, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import { classifyFailure } from './native-sync-health';
import { syncPersonalPass } from './native-sync-pass';

describe('syncPersonalPass', () => {
  const client = (): SyncClient =>
    ({
      syncAll: jasmine.createSpy().and.resolveTo({}),
      state: {
        scopes: {
          personal: { downloaded: true, info: { kind: 'personal', state: 'active' } },
        },
      },
    }) as unknown as SyncClient;

  it('does not infer a verified personal pull from an old SDK quota message', async () => {
    const sdk = client();
    (sdk.syncAll as jasmine.Spy).and.resolveTo({ personal: 'Sync quota exceeded' });
    const result = await syncPersonalPass(sdk, 'personal');
    expect(result.canApply).toBeFalse();
    expect(result.quotaBlocked).toBeFalse();
    expect(result.error?.message).toBe('Sync quota exceeded');
  });

  it('accepts an authenticated SDK quota pull without marking outgoing writes as complete', async () => {
    const sdk = Object.assign(client(), {
      syncAllDetailed: async (): Promise<Record<string, Error>> => ({
        personal: Object.assign(new AccountApiError(413, 'Sync quota exceeded'), {
          verifiedPull: true,
        }),
      }),
    });
    expect(await syncPersonalPass(sdk, 'personal')).toEqual({
      canApply: true,
      quotaBlocked: true,
      error: undefined,
    });
    expect(sdk.syncAll).not.toHaveBeenCalled();
  });

  it('distinguishes a typed deadline from the fallback network classifier', () => {
    expect(
      classifyFailure(
        Object.assign(new TypeError('Account request timed out'), {
          code: 'ACCOUNT_HTTP_TIMEOUT',
        }),
      ),
    ).toBe('timeout');
    expect(classifyFailure(new TypeError('Account request timed out'))).toBe('offline');
  });

  it('preserves typed errors instead of turning auth refusal into a generic string', async () => {
    const refused = new AccountApiError(401, 'Refused');
    const sdk = Object.assign(client(), {
      syncAllDetailed: async (): Promise<Record<string, Error>> => ({
        personal: refused,
      }),
    });
    expect((await syncPersonalPass(sdk, 'personal')).error).toBe(refused);
  });
});
