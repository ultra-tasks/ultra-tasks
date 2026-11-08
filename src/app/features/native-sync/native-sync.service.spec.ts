import { TestBed } from '@angular/core/testing';
import {
  AccountClient,
  SyncClient,
  randomKey,
  open,
} from '@sp/sync-providers/ultra-tasks';
import { NativeSyncPlatformService } from './native-sync-platform.service';
import { NativeSyncService } from './native-sync.service';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import { CertTrustService } from '../issue/cert-trust.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { Subject } from 'rxjs';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import type { Action } from '@ngrx/store';

describe('NativeSyncService', () => {
  let service: NativeSyncService;
  let actions: Subject<Action>;
  let certTrust: jasmine.SpyObj<CertTrustService>;
  beforeEach(() => {
    actions = new Subject<Action>();
    certTrust = jasmine.createSpyObj('CertTrustService', ['setPendingConfig']);
    certTrust.setPendingConfig.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        NativeSyncService,
        { provide: CertTrustService, useValue: certTrust },
        { provide: LOCAL_ACTIONS, useValue: actions },
        {
          provide: OperationWriteFlushService,
          useValue: { flushPendingWrites: async () => undefined },
        },
        {
          provide: NativeSyncPlatformService,
          useValue: {
            transport: (base: unknown) => base,
            bind: async () => undefined,
            update: async () => undefined,
            current: async () => undefined,
            clear: async () => undefined,
            reminderBarrier: async () => undefined,
            personalSynced: async () => undefined,
          },
        },
        {
          provide: NativePersonalBridgeService,
          useValue: {
            bind: async () => true,
            clear: () => undefined,
            capture: async () => undefined,
            apply: async () => undefined,
            scopeId: 'personal',
          },
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
    await expectAsync(service.openAccount('javascript:alert(1)')).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_URL',
    );
  });
  it('awaits certificate trust before sign-in and retains it through MFA until lock', async () => {
    let acknowledge!: () => void;
    certTrust.setPendingConfig.and.returnValue(
      new Promise<void>((resolve) => (acknowledge = resolve)),
    );
    const login = spyOn(AccountClient.prototype, 'login').and.resolveTo({
      mfaToken: 'pending-factor',
      factors: ['totp'],
    });
    const done = service.login(' https://account.example.test/ ', 'alice', 'password');
    expect(certTrust.setPendingConfig).toHaveBeenCalledWith(service, {
      baseUrl: 'https://account.example.test',
    });
    expect(login).not.toHaveBeenCalled();
    acknowledge();
    expect(await done).toBe(false);
    expect(service.mfaMethods()).toEqual(['totp']);
    await service.lock();
    expect(service.mfaMethods()).toEqual([]);
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
      actions.next({ type: 'local edit', meta: { isPersistent: true } } as Action);
      actions.next({
        type: 'another local edit',
        meta: { isPersistent: true },
      } as Action);
      jasmine.clock().tick(499);
      expect(sync).toHaveBeenCalledTimes(3);
      jasmine.clock().tick(1);
      expect(sync).toHaveBeenCalledTimes(4);
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
      expect(sync).toHaveBeenCalledTimes(4);
    } finally {
      jasmine.clock().uninstall();
    }
    const saved = localStorage.getItem('ultra-native-account:http://localhost:1900')!;
    expect(saved).not.toContain('"refreshToken"');
    expect(saved).not.toContain('"masterKey"');
  });
  const preparePrivateClient = (): SyncClient => {
    const account = new AccountClient(async () => ({}));
    account.capabilities = {
      protocol: 2,
      serverId: 'test',
      features: { sharedProjects: false, scopeRecovery: true },
    };
    account.tokens = { accessToken: 'test', refreshToken: 'test', expiresIn: 600 };
    service.account = account;
    const client = new SyncClient(account, {
      load: async () => null,
      save: async () => undefined,
    });
    client.state = { scopes: {} } as SyncClient['state'];
    service.client = client;
    service.unlocked.set(true);
    spyOn(client, 'refreshScopes').and.resolveTo([]);
    return client;
  };
  it('does not call sharing endpoints on a private server', async () => {
    const client = preparePrivateClient();
    const invitations = spyOn(client, 'invitations');
    const offers = spyOn(client, 'ownershipOffers');
    await service.refresh();
    expect(invitations).not.toHaveBeenCalled();
    expect(offers).not.toHaveBeenCalled();
    expect(service.sharingEnabled()).toBeFalse();
  });
  it('captures only after pending operation writes finish and repeats for edits arriving during a sync', async () => {
    const client = preparePrivateClient();
    service.linked.set(true);
    let release!: () => void;
    const durable = new Promise<void>((resolve) => {
      release = resolve;
    });
    spyOn(
      TestBed.inject(OperationWriteFlushService),
      'flushPendingWrites',
    ).and.returnValues(durable, Promise.resolve());
    const capture = spyOn(
      TestBed.inject(NativePersonalBridgeService),
      'capture',
    ).and.resolveTo();
    const upload = spyOn(client, 'syncAll').and.resolveTo({});
    const first = service.syncNow();
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    const coalesced = service.syncNow();
    expect(coalesced).toBe(first);
    release();
    await first;
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
