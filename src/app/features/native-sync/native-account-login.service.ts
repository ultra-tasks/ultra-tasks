import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  AccountClient,
  browserLoginUrl,
  fingerprint,
  validatePendingBrowserLogin,
  type PendingBrowserLogin,
  type Tokens,
} from '@sp/sync-providers/ultra-tasks';
import { NativeSyncService } from './native-sync.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import {
  pendingAccountLoginCallback$,
  parseAccountLoginCallback,
  type AccountLoginCallback,
} from '../../core/account-login-callback';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { type AccountLoginStoreApi } from '../../../../electron/shared-with-frontend/account-login-api';
import { Router } from '@angular/router';

/** One device-bound sign-in attempt. Native callbacks only wake its proof-bound poll. */
@Injectable({ providedIn: 'root' })
export class NativeAccountLoginService {
  private readonly native = inject(NativeSyncService);
  private readonly dataInit = inject(DataInitStateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isElectron = inject(IS_ELECTRON_TOKEN);
  readonly active = signal(false);
  readonly completing = signal(false);
  readonly code = signal('');
  readonly server = signal('');
  readonly error = signal('');
  private flow?: PendingBrowserLogin;
  private client?: AccountClient;
  private desktopStore?: AccountLoginStoreApi | null;
  private started = false;
  private initialization: Promise<void> = Promise.resolve();
  private inFlight?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  initialize(): void {
    if (this.started) return;
    this.started = true;
    if (this.isElectron) {
      this.desktopStore = window.ea.consumeAccountLoginStore();
    }
    this.initialization = this.restore().catch(() => {
      this.error.set('NATIVE_SYNC.BROWSER_RESTART');
    });
    if (this.isElectron) {
      window.ea.on(IPC.ACCOUNT_LOGIN_CALLBACK, (payload: unknown) => {
        const raw =
          typeof payload === 'string' ? payload : (payload as { url?: string })?.url;
        const callback = raw && parseAccountLoginCallback(raw);
        if (callback) void this.handleCallback(callback);
      });
    }
    pendingAccountLoginCallback$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((callback) => {
        void this.handleCallback(callback);
      });
    if (Capacitor.isNativePlatform()) {
      const listener = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void this.check();
      });
      this.destroyRef.onDestroy(() => {
        void listener.then((handle) => handle.remove());
      });
    }
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.timer);
    });
  }
  private async store(
    method: 'load' | 'save' | 'clear',
    value?: string,
  ): Promise<string | null> {
    if (this.isElectron) {
      if (!this.desktopStore) throw new Error('NATIVE_SYNC.ERROR_NATIVE');
      if (method === 'load') return this.desktopStore.load();
      if (method === 'save') await this.desktopStore.save(value!);
      else await this.desktopStore.clear();
    } else if (Capacitor.isNativePlatform())
      return this.native.platform.loginStore(method, value);
    // Browser clients keep the pending private key in memory. Reload starts a new login.
    return null;
  }
  private async restore(): Promise<void> {
    const raw = await this.store('load');
    if (!raw) return;
    try {
      const flow = JSON.parse(raw) as PendingBrowserLogin;
      await validatePendingBrowserLogin(flow);
      const client = await this.native.createBrowserAccount(flow.request.serverUrl);
      await client.resumeBrowserLogin(flow);
      await this.activate(client, flow);
    } catch (error) {
      await this.store('clear');
      throw error;
    }
  }
  private async activate(
    client: AccountClient,
    flow: PendingBrowserLogin,
  ): Promise<void> {
    this.client = client;
    this.flow = flow;
    this.server.set(flow.request.serverUrl);
    const code = (await fingerprint(flow.request)).slice(0, 8).toUpperCase();
    if (this.flow !== flow) return;
    this.code.set(code);
    this.active.set(true);
    this.schedule();
  }
  async start(serverUrl: string, identifier: string): Promise<void> {
    this.initialize();
    await this.initialization;
    await this.cancel();
    this.error.set('');
    const generation = ++this.generation;
    const client = await this.native.createBrowserAccount(serverUrl);
    const platform = Capacitor.isNativePlatform()
      ? Capacitor.getPlatform()
      : this.isElectron
        ? 'desktop'
        : 'web';
    const flow = await client.startBrowserLogin(
      this.native.serverUrl,
      platform === 'desktop'
        ? 'ultratasks://account-login'
        : platform === 'web'
          ? 'urn:ultra-tasks:web'
          : 'app.ultratasks://account-login',
      'Ultra Tasks (' + platform + ')',
      identifier,
    );
    if (generation !== this.generation) {
      await client.cancelBrowserLogin().catch(() => undefined);
      return;
    }
    try {
      await this.store('save', JSON.stringify(flow));
    } catch (error) {
      await client.cancelBrowserLogin().catch(() => undefined);
      throw error;
    }
    await this.activate(client, flow);
    await this.open();
  }
  async open(): Promise<void> {
    if (!this.flow) return;
    const url = await browserLoginUrl(this.flow.request);
    if (Capacitor.isNativePlatform()) await Browser.open({ url });
    else if (this.isElectron) window.ea.openExternalUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  async handleCallback(callback: AccountLoginCallback): Promise<void> {
    await this.initialization;
    if (
      !this.flow ||
      callback.result !== this.flow.request.ticket ||
      callback.state !== this.flow.request.state
    )
      return;
    await this.router.navigate(['/native-sync']);
    await this.check();
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.flow)
      this.timer = setTimeout(() => {
        void this.check();
      }, 2000);
  }
  check(): Promise<void> {
    return (this.inFlight ??= this.poll().finally(() => {
      this.inFlight = undefined;
      this.schedule();
    }));
  }
  private async poll(): Promise<void> {
    const flow = this.flow;
    const client = this.client;
    if (!flow || !client || this.completing()) return;
    let issuedTokens: Tokens | undefined;
    try {
      if (!(await client.pollBrowserLogin())) return;
      issuedTokens = client.tokens;
      this.completing.set(true);
      await firstValueFrom(this.dataInit.isAllDataLoadedInitially$);
      if (this.flow !== flow) {
        await this.revoke(client);
        return;
      }
      await this.store('clear');
      await this.native.finishBrowserAccount(client, flow.request.serverUrl);
      this.flow = undefined;
      this.client = undefined;
      this.active.set(false);
      if (Capacitor.isNativePlatform()) await Browser.close().catch(() => undefined);
    } catch (error) {
      if (this.flow !== flow) return;
      if (
        !issuedTokens &&
        error instanceof TypeError &&
        flow.request.expiresAt > Date.now()
      )
        return;
      // Native finalization can lock the client on failure. Retain the issued proof
      // until it finishes so that a failed local install does not orphan a session.
      if (issuedTokens) await this.revoke(client, issuedTokens);
      this.error.set('NATIVE_SYNC.BROWSER_RESTART');
      await this.cancel().catch(() => undefined);
    } finally {
      this.completing.set(false);
    }
  }
  private async revoke(client: AccountClient, tokens = client.tokens): Promise<void> {
    try {
      if (tokens) {
        const sessions = (await client.transport(
          '/sessions',
          undefined,
          tokens.accessToken,
        )) as { id: string; current: boolean }[];
        const current = sessions.find((s) => s.current);
        if (current)
          await client.transport(
            '/sessions/revoke',
            { sessionId: current.id },
            tokens.accessToken,
          );
      }
    } catch {
      /* Local cancellation still discards credentials if offline. */
    }
    client.lock();
  }
  async cancel(): Promise<void> {
    this.generation++;
    const client = this.client;
    this.flow = undefined;
    this.client = undefined;
    this.active.set(false);
    clearTimeout(this.timer);
    try {
      await this.store('clear');
    } finally {
      if (client) {
        await client.cancelBrowserLogin().catch(() => undefined);
        await this.revoke(client);
      }
    }
  }
}
