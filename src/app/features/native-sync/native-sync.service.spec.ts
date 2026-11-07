import { TestBed } from '@angular/core/testing';
import { AccountClient, SyncClient, randomKey, open } from '@ultra-tasks/account-crypto';
import { NativeSyncPlatformService } from './native-sync-platform.service';
import { NativeSyncService } from './native-sync.service';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import { CertTrustService } from '../issue/cert-trust.service';

describe('NativeSyncService', () => {
  let service: NativeSyncService;
  let certTrust: jasmine.SpyObj<CertTrustService>;
  beforeEach(() => {
    certTrust = jasmine.createSpyObj('CertTrustService', ['setPendingConfig']);
    certTrust.setPendingConfig.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        NativeSyncService,
        { provide: CertTrustService, useValue: certTrust },
        {
          provide: NativeSyncPlatformService,
          useValue: {
            transport: (base: unknown) => base,
            bind: async () => undefined,
            update: async () => undefined,
            current: async () => undefined,
            clear: async () => undefined,
          },
        },
        {
          provide: NativePersonalBridgeService,
          useValue: { bind: async () => true, clear: () => undefined },
        },
      ],
    });
    service = TestBed.inject(NativeSyncService);
  });
  afterEach(async () => {
    await service.lock();
    localStorage.removeItem('ultra-native-account:http://localhost:1900');
  });
  it('rejects insecure remote endpoints before sending credentials', async () => {
    await expectAsync(
      service.login('http://remote.example.com', 'alice', 'password'),
    ).toBeRejectedWithError('NATIVE_SYNC.ERROR_URL');
    expect(service.account).toBeUndefined();
    expect(certTrust.setPendingConfig).not.toHaveBeenCalled();
  });
  it('awaits certificate trust before sign-in and retains it through MFA until lock', async () => {
    let acknowledge!: () => void;
    certTrust.setPendingConfig.and.returnValue(
      new Promise<void>((resolve) => (acknowledge = resolve)),
    );
    const login = spyOn(AccountClient.prototype, 'login').and.resolveTo({
      mfaToken: 'pending-factor',
    });
    const done = service.login(' https://account.example.test/ ', 'alice', 'password');
    expect(certTrust.setPendingConfig).toHaveBeenCalledWith(service, {
      baseUrl: 'https://account.example.test',
    });
    expect(login).not.toHaveBeenCalled();
    acknowledge();
    expect(await done).toBe(false);
    await service.lock();
    expect(certTrust.setPendingConfig).toHaveBeenCalledWith(service, null);
  });
  it('revokes the unsaved endpoint when sign-in fails', async () => {
    spyOn(AccountClient.prototype, 'login').and.rejectWith(new Error('Sign-in rejected'));
    await expectAsync(
      service.login('https://account.example.test', 'alice', 'password'),
    ).toBeRejectedWithError('Sign-in rejected');
    expect(certTrust.setPendingConfig.calls.mostRecent().args).toEqual([service, null]);
  });
  it('schedules personal sync every 60 seconds, resumes online, and stops when locked', async () => {
    spyOn(AccountClient.prototype, 'login').and.callFake(async function (
      this: AccountClient,
    ) {
      this.capabilities = { serverId: 'server', protocol: 2, features: {} };
      this.account = {
        id: 'account',
        email: 'a@example.test',
        username: 'alice',
        displayName: '',
        vaultVersion: 1,
      };
      this.unlocked = {
        masterKey: randomKey(),
        secrets: {} as NonNullable<AccountClient['unlocked']>['secrets'],
      };
      this.tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 };
      return this.tokens;
    });
    spyOn(SyncClient.prototype, 'init').and.callFake(async function (this: SyncClient) {
      this.state = { scopes: {} } as SyncClient['state'];
    });
    spyOn(SyncClient.prototype, 'refreshScopes').and.resolveTo([]);
    const sync = spyOn(service, 'syncNow').and.resolveTo();
    jasmine.clock().install();
    try {
      await service.login('http://localhost:1900', 'alice', 'password');
      expect(sync).toHaveBeenCalledTimes(1);
      jasmine.clock().tick(59999);
      expect(sync).toHaveBeenCalledTimes(1);
      jasmine.clock().tick(1);
      expect(sync).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event('online'));
      expect(sync).toHaveBeenCalledTimes(3);
      const accountKey = service.account!.unlocked!.masterKey;
      spyOn(TestBed.inject(NativeSyncPlatformService), 'clear').and.resolveTo({
        accessToken: 'native-access',
        refreshToken: 'latest-native-refresh',
        expiresIn: 500,
      });
      await service.lock();
      const cached = JSON.parse(
        localStorage.getItem('ultra-native-account:http://localhost:1900')!,
      );
      expect(
        await open(
          accountKey,
          cached.refresh,
          JSON.stringify({
            serverId: 'server',
            accountId: 'account',
            purpose: 'native-session',
          }),
        ),
      ).toBe('latest-native-refresh');
      jasmine.clock().tick(60000);
      window.dispatchEvent(new Event('online'));
      expect(sync).toHaveBeenCalledTimes(3);
    } finally {
      jasmine.clock().uninstall();
    }
    const saved = localStorage.getItem('ultra-native-account:http://localhost:1900')!;
    expect(saved).not.toContain('"refreshToken"');
    expect(saved).not.toContain('"masterKey"');
  });
});
