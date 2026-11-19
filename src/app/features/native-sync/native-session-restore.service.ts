import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { NativeSyncService } from './native-sync.service';
import { NativeSessionStoreService } from './native-session-store.service';

/**
 * How the last attempt to bring the remembered session back ended.
 * - `none`: nothing was remembered (or this is not a trusted desktop device).
 * - `restored`: the same account is open again, without a password.
 * - `unavailable`: protected storage could not be read. The configured account stays,
 *   locked, with its local edits; no credentials are cleared.
 * - `reauth`: the server refused the session (revoked, expired or replayed): sign in again.
 * - `invalid`: the remembered session does not match this device's account; it is left alone.
 */
export type SessionRestoreOutcome =
  | 'pending'
  | 'none'
  | 'restored'
  | 'unavailable'
  | 'reauth'
  | 'invalid';

/**
 * Brings a trusted desktop device's account back after a restart, an update or a night of
 * sleep, without asking for the password: the unlocked session lives in the OS-protected
 * store, and the account opens through the same path as a fresh sign-in (realtime,
 * interval, lease, baseline binding behave identically).
 *
 * It also turns the OS "resumed from sleep" signal into a sync resume. The sync engine
 * coalesces that with the browser's own online and visibility events into one attempt.
 */
@Injectable({ providedIn: 'root' })
export class NativeSessionRestoreService {
  private readonly native = inject(NativeSyncService);
  private readonly store = inject(NativeSessionStoreService);
  private readonly dataInit = inject(DataInitStateService);
  private readonly isElectron = inject(IS_ELECTRON_TOKEN);
  readonly outcome = signal<SessionRestoreOutcome>('pending');
  private started = false;
  private attempt?: Promise<SessionRestoreOutcome>;

  /** Call from trusted startup code (the app component): claims the one-shot store API. */
  initialize(): void {
    if (this.started) return;
    this.started = true;
    this.store.initialize();
    if (!this.store.supported) {
      this.outcome.set('none');
      return;
    }
    if (this.isElectron)
      window.ea.on(IPC.RESUME, () => {
        // The OS woke up. The engine waits for the network to settle, then syncs once.
        if (this.native.unlocked()) this.native.resume();
        else if (this.outcome() === 'unavailable') void this.retry();
      });
    void this.restore();
  }

  /** "Try again": for example after the keychain was unlocked. Serialised: one at a time. */
  retry(): Promise<SessionRestoreOutcome> {
    return this.restore();
  }

  private restore(): Promise<SessionRestoreOutcome> {
    return (this.attempt ??= this.run().finally(() => {
      this.attempt = undefined;
    }));
  }

  private async run(): Promise<SessionRestoreOutcome> {
    // The op-log baseline and the sync client need the app's own data loaded first.
    await firstValueFrom(this.dataInit.isAllDataLoadedInitially$);
    if (this.native.unlocked() || this.native.signingIn()) return this.outcome();
    const stored = await this.store.load();
    if (stored.state === 'unavailable') {
      // Say so, keep the configured account and every local edit, and clear nothing.
      if (this.native.configured()) this.native.markStorageUnavailable();
      return this.finish('unavailable');
    }
    if (stored.state === 'none') return this.finish('none');
    try {
      return this.finish(await this.native.restoreSession(stored.session));
    } catch {
      return this.finish('invalid');
    }
  }

  private finish(outcome: SessionRestoreOutcome): SessionRestoreOutcome {
    this.outcome.set(outcome);
    return outcome;
  }
}
