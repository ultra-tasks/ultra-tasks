import { Injectable, inject } from '@angular/core';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import type {
  AccountSessionStoreApi,
  StoredAccountSession,
} from '../../../../electron/shared-with-frontend/account-session-api';

export type { StoredAccountSession };

/** What the OS-protected store holds right now. */
export type StoredSessionState =
  | { state: 'none' }
  /** The store could not be read (keychain locked, profile changed, no OS encryption). */
  | { state: 'unavailable' }
  | { state: 'found'; session: StoredAccountSession };

/**
 * The renderer's one door to the main process' protected session store. The preload
 * capability is one-shot (so plugin code can never claim it), which is why exactly one
 * service owns it: it is claimed by `initialize()` from trusted startup code.
 *
 * Writes are serialised and ordered against `clear()`: a rotation that was still queued
 * when the person locks or signs out can never write the old credential back.
 */
@Injectable({ providedIn: 'root' })
export class NativeSessionStoreService {
  private readonly isElectron = inject(IS_ELECTRON_TOKEN);
  private api: AccountSessionStoreApi | null = null;
  private claimed = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** Only a desktop app with the protected store can remember the session. */
  get supported(): boolean {
    return !!this.api;
  }

  /** Claim the one-shot capability. Call from trusted startup code (the app component). */
  initialize(): void {
    if (this.claimed) return;
    this.claimed = true;
    if (this.isElectron) this.api = window.ea.consumeAccountSessionStore();
  }

  async load(): Promise<StoredSessionState> {
    if (!this.api) return { state: 'none' };
    let raw: string | null;
    try {
      raw = await this.api.load();
    } catch {
      return { state: 'unavailable' };
    }
    if (!raw) return { state: 'none' };
    try {
      return { state: 'found', session: JSON.parse(raw) as StoredAccountSession };
    } catch {
      return { state: 'none' };
    }
  }

  /** Rejects when the protected store refuses; the caller keeps working without it. */
  save(session: StoredAccountSession): Promise<void> {
    const api = this.api;
    if (!api) return Promise.resolve();
    const epoch = this.epoch;
    return this.enqueue(async () => {
      // A lock, sign-out or revocation happened while this write waited its turn.
      if (epoch !== this.epoch) return;
      await api.save(JSON.stringify(session));
    });
  }

  /** Forget the remembered session: explicit lock, sign-out, disconnect, delete, revocation. */
  clear(): Promise<void> {
    const api = this.api;
    this.epoch++;
    if (!api) return Promise.resolve();
    return this.enqueue(() => api.clear());
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
