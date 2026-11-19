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
  createRealtimeSocket,
  type AccountBundle,
  type AccountInfo,
  type Capabilities,
  type Envelope,
  type Invitation,
  type ScopeInfo,
  type OwnershipOffer,
} from '@sp/sync-providers/ultra-tasks';
import { NativePersonalBridgeService } from './native-personal-bridge.service';
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
} from './account-sync.types';
import { AccountDataSummaryService } from './account-data-summary.service';
import { NativeDataConnection } from './native-data-connection';
import {
  classifyFailure,
  NativeSyncHealth,
  type FailureKind,
} from './native-sync-health';
import {
  NativeSessionStoreService,
  type StoredAccountSession,
} from './native-session-store.service';

interface CachedAccount {
  capabilities: Capabilities;
  account: AccountInfo;
  bundle: AccountBundle;
  refresh: Envelope;
}
const PERIOD = 60000;
/** After a wake, the network, the window and the OS all report at once: wait for them to settle. */
const RESUME_SETTLE_MS = 1500;

/** A sync that already reported its own failure; only the socket's retry needs to hear of it. */
class RecordedFailure extends Error {}

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
  readonly platform = inject(NativeSyncPlatformService);
  readonly backgroundError = signal('');
  readonly status = signal('NATIVE_SYNC.LOCKED');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly unlocked = signal(false);
  readonly linked = signal(false);
  readonly configured = signal(
    !!localStorage.getItem(
      'ultra-native-account:' + (localStorage.getItem('ultra-native-server') ?? ''),
    ),
  );
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
  readonly accountIdentity = signal<{ email: string; id: string } | null>(
    NativeSyncService.cachedIdentity(),
  );
  /** Facts about the last attempts, derived from engine events; nothing here is synced. */
  private readonly health = new NativeSyncHealth();
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
    link: (migrate, automatic) => this.link(migrate, automatic),
    serverHasPersonalScope: async (client) =>
      (await client.account.request<{ scopes: ScopeInfo[] }>('/sync/scopes')).scopes.some(
        (scope) => scope.kind === 'personal',
      ),
    fail: (error) => ({ sessionLost: this.failure(error, true) === 'auth' }),
    deferred: {
      read: () => this.readFlag('deferred') === '1',
      write: (on) => this.writeFlag('deferred', on ? '1' : null),
    },
    showWorkspace: () => this.showWorkspace(),
  });
  /** Both sides hold real data (or the person chose "Decide later"). */
  readonly dataChoice: Signal<AccountDataChoice | null> = this.dataConnection.choice;
  /** Why the choice is being asked again (an i18n key), or ''. */
  readonly dataNotice: Signal<string> = this.dataConnection.notice;
  /** Where the first connection stands; `failed` and `waiting` need Retry or time. */
  readonly connection: Signal<DataConnectionState> = this.dataConnection.stage;
  /** Derived presentation state; see {@link AccountPhase}. Not persisted. */
  readonly phase = computed<AccountPhase>(() => {
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
        return 'choose-data';
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
  private expiring?: Promise<void>;
  private rememberedToken?: string;
  private emptyChecked = '';
  /** A restored session must not interrupt with a dialog the person already deferred. */
  private restoring = false;

  constructor() {
    // Development builds only (like `__e2eTestHelpers`): lets E2E read `phase`,
    // `dataChoice` and friends on any route without depending on how a surface words them.
    if (!environment.production && !environment.stage)
      (window as unknown as { __e2eNativeSync?: NativeSyncService }).__e2eNativeSync =
        this;
  }

  private static cachedIdentity(): { email: string; id: string } | null {
    try {
      const raw = localStorage.getItem(
        'ultra-native-account:' + (localStorage.getItem('ultra-native-server') ?? ''),
      );
      const account = raw ? (JSON.parse(raw) as CachedAccount).account : undefined;
      return account?.email && account.id
        ? { email: account.email, id: account.id }
        : null;
    } catch {
      return null;
    }
  }
  private cacheKey(): string {
    return 'ultra-native-account:' + this.serverUrl;
  }
  private cacheContext(): string {
    return JSON.stringify({ ...this.account!.identity(), purpose: 'native-session' });
  }
  /** Small device-local facts per account (never synced): the deferral and the last sync. */
  private flagKey(name: string): string {
    return `ultra-native-${name}:${this.account?.account?.id ?? this.accountIdentity()?.id ?? ''}`;
  }
  private readFlag(name: string): string | null {
    try {
      return localStorage.getItem(this.flagKey(name));
    } catch {
      return null;
    }
  }
  private writeFlag(name: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(this.flagKey(name));
      else localStorage.setItem(this.flagKey(name), value);
    } catch {
      /* A full or blocked storage only loses the convenience. */
    }
  }
  private async cache(): Promise<void> {
    const account = this.account!;
    const refresh = await seal(
      account.unlocked!.masterKey,
      account.tokens!.refreshToken,
      this.cacheContext(),
    );
    localStorage.setItem(
      this.cacheKey(),
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
    // Present once the account SDK issues new-device trust markers; never sent from here.
    const { deviceToken } = account as AccountClient & { deviceToken?: string };
    const session: StoredAccountSession = {
      v: 1,
      serverUrl: this.serverUrl,
      accountId: account.account!.id,
      serverId: account.capabilities!.serverId,
      masterKey: account.unlocked.masterKey,
      refreshToken: token,
      ...(deviceToken ? { deviceToken } : {}),
    };
    try {
      await this.sessions.save(session);
      this.rememberedToken = token;
      this.clearBackgroundError('ACCOUNT_DATA.ERROR_STORAGE');
    } catch {
      this.backgroundError.set('ACCOUNT_DATA.ERROR_STORAGE');
    }
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
  async login(serverUrl: string, identifier: string, password: string): Promise<boolean> {
    this.error.set('');
    this.mfaMethods.set([]);
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
    return new AccountClient(this.platform.transport(httpTransport(this.serverUrl)));
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
    this.account = new AccountClient(
      this.platform.transport(httpTransport(this.serverUrl)),
    );
    try {
      const result = await this.account.login(identifier, password);
      if (result.mfaToken) {
        this.mfaMethods.set(result.factors ?? []);
        this.status.set('NATIVE_SYNC.MFA');
        return false;
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      const raw = localStorage.getItem(this.cacheKey());
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
  async passkey(): Promise<void> {
    await this.signingInWhile(() => this.signInWithPasskey());
  }
  private async signInWithPasskey(): Promise<void> {
    if (location.origin !== new URL(this.serverUrl).origin) {
      if (!this.account!.capabilities?.features['browserMfa'])
        throw new Error('NATIVE_SYNC.ERROR_SERVER_UPDATE');
      const flow = await this.account!.startBrowserMfa();
      if (new URL(flow.url).origin !== new URL(this.serverUrl).origin)
        throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
      if (Capacitor.isNativePlatform()) await Browser.open({ url: flow.url });
      else if (IS_ELECTRON) window.ea.openExternalUrl(flow.url);
      else window.open(flow.url, '_blank', 'noopener,noreferrer');
      const account = this.account!;
      const deadline = Date.now() + 180000;
      while (this.account === account && Date.now() < deadline) {
        if (await account.pollBrowserMfa(flow)) {
          if (Capacitor.isNativePlatform()) await Browser.close().catch(() => undefined);
          await this.finishLogin();
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
    }
    const { options, credentialToken } = await this.account!.webauthnLoginOptions();
    const credentialClass = PublicKeyCredential as typeof PublicKeyCredential & {
      parseRequestOptionsFromJSON(options: object): PublicKeyCredentialRequestOptions;
    };
    if (!credentialClass.parseRequestOptionsFromJSON)
      throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
    const credential = (await navigator.credentials.get({
      publicKey: credentialClass.parseRequestOptionsFromJSON(options),
    })) as (PublicKeyCredential & { toJSON(): unknown }) | null;
    if (!credential) throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
    await this.account!.completeWebauthn(credentialToken, credential.toJSON());
    await this.finishLogin();
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
            ? (JSON.parse(localStorage.getItem(this.cacheKey())!) as CachedAccount)
            : undefined;
        const refresh = cached
          ? await open(account.unlocked!.masterKey, cached.refresh, this.cacheContext())
          : undefined;
        await this.platform.bind(
          client,
          this.serverUrl,
          () => this.syncNow(),
          async () => {
            if (this.client !== client) return;
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
      this.health.lastSyncedAt.set(Number(this.readFlag('synced')) || null);
      this.health.refreshPending(this.client);
      this.localChanges = this.localActions
        .pipe(filter(isPersistentAction), auditTime(500))
        .subscribe(() => {
          if (this.linked() && !this.closing) void this.syncNow();
        });
      this.localEdits = this.localActions
        .pipe(filter(isPersistentAction))
        .subscribe(() => {
          if (this.linked() && !this.closing) this.health.noteLocalEdit(this.client);
        });
      this.status.set('NATIVE_SYNC.READY');
      this.interval = setInterval(() => {
        if (!this.personalRealtimeEnabled() || this.dataConnection.needsRetry())
          void this.syncNow();
      }, PERIOD);
      window.addEventListener('online', this.resume);
      window.addEventListener('offline', this.markOffline);
      document.addEventListener('visibilitychange', this.resume);
      if (this.linked()) await this.syncNow();
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
  /** The OS or browser says there is no network: say so now instead of at the next failure. */
  private readonly markOffline = (): void => {
    if (!this.unlocked()) return;
    this.health.failed('offline');
    this.status.set('ACCOUNT_DATA.OFFLINE');
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
      void this.syncNow().then(() => {
        if (!this.live()) this.realtime?.resume();
      });
    }, RESUME_SETTLE_MS);
  };
  private startRealtime(): void {
    if (
      !this.client ||
      this.expiring ||
      !(
        this.account?.capabilities?.features['sharedRealtime'] ||
        this.account?.capabilities?.features['personalRealtime']
      )
    )
      return;
    this.realtime = new RealtimeSync(this.client, {
      fallbackMs: PERIOD,
      includePersonal: this.account?.capabilities?.features['personalRealtime'] === true,
      includeShared: this.account?.capabilities?.features['sharedRealtime'] === true,
      syncScope: async (scopeId) => {
        if (this.client?.state.scopes[scopeId]?.info.kind === 'personal') {
          await this.syncNow();
          // Make the socket retry with its back-off; the failure itself is already recorded.
          if (this.error() || this.offline()) throw new RecordedFailure();
        } else await this.client!.syncScope(scopeId);
      },
      socket: (ticket) =>
        createRealtimeSocket(
          this.serverUrl.replace(/^http/, 'ws') +
            '/api/v2/accounts/sync/events?ticket=' +
            encodeURIComponent(ticket),
        ),
      updated: () => {
        this.scopes.set(
          Object.values(this.client!.state.scopes)
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
      failed: (scopeId, error) => {
        if (scopeId && !(error instanceof RecordedFailure)) this.failure(error);
      },
      // An open socket says nothing about whether tasks have synced: connection detail only.
      status: (connected) => this.live.set(connected),
    });
    this.realtime.start();
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
    const native = await this.platform.current(this.account!);
    if (native) {
      this.account!.adoptTokens(native);
      await this.cache();
    }
    if (this.account!.tokens) return;
    const cached = JSON.parse(localStorage.getItem(this.cacheKey())!) as CachedAccount;
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
  async link(migrate: boolean, automatic = false): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    // A switch started directly (not by the first-connection planner) still reports its stage.
    const ownStage = this.dataConnection.stage() === 'idle';
    if (ownStage) this.dataConnection.stage.set(migrate ? 'uploading' : 'downloading');
    const onStage = (stage: 'downloading' | 'applying' | 'uploading'): void =>
      this.dataConnection.stage.set(stage);
    let changedWhileChoosing = false;
    let retiringLegacy = false;
    let retiredLegacy = false;
    const choiceChanges = !migrate
      ? this.localActions.pipe(filter(isPersistentAction)).subscribe((action) => {
          // The provider switch itself disables local-only sync settings.
          if (
            retiringLegacy &&
            action.type === updateGlobalConfigSection.type &&
            action.sectionKey === 'sync'
          )
            return;
          changedWhileChoosing = true;
        })
      : undefined;
    try {
      if (!this.client) throw new Error('NATIVE_SYNC.ERROR_SYNC');
      const chosenScope = this.scopes().find((scope) => scope.kind === 'personal');
      const previousScopeId = this.bridge.scopeId;
      const scopes = await this.client.refreshScopes();
      this.scopes.set(scopes);
      const discoveredPersonal = scopes.find((scope) => scope.kind === 'personal');
      if (!previousScopeId && discoveredPersonal) {
        await this.bridge.bind(this.client);
        // A second device may have initialized the account while sign-in ran.
        if (automatic) return;
      }
      const personal =
        this.bridge.scopeId && this.client?.state.scopes[this.bridge.scopeId];
      const journal = personal && this.client?.state.migrations[personal.info.id];
      const resumingInitialMigration = !!journal && !journal.complete;
      const changedSinceChoice = (scope: ScopeInfo): boolean =>
        !!chosenScope &&
        (scope.id !== chosenScope.id ||
          scope.sequence !== chosenScope.sequence ||
          scope.generation !== chosenScope.generation ||
          scope.controlVersion !== chosenScope.controlVersion);
      if (
        migrate &&
        !resumingInitialMigration &&
        discoveredPersonal &&
        changedSinceChoice(discoveredPersonal)
      )
        throw new Error('NATIVE_SYNC.ERROR_REMOTE_CHANGED');
      if (
        personal &&
        !resumingInitialMigration &&
        (personal.intents.length || personal.uncertain)
      )
        throw new Error('NATIVE_SYNC.ERROR_PENDING_ACCOUNT_CHANGES');
      if (
        migrate &&
        personal &&
        !resumingInitialMigration &&
        this.account?.capabilities?.features['personalReplacement'] !== true
      )
        throw new Error('NATIVE_SYNC.ERROR_REPLACEMENT_UNAVAILABLE');
      if (personal && !resumingInitialMigration) {
        await this.client.syncScope(personal.info.id);
        const current = this.client.state.scopes[personal.info.id].info;
        this.scopes.update((values) =>
          values.map((value) => (value.id === current.id ? current : value)),
        );
        if (migrate && changedSinceChoice(current))
          throw new Error('NATIVE_SYNC.ERROR_REMOTE_CHANGED');
        if (current.state !== 'active')
          throw new Error('NATIVE_SYNC.ERROR_MIGRATION_BUSY');
      }
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
        if (migrate) await this.bridge.migrate(onStage);
        else
          await this.bridge.useExisting(() => {
            if (changedWhileChoosing) {
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
      await this.refresh();
      await this.syncNow();
      await this.updatePlatform();
    } catch (error) {
      if (error instanceof Error && error.message === 'NATIVE_SYNC.ERROR_LOCAL_CHANGED') {
        this.error.set(error.message);
      } else if (retiredLegacy && !this.linked()) {
        this.error.set('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
        throw new Error('NATIVE_SYNC.ERROR_SWITCH_INTERRUPTED');
      }
      throw error;
    } finally {
      choiceChanges?.unsubscribe();
      if (ownStage && this.dataConnection.stage() !== 'idle' && !this.linked())
        this.dataConnection.stage.set('idle');
      this.busy.set(false);
    }
  }
  /** Sync now. Reaches exactly one engine: a device that is not connected yet only retries. */
  syncNow(): Promise<void> {
    if (this.inFlight) {
      this.resyncRequested = true;
      return this.inFlight;
    }
    if (!this.client || !this.unlocked() || this.closing) return Promise.resolve();
    if (this.expiring || this.reauth()) return Promise.resolve();
    if (!this.linked())
      return this.dataConnection.needsRetry()
        ? this.dataConnection.connect(false)
        : Promise.resolve();
    this.inFlight = (async () => {
      do {
        this.resyncRequested = false;
        await this.sync();
      } while (this.resyncRequested && !this.closing);
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  private async sync(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    // Stale success ends the moment new work starts.
    this.status.set('ACCOUNT_DATA.SYNCING');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false)
        throw new TypeError('Failed to fetch');
      const reminderBarrier = await this.platform.reminderBarrier(this.account!);
      if (this.linked()) {
        await this.writeFlush.flushPendingWrites();
        await this.bridge.capture();
        this.health.captured(this.client);
      }
      await this.adoptNativeSession();
      const errors = await this.client!.syncAll();
      if (this.linked() && !errors[this.bridge.scopeId!]) await this.bridge.apply();
      if (this.linked() && !errors[this.bridge.scopeId!])
        await this.platform.personalSynced(this.account!, reminderBarrier);
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
  /** Only a sync that finished, applied and persisted everything counts as success. */
  private syncSucceeded(): void {
    const at = Date.now();
    this.status.set('NATIVE_SYNC.SYNCED');
    this.health.succeeded(at);
    this.writeFlag('synced', String(at));
    this.refreshEmptyAccount();
  }
  /** "Up to date, no tasks yet" is only true after a complete fetch found none. */
  private refreshEmptyAccount(): void {
    const scopeId = this.bridge.scopeId;
    const scope = scopeId ? this.client?.state.scopes[scopeId] : undefined;
    if (!scopeId || !scope) return;
    const marker = `${scopeId}:${scope.info.sequence}:${scope.info.generation}`;
    if (marker === this.emptyChecked) return;
    try {
      this.health.emptyAccount.set(
        !this.summary.fromRecords(this.client!, scopeId).hasUserData,
      );
      this.emptyChecked = marker;
    } catch {
      /* Unreadable data is reported by the sync itself, never as "empty". */
    }
  }
  /**
   * Records a failure the way every surface reports it and returns its kind. Failing to
   * reach the server is "offline" (calm, automatic retry, no error text); a refused session
   * needs a new sign-in; nothing here ever clears the person's data or credentials by
   * itself. `connecting` marks the first connection of a device to the account's data.
   */
  private failure(error: unknown, connecting = false): FailureKind {
    const kind = classifyFailure(error);
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
      await this.sessions.clear();
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
    const raw = localStorage.getItem(this.cacheKey());
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
        const account = new AccountClient(
          this.platform.transport(httpTransport(this.serverUrl)),
        );
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
    const cacheKey = this.cacheKey();
    const storage = new EncryptedSyncStorage(
      account.unlocked!.masterKey,
      account.identity(),
    );
    let deleted = false;
    try {
      await account.deleteAccount();
      deleted = true;
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
    const key = this.cacheKey();
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
    const key =
      'ultra-native-account:' + (localStorage.getItem('ultra-native-server') ?? '');
    await this.teardown();
    await this.bridge.unlink();
    await this.forgetAccount(key);
  }
  /** The account is gone from this device (sign-out, disconnect or deletion). */
  private async forgetAccount(cacheKey: string): Promise<void> {
    this.writeFlag('deferred', null);
    this.writeFlag('synced', null);
    localStorage.removeItem(cacheKey);
    await this.sessions.clear();
    this.rememberedToken = undefined;
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
    if (wasUnlocked) {
      await this.sessions.clear();
      this.rememberedToken = undefined;
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
    this.linked.set(false);
    this.dataConnection.reset();
    this.emptyChecked = '';
    this.health.offline.set(false);
    this.health.pendingChanges.set(0);
    this.health.emptyAccount.set(false);
    this.status.set('NATIVE_SYNC.LOCKED');
    await this.certTrust.setPendingConfig(this, null);
    this.closing = false;
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
}
