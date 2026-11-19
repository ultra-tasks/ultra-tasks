import { fakeAsync, tick } from '@angular/core/testing';
import type { AccountClient } from '@sp/sync-providers/ultra-tasks';
import { CAPABILITIES_WAIT_MS, freshCapabilities } from './native-capabilities';

const SERVER = '3e2edea8-ff50-4f20-87f6-a8f0465f9946';
const capabilities = (over: Record<string, unknown> = {}): unknown => ({
  protocol: 2,
  serverId: SERVER,
  features: { personalReplacement: true },
  ...over,
});

const account = (transport: (path: string) => Promise<unknown>): AccountClient =>
  ({ transport }) as unknown as AccountClient;

describe('freshCapabilities', () => {
  it('returns what the same server says it can do now', async () => {
    const transport = jasmine.createSpy('transport').and.resolveTo(capabilities());
    expect(await freshCapabilities(account(transport), SERVER)).toEqual(
      capabilities() as never,
    );
    expect(transport).toHaveBeenCalledOnceWith('/capabilities');
  });

  it('says so when a different server answers at this address', async () => {
    const answer = capabilities({ serverId: '9b1c3f5e-6a2d-4c81-8e07-5d2f9a4b7c10' });
    expect(
      await freshCapabilities(
        account(() => Promise.resolve(answer)),
        SERVER,
      ),
    ).toBe('other-server');
  });

  it('leaves the cached copy alone when the server cannot be reached or answers nonsense', async () => {
    const unusable: unknown[] = [
      undefined,
      null,
      {},
      capabilities({ protocol: 3 }),
      capabilities({ serverId: 'not-a-server-id' }),
      capabilities({ serverId: 7 }),
      capabilities({ features: undefined }),
      capabilities({ features: null }),
    ];
    for (const answer of unusable)
      expect(
        await freshCapabilities(
          account(() => Promise.resolve(answer)),
          SERVER,
        ),
      )
        .withContext(JSON.stringify(answer))
        .toBeUndefined();
    expect(
      await freshCapabilities(
        account(() => Promise.reject(new TypeError('Failed to fetch'))),
        SERVER,
      ),
    ).toBeUndefined();
  });

  it('never makes the vault wait long for a server that does not answer', fakeAsync(() => {
    let result: unknown = 'pending';
    void freshCapabilities(
      account(() => new Promise<never>(() => undefined)),
      SERVER,
    ).then((value) => (result = value));
    tick(CAPABILITIES_WAIT_MS - 1);
    expect(result).toBe('pending');
    tick(1);
    expect(result).toBeUndefined();
  }));

  it('does not leave its timer behind once the server answered', fakeAsync(() => {
    void freshCapabilities(
      account(() => Promise.resolve(capabilities())),
      SERVER,
    );
    tick(0);
    // fakeAsync fails the test when a timer is still pending at its end.
  }));
});
