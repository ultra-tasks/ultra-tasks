import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { NativeSyncService } from './native-sync.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import type { AccountDataChoice, AccountPhase } from './account-sync.types';

describe('AccountSyncStatusService', () => {
  let service: AccountSyncStatusService;
  let configured: ReturnType<typeof signal<boolean>>;
  let unlocked: ReturnType<typeof signal<boolean>>;
  let phase: ReturnType<typeof signal<AccountPhase>>;
  let error: ReturnType<typeof signal<string>>;
  let busy: ReturnType<typeof signal<boolean>>;
  let offline: ReturnType<typeof signal<boolean>>;
  let emptyAccount: ReturnType<typeof signal<boolean>>;
  let lastSyncedAt: ReturnType<typeof signal<number | null>>;
  let pendingChanges: ReturnType<typeof signal<number>>;
  let syncCfg$: BehaviorSubject<{ isEnabled: boolean; syncProvider: unknown }>;
  let ready$: BehaviorSubject<boolean>;
  let state$: BehaviorSubject<string>;
  let inProgress$: BehaviorSubject<boolean>;
  let clean$: BehaviorSubject<boolean>;

  beforeEach(() => {
    configured = signal(false);
    unlocked = signal(false);
    phase = signal<AccountPhase>('signed-out');
    error = signal('');
    busy = signal(false);
    offline = signal(false);
    emptyAccount = signal(false);
    lastSyncedAt = signal<number | null>(null);
    pendingChanges = signal(0);
    syncCfg$ = new BehaviorSubject<{ isEnabled: boolean; syncProvider: unknown }>({
      isEnabled: false,
      syncProvider: null,
    });
    ready$ = new BehaviorSubject(false);
    state$ = new BehaviorSubject('UNKNOWN_OR_CHANGED');
    inProgress$ = new BehaviorSubject(false);
    clean$ = new BehaviorSubject(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NativeSyncService,
          useValue: {
            configured,
            unlocked,
            phase,
            error,
            busy,
            offline,
            emptyAccount,
            lastSyncedAt,
            pendingChanges,
            dataChoice: signal<AccountDataChoice | null>(null),
          },
        },
        {
          provide: SyncWrapperService,
          useValue: {
            syncCfg$,
            isEnabledAndReady$: ready$,
            syncState$: state$,
            isSyncInProgress$: inProgress$,
            hasNoPendingOps$: clean$,
          },
        },
      ],
    });
    service = TestBed.inject(AccountSyncStatusService);
  });

  const account = (next: AccountPhase): void => {
    configured.set(true);
    unlocked.set(next !== 'locked' && next !== 'reauth');
    phase.set(next);
  };

  it('is local only when neither an account nor a provider is configured', () => {
    expect(service.status().id).toBe('local-only');
    expect(service.status().configured).toBeFalse();
    expect(service.status().action).toBe('setup');
    expect(service.isConfigured()).toBeFalse();
  });

  it('reports a configured account as up to date, with the account engine', () => {
    account('synced');
    lastSyncedAt.set(1_700_000_000_000);
    const status = service.status();
    expect(status.id).toBe('up-to-date');
    expect(status.engine).toBe('account');
    expect(status.configured).toBeTrue();
    expect(status.lastSyncedAt).toBe(1_700_000_000_000);
    expect(service.isConfigured()).toBeTrue();
  });

  it('distinguishes an account with no tasks from an incomplete fetch', () => {
    account('synced');
    emptyAccount.set(true);
    expect(service.status().id).toBe('up-to-date-empty');
  });

  it('never presents a locked account as "set up sync"', () => {
    account('locked');
    const status = service.status();
    expect(status.id).toBe('locked');
    expect(status.configured).toBeTrue();
    expect(status.action).toBe('unlock');
  });

  it('keeps the configured identity when the session was revoked and asks to sign in again', () => {
    account('reauth');
    const status = service.status();
    expect(status.id).toBe('reauth');
    expect(status.configured).toBeTrue();
    expect(status.action).toBe('sign-in');
    expect(status.severity).toBe('error');
  });

  it('asks for the data decision without any success badge', () => {
    account('choose-data');
    const status = service.status();
    expect(status.id).toBe('choose-data');
    expect(status.severity).toBe('warning');
    expect(status.action).toBe('choose-data');
  });

  it('shows download and apply as separate stages with a busy indicator', () => {
    account('downloading');
    expect(service.status().id).toBe('downloading');
    expect(service.status().busy).toBeTrue();
    phase.set('applying');
    expect(service.status().id).toBe('applying');
    phase.set('syncing');
    expect(service.status().id).toBe('syncing');
  });

  it('ranks a failure ahead of an earlier "up to date"', () => {
    account('synced');
    lastSyncedAt.set(1);
    error.set('NATIVE_SYNC.ERROR_SYNC');
    const status = service.status();
    expect(status.id).toBe('error');
    expect(status.reason).toBe('NATIVE_SYNC.ERROR_SYNC');
    expect(status.action).toBe('retry');
  });

  it('keeps showing progress while a retry is running instead of the old failure', () => {
    account('syncing');
    error.set('NATIVE_SYNC.ERROR_SYNC');
    busy.set(true);
    expect(service.status().id).toBe('syncing');
  });

  it('shows offline with changes kept on this device', () => {
    account('synced');
    offline.set(true);
    pendingChanges.set(3);
    const status = service.status();
    expect(status.id).toBe('offline');
    expect(status.pendingChanges).toBe(3);
  });

  it('prefers a configured account over a legacy provider', () => {
    syncCfg$.next({ isEnabled: true, syncProvider: SyncProviderId.WebDAV });
    ready$.next(true);
    account('synced');
    expect(service.status().engine).toBe('account');
  });

  describe('legacy provider', () => {
    beforeEach(() => {
      syncCfg$.next({ isEnabled: true, syncProvider: SyncProviderId.WebDAV });
    });

    it('flags a configured but not ready provider for attention instead of "set up"', () => {
      ready$.next(false);
      const status = service.status();
      expect(status.id).toBe('provider-attention');
      expect(status.engine).toBe('provider');
      expect(status.configured).toBeTrue();
    });

    it('reports error, syncing and up to date with the header precedence', () => {
      ready$.next(true);
      clean$.next(true);
      expect(service.status().id).toBe('up-to-date');
      clean$.next(false);
      expect(service.status().id).toBe('syncing');
      state$.next('ERROR');
      expect(service.status().id).toBe('error');
      state$.next('IN_SYNC');
      inProgress$.next(true);
      expect(service.status().id).toBe('syncing');
      expect(service.status().busy).toBeTrue();
    });

    it('reports offline ahead of the provider state', async () => {
      ready$.next(true);
      // `isOnline$` debounces in the root zone, so wait in real time.
      const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 1150));
      window.dispatchEvent(new Event('offline'));
      await settled();
      try {
        expect(service.status().id).toBe('offline');
      } finally {
        window.dispatchEvent(new Event('online'));
        await settled();
      }
      expect(service.status().id).toBe('up-to-date');
    }, 8000);
  });
});
