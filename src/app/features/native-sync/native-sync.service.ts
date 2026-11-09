import { computed, inject, Injectable, signal } from '@angular/core';
import {
  AccountClient,
  EncryptedSyncStorage,
  SyncClient,
  httpTransport,
  open,
  seal,
  unlockBundle,
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

interface CachedAccount {
  capabilities: Capabilities;
  account: AccountInfo;
  bundle: AccountBundle;
  refresh: Envelope;
}
const PERIOD = 60000;

@Injectable({ providedIn: 'root' })
export class NativeSyncService {
  private readonly bridge = inject(NativePersonalBridgeService);
  private readonly certTrust = inject(CertTrustService);
  private readonly localActions = inject(LOCAL_ACTIONS);
  private readonly writeFlush = inject(OperationWriteFlushService);
  private readonly legacySync = inject(SyncWrapperService);
  private readonly config = inject(GlobalConfigService);
  private readonly backups = inject(BackupService);
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
  private resyncRequested = false;

  private cacheKey(): string {
    return 'ultra-native-account:' + this.serverUrl;
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
  }
  private normalizeServerUrl(serverUrl: string): string {
    const url = new URL(serverUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error('NATIVE_SYNC.ERROR_URL');
    return url.href.replace(/\/$/, '');
  }
  async openAccount(serverUrl: string): Promise<void> {
    const url = this.normalizeServerUrl(serverUrl) + '/account';
    if (Capacitor.isNativePlatform()) await Browser.open({ url });
    else if (IS_ELECTRON) window.ea.openExternalUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  async login(serverUrl: string, identifier: string, password: string): Promise<boolean> {
    this.error.set('');
    this.mfaMethods.set([]);
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    try {
      await this.certTrust.setPendingConfig(this, { baseUrl: this.serverUrl });
      return await this.authenticate(identifier, password);
    } catch (error) {
      await this.certTrust.setPendingConfig(this, null);
      throw error;
    }
  }
  async createBrowserAccount(serverUrl: string): Promise<AccountClient> {
    if (this.unlocked()) throw new Error('NATIVE_SYNC.ERROR_TAB');
    await this.lock();
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    await this.certTrust.setPendingConfig(this, { baseUrl: this.serverUrl });
    return new AccountClient(this.platform.transport(httpTransport(this.serverUrl)));
  }
  async finishBrowserAccount(account: AccountClient, serverUrl: string): Promise<void> {
    if (this.unlocked() || !account.unlocked || !account.tokens)
      throw new Error('NATIVE_SYNC.ERROR_TAB');
    this.serverUrl = this.normalizeServerUrl(serverUrl);
    this.account = account;
    try {
      await this.finishLogin();
    } catch (error) {
      await this.lock();
      throw error;
    }
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
    await this.account!.completeMfa(code);
    await this.finishLogin();
  }
  async passkey(): Promise<void> {
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
          void this.updatePlatform();
        });
      } catch {
        this.backgroundError.set('NATIVE_SYNC.ERROR_NATIVE');
      }
      if (account.tokens) {
        await this.cache();
        await this.client.refreshScopes();
      }
      this.scopes.set(
        Object.values(this.client.state.scopes)
          .filter((s) => !s.revoked)
          .map((s) => s.info),
      );
      const wasLinked = await this.bridge.bind(this.client);
      // A saved account baseline must not reactivate while a file provider is live.
      this.linked.set(wasLinked && !this.config.sync()?.isEnabled);
      this.unlocked.set(true);
      this.localChanges = this.localActions
        .pipe(filter(isPersistentAction), auditTime(500))
        .subscribe(() => {
          if (this.linked() && !this.closing) void this.syncNow();
        });
      this.status.set('NATIVE_SYNC.READY');
      this.interval = setInterval(() => {
        if (!this.personalRealtimeEnabled()) void this.syncNow();
      }, PERIOD);
      window.addEventListener('online', this.resume);
      document.addEventListener('visibilitychange', this.resume);
      if (this.linked()) await this.syncNow();
      this.startRealtime();
      await this.updatePlatform();
      const personal = this.scopes().find((scope) => scope.kind === 'personal');
      const incomplete =
        personal &&
        this.client.state.migrations[personal.id] &&
        !this.client.state.migrations[personal.id].complete;
      if (!this.linked() && (!personal || incomplete)) {
        try {
          await this.link(true, true);
        } catch (error) {
          // The recovery copy and local data remain available for another attempt.
          this.error.set(
            error instanceof Error ? error.message : 'NATIVE_SYNC.ERROR_SYNC',
          );
        }
      }
    } catch (error) {
      await this.lock();
      throw error;
    }
  }
  private readonly resume = (): void => {
    if (document.visibilityState !== 'hidden')
      void this.syncNow().then(() => this.realtime?.resume());
  };
  private startRealtime(): void {
    if (
      !this.client ||
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
          if (this.error()) throw new Error(this.error());
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
        if (scopeId)
          this.error.set(
            error instanceof Error ? error.message : 'NATIVE_SYNC.ERROR_SYNC',
          );
      },
      status: (connected) => this.live.set(connected),
    });
    this.realtime.start();
  }
  private async updatePlatform(): Promise<void> {
    if (!this.client || !this.unlocked() || !this.linked()) return;
    try {
      await this.platform.update(this.client);
      this.backgroundError.set('');
    } catch {
      this.backgroundError.set('NATIVE_SYNC.ERROR_NATIVE');
    }
  }
  private async reconnect(): Promise<void> {
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
  async link(migrate: boolean, automatic = false): Promise<void> {
    this.busy.set(true);
    this.error.set('');
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
        if (migrate) await this.bridge.migrate();
        else
          await this.bridge.useExisting(() => {
            if (changedWhileChoosing) {
              this.error.set('NATIVE_SYNC.ERROR_LOCAL_CHANGED');
              throw new Error('NATIVE_SYNC.ERROR_LOCAL_CHANGED');
            }
          });
      };
      if (this.config.sync()?.isEnabled)
        await this.legacySync.runWithSyncBlocked(perform);
      else await perform();
      this.linked.set(true);
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
      this.busy.set(false);
    }
  }
  syncNow(): Promise<void> {
    if (this.inFlight) {
      this.resyncRequested = true;
      return this.inFlight;
    }
    if (!this.client || !this.unlocked() || !this.linked() || this.closing)
      return Promise.resolve();
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
    try {
      const reminderBarrier = await this.platform.reminderBarrier(this.account!);
      if (this.linked()) {
        await this.writeFlush.flushPendingWrites();
        await this.bridge.capture();
      }
      await this.reconnect();
      const errors = await this.client!.syncAll();
      if (this.linked() && !errors[this.bridge.scopeId!]) await this.bridge.apply();
      if (this.linked() && !errors[this.bridge.scopeId!])
        await this.platform.personalSynced(this.account!, reminderBarrier);
      await this.refresh();
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join('; '));
      await this.updatePlatform();
      this.status.set('NATIVE_SYNC.SYNCED');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'NATIVE_SYNC.ERROR_SYNC');
    } finally {
      this.busy.set(false);
      this.revision.update((n) => n + 1);
    }
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
        if (deleted) await this.lock();
      } finally {
        if (deleted) {
          localStorage.removeItem(cacheKey);
          this.configured.set(false);
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
      const sessions =
        await this.account!.request<{ id: string; current: boolean }[]>('/sessions');
      const session = sessions.find((value) => value.current);
      if (session)
        await this.account!.request('/sessions/revoke', { sessionId: session.id });
    } finally {
      await this.lock();
      await this.bridge.unlink();
      localStorage.removeItem(key);
      this.configured.set(false);
    }
  }
  async disconnect(): Promise<void> {
    if (this.unlocked()) return this.logout();
    const key =
      'ultra-native-account:' + (localStorage.getItem('ultra-native-server') ?? '');
    await this.lock();
    await this.bridge.unlink();
    localStorage.removeItem(key);
    this.configured.set(false);
  }
  async lock(): Promise<void> {
    this.closing = true;
    this.localChanges?.unsubscribe();
    this.localChanges = undefined;
    if (this.interval) clearInterval(this.interval);
    window.removeEventListener('online', this.resume);
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
    this.status.set('NATIVE_SYNC.LOCKED');
    await this.certTrust.setPendingConfig(this, null);
    this.closing = false;
  }
}
