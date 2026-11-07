import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import {
  AccountClient,
  type SyncClient,
  type SyncState,
} from '@sp/sync-providers/ultra-tasks';
import { GlobalConfigService } from '../config/global-config.service';
import { NativeSyncPlatformService } from './native-sync-platform.service';

describe('NativeSyncPlatformService', () => {
  let service: NativeSyncPlatformService;
  let original: unknown;
  let bridge: { nativeAccountCall: jasmine.Spy };
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const host = window as unknown as { SUPAndroid?: unknown };
  beforeEach(() => {
    original = host.SUPAndroid;
    calls.length = 0;
    bridge = {
      nativeAccountCall: jasmine
        .createSpy('nativeAccountCall')
        .and.callFake((requestId: string, method: string, payload: string) => {
          calls.push({ method, input: JSON.parse(payload) as Record<string, unknown> });
          window.dispatchEvent(
            new CustomEvent('ultra-native-account', {
              detail: {
                requestId,
                ok: true,
                data: {
                  accessToken: 'native-access',
                  refreshToken: 'native-refresh',
                  expiresIn: 600,
                },
              },
            }),
          );
        }),
    };
    host.SUPAndroid = bridge;
    TestBed.configureTestingModule({
      providers: [
        NativeSyncPlatformService,
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => ({ reminder: { disableReminders: false } }) },
        },
        { provide: TranslateService, useValue: { instant: (value: string) => value } },
      ],
    });
    service = TestBed.inject(NativeSyncPlatformService);
  });
  afterEach(async () => {
    await service.clear();
    host.SUPAndroid = original;
  });
  const client = (): SyncClient => {
    const account = new AccountClient(async () => undefined);
    account.capabilities = { protocol: 2, serverId: 'server', features: {} };
    account.account = {
      id: 'me',
      email: 'me@example.test',
      username: 'me',
      displayName: '',
      vaultVersion: 1,
    };
    account.tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 };
    account.unlocked = {
      masterKey: 'must-not-leave-vault',
      secrets: { signingPrivateKey: { d: 'private-signing-key' } } as NonNullable<
        AccountClient['unlocked']
      >['secrets'],
    };
    const scope = {
      id: 'project',
      kind: 'project',
      ownerId: 'owner',
      ownerKey: { kty: 'EC' },
      epoch: 1,
      generation: 1,
      controlVersion: 1,
      sequence: 2,
      state: 'active',
      members: [],
    };
    return {
      account,
      state: {
        scopes: {
          project: { info: scope, key: 'project-key' },
          personal: {
            info: { ...scope, id: 'personal', kind: 'personal' },
            key: 'personal-key',
          },
        },
      } as unknown as SyncState,
      records: (id: string) =>
        id === 'personal'
          ? {
              overlay: {
                entityType: 'personal.overlay',
                value: {
                  scopeId: 'project',
                  taskId: 'task',
                  label: 'label',
                  remindAt: Date.now() + 3600000,
                },
              },
            }
          : {},
      record: () => ({ value: { title: 'Shared task', isDone: false } }),
    } as unknown as SyncClient;
  };
  it('binds only the session, hands off narrow keys after linking, and uses one refresh owner', async () => {
    const fixture = client();
    const base = jasmine.createSpy('transport').and.resolveTo({});
    await service.bind(
      fixture,
      'https://sync.example.test',
      async () => undefined,
      async () => undefined,
    );
    const payload = JSON.stringify(calls[0].input);
    expect(calls[0].input['scopes']).toEqual([]);
    expect(payload).not.toContain('project-key');
    expect(payload).not.toContain('personal-key');
    expect(payload).not.toContain('must-not-leave-vault');
    expect(payload).not.toContain('private-signing-key');
    await service.update(fixture);
    const scopePayload = JSON.stringify(calls.find((call) => call.method === 'scopes'));
    expect(scopePayload).toContain('project-key');
    expect(scopePayload).toContain('personal-key');
    expect(scopePayload).not.toContain('must-not-leave-vault');
    expect(scopePayload).not.toContain('private-signing-key');
    const wrapped = service.transport(base);
    expect(
      await wrapped('/sessions/refresh', { refreshToken: 'stale-web-cache' }),
    ).toEqual({
      accessToken: 'native-access',
      refreshToken: 'native-refresh',
      expiresIn: 600,
    });
    expect(base).not.toHaveBeenCalled();
    expect(calls.at(-1)).toEqual({
      method: 'refresh',
      input: { serverId: 'server', accountId: 'me' },
    });
  });
  it('schedules private shared reminders from local state and removes keys and alarms after revocation', async () => {
    const fixture = client();
    await service.bind(
      fixture,
      'https://sync.example.test',
      async () => undefined,
      async () => undefined,
    );
    await service.update(fixture);
    const first = [...calls].reverse().find((call) => call.method === 'local-reminders')!;
    expect(first.input['reminders']).toEqual(
      jasmine.objectContaining({
        ['native:project:task']: jasmine.objectContaining({
          shared: true,
          title: 'Shared task',
        }),
      }),
    );
    fixture.state.scopes['project'].revoked = true;
    await service.update(fixture);
    expect(
      [...calls].reverse().find((call) => call.method === 'local-reminders')!.input[
        'reminders'
      ],
    ).toEqual({});
    const scopes = [...calls].reverse().find((call) => call.method === 'scopes')!.input[
      'scopes'
    ] as { id: string }[];
    expect(scopes.map((scope) => scope.id)).toEqual(['personal']);
  });
  it('surfaces keystore failure and retains no plaintext credential fallback', async () => {
    bridge.nativeAccountCall.and.throwError('Keystore unavailable');
    await expectAsync(
      service.bind(
        client(),
        'https://sync.example.test',
        async () => undefined,
        async () => undefined,
      ),
    ).toBeRejectedWithError('Keystore unavailable');
    bridge.nativeAccountCall.and.callFake(() => {
      throw new Error('Keystore unavailable');
    });
    // No account is bound after failure, so its new foreground session retains
    // ownership of refresh; an older native session is never fed its token.
    const base = jasmine.createSpy('transport').and.resolveTo({});
    await service.transport(base)('/sessions/refresh', { refreshToken: 'new-session' });
    expect(base).toHaveBeenCalled();
    bridge.nativeAccountCall.and.callFake((requestId: string) =>
      window.dispatchEvent(
        new CustomEvent('ultra-native-account', {
          detail: { requestId, ok: true, data: {} },
        }),
      ),
    );
  });
});
