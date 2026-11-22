import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AccountClient,
  EncryptedSyncStorage,
  SyncClient,
  httpTransport,
  open,
  seal,
  unlockBundle,
  unlockBundleWithMasterKey,
  RealtimeSync,
  type Invitation,
  type ScopeInfo,
  type OwnershipOffer,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
import {
  detachPersonal,
  HISTORY_CHANGED,
  isHistoryFailure,
  personalRecoveryScope,
  supportsRecovery,
} from './native-personal-recovery';
import { NativeSyncPlatformService } from './native-sync-platform.service';
import { normalizeServerUrl } from './native-server-url.util';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { IS_ELECTRON } from '../../app.constants';
import { CertTrustService } from '../issue/cert-trust.service';
import { auditTime, filter, type Subscription } from 'rxjs';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { GlobalConfigService } from '../config/global-config.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { updateGlobalConfigSection } from '../config/store/global-config.actions';
import { environment } from '../../../environments/environment';
import type {
  AccountDataChoice,
  AccountPhase,
  AccountReconnect,
  DataConnectionState,
  DeviceVerificationView,
} from './account-sync.types';
import { AccountDataSummaryService } from './account-data-summary.service';
import {
  accountCacheKey,
  cachedAccountIdentity,
  NativeAccountLocalFlags,
  type CachedAccount,
} from './native-account-local-state';
import { NativeDataConnection } from './native-data-connection';
import { NativeDeviceTrustService } from './native-device-trust.service';
import { watchLocalEdits, type LocalEditWatch } from './native-local-edits';
import { signInWithPasskey } from './native-passkey-sign-in';
import { freshCapabilities } from './native-capabilities';
import { createRealtime, RecordedFailure } from './native-realtime';
import { NativeSessionRenewal } from './native-session-renewal';
import {
  deviceLabel,
  explainDeviceError,
  NativeDeviceVerification,
} from './native-device-verification';
import {
  classifyFailure,
  hasUploadDrafts,
  NativeSyncHealth,
  type FailureKind,
} from './native-sync-health';
import {
  NativeSessionStoreService,
  type StoredAccountSession,
} from './native-session-store.service';

const PERIOD = 60000;
/** After a wake, the network, the window and the OS all report at once: wait for them to settle. */
const RESUME_SETTLE_MS = 1500;
/** The browser's "offline" flag is unreliable (Linux, Electron): it counts once it has held. */
const OFFLINE_SETTLE_MS = 1000;

@Injectable({ providedIn: 'root' })
export class NativeSyncService {
  private readonly bridge = inject(NativePersonalBridgeService);
  private readonly certTrust = inject(CertTrustService);
  private readonly localActions = inject(LOCAL_ACTIONS);
  private readonly writeFlush = inject(OperationWriteFlushService);
  private readonly legacySync = inject(SyncWrapperService);
  private readonly config = inject(GlobalConfigService);
  private readonly backups = inject(BackupService);
  private readonly router = inject(Router);
  private readonly summary = inject(AccountDataSummaryService);
  private readonly sessions = inject(NativeSessionStoreService);
  private readonly deviceTrust = inject(NativeDeviceTrustService);
  readonly platform = inject(NativeSyncPlatformService);
  readonly backgroundError = signal('');
  readonly status = signal('NATIVE_SYNC.LOCKED');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly unlocked = signal(false);
  readonly canRecoverPersonal = computed(
    () =>
      this.unlocked() &&
      this.error() === HISTORY_CHANGED &&
      supportsRecovery(this.client),
  );
  readonly linked = signal(false);
  readonly configured = signal(!!localStorage.getItem(accountCacheKey()));
  readonly scopes = signal<ScopeInfo[]>([]);
  readonly invitations = signal<Invitation[]>([]);
  readonly ownershipOffers = signal<OwnershipOffer[]>([]);
  readonly projects = computed(() => this.scopes().filter((s) => s.kind === 'project'));
  readonly revision = signal(0);
  readonly live = signal(false);
  readonly mfaMethods = signal<string[]>([]);
  readonly sharingEnabled = computed(
    () =>
      this.unlocked() && this.account?.capabilities?.features['sharedProjects'] === true,
  );
  readonly personalRealtimeEnabled = computed(
    () =>
      this.unlocked() &&
      this.account?.capabilities?.features['personalRealtime'] === true,
  );
  /** Email and support ID of the configured account; known even while the vault is closed. */
  readonly accountIdentity = signal(cachedAccountIdentity());
  private readonly localFlags = new NativeAccountLocalFlags(
    () => this.account?.account?.id ?? this.accountIdentity()?.id,
  );
  /** Facts about the last attempts, derived from engine events; nothing here is synced. */
  private readonly health = new NativeSyncHealth();
  /** One renewal for a refused access token, never for a refused refresh credential. */
  private readonly renewal = new NativeSessionRenewal();
  /** The last attempt failed because the device or the server was unreachable. */
  readonly offline = this.health.offline;
  /** Last fully successful sync (including the apply), in ms since epoch. */
  readonly lastSyncedAt = this.health.lastSyncedAt;
  /** Number of local change intents not yet uploaded (bounded count, never content). */
  readonly pendingChanges = this.health.pendingChanges;
  /** The last complete fetch found no tasks in the account. */
  readonly emptyAccount = this.health.emptyAccount;
  /** The server refused the session: only a new sign-in helps. The identity is kept. */
  readonly reauth = this.health.reauth;
  /** Password, browser return, two-factor step or session restore in progress. */
  readonly signingIn = signal(false);
  /** Why a configured account is locked although the person did not lock it. */
  readonly lockReason = signal<'storage-unavailable' | null>(null);
  /** First connection of this device to the account's data (discover, download, apply). */
  private readonly dataConnection = new NativeDataConnection({
    client: () => this.client,
    linked: () => this.linked(),
    scopes: this.scopes,
    bind: (client) => this.bridge.bind(client),
    summary: this.summary,
    link: (migrate, automatic, since) => this.link(migrate, automatic, since),
    watchEdits: () => watchLocalEdits(this.localActions),
    serverHasPersonalScope: async (client) =>
      (await client.account.request<{ scopes: ScopeInfo[] }>('/sync/scopes')).scopes.some(
        (scope) => scope.kind === 'personal',
      ),
    fail: (error) => ({ sessionLost: this.failure(error, true) === 'auth' }),
    deferred: {
      read: () => this.localFlags.read('deferred') === '1',
      write: (on) => this.localFlags.write('deferred', on ? '1' : null),
    },
    showWorkspace: () => this.showWorkspace(),
  });
  /** Sign-in on a device the account does not recognise yet: the emailed code is awaited. */
  private readonly deviceCheck = new NativeDeviceVerification({
    account: () => this.account,
    finishLogin: () => this.finishLogin(),
    abandon: () => this.lock(),
  });
  /** The pending "Verify this device" step, or null. Nothing is signed in while it is pending. */
  readonly deviceVerification: Signal<DeviceVerificationView | null> =
    this.deviceCheck.pending;
  /** Both sides hold real data (or the person chose "Decide later"). */
  readonly dataChoice: Signal<AccountDataChoice | null> = this.dataConnection.choice;
  /** Why the choice is being asked again (an i18n key), or ''. */
  readonly dataNotice: Signal<string> = this.dataConnection.notice;
  /** Where the first connection stands; `failed` and `waiting` need Retry or time. */
  readonly connection: Signal<DataConnectionState> = this.dataConnection.stage;
  readonly abandonedPersonalSetup = computed(() => {
    const scope = this.dataConnection.abandonedPersonalSetup();
    return scope && this.bridge.canRecoverSetup(scope.sequence > 0)
      ? { id: scope.id, uploaded: scope.sequence > 0 }
      : undefined;
  });
  /** Derived presentation state; see {@link AccountPhase}. Not persisted. */
  readonly phase = computed<AccountPhase>(() => {
    // Waiting for the emailed code outranks everything else: the person is mid sign-in.
    if (this.deviceVerification()) return 'verify-device';
    if (this.reauth()) return 'reauth';
    if (!this.unlocked()) {
      if (this.signingIn() || this.status() === 'NATIVE_SYNC.MFA') return 'signing-in';
      return this.configured() ? 'locked' : 'signed-out';
    }
    if (this.dataChoice()) return 'choose-data';
    switch (this.connection()) {
      case 'discovering':
        return 'signing-in';
      case 'downloading':
        return 'downloading';
      case 'applying':
        return 'applying';
      case 'uploading':
        return 'syncing';
      case 'failed':
      case 'waiting':
        // Only an unconnected device is waiting: one that got linked is judged by its syncs.
        if (!this.linked()) return 'choose-data';
    }
    // The vault is open but nothing has been discovered yet: the connection is only starting,
    // which is still "Signing in" and not an unfinished connection.
    if (!this.linked()) return this.signingIn() ? 'signing-in' : 'choose-data';
    return this.busy() ? 'syncing' : 'synced';
  });
  /** What a session that cannot sync on its own needs from the person. */
  readonly reconnect = computed<AccountReconnect>(() => {
    const phase = this.phase();
    return phase === 'reauth' ? 'sign-in' : phase === 'locked' ? 'unlock' : null;
  });
  client?: SyncClient;
  account?: AccountClient;
  serverUrl = '';
  private interval?: ReturnType<typeof setInterval>;
  private releaseLease?: () => void;
  private inFlight?: Promise<void>;
  private realtime?: RealtimeSync;
  private unsubscribePlatform?: () => void;
  private closing = false;
  private localChanges?: Subscription;
  private localEdits?: Subscription;
  private resyncRequested = false;
  private resumeTimer?: ReturnType<typeof setTimeout>;
  private offlineTimer?: ReturnType<typeof setTimeout>;
  /** The sync in flight was started by the app's own loops (not by a person). */
  private syncAutomatic = false;
  private expiring?: Promise<void>;
  private rememberedToken?: string;
  /** What the person typed to sign in; one of the names the device's trust marker is kept under. */
  private signInIdentifier?: string;
  /** A restored session must not interrupt with a dialog the person already deferred. */
  private restoring = false;

  constructor() {
    // Development builds only (like `__e2eTestHelpers`): lets E2E read `phase`,
    // `dataChoice` and friends on any route without depending on how a surface words them.
    if (!environment.production && !environment.stage)
      (window as unknown as { __e2eNativeSync?: NativeSyncService }).__e2eNativeSync =
        this;
  }

  private cacheContext(): string {
    return JSON.stringify({ ...this.account!.identity(), purpose: 'native-session' });
  }
  private async cache(): Promise<void> {
    const account = this.account!;
    const refresh = await seal(
      account.unlocked!.masterKey,
      account.tokens!.refreshToken,
      this.cacheContext(),
    );
    localStorage.setItem(
      accountCacheKey(this.serverUrl),
      JSON.stringify({
        capabilities: account.capabilities,
        account: account.account,
        bundle: account.bundle,
        refresh,
      }),
    );
    localStorage.setItem('ultra-native-server', this.serverUrl);
    this.configured.set(true);
    this.accountIdentity.set({ email: account.account!.email, id: account.account!.id });
    await this.rememberSession();
  }
  /**
   * A trusted desktop device keeps the unlocked session in OS-protected storage, rewritten
   * on every refresh-token rotation. Never throws: a store that refuses must not fail the
   * refresh that is in flight (the SDK awaits this), and the account keeps working until
   * the app closes.
   */
  private async rememberSession(): Promise<void> {
    const account = this.account;
    if (!this.sessions.supported || !account?.unlocked || !account.tokens) return;
    const token = account.tokens.refreshToken;
    if (token === this.rememberedToken) return;
    const session: StoredAccountSession = {
      v: 1,
      serverUrl: this.serverUrl,
      accountId: account.account!.id,
      serverId: account.capabilities!.serverId,
      masterKey: account.unlocked.masterKey,
      refreshToken: token,
    };
    try {
      await this.sessions.save(session);
      this.rememberedToken = token;
      this.clearBackgroundError('ACCOUNT_DATA.ERROR_STORAGE');
    } catch {
      this.backgroundError.set('ACCOUNT_DATA.ERROR_STORAGE');
    }
  }
  /** The account server's transport; it notes when the refresh credential itself was refused. */
  private transport(): Transport {
    return this.renewal.guard(this.platform.transport(httpTransport(this.serverUrl)));
  }
  private normalizeServerUrl(serverUrl: string): string {
    return normalizeServerUrl(serverUrl);
  }
  /** Opens the account website; `signup` lands on its create-account view. */
  async openAccount(serverUrl: string, view?: 'signup'): Promise<void> {
    const url =
      this.normalizeServerUrl(serverUrl) + '/account' + (view ? '?view=' + view : '');
    if (Capacitor.isNativePlatform()) await Browser.open({ url });
    else if (IS_ELECTRON) window.ea.openExternalUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  /** Runs a sign-in step and reports it as "Signing in" until it ends (or waits for 2FA). */
  private async signingInWhile<T>(step: () => Promise<T>): Promise<T> {
    this.signingIn.set(true);
    try {
      return await step();
    } finally {
      this.signingIn.set(false);
    }
  }
  /**
   * Resolves true when signed in, and false when a further step is pending: two-factor
   * (`mfaMethods`) or the emailed code of a new device (`deviceVerification`).
   */
  async login(serverUrl: string, identifier: string, password: string): Promise<boolean> {
    this.error.set('');
    this.mfaMethods.set([]);
    this.deviceCheck.reset();
    this.signInIdentifier = identifier.trim();
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    return this.signingInWhile(async () => {
      try {
        await this.certTrust.setPendingConfig(this, { baseUrl: this.serverUrl });
        return await this.authenticate(identifier, password);
      } catch (error) {
        await this.certTrust.setPendingConfig(this, null);
        throw error;
      }
    });
  }
  async createBrowserAccount(serverUrl: string): Promise<AccountClient> {
    if (this.unlocked()) throw new Error('NATIVE_SYNC.ERROR_TAB');
    await this.teardown();
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    await this.certTrust.setPendingConfig(this, { baseUrl: this.serverUrl });
    return new AccountClient(this.transport());
  }
  async finishBrowserAccount(account: AccountClient, serverUrl: string): Promise<void> {
    if (this.unlocked() || !account.unlocked || !account.tokens)
      throw new Error('NATIVE_SYNC.ERROR_TAB');
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    this.account = account;
    await this.signingInWhile(async () => {
      try {
        await this.finishLogin();
      } catch (error) {
        await this.teardown();
        throw error;
      }
    });
  }
  private async authenticate(identifier: string, password: string): Promise<boolean> {
    this.account = new AccountClient(this.transport());
    try {
      // The server decides from the device's trust marker whether this device needs a code.
      const { serverId } = await this.account.init();
      const result = await this.account.login(identifier, password, deviceLabel(), {
        deviceToken: await this.deviceTrust.recall(serverId, [identifier]),
      });
      // Enrolled two-factor always takes precedence: the emailed code never replaces it.
      if (result.mfaToken) {
        this.mfaMethods.set(result.factors ?? []);
        this.status.set('NATIVE_SYNC.MFA');
        return false;
      }
      if (result.verification) {
        this.deviceCheck.begin(result.verification);
        this.status.set('ACCOUNT_STATUS.VERIFY_DEVICE');
        return false;
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw explainDeviceError(error, 'sign-in');
      const raw = localStorage.getItem(accountCacheKey(this.serverUrl));
      if (!raw) throw error;
      const cached = JSON.parse(raw) as CachedAccount;
      if (
        ![cached.account.id, cached.account.email, cached.account.username].includes(
          identifier.trim().toLowerCase(),
        )
      )
        throw error;
      const unlocked = await unlockBundle(
        cached.bundle,
        { serverId: cached.capabilities.serverId, accountId: cached.account.id },
        { password },
      );
      this.account.capabilities = cached.capabilities;
      this.account.account = cached.account;
      this.account.bundle = cached.bundle;
      this.account.unlocked = unlocked;
    }
    await this.finishLogin();
    return true;
  }
  async completeMfa(code: string): Promise<void> {
    await this.signingInWhile(async () => {
      await this.account!.completeMfa(code);
      await this.finishLogin();
    });
  }
  /** The code emailed to a new device; opens the account exactly like a two-factor code. */
  async completeDeviceVerification(code: string): Promise<void> {
    await this.signingInWhile(() => this.deviceCheck.complete(code));
  }
  /** A replacement code. The server limits how often and how many. */
  resendDeviceVerification(): Promise<void> {
    return this.deviceCheck.resend();
  }
  /** Back from "Verify this device": nothing was signed in, so the sign-in just ends. */
  cancelDeviceVerification(): Promise<void> {
    return this.deviceCheck.cancel();
  }

  async passkey(): Promise<void> {
    await this.signingInWhile(() =>
      signInWithPasskey(
        this.account!,
        this.serverUrl,
        () => this.account,
        () => this.finishLogin(),
      ),
    );
  }
  private async lease(): Promise<void> {
    if (!navigator.locks) throw new Error('NATIVE_SYNC.ERROR_BROWSER');
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request('ultra-native-workspace', { ifAvailable: true }, async (lock) => {
          if (!lock) {
            reject(new Error('NATIVE_SYNC.ERROR_TAB'));
            return;
          }
          await new Promise<void>((release) => {
            this.releaseLease = release;
            resolve();
          });
        })
        .catch(reject);
    });
  }
  /**
   * Opens the sync client for an authenticated account (fresh sign-in, browser return or a
   * restored session) and starts its timers. It does not need the network: the first
   * thing that talks to the server is either the sync of an already connected device or
   * the data connection of a new one, and each reports its own failures.
   */
  private async finishLogin(): Promise<void> {
    // Signing out keeps the device's trust marker (deleting the account forgets it).
    await this.deviceTrust.rememberFrom(this.account, this.signInIdentifier);
    await this.lease();
    const account = this.account!;
    account.onTokensChanged = () => this.cache();
    try {
      this.client = new SyncClient(
        account,
        new EncryptedSyncStorage(account.unlocked!.masterKey, account.identity()),
      );
      await this.client.init();
      const client = this.client;
      try {
        const cached =
          !account.tokens && this.platform.supported
            ? (JSON.parse(
                localStorage.getItem(accountCacheKey(this.serverUrl))!,
              ) as CachedAccount)
            : undefined;
        const refresh = cached
          ? await open(account.unlocked!.masterKey, cached.refresh, this.cacheContext())
          : undefined;
        await this.platform.bind(
          client,
          this.serverUrl,
          this.resume,
          async () => {
            if (this.client !== client || this.closing) return;
            await this.writeFlush.flushPendingWrites();
            if (Capacitor.getPlatform() === 'ios' && this.linked())
              return this.syncNow(true);
            for (const scope of Object.values(client.state.scopes))
              if (scope.info.kind === 'project' && !scope.revoked)
                await client.syncScope(scope.info.id);
          },
          refresh,
        );
        this.unsubscribePlatform = client.subscribeLocal(() => {
          this.health.refreshPending(client);
          void this.updatePlatform();
        });
      } catch {
        this.backgroundError.set('NATIVE_SYNC.ERROR_NATIVE');
      }
      if (account.tokens) await this.cache();
      this.scopes.set(
        Object.values(this.client.state.scopes)
          .filter((s) => !s.revoked)
          .map((s) => s.info),
      );
      const wasLinked = await this.bridge.bind(this.client);
      // A saved account baseline must not reactivate while a file provider is live.
      this.linked.set(wasLinked && !this.config.sync()?.isEnabled);
      this.unlocked.set(true);
      this.health.reauth.set(false);
      this.lockReason.set(null);
      this.health.lastSyncedAt.set(Number(this.localFlags.read('synced')) || null);
      this.health.refreshPending(this.client);
      this.localChanges = this.localActions
        .pipe(filter(isPersistentAction), auditTime(500))
        .subscribe(() => {
          if (this.linked() && !this.closing) void this.syncNow(true);
        });
      this.localEdits = this.localActions
        .pipe(filter(isPersistentAction))
        .subscribe(() => {
          if (this.linked() && !this.closing) this.health.noteLocalEdit(this.client);
        });
      this.status.set('NATIVE_SYNC.READY');
      this.interval = setInterval(() => {
        if (!this.personalRealtimeEnabled() || this.dataConnection.needsRetry())
          void this.syncNow(true);
      }, PERIOD);
      window.addEventListener('online', this.resume);
      window.addEventListener('offline', this.markOffline);
      document.addEventListener('visibilitychange', this.resume);
      const recovering = this.localFlags.read('recovering');
      if (recovering && client.state.scopes[recovering]) {
        this.linked.set(false);
        this.failure(new Error(HISTORY_CHANGED));
        return;
      }
      if (recovering) this.localFlags.write('recovering', null);
      if (this.linked()) await this.syncNow(true);
      // A refused session is already being closed: nothing more may talk to the server.
      if (this.expiring || this.reauth()) return;
      this.startRealtime();
      await this.updatePlatform();
      if (!this.linked()) await this.dataConnection.connect(!this.restoring);
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }
  /**
   * The browser says there is no network: say so instead of waiting for the next failure. The
   * flag flaps and is wrong on some systems, so it only counts when it still holds a moment
   * later; a real failed request is what settles it either way.
   */
  private readonly markOffline = (): void => {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = setTimeout(() => {
      this.offlineTimer = undefined;
      if (!this.unlocked() || navigator.onLine !== false) return;
      this.health.failed('offline');
      this.status.set('ACCOUNT_DATA.OFFLINE');
    }, OFFLINE_SETTLE_MS);
  };
  /**
   * Network back, window visible again or the OS resumed from sleep. Several of these fire
   * together after a wake, so they are coalesced into ONE sync a moment later, when the
   * network has had time to settle. The live socket is only rebuilt when it is gone: a
   * rebuilt socket catches up on its own, which would be a second pass for nothing.
   */
  readonly resume = (): void => {
    if (document.visibilityState === 'hidden') return;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = undefined;
      void this.syncNow(true).then(() => {
        if (!this.live()) this.realtime?.resume();
      });
    }, RESUME_SETTLE_MS);
  };
  private startRealtime(): void {
    const client = this.client;
    if (!client || this.expiring) return;
    this.realtime = createRealtime({
      client,
      features: this.account?.capabilities?.features,
      serverUrl: this.serverUrl,
      fallbackMs: PERIOD,
      syncPersonal: async () => {
        await this.syncNow(true);
        // Make the socket retry with its back-off; the failure itself is already recorded.
        if (this.error() || this.offline()) throw new RecordedFailure();
      },
      updated: () => {
        this.scopes.set(
          Object.values(client.state.scopes)
            .filter((s) => !s.revoked)
            .map((s) => s.info),
        );
        this.revision.update((n) => n + 1);
        void this.updatePlatform();
      },
      revoked: (id) => {
        this.scopes.update((scopes) => scopes.filter((s) => s.id !== id));
        this.revision.update((n) => n + 1);
        void this.updatePlatform();
      },
      failed: (error) => this.failure(error),
      connected: (isOpen) => this.live.set(isOpen),
    });
    this.realtime?.start();
  }
  private async updatePlatform(): Promise<void> {
    if (!this.client || !this.unlocked() || !this.linked()) return;
    try {
      await this.platform.update(this.client);
      this.clearBackgroundError('NATIVE_SYNC.ERROR_NATIVE');
    } catch {
      this.backgroundError.set('NATIVE_SYNC.ERROR_NATIVE');
    }
  }
  /** A problem is only cleared by the success of the thing that raised it. */
  private clearBackgroundError(only: string): void {
    if (this.backgroundError() === only) this.backgroundError.set('');
  }
  private async adoptNativeSession(): Promise<void> {
    // Do not replace the SDK's forced expiry with the same rejected native token.
    if (this.renewal.pending) return;
    const native = await this.platform.current(this.account!);
    if (native) {
      this.account!.adoptTokens(native);
      await this.cache();
    }
    if (this.account!.tokens) return;
    const cached = JSON.parse(
      localStorage.getItem(accountCacheKey(this.serverUrl))!,
    ) as CachedAccount;
    const refreshToken = await open(
      this.account!.unlocked!.masterKey,
      cached.refresh,
      this.cacheContext(),
    );
    const tokens = await this.account!.transport('/sessions/refresh', { refreshToken });
    this.account!.adoptTokens(tokens as Parameters<AccountClient['adoptTokens']>[0]);
    await this.cache();
  }
  /**
   * The engine's transactional switch between the account's dataset and this device's.
   * `migrate` replaces the account's data with this device's (or seeds an empty account);
   * otherwise the account's data replaces this device's. Callers decide WHICH, either the
   * person through the choice dialog or the first-connection rules in
   * {@link NativeDataConnection}; this method only refuses unsafe switches.
   */
  async link(
    migrate: boolean,
    automatic = false,
    since?: LocalEditWatch,
    restartScopeId?: string,
  ): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    // A switch started directly (not by the first-connection planner) still reports its stage.
    const ownStage = !!restartScopeId || this.dataConnection.stage() === 'idle';
    if (ownStage) this.dataConnection.stage.set(migrate ? 'uploading' : 'downloading');
    const onStage = (stage: 'downloading' | 'applying' | 'uploading'): void =>
      this.dataConnection.stage.set(stage);
    let retiringLegacy = false;
    let retiredLegacy = false;
    const choiceChanges = !migrate
      ? watchLocalEdits(
          this.localActions,
          // The provider switch itself disables local-only sync settings.
          (action) =>
            retiringLegacy &&
            action.type === updateGlobalConfigSection.type &&
            action.sectionKey === 'sync',
        )
      : undefined;
    try {
      if (
        !(await this.dataConnection.prepareLink({
          scopeId: () => this.bridge.scopeId,
          migrate,
          automatic,
          restartScopeId,
          replacementAvailable:
            this.account?.capabilities?.features['personalReplacement'] === true,
        }))
      )
        return;
      const perform = async (): Promise<void> => {
        await this.writeFlush.flushPendingWrites();
        if (this.config.sync()?.isEnabled) {
          await this.backups.captureImportBackup('LOCAL_IMPORT');
          retiringLegacy = true;
          try {
            this.config.updateSection('sync', { isEnabled: false }, true);
            retiredLegacy = true;
          } finally {
            retiringLegacy = false;
          }
          await this.writeFlush.flushPendingWrites();
        }
        if (migrate) await this.bridge.migrate(onStage, restartScopeId, !automatic);
        else
          await this.bridge.useExisting(() => {
            if (since?.changed || choiceChanges?.changed) {
              this.error.set('NATIVE_SYNC.ERROR_LOCAL_CHANGED');
              throw new Error('NATIVE_SYNC.ERROR_LOCAL_CHANGED');
            }
          }, onStage);
      };
      if (this.config.sync()?.isEnabled)
        await this.legacySync.runWithSyncBlocked(perform);
      else await perform();
      this.linked.set(true);
      // The connection is finished (the planner or dialog clears the rest); settle the stage
      // before the follow-up sync so it reads as "Syncing changes", not "Downloading".
      if (ownStage) this.dataConnection.stage.set('idle');
      await this.afterSwitch();
    } catch (error) {
      if (error instanceof Error && error.message === 'NATIVE_SYNC.ERROR_LOCAL_CHANGED') {
        this.error.set(error.message);
      } else if (retiredLegacy && !this.linked()) {
        this.error.set('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
        throw new Error('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
      }
      throw error;
    } finally {
      choiceChanges?.stop();
      if (ownStage && this.dataConnection.stage() !== 'idle' && !this.linked())
        this.dataConnection.stage.set('idle');
      this.busy.set(false);
    }
  }
  /**
   * Sync now. Reaches exactly one engine: a device that is not connected yet only retries.
   * `automatic` is for the app's own loops (timer, edits, wake): they may skip while the browser
   * says there is no network. A person pressing "Sync now" always gets a real attempt, because
   * that flag is unreliable and is the very thing they are trying.
   */
  syncNow(automatic = false): Promise<void> {
    if (this.inFlight) {
      this.resyncRequested = true;
      // A person's request outranks an automatic one it was folded into.
      this.syncAutomatic &&= automatic;
      return this.inFlight;
    }
    if (!this.client || !this.unlocked() || this.closing) return Promise.resolve();
    if (this.expiring || this.reauth()) return Promise.resolve();
    if (!this.linked())
      return this.dataConnection.needsRetry()
        ? this.dataConnection.connect(false)
        : Promise.resolve();
    this.syncAutomatic = automatic;
    this.inFlight = (async () => {
      do {
        this.resyncRequested = false;
        await this.sync(this.syncAutomatic);
      } while (this.resyncRequested && !this.closing);
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  private async sync(automatic: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    // Stale success ends the moment new work starts.
    this.status.set('ACCOUNT_DATA.SYNCING');
    try {
      if (automatic && typeof navigator !== 'undefined' && navigator.onLine === false)
        throw new TypeError('Failed to fetch');
      const reminderBarrier = await this.platform.reminderBarrier(this.account!);
      if (this.linked()) {
        await this.bridge.rejoinRecoveredPersonalSetup();
        await this.writeFlush.flushPendingWrites();
        await this.bridge.capture();
        this.health.captured(this.client);
      }
      await this.adoptNativeSession();
      const errors = await this.client!.syncAll();
      const personalError = this.bridge.scopeId && errors[this.bridge.scopeId];
      if (personalError && isHistoryFailure(personalError))
        throw new Error(HISTORY_CHANGED);
      if (this.linked() && !errors[this.bridge.scopeId!]) {
        await this.bridge.apply();
        await this.platform.personalSynced(this.account!, reminderBarrier);
      }
      await this.refresh();
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join('; '));
      await this.updatePlatform();
      this.syncSucceeded();
    } catch (error) {
      this.failure(error);
    } finally {
      this.health.refreshPending(this.client);
      this.busy.set(false);
      this.revision.update((n) => n + 1);
    }
  }
  /** Preserve both the working copy and the old SDK branch before reopening data choice. */
  async recoverPersonalSync(
    saveArchive: (archive: unknown) => Promise<boolean>,
  ): Promise<void> {
    const client = this.client;
    if (!this.canRecoverPersonal() || !supportsRecovery(client) || this.closing) return;
    const scopeId = personalRecoveryScope(
      client,
      this.localFlags.read('recovering') ?? this.bridge.scopeId,
    );
    if (!scopeId) return;
    this.closing = true;
    let detached = false;
    try {
      await this.realtime?.stop();
      this.realtime = undefined;
      if (this.inFlight) await this.inFlight;
      await this.writeFlush.flushPendingWrites();
      detached = await detachPersonal(client, scopeId, saveArchive, async () => {
        if (this.client !== client)
          throw new Error('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
        await this.backups.captureImportBackup('REMOTE_IMPORT');
        if (this.client !== client)
          throw new Error('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
        // A restart must stay paused until both stores reflect the recovery choice.
        this.localFlags.markRecovering(scopeId);
        await this.bridge.unlink();
        this.linked.set(false);
        this.localFlags.write('synced', null);
        this.health.lastSyncedAt.set(null);
      });
      if (detached) {
        this.localFlags.write('recovering', null);
        this.error.set('');
        this.health.refreshPending(client);
        this.scopes.update((scopes) => scopes.filter(({ id }) => id !== scopeId));
        this.dataConnection.reset();
      }
    } finally {
      this.closing = false;
      if (this.client === client) this.startRealtime();
    }
    if (detached) await this.dataConnection.connect(true);
  }
  /** Only a sync that finished, applied and persisted everything counts as success. */
  private syncSucceeded(): void {
    const at = Date.now();
    this.status.set('NATIVE_SYNC.SYNCED');
    this.renewal.succeeded();
    this.health.succeeded(at);
    if (hasUploadDrafts(this.client)) this.error.set('NATIVE_SYNC.UPLOAD_DRAFTS');
    this.localFlags.write('synced', String(at));
    this.health.refreshEmpty(this.client, this.bridge.scopeId, (client, id) =>
      this.summary.fromRecords(client, id),
    );
  }
  /**
   * Records a failure the way every surface reports it and returns its kind. Failing to
   * reach the server is "offline" (calm, automatic retry, no error text); a refused session
   * needs a new sign-in; nothing here ever clears the person's data or credentials by
   * itself. `connecting` marks the first connection of a device to the account's data.
   */
  private failure(error: unknown, connecting = false): FailureKind {
    const kind = classifyFailure(error);
    if (kind === 'auth' && this.renewal.renew(this.account, error)) {
      // The refresh credential was not refused: the access token only looked fine on this
      // device. The SDK renews it on its next request; try again, once.
      this.status.set('ACCOUNT_DATA.SYNCING');
      void this.syncNow(true);
      return 'other';
    }
    this.health.failed(kind);
    const message =
      error instanceof Error && error.message ? error.message : 'NATIVE_SYNC.ERROR_SYNC';
    if (kind === 'auth') {
      this.status.set('NATIVE_SYNC.LOCKED');
      void this.expireSession();
    } else if (kind === 'offline') {
      // Not an error: `offline()` and the status say so, the changes are safe on this device
      // and the next attempt is automatic. Only a first connection that could not look at
      // the account says why it is unfinished.
      this.error.set(connecting ? 'ACCOUNT_DATA.ERROR_DISCOVERY' : '');
      this.status.set('ACCOUNT_DATA.OFFLINE');
    } else {
      this.error.set(
        kind === 'data' && !message.startsWith('NATIVE_SYNC.')
          ? 'NATIVE_SYNC.ERROR_DATA'
          : message,
      );
      this.status.set('ACCOUNT_DATA.SYNC_FAILED');
    }
    return kind;
  }
  /**
   * The server refused the session (revoked, expired or a replayed single-use credential).
   * The vault closes and the stored session is forgotten, but the configured identity and
   * every local edit stay: the status says "Sign in again" instead of a setup nudge.
   */
  private expireSession(): Promise<void> {
    return (this.expiring ??= (async () => {
      this.health.reauth.set(true);
      await this.forgetSession();
      await this.teardown();
    })().finally(() => {
      this.expiring = undefined;
    }));
  }
  async refresh(): Promise<void> {
    this.scopes.set(await this.client!.refreshScopes());
    const sharing = this.account?.capabilities?.features['sharedProjects'] === true;
    this.invitations.set(sharing ? await this.client!.invitations() : []);
    this.ownershipOffers.set(
      sharing && this.account?.capabilities?.features['scopeRecovery']
        ? await this.client!.ownershipOffers()
        : [],
    );
    this.realtime?.updateScopes();
    this.revision.update((n) => n + 1);
  }
  /** Takes the person to their tasks after a first download, if they signed in on the account page. */
  private showWorkspace(): void {
    if (this.router.url.split(/[?#]/)[0].startsWith('/native-sync'))
      void this.router.navigateByUrl('/');
  }
  /**
   * Opens the account from the OS-protected session of a trusted desktop device, without
   * the password: the vault opens locally with the protected key, and the first request
   * renews the credential (and keeps working offline, with the status saying so).
   */
  async restoreSession(
    session: StoredAccountSession,
  ): Promise<'restored' | 'reauth' | 'invalid'> {
    if (this.unlocked() || this.signingIn()) return 'invalid';
    this.serverUrl = this.normalizeServerUrl(session.serverUrl);
    const raw = localStorage.getItem(accountCacheKey(this.serverUrl));
    if (!raw) return 'invalid';
    const cached = JSON.parse(raw) as CachedAccount;
    if (
      cached.account.id !== session.accountId ||
      cached.capabilities.serverId !== session.serverId
    )
      return 'invalid';
    return this.signingInWhile(async () => {
      this.restoring = true;
      try {
        await this.certTrust.setPendingConfig(this, { baseUrl: this.serverUrl });
        const account = new AccountClient(this.transport());
        account.capabilities = cached.capabilities;
        account.account = cached.account;
        account.bundle = cached.bundle;
        account.unlocked = await unlockBundleWithMasterKey(
          cached.bundle,
          account.identity(),
          session.masterKey,
        );
        // The first request renews this (refreshAt starts at 0) and rotates it exactly once.
        account.tokens = {
          accessToken: '',
          refreshToken: session.refreshToken,
          expiresIn: 0,
        };
        // What the server can do may have changed since sign-in (an upgrade): ask again, bounded.
        // `cache()` then keeps the fresh copy; offline, the cached one stays.
        const latest = await freshCapabilities(account, session.serverId);
        if (latest === 'other-server') throw new Error('Account server identity changed');
        if (latest) account.capabilities = latest;
        this.rememberedToken = session.refreshToken;
        this.account = account;
        await this.finishLogin();
        // The first request of a revoked session is refused; it is already being closed.
        return this.reauth() ? ('reauth' as const) : ('restored' as const);
      } catch (error) {
        await this.certTrust.setPendingConfig(this, null);
        if (classifyFailure(error) === 'auth') {
          await this.expireSession();
          return 'reauth' as const;
        }
        return 'invalid' as const;
      } finally {
        this.restoring = false;
      }
    });
  }
  /** The remembered session exists but its protected storage cannot be read. */
  markStorageUnavailable(): void {
    this.lockReason.set('storage-unavailable');
    this.backgroundError.set('ACCOUNT_DATA.ERROR_STORAGE');
  }
  async deleteAccount(): Promise<void> {
    this.closing = true;
    await this.realtime?.stop();
    if (this.inFlight) await this.inFlight;
    const account = this.account!;
    const cacheKey = accountCacheKey(this.serverUrl);
    const storage = new EncryptedSyncStorage(
      account.unlocked!.masterKey,
      account.identity(),
    );
    const trusted = this.deviceTrust.whoIs(account, this.signInIdentifier);
    let deleted = false;
    try {
      await account.deleteAccount();
      deleted = true;
      await this.deviceTrust.forget(trusted);
      await storage.clear();
    } catch (error) {
      if (!deleted) this.startRealtime();
      throw error;
    } finally {
      try {
        if (deleted) await this.teardown();
      } finally {
        if (deleted) {
          await this.forgetAccount(cacheKey);
        }
        this.closing = false;
      }
    }
  }
  async logout(): Promise<void> {
    const key = accountCacheKey(this.serverUrl);
    this.closing = true;
    try {
      await this.realtime?.stop();
      if (this.inFlight) await this.inFlight;
      try {
        const sessions =
          await this.account!.request<{ id: string; current: boolean }[]>('/sessions');
        const session = sessions.find((value) => value.current);
        if (session)
          await this.account!.request('/sessions/revoke', { sessionId: session.id });
      } catch (error) {
        // Signing out must work without a network: the credential is forgotten on this
        // device either way (the old session expires on its own or can be revoked from the
        // account dashboard). Any other failure is still reported.
        if (classifyFailure(error) !== 'offline') throw error;
      }
    } finally {
      await this.teardown();
      await this.bridge.unlink();
      await this.forgetAccount(key);
    }
  }
  async disconnect(): Promise<void> {
    if (this.unlocked()) return this.logout();
    const key = accountCacheKey();
    await this.teardown();
    await this.bridge.unlink();
    await this.forgetAccount(key);
  }
  /** The account is gone from this device (sign-out, disconnect or deletion). */
  private async forgetAccount(cacheKey: string): Promise<void> {
    this.localFlags.write('deferred', null);
    this.localFlags.write('synced', null);
    localStorage.removeItem(cacheKey);
    await this.forgetSession();
    this.health.reset();
    this.lockReason.set(null);
    this.configured.set(false);
    this.accountIdentity.set(null);
  }
  /**
   * Explicit lock ("Lock account"): closes the vault AND forgets the remembered session, so
   * the next start asks for the password. Internal teardown (a failed sign-in, a restart of
   * the sign-in flow) must never forget a session, which is what `teardown` is for.
   */
  async lock(): Promise<void> {
    const wasUnlocked = this.unlocked();
    await this.teardown();
    if (wasUnlocked) await this.forgetSession();
  }
  /**
   * Forgets the remembered desktop session. A store that refuses (a Windows file lock, say) must
   * never keep the vault open or the account configured: closing and resetting go on, and the
   * person is told the saved sign-in may still be on this device.
   */
  private async forgetSession(): Promise<void> {
    this.rememberedToken = undefined;
    try {
      await this.sessions.clear();
    } catch {
      this.backgroundError.set('ACCOUNT_DATA.ERROR_STORAGE_CLEAR');
    }
  }
  /** Closes the vault and stops every timer. Keeps the configured identity and cached session. */
  private async teardown(): Promise<void> {
    this.closing = true;
    this.localChanges?.unsubscribe();
    this.localChanges = undefined;
    this.localEdits?.unsubscribe();
    this.localEdits = undefined;
    if (this.interval) clearInterval(this.interval);
    clearTimeout(this.resumeTimer);
    this.resumeTimer = undefined;
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    this.renewal.reset();
    window.removeEventListener('online', this.resume);
    window.removeEventListener('offline', this.markOffline);
    document.removeEventListener('visibilitychange', this.resume);
    await this.realtime?.stop();
    this.realtime = undefined;
    this.live.set(false);
    if (this.inFlight) await this.inFlight;
    this.unsubscribePlatform?.();
    this.unsubscribePlatform = undefined;
    try {
      const latest = await this.platform.clear();
      if (latest && this.account?.unlocked) {
        this.account.adoptTokens(latest);
        await this.cache();
      }
    } catch {
      this.backgroundError.set('NATIVE_SYNC.ERROR_NATIVE');
    }
    this.client = undefined;
    this.account?.lock();
    this.account = undefined;
    this.bridge.clear();
    this.releaseLease?.();
    this.releaseLease = undefined;
    this.scopes.set([]);
    this.invitations.set([]);
    this.ownershipOffers.set([]);
    this.unlocked.set(false);
    this.mfaMethods.set([]);
    this.deviceCheck.reset();
    this.signInIdentifier = undefined;
    this.linked.set(false);
    this.dataConnection.reset();
    this.health.closed();
    this.status.set('NATIVE_SYNC.LOCKED');
    await this.certTrust.setPendingConfig(this, null);
    this.closing = false;
  }
  /**
   * The switch has happened. What fails after it (no network for the listing or the first sync)
   * is an ordinary sync failure, never a reason to call the connection unfinished.
   */
  private async afterSwitch(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.failure(error);
    }
    await this.syncNow();
    await this.updatePlatform();
  }
  /** The person's decision from the data-choice dialog (the replacement was confirmed first). */
  chooseData(kind: 'download' | 'replace'): Promise<void> {
    return this.dataConnection.choose(kind);
  }
  /** "Decide later": nothing changes; the connection stays visibly unfinished. */
  deferDataChoice(): void {
    this.dataConnection.defer();
  }
  /**
   * "Finish connecting" / "Retry": look at the account again (it may have changed) and ask
   * again if both sides still hold work. Replaces nothing by itself.
   */
  resumeDataConnection(): Promise<void> {
    return this.dataConnection.resume();
  }

  async recoverAbandonedPersonalSetup(scopeId: string): Promise<void> {
    const setup = this.abandonedPersonalSetup();
    if (setup?.id !== scopeId) throw new Error('NATIVE_SYNC.ERROR_REMOTE_CHANGED');
    this.busy.set(true);
    try {
      if (!setup.uploaded) await this.link(true, false, undefined, scopeId);
      else {
        await this.bridge.recoverUploadedPersonalSetup(scopeId);
        await this.dataConnection.resume();
      }
    } catch (error) {
      if (this.unlocked() && !this.linked()) this.dataConnection.stage.set('waiting');
      throw error;
    } finally {
      this.busy.set(false);
    }
  }
}
