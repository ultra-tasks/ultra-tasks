import { signal, type WritableSignal } from '@angular/core';
import type { ScopeInfo, SyncClient } from '@sp/sync-providers/ultra-tasks';
import type {
  AccountDataChoice,
  AccountDataSummary,
  DataConnectionState,
} from './account-sync.types';

export const ERROR_LOCAL_CHANGED = 'NATIVE_SYNC.ERROR_LOCAL_CHANGED';
export const ERROR_REMOTE_CHANGED = 'NATIVE_SYNC.ERROR_REMOTE_CHANGED';
const ERROR_MIGRATION_BUSY = 'NATIVE_SYNC.ERROR_MIGRATION_BUSY';
const ERROR_DATA = 'NATIVE_SYNC.ERROR_DATA';
/**
 * An automatic switch is attempted at most this many times while edits keep arriving, then
 * the person is asked. One silent retry covers a benign edit (a setting); a second refusal
 * means something real is changing (another tab, a typed task), and retrying cannot fix it.
 */
const MAX_AUTOMATIC_ATTEMPTS = 2;

export interface DataConnectionHost {
  client(): SyncClient | undefined;
  linked(): boolean;
  /** The engine's list of datasets, updated after every successful discovery. */
  readonly scopes: WritableSignal<ScopeInfo[]>;
  /** Loads the saved baseline and finds the personal dataset; true when already linked. */
  bind(client: SyncClient): Promise<boolean>;
  readonly summary: {
    local(): Promise<AccountDataSummary>;
    fromRecords(client: SyncClient, scopeId: string): AccountDataSummary;
  };
  /** The engine's transactional switch: `migrate` replaces the account with this device. */
  link(migrate: boolean, automatic?: boolean): Promise<void>;
  /** The server's own list of datasets, to cross-check what the client could verify. */
  serverHasPersonalScope(client: SyncClient): Promise<boolean>;
  /** Reports a failure like every other engine failure; true when the session is gone. */
  fail(error: unknown): { sessionLost: boolean };
  /** Whether the person already pressed "Decide later" for this account on this device. */
  readonly deferred: { read(): boolean; write(on: boolean): void };
  /** Takes the person to their tasks once the first download has been applied. */
  showWorkspace(): void;
}

/**
 * First connection of a device to the account's data: discover, then either download
 * silently (this device holds nothing of its own), seed an empty account (this device holds
 * work, the account holds none) or ask (both sides hold real work). Failing to look is never
 * read as "nothing there": the connection reports `failed` and tries again, and no dataset
 * is created meanwhile.
 *
 * An empty device downloads inside the engine's guarded switch without fetching anything
 * beforehand, so an edit made at any moment of the download is noticed and refuses the
 * replacement. A device with work fetches the whole dataset first, because the choice (and
 * the numbers it shows) needs to know what the account holds.
 *
 * State only. The transactional work (recovery copy, replacement, apply) stays in
 * `NativeSyncService.link`.
 */
export class NativeDataConnection {
  readonly stage = signal<DataConnectionState>('idle');
  /** Set while both sides hold real data (or the person deferred): drives the dialog. */
  readonly choice = signal<AccountDataChoice | null>(null);
  /** Why the choice is being asked again: an i18n key, or ''. */
  readonly notice = signal('');
  private flight?: Promise<void>;
  private generation = 0;

  constructor(private readonly host: DataConnectionHost) {}

  /** A failed or waiting connection that a periodic or manual retry should resume. */
  needsRetry(): boolean {
    return this.stage() === 'failed' || this.stage() === 'waiting';
  }

  /** Single flight. `userInitiated` is false for a restored session (no surprise modal). */
  connect(userInitiated = true): Promise<void> {
    return (this.flight ??= this.plan(userInitiated, this.generation).finally(() => {
      this.flight = undefined;
    }));
  }

  /** "Finish connecting": measure again (the situation may have changed) and ask again. */
  resume(): Promise<void> {
    if (this.flight) return this.flight;
    this.choice.set(null);
    this.notice.set('');
    return this.connect(true);
  }

  /** "Decide later": nothing changes, and the connection stays visibly unfinished. */
  defer(): void {
    if (!this.choice()) return;
    this.choice.update((choice) => choice && { ...choice, deferred: true });
    this.host.deferred.write(true);
  }

  /** The person's decision from the dialog. */
  async choose(kind: 'download' | 'replace'): Promise<void> {
    if (!this.choice() || this.flight) return;
    this.notice.set('');
    const generation = this.generation;
    await (this.flight = this.switchTo(kind, 'user', generation, 0).finally(() => {
      this.flight = undefined;
    }));
  }

  /** The vault closed or the account changed: forget everything in flight. */
  reset(): void {
    this.generation++;
    this.flight = undefined;
    this.choice.set(null);
    this.notice.set('');
    this.stage.set('idle');
  }

  private stale(generation: number): boolean {
    return generation !== this.generation;
  }

  private fail(error: unknown, stage: DataConnectionState = 'failed'): void {
    const { sessionLost } = this.host.fail(error);
    this.stage.set(sessionLost ? 'idle' : stage);
  }

  private async plan(userInitiated: boolean, generation: number): Promise<void> {
    const client = this.host.client();
    if (!client || this.host.linked()) {
      this.stage.set('idle');
      return;
    }
    this.stage.set('discovering');
    let scopes: ScopeInfo[];
    try {
      scopes = await client.refreshScopes();
    } catch (error) {
      if (!this.stale(generation)) this.fail(error);
      return;
    }
    if (this.stale(generation)) return;
    this.host.scopes.set(scopes);
    const personal = scopes.find((scope) => scope.kind === 'personal');
    const journal = personal && client.state.migrations[personal.id];
    if (!personal || (journal && !journal.complete)) {
      await this.initializeAccount(client, !!personal, userInitiated, generation);
      return;
    }
    await this.connectExisting(client, personal, userInitiated, generation, 0);
  }

  /** The account has no personal dataset (or this device's own first upload was interrupted). */
  private async initializeAccount(
    client: SyncClient,
    resuming: boolean,
    userInitiated: boolean,
    generation: number,
  ): Promise<void> {
    if (!resuming) {
      try {
        // A dataset the client could not verify is missing from the list but not from the
        // server. Creating a second one next to it is exactly what must never happen.
        if (await this.host.serverHasPersonalScope(client))
          return this.fail(new Error(ERROR_DATA));
      } catch (error) {
        return this.fail(error);
      }
      if (this.stale(generation)) return;
    }
    this.stage.set('uploading');
    try {
      await this.host.link(true, true);
    } catch (error) {
      if (!this.stale(generation)) this.fail(error);
      return;
    }
    if (this.stale(generation)) return;
    if (this.host.linked()) return this.complete(false);
    // Another device initialised the account while this one was looking: look again.
    await this.plan(userInitiated, generation);
  }

  private async connectExisting(
    client: SyncClient,
    personal: ScopeInfo,
    userInitiated: boolean,
    generation: number,
    attempts: number,
  ): Promise<void> {
    if (personal.state !== 'active') return this.waitForOtherDevice();
    // Measure this device first: what it holds decides how much has to be known.
    let local: AccountDataSummary;
    try {
      local = await this.host.summary.local();
    } catch (error) {
      if (!this.stale(generation)) this.fail(error);
      return;
    }
    if (this.stale(generation)) return;
    try {
      await this.host.bind(client);
    } catch (error) {
      if (!this.stale(generation)) this.fail(error);
      return;
    }
    if (this.stale(generation)) return;
    const mayDecideAlone = attempts < MAX_AUTOMATIC_ATTEMPTS;
    if (mayDecideAlone && !local.hasUserData)
      // An empty device holds nothing to lose, whatever the account holds.
      return this.switchTo('download', 'automatic', generation, attempts);
    this.stage.set('downloading');
    let account: AccountDataSummary;
    try {
      await client.syncScope(personal.id);
      if (client.state.scopes[personal.id].info.state !== 'active')
        return this.waitForOtherDevice();
      // The whole dataset is now in the encrypted local state; the app's own data is untouched.
      account = this.host.summary.fromRecords(client, personal.id);
    } catch (error) {
      if (!this.stale(generation)) this.fail(error);
      return;
    }
    if (this.stale(generation)) return;
    if (mayDecideAlone && !account.hasUserData)
      // Nothing on the account side can be lost: seed it with this device's data.
      return this.switchTo('replace', 'automatic', generation, attempts);
    this.stage.set('idle');
    this.choice.set({
      local,
      account,
      since: Date.now(),
      deferred: !userInitiated && this.host.deferred.read(),
    });
  }

  private waitForOtherDevice(): void {
    this.fail(new Error(ERROR_MIGRATION_BUSY), 'waiting');
  }

  private async switchTo(
    kind: 'download' | 'replace',
    origin: 'automatic' | 'user',
    generation: number,
    attempts: number,
  ): Promise<void> {
    if (this.stale(generation)) return;
    this.stage.set(kind === 'download' ? 'downloading' : 'uploading');
    try {
      await this.host.link(kind === 'replace', origin === 'automatic');
    } catch (error) {
      if (!this.stale(generation))
        await this.refused(error, origin, generation, attempts);
      return;
    }
    if (!this.stale(generation)) this.complete(kind === 'download');
  }

  /** The switch did not happen. Nothing was replaced; decide what the person sees next. */
  private async refused(
    error: unknown,
    origin: 'automatic' | 'user',
    generation: number,
    attempts: number,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : '';
    const client = this.host.client();
    const personal = this.host.scopes().find((scope) => scope.kind === 'personal');
    const changed = message === ERROR_LOCAL_CHANGED || message === ERROR_REMOTE_CHANGED;
    if (!client || !personal || (!changed && origin === 'automatic')) {
      this.fail(error);
      return;
    }
    // Something moved while the switch ran. Measure both sides again: an edit makes this
    // device "real", a remote change alters the account, and the person (or the rule for
    // an empty device) decides on fresh facts. An automatic download retries once.
    if (changed) {
      this.notice.set(
        message === ERROR_LOCAL_CHANGED
          ? 'ACCOUNT_DATA.NOTICE_LOCAL_CHANGED'
          : 'ACCOUNT_DATA.NOTICE_REMOTE_CHANGED',
      );
      this.host.fail(error);
      const again = origin === 'automatic' && message === ERROR_LOCAL_CHANGED;
      return this.connectExisting(
        client,
        personal,
        true,
        generation,
        // After the person's own choice was refused, or the retry was spent, ask.
        again ? attempts + 1 : MAX_AUTOMATIC_ATTEMPTS,
      );
    }
    // The person's own choice failed (offline, validation, server too old, ...): the
    // choice stays on screen with the reason, and nothing was changed.
    this.notice.set(this.noticeFor(error));
    this.host.fail(error);
    this.stage.set('idle');
  }

  private noticeFor(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    return /^(NATIVE_SYNC|ACCOUNT_DATA)\./.test(message)
      ? message
      : 'ACCOUNT_DATA.ERROR_SWITCH';
  }

  private complete(showTasks: boolean): void {
    this.choice.set(null);
    this.notice.set('');
    this.stage.set('idle');
    this.host.deferred.write(false);
    if (showTasks) this.host.showWorkspace();
  }
}
