import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AccountApiError,
  AccountClient,
  SyncClient,
  createAccountBundle,
  randomKey,
  open,
  type AccountBundle,
  type DeviceVerification,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';
import { NativeSyncPlatformService } from './native-sync-platform.service';
import { NativeSyncService } from './native-sync.service';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import { CertTrustService } from '../issue/cert-trust.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { Subject } from 'rxjs';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import type { Action } from '@ngrx/store';
import { GlobalConfigService } from '../config/global-config.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { AccountDataSummaryService } from './account-data-summary.service';
import { NativeDeviceTrustService } from './native-device-trust.service';
import {
  NativeSessionStoreService,
  type StoredAccountSession,
} from './native-session-store.service';

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
          provide: GlobalConfigService,
          useValue: {
            sync: () => ({ isEnabled: false }),
            updateSection: jasmine.createSpy('updateSection'),
          },
        },
        {
          provide: SyncWrapperService,
          useValue: { runWithSyncBlocked: async (run: () => Promise<void>) => run() },
        },
        {
          provide: BackupService,
          useValue: {
            captureImportBackup: jasmine
              .createSpy('captureImportBackup')
              .and.resolveTo({}),
          },
        },
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
          provide: Router,
          useValue: {
            url: '/native-sync',
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
          },
        },
        {
          provide: AccountDataSummaryService,
          useValue: {
            local: async () => ({
              tasks: 0,
              projects: 0,
              notes: 0,
              archived: 0,
              hasUserData: false,
            }),
            fromRecords: () => ({
              tasks: 0,
              projects: 0,
              notes: 0,
              archived: 0,
              hasUserData: false,
            }),
          },
        },
        {
          provide: NativeSessionStoreService,
          useValue: {
            supported: false,
            save: jasmine.createSpy('save').and.resolveTo(),
            clear: jasmine.createSpy('clear').and.resolveTo(),
            load: jasmine.createSpy('load').and.resolveTo({ state: 'none' }),
          },
        },
        {
          provide: NativePersonalBridgeService,
          useValue: {
            bind: async () => true,
            clear: () => undefined,
            unlink: jasmine.createSpy('unlink').and.resolveTo(),
            capture: async () => undefined,
            apply: async () => undefined,
            migrate: jasmine.createSpy('migrate').and.resolveTo(),
            scopeId: 'personal',
          },
        },
      ],
    });
    service = TestBed.inject(NativeSyncService);
    // Signing in reads the server's identity first (to look up this device's trust marker).
    spyOn(AccountClient.prototype, 'init').and.callFake(async function (
      this: AccountClient,
    ) {
      this.capabilities = {
        serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
        protocol: 2,
        features: {},
      };
      return this.capabilities;
    });
  });
  afterEach(async () => {
    await service.lock();
    localStorage.removeItem('ultra-native-account:http://localhost:1900');
    localStorage.removeItem('ultra-native-device-trust');
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
  it('opens the account website, optionally on its create-account view', async () => {
    const windowOpen = spyOn(window, 'open');
    await service.openAccount('https://account.example.test');
    expect(windowOpen).toHaveBeenCalledWith(
      'https://account.example.test/account',
      '_blank',
      'noopener,noreferrer',
    );
    await service.openAccount('https://account.example.test/', 'signup');
    expect(windowOpen).toHaveBeenCalledWith(
      'https://account.example.test/account?view=signup',
      '_blank',
      'noopener,noreferrer',
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
      // A wake reports "online" and "visible" together: one sync, once the network settled.
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(sync).toHaveBeenCalledTimes(2);
      jasmine.clock().tick(1500);
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
      expect(service.configured()).toBeTrue();
      expect(TestBed.inject(NativePersonalBridgeService).unlink).not.toHaveBeenCalled();
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
    const reopened = TestBed.runInInjectionContext(() => new NativeSyncService());
    expect(reopened.configured()).toBeTrue();
    await reopened.disconnect();
    expect(reopened.configured()).toBeFalse();
    expect(TestBed.inject(NativePersonalBridgeService).unlink).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ultra-native-account:http://localhost:1900')).toBeNull();
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
  it('stops the writer before retiring the explicit disconnect baseline', async () => {
    let release!: () => void;
    spyOn(service, 'lock').and.returnValue(
      new Promise<void>((resolve) => (release = resolve)),
    );
    const unlink = TestBed.inject(NativePersonalBridgeService).unlink;
    const disconnect = service.disconnect();
    expect(unlink).not.toHaveBeenCalled();
    release();
    await disconnect;
    expect(unlink).toHaveBeenCalledTimes(1);
  });
  it('retires the baseline when an unlocked account is explicitly disconnected', async () => {
    const client = preparePrivateClient();
    spyOn(client.account, 'request').and.resolveTo([]);
    await service.disconnect();
    expect(TestBed.inject(NativePersonalBridgeService).unlink).toHaveBeenCalledTimes(1);
    expect(service.configured()).toBeFalse();
  });
  it('signs out without a network: the credential is forgotten here and nothing is reported as failed', async () => {
    const client = preparePrivateClient();
    spyOn(client.account, 'request').and.rejectWith(new TypeError('Failed to fetch'));
    await service.logout();
    expect(TestBed.inject(NativePersonalBridgeService).unlink).toHaveBeenCalledTimes(1);
    expect(
      (TestBed.inject(NativeSessionStoreService) as unknown as { clear: jasmine.Spy })
        .clear,
    ).toHaveBeenCalled();
    expect(service.configured()).toBeFalse();
    expect(service.unlocked()).toBeFalse();
  });
  it('still signs out here, and reports it, when the server fails for another reason', async () => {
    const client = preparePrivateClient();
    spyOn(client.account, 'request').and.rejectWith(new AccountApiError(500, 'Broken'));
    await expectAsync(service.logout()).toBeRejected();
    expect(TestBed.inject(NativePersonalBridgeService).unlink).toHaveBeenCalledTimes(1);
    expect(service.configured()).toBeFalse();
  });
  it('does not restore a deleted account when native credential detachment returns tokens', async () => {
    const client = preparePrivateClient();
    const account = client.account;
    service.serverUrl = 'http://localhost:1900';
    account.account = {
      id: 'delete-account-fixture',
      email: 'delete@example.test',
      username: 'delete-test',
      displayName: '',
      vaultVersion: 1,
    };
    account.unlocked = {
      masterKey: randomKey(),
      secrets: {} as NonNullable<AccountClient['unlocked']>['secrets'],
    };
    spyOn(account, 'deleteAccount').and.resolveTo();
    spyOn(TestBed.inject(NativeSyncPlatformService), 'clear').and.resolveTo({
      accessToken: 'detached',
      refreshToken: 'detached-refresh',
      expiresIn: 600,
    });
    await service.deleteAccount();
    expect(service.configured()).toBeFalse();
    expect(localStorage.getItem('ultra-native-account:http://localhost:1900')).toBeNull();
  });
  it('does not call sharing endpoints on a private server', async () => {
    const client = preparePrivateClient();
    const invitations = spyOn(client, 'invitations');
    const offers = spyOn(client, 'ownershipOffers');
    await service.refresh();
    expect(invitations).not.toHaveBeenCalled();
    expect(offers).not.toHaveBeenCalled();
    expect(service.sharingEnabled()).toBeFalse();
  });
  it('leaves the old provider enabled when the account cannot be checked', async () => {
    const client = preparePrivateClient();
    (client.refreshScopes as jasmine.Spy).and.rejectWith(new Error('offline'));
    const config = TestBed.inject(GlobalConfigService);
    spyOn(config, 'sync').and.returnValue({ isEnabled: true } as ReturnType<
      typeof config.sync
    >);
    const backup = TestBed.inject(BackupService).captureImportBackup as jasmine.Spy;
    await expectAsync(service.link(true)).toBeRejectedWithError('offline');
    expect(backup).not.toHaveBeenCalled();
    expect(config.updateSection).not.toHaveBeenCalled();
    expect(service.linked()).toBeFalse();
  });
  it('does not turn off the old provider if its recovery snapshot fails', async () => {
    preparePrivateClient();
    const config = TestBed.inject(GlobalConfigService);
    spyOn(config, 'sync').and.returnValue({ isEnabled: true } as ReturnType<
      typeof config.sync
    >);
    const backup = TestBed.inject(BackupService).captureImportBackup as jasmine.Spy;
    backup.and.rejectWith(new Error('no local storage'));
    await expectAsync(service.link(true)).toBeRejectedWithError('no local storage');
    expect(config.updateSection).not.toHaveBeenCalled();
    expect(TestBed.inject(NativePersonalBridgeService).migrate).not.toHaveBeenCalled();
  });
  it('does not upload account changes until the user connects personal data', async () => {
    const client = preparePrivateClient();
    const upload = spyOn(client, 'syncAll').and.resolveTo({});
    await service.syncNow();
    expect(upload).not.toHaveBeenCalled();
  });
  describe('the first connection of a device to the account', () => {
    const scope = {
      id: 'personal',
      kind: 'personal',
      state: 'active',
      sequence: 3,
      generation: 1,
      controlVersion: 1,
    } as ReturnType<typeof service.scopes>[number];
    type FakeBridge = {
      scopeId?: string;
      bind: () => Promise<boolean>;
      useExisting: jasmine.Spy;
    };
    const prepareAccount = (): SyncClient => {
      const client = preparePrivateClient();
      (client.refreshScopes as jasmine.Spy).and.resolveTo([scope]);
      client.state.scopes = {
        personal: {
          info: scope,
          key: '',
          counter: 0,
          heads: {},
          intents: [],
          conflicts: [],
        },
      };
      client.state.migrations = {};
      spyOn(client, 'syncScope').and.resolveTo();
      spyOn(client, 'syncAll').and.resolveTo({});
      const bridge = TestBed.inject(NativePersonalBridgeService) as unknown as FakeBridge;
      bridge.scopeId = undefined;
      bridge.bind = async () => {
        bridge.scopeId = 'personal';
        return false;
      };
      bridge.useExisting = jasmine.createSpy('useExisting').and.resolveTo();
      return client;
    };

    it('says why it is unfinished when the account cannot be looked at, and creates nothing', async () => {
      const client = preparePrivateClient();
      (client.refreshScopes as jasmine.Spy).and.rejectWith(
        new TypeError('Failed to fetch'),
      );
      await service.resumeDataConnection();
      expect(service.connection()).toBe('failed');
      expect(service.offline()).toBeTrue();
      expect(service.error()).toBe('ACCOUNT_DATA.ERROR_DISCOVERY');
      expect(service.status()).toBe('ACCOUNT_DATA.OFFLINE');
      expect(service.phase()).toBe('choose-data');
      expect(service.linked()).toBeFalse();
      expect(TestBed.inject(NativePersonalBridgeService).migrate).not.toHaveBeenCalled();
    });

    it('downloads the account by itself on an empty device and ends on the task workspace', async () => {
      prepareAccount();
      const bridge = TestBed.inject(NativePersonalBridgeService) as unknown as FakeBridge;
      await service.resumeDataConnection();
      expect(bridge.useExisting).toHaveBeenCalledTimes(1);
      expect(service.linked()).toBeTrue();
      expect(service.dataChoice()).toBeNull();
      expect(service.connection()).toBe('idle');
      expect(service.phase()).toBe('synced');
      expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('does not depend on an old provider being enabled: the switch retires it, with a recovery copy', async () => {
      prepareAccount();
      const config = TestBed.inject(GlobalConfigService);
      spyOn(config, 'sync').and.returnValue({ isEnabled: true } as ReturnType<
        typeof config.sync
      >);
      const bridge = TestBed.inject(NativePersonalBridgeService) as unknown as FakeBridge;
      await service.resumeDataConnection();
      expect(service.dataChoice()).toBeNull();
      expect(bridge.useExisting).toHaveBeenCalledTimes(1);
      expect(
        TestBed.inject(BackupService).captureImportBackup as jasmine.Spy,
      ).toHaveBeenCalledOnceWith('LOCAL_IMPORT');
      expect(config.updateSection).toHaveBeenCalledWith(
        'sync',
        { isEnabled: false },
        true,
      );
      expect(service.linked()).toBeTrue();
    });

    it('refuses the download when something was edited between measuring the device and the switch, and asks', async () => {
      prepareAccount();
      const bridge = TestBed.inject(NativePersonalBridgeService) as unknown as FakeBridge;
      // What the real bridge does: it refuses at its last look when the person edited meanwhile.
      bridge.useExisting.and.callFake(async (assertUnchanged?: () => void) =>
        assertUnchanged?.(),
      );
      const summary = TestBed.inject(AccountDataSummaryService) as unknown as {
        local: () => Promise<unknown>;
        fromRecords: () => unknown;
      };
      const real = { tasks: 1, projects: 0, notes: 0, archived: 0, hasUserData: true };
      let measured = 0;
      summary.local = async () => {
        // The edit lands right after the device was found empty, before the switch starts.
        if (++measured === 1) {
          actions.next({ type: 'Add task', meta: { isPersistent: true } } as Action);
          return { tasks: 0, projects: 0, notes: 0, archived: 0, hasUserData: false };
        }
        return real;
      };
      summary.fromRecords = () => ({ ...real, tasks: 9 });
      await service.resumeDataConnection();
      // The switch looked, found the edit and stopped: nothing was replaced.
      expect(bridge.useExisting).toHaveBeenCalledTimes(1);
      expect(service.linked()).toBeFalse();
      // The device now holds real work, so the person is asked instead.
      expect(service.dataChoice()).toEqual(
        jasmine.objectContaining({ local: real, account: { ...real, tasks: 9 } }),
      );
      expect(service.dataNotice()).toBe('ACCOUNT_DATA.NOTICE_LOCAL_CHANGED');
    });

    it('treats a failure after the switch committed as a sync failure, not as an unfinished connection', async () => {
      const client = prepareAccount();
      // The first look finds the account, the switch's own look works, the follow-up listing fails.
      let listings = 0;
      (client.refreshScopes as jasmine.Spy).and.callFake(async () => {
        if (++listings >= 3) throw new TypeError('Failed to fetch');
        return [scope];
      });
      await service.resumeDataConnection();
      expect(listings).toBeGreaterThanOrEqual(3);
      expect(service.linked()).toBeTrue();
      expect(service.connection()).toBe('idle');
      expect(service.dataChoice()).toBeNull();
      expect(service.offline()).toBeTrue();
      expect(service.phase()).toBe('synced');
      // The next successful sync clears the offline flag and the page stays on its tasks.
      (client.refreshScopes as jasmine.Spy).and.resolveTo([scope]);
      await service.syncNow();
      expect(service.offline()).toBeFalse();
      expect(service.phase()).toBe('synced');
    });

    it('asks, and replaces nothing, when both sides hold real work', async () => {
      prepareAccount();
      const summary = TestBed.inject(AccountDataSummaryService) as unknown as {
        local: () => Promise<unknown>;
        fromRecords: () => unknown;
      };
      const real = { tasks: 2, projects: 0, notes: 0, archived: 0, hasUserData: true };
      summary.local = async () => real;
      summary.fromRecords = () => ({ ...real, tasks: 9 });
      const bridge = TestBed.inject(NativePersonalBridgeService) as unknown as FakeBridge;
      await service.resumeDataConnection();
      expect(service.phase()).toBe('choose-data');
      expect(service.dataChoice()).toEqual(
        jasmine.objectContaining({ local: real, account: { ...real, tasks: 9 } }),
      );
      expect(bridge.useExisting).not.toHaveBeenCalled();
      expect(TestBed.inject(BackupService).captureImportBackup).not.toHaveBeenCalled();
      expect(service.linked()).toBeFalse();
    });
  });
  it('asks for a choice if another device initializes the account during automatic setup', async () => {
    const client = preparePrivateClient();
    const scope = {
      id: 'personal',
      kind: 'personal',
      sequence: 1,
      generation: 1,
      controlVersion: 1,
    } as ReturnType<typeof service.scopes>[number];
    (client.refreshScopes as jasmine.Spy).and.resolveTo([scope]);
    TestBed.inject(NativePersonalBridgeService).scopeId = undefined;
    await service.link(true, true);
    expect(service.linked()).toBeFalse();
    expect(service.scopes()).toEqual([scope]);
    expect(TestBed.inject(GlobalConfigService).updateSection).not.toHaveBeenCalled();
    expect(TestBed.inject(NativePersonalBridgeService).migrate).not.toHaveBeenCalled();
  });
  it('refuses to replace account data if it changed while the user was choosing', async () => {
    const client = preparePrivateClient();
    const old = {
      id: 'personal',
      kind: 'personal',
      sequence: 1,
      generation: 1,
      controlVersion: 1,
    } as ReturnType<typeof service.scopes>[number];
    const newer = { ...old, sequence: 2 };
    service.scopes.set([old]);
    client.state.scopes = {
      personal: { info: old, key: '', counter: 0, heads: {}, intents: [], conflicts: [] },
    };
    client.state.migrations = {};
    (client.refreshScopes as jasmine.Spy).and.resolveTo([newer]);
    await expectAsync(service.link(true)).toBeRejectedWithError(
      'NATIVE_SYNC.ERROR_REMOTE_CHANGED',
    );
    expect(TestBed.inject(GlobalConfigService).updateSection).not.toHaveBeenCalled();
    expect(TestBed.inject(NativePersonalBridgeService).migrate).not.toHaveBeenCalled();
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

  describe('what every surface can read: phase, offline, last sync, pending changes', () => {
    type Internals = {
      dataConnection: {
        stage: { set(value: string): void };
        connect: () => Promise<void>;
      };
    };
    const internals = (): Internals => service as unknown as Internals;
    const sessions = (): {
      supported: boolean;
      save: jasmine.Spy;
      clear: jasmine.Spy;
    } => TestBed.inject(NativeSessionStoreService) as never;

    it('derives the phase from engine events, never from an open socket', () => {
      expect(service.phase()).toBe('signed-out');
      service.configured.set(true);
      expect(service.phase()).toBe('locked');
      expect(service.reconnect()).toBe('unlock');
      service.signingIn.set(true);
      expect(service.phase()).toBe('signing-in');
      service.signingIn.set(false);
      service.status.set('NATIVE_SYNC.MFA');
      expect(service.phase()).toBe('signing-in');
      service.status.set('NATIVE_SYNC.LOCKED');
      service.unlocked.set(true);
      expect(service.phase()).toBe('choose-data');
      for (const [stage, phase] of [
        ['discovering', 'signing-in'],
        ['downloading', 'downloading'],
        ['applying', 'applying'],
        ['uploading', 'syncing'],
        ['failed', 'choose-data'],
        ['waiting', 'choose-data'],
      ] as const) {
        internals().dataConnection.stage.set(stage);
        expect(service.phase()).toBe(phase);
      }
      internals().dataConnection.stage.set('idle');
      // Vault open, nothing discovered yet: the connection is starting, not unfinished.
      service.signingIn.set(true);
      expect(service.phase()).toBe('signing-in');
      service.signingIn.set(false);
      expect(service.phase()).toBe('choose-data');
      service.linked.set(true);
      expect(service.phase()).toBe('synced');
      service.live.set(true);
      expect(service.phase()).toBe('synced');
      service.busy.set(true);
      expect(service.phase()).toBe('syncing');
      service.busy.set(false);
      service.reauth.set(true);
      expect(service.phase()).toBe('reauth');
      expect(service.reconnect()).toBe('sign-in');
    });

    it('success sets the last sync only once everything including the apply finished', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      const apply = spyOn(TestBed.inject(NativePersonalBridgeService), 'apply');
      let finish!: () => void;
      apply.and.returnValue(new Promise<void>((resolve) => (finish = resolve)));
      spyOn(client, 'syncAll').and.resolveTo({});
      const syncing = service.syncNow();
      await new Promise((resolve) => setTimeout(resolve));
      // Uploaded and downloaded, but the apply is still running: not "synced" yet.
      expect(service.lastSyncedAt()).toBeNull();
      expect(service.status()).toBe('ACCOUNT_DATA.SYNCING');
      finish();
      await syncing;
      expect(service.lastSyncedAt()).toEqual(jasmine.any(Number));
      expect(service.status()).toBe('NATIVE_SYNC.SYNCED');
      expect(service.error()).toBe('');
    });

    it('clears a stale success when new work starts and shows a failure ahead of it', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      const upload = spyOn(client, 'syncAll');
      upload.and.resolveTo({});
      await service.syncNow();
      const synced = service.lastSyncedAt();
      expect(service.status()).toBe('NATIVE_SYNC.SYNCED');
      upload.and.rejectWith(new Error('Concurrent changes are still arriving'));
      await service.syncNow();
      expect(service.status()).toBe('ACCOUNT_DATA.SYNC_FAILED');
      expect(service.error()).toBe('Concurrent changes are still arriving');
      // The earlier success is history, not a claim about now.
      expect(service.lastSyncedAt()).toBe(synced);
      expect(service.offline()).toBeFalse();
    });

    it('an unreachable server is "offline": calm, nothing lost, never a revocation', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      spyOn(client, 'syncAll').and.rejectWith(new TypeError('Failed to fetch'));
      await service.syncNow();
      expect(service.offline()).toBeTrue();
      expect(service.status()).toBe('ACCOUNT_DATA.OFFLINE');
      // Not an error: surfaces read `offline()`, and no error text competes with it.
      expect(service.error()).toBe('');
      expect(service.reauth()).toBeFalse();
      expect(service.unlocked()).toBeTrue();
      expect(service.configured() || service.unlocked()).toBeTrue();
      expect(sessions().clear).not.toHaveBeenCalled();
      expect(TestBed.inject(NativePersonalBridgeService).unlink).not.toHaveBeenCalled();
    });

    it('the app’s own loops do not try while the browser says there is no network', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      const upload = spyOn(client, 'syncAll').and.resolveTo({});
      spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
      await service.syncNow(true);
      expect(upload).not.toHaveBeenCalled();
      expect(service.offline()).toBeTrue();
      expect(service.error()).toBe('');
    });

    it('a person pressing Sync now always reaches the server, whatever the browser claims', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      const upload = spyOn(client, 'syncAll').and.resolveTo({});
      // The flag is unreliable (Linux, Electron) and is exactly what the person is checking.
      spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
      await service.syncNow();
      expect(upload).toHaveBeenCalledTimes(1);
      expect(service.offline()).toBeFalse();
      expect(service.lastSyncedAt()).toEqual(jasmine.any(Number));
    });

    it('keeps a person’s request a real one when it is folded into a sync that is already running', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      let release!: () => void;
      const upload = spyOn(client, 'syncAll').and.callFake(
        () =>
          new Promise<Record<string, string>>((resolve) => (release = () => resolve({}))),
      );
      const onLine = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
      const automatic = service.syncNow(true);
      await new Promise((resolve) => setTimeout(resolve));
      onLine.and.returnValue(false);
      const manual = service.syncNow();
      upload.and.resolveTo({});
      release();
      await Promise.all([automatic, manual]);
      // The repeat pass belongs to the person: it reached the server.
      expect(upload).toHaveBeenCalledTimes(2);
      expect(service.offline()).toBeFalse();
    });

    it('success after an offline period clears offline and the error', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      const upload = spyOn(client, 'syncAll');
      upload.and.rejectWith(new TypeError('Failed to fetch'));
      await service.syncNow();
      expect(service.offline()).toBeTrue();
      upload.and.resolveTo({});
      await service.syncNow();
      expect(service.offline()).toBeFalse();
      expect(service.error()).toBe('');
      expect(service.status()).toBe('NATIVE_SYNC.SYNCED');
    });

    it('counts unsent intents (bounded, no content) after a failed attempt', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      client.state.scopes = {
        personal: {
          info: { id: 'personal', kind: 'personal' },
          intents: [{ id: 'a' }, { id: 'b' }],
          conflicts: [],
        },
      } as unknown as SyncClient['state']['scopes'];
      spyOn(client, 'syncAll').and.rejectWith(new TypeError('Failed to fetch'));
      await service.syncNow();
      expect(service.pendingChanges()).toBe(2);
    });

    it('a refused session (HTTP 401) keeps the identity and local edits and says "sign in again"', async () => {
      const client = preparePrivateClient();
      service.linked.set(true);
      service.configured.set(true);
      spyOn(client, 'syncAll').and.rejectWith(new AccountApiError(401, 'Unauthorized'));
      await service.syncNow();
      await new Promise((resolve) => setTimeout(resolve));
      await new Promise((resolve) => setTimeout(resolve));
      expect(service.reauth()).toBeTrue();
      expect(service.phase()).toBe('reauth');
      expect(service.reconnect()).toBe('sign-in');
      expect(service.configured()).toBeTrue();
      expect(service.unlocked()).toBeFalse();
      // The remembered session is dead; nothing of the person's data is touched.
      expect(sessions().clear).toHaveBeenCalled();
      expect(TestBed.inject(NativePersonalBridgeService).unlink).not.toHaveBeenCalled();
      expect(TestBed.inject(BackupService).captureImportBackup).not.toHaveBeenCalled();
    });

    it('a failed connection retries from a manual or periodic sync, but an idle unconnected device does not', async () => {
      preparePrivateClient();
      const connect = spyOn(internals().dataConnection, 'connect').and.resolveTo();
      await service.syncNow();
      expect(connect).not.toHaveBeenCalled();
      internals().dataConnection.stage.set('failed');
      await service.syncNow();
      expect(connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('trusted desktop devices remember the unlocked session', () => {
    const sessions = (): {
      supported: boolean;
      save: jasmine.Spy;
      clear: jasmine.Spy;
    } => TestBed.inject(NativeSessionStoreService) as never;
    const identity = {
      serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
      accountId: '3e2edea8-ff50-4f20-87f6-a8f0465f9945',
    };
    const cacheKey = 'ultra-native-account:http://localhost:1900';
    let masterKey: string;
    let bundle: AccountBundle;
    const info = {
      id: identity.accountId,
      email: 'restore@example.test',
      username: null,
      displayName: '',
      vaultVersion: 1,
    };
    const stored = (): StoredAccountSession => ({
      v: 1,
      serverUrl: 'http://localhost:1900',
      accountId: identity.accountId,
      serverId: identity.serverId,
      masterKey,
      refreshToken: 'R'.repeat(43),
    });

    beforeAll(async () => {
      const created = await createAccountBundle('a long enough test password', identity);
      masterKey = created.masterKey;
      bundle = created.bundle;
    });
    beforeEach(() => {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          capabilities: { protocol: 2, serverId: identity.serverId, features: {} },
          account: info,
          bundle,
          refresh: {},
        }),
      );
      spyOn(SyncClient.prototype, 'init').and.callFake(async function (this: SyncClient) {
        this.state = { scopes: {}, migrations: {} } as SyncClient['state'];
      });
      spyOn(SyncClient.prototype, 'refreshScopes').and.resolveTo([]);
      // A restored session asks the server what it can do: never a real server in a spec.
      spyOn(window, 'fetch').and.rejectWith(new TypeError('Failed to fetch'));
      sessions().supported = true;
    });
    afterEach(() => {
      localStorage.removeItem(cacheKey);
      localStorage.removeItem('ultra-native-server');
      localStorage.removeItem('ultra-native-synced:' + identity.accountId);
      localStorage.removeItem('ultra-native-deferred:' + identity.accountId);
    });

    it('reopens the same account without the password and renews the credential on first use', async () => {
      const upload = spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
      const bridge = TestBed.inject(NativePersonalBridgeService);
      spyOn(bridge, 'bind').and.resolveTo(true);
      expect(await service.restoreSession(stored())).toBe('restored');
      expect(service.unlocked()).toBeTrue();
      expect(service.linked()).toBeTrue();
      expect(service.account!.unlocked!.masterKey).toBe(masterKey);
      // The stored credential is used as is: the SDK refreshes once, before the first request.
      expect(service.account!.tokens!.refreshToken).toBe('R'.repeat(43));
      expect(upload).toHaveBeenCalledTimes(1);
      expect(service.phase()).toBe('synced');
      expect(service.accountIdentity()).toEqual({ email: info.email, id: info.id });
    });

    describe('what the server can do after an upgrade', () => {
      const answers = (answer: () => Promise<Response>): void => {
        (window.fetch as jasmine.Spy).and.callFake((input: RequestInfo | URL) =>
          String(input).endsWith('/capabilities')
            ? answer()
            : Promise.reject(new TypeError('Failed to fetch')),
        );
      };
      const upgraded = (): Response =>
        new Response(
          JSON.stringify({
            protocol: 2,
            serverId: identity.serverId,
            features: { personalReplacement: true },
          }),
          { status: 200 },
        );
      const cachedFeatures = (): Record<string, unknown> =>
        JSON.parse(localStorage.getItem(cacheKey)!).capabilities.features;

      beforeEach(() => {
        spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
        spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      });

      it('is seen after a restore, for this session and for the next start', async () => {
        answers(() => Promise.resolve(upgraded()));
        expect(cachedFeatures()['personalReplacement']).toBeUndefined();
        expect(await service.restoreSession(stored())).toBe('restored');
        expect(service.account!.capabilities!.features['personalReplacement']).toBeTrue();
        expect(cachedFeatures()['personalReplacement']).toBeTrue();
      });

      it('keeps the cached copy when the server cannot be reached', async () => {
        answers(() => Promise.reject(new TypeError('Failed to fetch')));
        expect(await service.restoreSession(stored())).toBe('restored');
        expect(service.unlocked()).toBeTrue();
        expect(
          service.account!.capabilities!.features['personalReplacement'],
        ).toBeUndefined();
        expect(cachedFeatures()['personalReplacement']).toBeUndefined();
      });

      it('refuses a restored session when a different server answers at that address', async () => {
        answers(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                protocol: 2,
                serverId: '9b1c3f5e-6a2d-4c81-8e07-5d2f9a4b7c10',
                features: {},
              }),
              { status: 200 },
            ),
          ),
        );
        expect(await service.restoreSession(stored())).toBe('invalid');
        expect(service.unlocked()).toBeFalse();
        expect(service.account).toBeUndefined();
        expect(sessions().save).not.toHaveBeenCalled();
      });
    });

    it('unlocks with the password from the cached account while the server cannot be reached, with no code step', async () => {
      (AccountClient.prototype.init as jasmine.Spy).and.rejectWith(
        new TypeError('Failed to fetch'),
      );
      const login = spyOn(AccountClient.prototype, 'login');
      spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(false);
      expect(
        await service.login(
          'http://localhost:1900',
          info.email,
          'a long enough test password',
        ),
      ).toBeTrue();
      // Nothing was asked of the server, so the device's trust was never in question.
      expect(login).not.toHaveBeenCalled();
      expect(service.unlocked()).toBeTrue();
      expect(service.deviceVerification()).toBeNull();
      expect(service.account?.account?.email).toBe(info.email);
    }, 60000);

    it('opens locally while offline: edits stay, the status says so, and nothing is cleared', async () => {
      spyOn(SyncClient.prototype, 'syncAll').and.rejectWith(
        new TypeError('Failed to fetch'),
      );
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      expect(await service.restoreSession(stored())).toBe('restored');
      expect(service.unlocked()).toBeTrue();
      expect(service.offline()).toBeTrue();
      expect(service.reauth()).toBeFalse();
      expect(sessions().clear).not.toHaveBeenCalled();
    });

    it('a revoked session found at startup ends in "sign in again", with the account kept', async () => {
      spyOn(SyncClient.prototype, 'syncAll').and.rejectWith(
        new AccountApiError(401, 'x'),
      );
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      await service.restoreSession(stored());
      await new Promise((resolve) => setTimeout(resolve));
      await new Promise((resolve) => setTimeout(resolve));
      expect(service.phase()).toBe('reauth');
      expect(service.configured()).toBeTrue();
      expect(sessions().clear).toHaveBeenCalled();
    });

    describe('a store that refuses to forget the session (a Windows file lock, say)', () => {
      const refuse = (): void => {
        sessions().clear.and.rejectWith(new Error('EBUSY: resource busy or locked'));
      };
      const settle = async (): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve));
        await new Promise((resolve) => setTimeout(resolve));
      };
      beforeEach(() => {
        spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      });

      it('still closes the vault on an explicit lock, and says the saved sign-in may remain', async () => {
        spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
        await service.restoreSession(stored());
        refuse();
        await expectAsync(service.lock()).toBeResolved();
        expect(service.unlocked()).toBeFalse();
        expect(service.account).toBeUndefined();
        expect(service.configured()).toBeTrue();
        expect(service.backgroundError()).toBe('ACCOUNT_DATA.ERROR_STORAGE_CLEAR');
      });

      it('still ends a revoked session: the vault closes and the account asks to sign in again', async () => {
        spyOn(SyncClient.prototype, 'syncAll').and.rejectWith(
          new AccountApiError(401, 'x'),
        );
        refuse();
        await service.restoreSession(stored());
        await settle();
        expect(service.phase()).toBe('reauth');
        expect(service.unlocked()).toBeFalse();
        expect(service.account).toBeUndefined();
        expect(service.configured()).toBeTrue();
        expect(service.backgroundError()).toBe('ACCOUNT_DATA.ERROR_STORAGE_CLEAR');
      });

      it('still signs the account out of this device', async () => {
        spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
        await service.restoreSession(stored());
        refuse();
        await expectAsync(service.disconnect()).toBeResolved();
        expect(service.unlocked()).toBeFalse();
        expect(service.configured()).toBeFalse();
        expect(service.accountIdentity()).toBeNull();
        expect(localStorage.getItem(cacheKey)).toBeNull();
        expect(service.backgroundError()).toBe('ACCOUNT_DATA.ERROR_STORAGE_CLEAR');
      });
    });

    it('refuses a remembered session that does not belong to the account on this device', async () => {
      expect(
        await service.restoreSession({ ...stored(), accountId: 'someone-else' }),
      ).toBe('invalid');
      expect(
        await service.restoreSession({ ...stored(), serverId: 'another-server' }),
      ).toBe('invalid');
      localStorage.removeItem(cacheKey);
      expect(await service.restoreSession(stored())).toBe('invalid');
      expect(service.unlocked()).toBeFalse();
      expect(sessions().clear).not.toHaveBeenCalled();
    });

    it('a wrong protected key opens nothing and clears nothing', async () => {
      const wrong = { ...stored(), masterKey: randomKey() };
      expect(await service.restoreSession(wrong)).toBe('invalid');
      expect(service.unlocked()).toBeFalse();
      expect(sessions().clear).not.toHaveBeenCalled();
    });

    it('rewrites the protected session on every rotation, and never stores the password', async () => {
      spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      await service.restoreSession(stored());
      sessions().save.calls.reset();
      service.account!.adoptTokens({
        accessToken: 'new-access',
        refreshToken: 'N'.repeat(43),
        expiresIn: 600,
      });
      await service.account!.onTokensChanged!();
      expect(sessions().save).toHaveBeenCalledTimes(1);
      const written = sessions().save.calls.mostRecent().args[0] as StoredAccountSession;
      expect(written.refreshToken).toBe('N'.repeat(43));
      expect(written.masterKey).toBe(masterKey);
      expect(JSON.stringify(written)).not.toContain('password');
      // Same token again: no second write.
      await service.account!.onTokensChanged!();
      expect(sessions().save).toHaveBeenCalledTimes(1);
    });

    it('a protected store that refuses does not fail the refresh in flight', async () => {
      spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      await service.restoreSession(stored());
      sessions().save.and.rejectWith(
        new Error('Protected account session storage is unavailable'),
      );
      service.account!.adoptTokens({
        accessToken: 'a',
        refreshToken: 'M'.repeat(43),
        expiresIn: 600,
      });
      await expectAsync(service.account!.onTokensChanged!()).toBeResolved();
      expect(service.backgroundError()).toBe('ACCOUNT_DATA.ERROR_STORAGE');
      expect(service.unlocked()).toBeTrue();
      // A later success of something else (the platform bridge) does not hide the problem:
      // the session is not being remembered, and the person is told until a save works.
      await (
        service as unknown as { updatePlatform: () => Promise<void> }
      ).updatePlatform();
      expect(service.backgroundError()).toBe('ACCOUNT_DATA.ERROR_STORAGE');
      sessions().save.and.resolveTo();
      service.account!.adoptTokens({
        accessToken: 'a',
        refreshToken: 'N'.repeat(48),
        expiresIn: 600,
      });
      await service.account!.onTokensChanged!();
      expect(service.backgroundError()).toBe('');
    });

    it('explicit lock, sign-out and disconnect forget the remembered session; internal teardown does not', async () => {
      spyOn(SyncClient.prototype, 'syncAll').and.resolveTo({});
      spyOn(TestBed.inject(NativePersonalBridgeService), 'bind').and.resolveTo(true);
      // Nothing open: a failed sign-in's teardown must not forget a remembered session.
      await service.lock();
      expect(sessions().clear).not.toHaveBeenCalled();
      await service.createBrowserAccount('http://localhost:1900').catch(() => undefined);
      expect(sessions().clear).not.toHaveBeenCalled();

      await service.restoreSession(stored());
      await service.lock();
      expect(sessions().clear).toHaveBeenCalledTimes(1);
      expect(service.configured()).toBeTrue();

      await service.disconnect();
      expect(sessions().clear.calls.count()).toBeGreaterThan(1);
      expect(service.configured()).toBeFalse();
    });
  });

  describe('an access token the server refuses although it looks valid here (a clock stepped back)', () => {
    const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
    let serverAccepts: string | null;
    let refreshes: string[];
    let refreshRefused: boolean;
    let apiRefusesEverything: boolean;

    /** A server that holds one valid access token and rotates the refresh credential. */
    const openAccount = (): void => {
      const transport: Transport = async (path, body, accessToken) => {
        if (path === '/sessions/refresh') {
          refreshes.push((body as { refreshToken: string }).refreshToken);
          if (refreshRefused) throw new AccountApiError(401, 'Invalid refresh token');
          serverAccepts = 'access-' + refreshes.length;
          return {
            accessToken: serverAccepts,
            refreshToken: 'refresh-' + (refreshes.length + 1),
            expiresIn: 600,
          };
        }
        if (apiRefusesEverything || accessToken !== serverAccepts)
          throw new AccountApiError(401, 'Unauthorized');
        return path === '/sync/scopes' ? { scopes: [] } : {};
      };
      const guarded = (
        service as unknown as { renewal: { guard: (inner: Transport) => Transport } }
      ).renewal.guard(transport);
      const account = new AccountClient(guarded);
      account.capabilities = {
        serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
        protocol: 2,
        features: {},
      };
      account.account = {
        id: 'account',
        email: 'a@example.test',
        username: null,
        displayName: '',
        vaultVersion: 1,
      };
      account.adoptTokens({
        accessToken: 'access-0',
        refreshToken: 'refresh-1',
        expiresIn: 600,
      });
      serverAccepts = 'access-0';
      const client = new SyncClient(account, {
        load: async () => null,
        save: async () => undefined,
      });
      client.state = { scopes: {}, migrations: {} } as SyncClient['state'];
      service.account = account;
      service.client = client;
      service.unlocked.set(true);
      service.linked.set(true);
    };
    /** Ten minutes pass on the server while this device's clock goes back an hour. */
    const stepClockBack = (): void => {
      serverAccepts = 'expired-on-the-server';
      jasmine.clock().mockDate(new Date(T0 - 3_600_000));
    };
    /** The mock clock stops timers, so only promises can be waited on. */
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 200; i++) await Promise.resolve();
    };

    beforeEach(() => {
      refreshes = [];
      refreshRefused = false;
      apiRefusesEverything = false;
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(T0));
      openAccount();
    });
    afterEach(() => jasmine.clock().uninstall());

    it('renews once through the refresh credential it still holds, and carries on', async () => {
      stepClockBack();
      await service.syncNow();
      await settle();
      // Exactly one refresh, with the credential that was never spent.
      expect(refreshes).toEqual(['refresh-1']);
      expect(service.reauth()).toBeFalse();
      expect(service.unlocked()).toBeTrue();
      expect(service.phase()).toBe('synced');
      expect(service.lastSyncedAt()).toEqual(jasmine.any(Number));
      expect(service.error()).toBe('');
    });

    it('is armed again after it worked: a later refusal is renewed too', async () => {
      stepClockBack();
      await service.syncNow();
      await settle();
      serverAccepts = 'expired-again';
      await service.syncNow();
      await settle();
      expect(refreshes).toEqual(['refresh-1', 'refresh-2']);
      expect(service.reauth()).toBeFalse();
      expect(service.phase()).toBe('synced');
    });

    it('ends the session when the refresh credential itself is refused, and presents it only once', async () => {
      refreshRefused = true;
      stepClockBack();
      await service.syncNow();
      await settle();
      expect(refreshes).toEqual(['refresh-1']);
      expect(service.reauth()).toBeTrue();
      expect(service.phase()).toBe('reauth');
      expect(service.unlocked()).toBeFalse();
    });

    it('ends the session when a renewal did not help, without looping', async () => {
      apiRefusesEverything = true;
      stepClockBack();
      await service.syncNow();
      await settle();
      expect(refreshes).toEqual(['refresh-1']);
      expect(service.reauth()).toBeTrue();
      expect(service.unlocked()).toBeFalse();
    });
  });

  describe('the browser saying it is offline', () => {
    const signIn = async (): Promise<void> => {
      spyOn(AccountClient.prototype, 'login').and.callFake(async function (
        this: AccountClient,
      ) {
        this.capabilities = {
          serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
          protocol: 2,
          features: {},
        };
        this.account = {
          id: 'account',
          email: 'a@example.test',
          username: null,
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
      spyOn(service, 'syncNow').and.resolveTo();
      await service.login(
        'http://localhost:1900',
        'a@example.test',
        'a long test password',
      );
    };

    it('is believed only once it has held for a moment', async () => {
      jasmine.clock().install();
      try {
        await signIn();
        spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
        window.dispatchEvent(new Event('offline'));
        jasmine.clock().tick(999);
        expect(service.offline()).toBeFalse();
        jasmine.clock().tick(1);
        expect(service.offline()).toBeTrue();
        expect(service.status()).toBe('ACCOUNT_DATA.OFFLINE');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('is not believed at all when the network is back before that moment is over', async () => {
      jasmine.clock().install();
      try {
        await signIn();
        const onLine = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
        window.dispatchEvent(new Event('offline'));
        jasmine.clock().tick(400);
        onLine.and.returnValue(true);
        window.dispatchEvent(new Event('online'));
        jasmine.clock().tick(5000);
        expect(service.offline()).toBeFalse();
        expect(service.status()).not.toBe('ACCOUNT_DATA.OFFLINE');
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  describe('new-device email verification', () => {
    const SERVER_ID = '3e2edea8-ff50-4f20-87f6-a8f0465f9946';
    const TOKEN = 'T'.repeat(43);
    const EMAIL = 'ada@example.test';
    const ACCOUNT_URL = 'http://localhost:1900';
    const challenge = (over: Partial<DeviceVerification> = {}): DeviceVerification => ({
      kind: 'email',
      token: 'C'.repeat(43),
      expiresIn: 600,
      resendAfter: 30,
      resendsLeft: 3,
      emailHint: 'a***@example.test',
      ...over,
    });
    /** What a successful sign-in leaves on the SDK: an open vault and fresh tokens. */
    const openVault = function (this: AccountClient): void {
      this.capabilities = { serverId: SERVER_ID, protocol: 2, features: {} };
      this.account = {
        id: 'account',
        email: EMAIL,
        username: null,
        displayName: '',
        vaultVersion: 1,
      };
      this.unlocked = {
        masterKey: randomKey(),
        secrets: {} as NonNullable<AccountClient['unlocked']>['secrets'],
      };
      this.tokens = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 600 };
    };
    const refusal = (status: number, code?: string): AccountApiError =>
      new AccountApiError(status, 'Server text that must never be shown', code);
    let login: jasmine.Spy;
    let trust: NativeDeviceTrustService;

    beforeEach(() => {
      trust = TestBed.inject(NativeDeviceTrustService);
      login = spyOn(AccountClient.prototype, 'login').and.resolveTo({
        verification: challenge(),
      });
      spyOn(SyncClient.prototype, 'init').and.callFake(async function (this: SyncClient) {
        this.state = { scopes: {} } as SyncClient['state'];
      });
      spyOn(SyncClient.prototype, 'refreshScopes').and.resolveTo([]);
      spyOn(service, 'syncNow').and.resolveTo();
    });
    afterEach(() => localStorage.removeItem('ultra-native-device-trust'));

    const signInToChallenge = (): Promise<boolean> =>
      service.login(ACCOUNT_URL, EMAIL, 'a long test password');
    /** The workspace lock is handed back a moment after the vault closes. */
    const lockReleased = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 30));
    const deviceToken = (token: string | undefined): jasmine.Spy =>
      spyOnProperty(AccountClient.prototype, 'deviceToken', 'get').and.returnValue(token);

    it('asks a new device for the emailed code instead of signing it in', async () => {
      expect(await signInToChallenge()).toBeFalse();
      expect(service.deviceVerification()).toEqual(
        jasmine.objectContaining({
          emailHint: 'a***@example.test',
          resendAfter: 30,
          resendsLeft: 3,
        }),
      );
      expect(service.phase()).toBe('verify-device');
      expect(service.status()).toBe('ACCOUNT_STATUS.VERIFY_DEVICE');
      // Nothing is signed in, opened or remembered while the code is awaited.
      expect(service.unlocked()).toBeFalse();
      expect(service.configured()).toBeFalse();
      expect(service.client).toBeUndefined();
      expect(service.signingIn()).toBeFalse();
      expect(localStorage.getItem('ultra-native-account:' + ACCOUNT_URL)).toBeNull();
      expect(service.error()).toBe('');
    });

    it('presents the marker this installation holds for the account, and labels the device', async () => {
      await trust.remember(SERVER_ID, [EMAIL], TOKEN);
      await signInToChallenge();
      expect(login).toHaveBeenCalledOnceWith(
        EMAIL,
        'a long test password',
        'Ultra Tasks (web)',
        {
          deviceToken: TOKEN,
        },
      );
      await service.lock();
      await service.login(ACCOUNT_URL, 'grace@example.test', 'a long test password');
      expect(login.calls.mostRecent().args[3]).toEqual({ deviceToken: undefined });
    });

    it('keeps two-factor first: an enrolled factor is never replaced by an emailed code', async () => {
      login.and.resolveTo({
        mfaToken: 'pending-factor',
        factors: ['totp'],
        verification: challenge(),
      });
      expect(await signInToChallenge()).toBeFalse();
      expect(service.mfaMethods()).toEqual(['totp']);
      expect(service.deviceVerification()).toBeNull();
      expect(service.status()).toBe('NATIVE_SYNC.MFA');
      expect(service.phase()).toBe('signing-in');
    });

    it('opens the account with the code like any other sign-in, and remembers the device', async () => {
      const complete = spyOn(
        AccountClient.prototype,
        'completeDeviceVerification',
      ).and.callFake(async function (this: AccountClient) {
        openVault.call(this);
      });
      deviceToken(TOKEN);
      await signInToChallenge();
      await service.completeDeviceVerification('1234 5678');
      expect(complete).toHaveBeenCalledOnceWith('12345678');
      expect(service.unlocked()).toBeTrue();
      expect(service.configured()).toBeTrue();
      expect(service.deviceVerification()).toBeNull();
      expect(service.phase()).toBe('synced');
      // Remembered under the email and under what was typed to sign in.
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBe(TOKEN);
      expect(await trust.recall(SERVER_ID, ['ADA@example.test'])).toBe(TOKEN);
    });

    it('keeps the step after a wrong code and says so once, without detail', async () => {
      spyOn(AccountClient.prototype, 'completeDeviceVerification').and.rejectWith(
        refusal(401),
      );
      await signInToChallenge();
      await expectAsync(
        service.completeDeviceVerification('00000000'),
      ).toBeRejectedWithError('ACCOUNT_DEVICE.ERROR_CODE');
      expect(service.deviceVerification()).not.toBeNull();
      expect(service.phase()).toBe('verify-device');
      expect(service.signingIn()).toBeFalse();
      expect(service.unlocked()).toBeFalse();
    });

    it('ends the sign-in after five wrong codes and leaves the account unconfigured', async () => {
      spyOn(AccountClient.prototype, 'completeDeviceVerification').and.rejectWith(
        refusal(401),
      );
      await signInToChallenge();
      for (let i = 0; i < 4; i++)
        await expectAsync(service.completeDeviceVerification('00000000')).toBeRejected();
      await expectAsync(
        service.completeDeviceVerification('00000000'),
      ).toBeRejectedWithError('ACCOUNT_DEVICE.ERROR_LOCKED');
      expect(service.deviceVerification()).toBeNull();
      expect(service.phase()).toBe('signed-out');
      expect(service.configured()).toBeFalse();
      expect(service.account).toBeUndefined();
    });

    it('sends a new code and shows the server’s new cooldown; the server’s limits end the step', async () => {
      const resend = spyOn(AccountClient.prototype, 'resendDeviceVerification');
      resend.and.resolveTo(challenge({ resendsLeft: 2 }));
      await signInToChallenge();
      await service.resendDeviceVerification();
      expect(service.deviceVerification()!.resendsLeft).toBe(2);

      resend.and.rejectWith(refusal(429, 'resend_too_soon'));
      await expectAsync(service.resendDeviceVerification()).toBeRejectedWithError(
        'ACCOUNT_DEVICE.ERROR_RESEND_SOON',
      );
      expect(service.deviceVerification()).not.toBeNull();

      resend.and.rejectWith(refusal(401));
      await expectAsync(service.resendDeviceVerification()).toBeRejectedWithError(
        'ACCOUNT_DEVICE.ERROR_ENDED',
      );
      expect(service.deviceVerification()).toBeNull();
      expect(service.phase()).toBe('signed-out');
    });

    it('goes Back to a clean sign-in: nothing configured, no endpoint trust left behind', async () => {
      await signInToChallenge();
      await service.cancelDeviceVerification();
      expect(service.deviceVerification()).toBeNull();
      expect(service.phase()).toBe('signed-out');
      expect(service.configured()).toBeFalse();
      expect(service.account).toBeUndefined();
      expect(certTrust.setPendingConfig.calls.mostRecent().args).toEqual([service, null]);
      expect(localStorage.getItem('ultra-native-account:' + ACCOUNT_URL)).toBeNull();
    });

    it('starting over discards a pending step', async () => {
      await signInToChallenge();
      login.and.resolveTo({
        verification: challenge({ emailHint: 'b***@example.test' }),
      });
      await signInToChallenge();
      expect(service.deviceVerification()!.emailHint).toBe('b***@example.test');
    });

    it('says what the server refused in the app’s own words, and lets nothing through', async () => {
      const cases: [AccountApiError, string][] = [
        [refusal(426, 'client_update_required'), 'ACCOUNT_DEVICE.ERROR_UPDATE'],
        [refusal(409, 'session_limit'), 'ACCOUNT_DEVICE.ERROR_SESSION_LIMIT'],
        [refusal(429, 'verification_rate_limited'), 'ACCOUNT_DEVICE.ERROR_RATE_LIMITED'],
        [refusal(503, 'email_delivery_failed'), 'ACCOUNT_DEVICE.ERROR_EMAIL'],
      ];
      for (const [error, key] of cases) {
        login.and.rejectWith(error);
        await expectAsync(signInToChallenge()).toBeRejectedWithError(key);
        expect(service.deviceVerification()).toBeNull();
        expect(service.configured()).toBeFalse();
        expect(certTrust.setPendingConfig.calls.mostRecent().args).toEqual([
          service,
          null,
        ]);
      }
      // A wrong password stays the server's own answer.
      const wrong = refusal(401);
      login.and.rejectWith(wrong);
      await expectAsync(signInToChallenge()).toBeRejectedWith(wrong);
    });

    it('remembers the device after every kind of sign-in that leaves a marker', async () => {
      deviceToken(TOKEN);
      login.and.callFake(async function (this: AccountClient) {
        openVault.call(this);
        return this.tokens!;
      });
      expect(await signInToChallenge()).toBeTrue();
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBe(TOKEN);
      await service.lock();
      await lockReleased();

      localStorage.removeItem('ultra-native-device-trust');
      login.and.resolveTo({ mfaToken: 'pending-factor', factors: ['totp'] });
      spyOn(AccountClient.prototype, 'completeMfa').and.callFake(async function (
        this: AccountClient,
      ) {
        openVault.call(this);
      });
      await signInToChallenge();
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBeUndefined();
      await service.completeMfa('123456');
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBe(TOKEN);
    });

    it('leaves the marker alone when a sign-in carries none (an offline unlock, a restored session)', async () => {
      await trust.remember(SERVER_ID, [EMAIL], TOKEN);
      deviceToken(undefined);
      login.and.callFake(async function (this: AccountClient) {
        openVault.call(this);
        return this.tokens!;
      });
      await signInToChallenge();
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBe(TOKEN);
    });

    it('keeps the marker when signing out, and forgets it only when the account is deleted', async () => {
      deviceToken(TOKEN);
      login.and.callFake(async function (this: AccountClient) {
        openVault.call(this);
        return this.tokens!;
      });
      spyOn(AccountClient.prototype, 'request').and.resolveTo([]);
      await signInToChallenge();
      await service.logout();
      await lockReleased();
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBe(TOKEN);

      await signInToChallenge();
      spyOn(AccountClient.prototype, 'deleteAccount').and.resolveTo();
      await service.deleteAccount();
      expect(await trust.recall(SERVER_ID, [EMAIL])).toBeUndefined();
    });
  });
});
