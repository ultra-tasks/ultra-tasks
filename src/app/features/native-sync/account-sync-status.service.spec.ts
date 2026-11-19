import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { IS_ONLINE$ } from '../../util/is-online.token';
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
  let online$: BehaviorSubject<boolean>;

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
    // Not the module-level `isOnline$`: it is a debounced singleton shared by the whole run, so
    // its state leaks between specs and cannot be driven without waiting in real time.
    online$ = new BehaviorSubject(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_ONLINE$, useValue: online$ },
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

  it('offers a manual sync from the calm states, so a click on them does something', () => {
    account('synced');
    expect(service.status().action).toBe('sync');
    emptyAccount.set(true);
    expect(service.status().action).toBe('sync');
    emptyAccount.set(false);
    offline.set(true);
    expect(service.status().action).toBe('sync');
    // Work that is already running has nothing to start.
    offline.set(false);
    phase.set('downloading');
    expect(service.status().action).toBeNull();
  });

  describe('needsAttention', () => {
    it('is false while nothing is configured', () => {
      expect(service.needsAttention()).toBeFalse();
    });

    it('is false for a healthy, working or offline account: they resolve by themselves', () => {
      account('synced');
      expect(service.needsAttention()).toBeFalse();
      phase.set('syncing');
      expect(service.needsAttention()).toBeFalse();
      phase.set('downloading');
      expect(service.needsAttention()).toBeFalse();
      phase.set('synced');
      offline.set(true);
      expect(service.needsAttention()).toBeFalse();
    });

    for (const next of ['locked', 'reauth', 'choose-data', 'verify-device'] as const) {
      it(`is true while an account is "${next}"`, () => {
        account(next);
        expect(service.needsAttention()).toBeTrue();
      });
    }

    it('is true after a failure and clears with the next success', () => {
      account('synced');
      error.set('NATIVE_SYNC.ERROR_SYNC');
      expect(service.needsAttention()).toBeTrue();
      error.set('');
      expect(service.needsAttention()).toBeFalse();
    });

    it('is only a boolean, so a sync cycle does not wake its readers', () => {
      account('synced');
      let runs = 0;
      const reader = computed(() => {
        runs++;
        return service.needsAttention();
      });
      reader();
      lastSyncedAt.set(1);
      phase.set('syncing');
      phase.set('synced');
      reader();
      expect(runs).toBe(1);
    });
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
      expect(service.needsAttention()).toBeTrue();
    });

    it('sends a provider that needs reconnecting to its dialog, not to the account page', () => {
      ready$.next(false);
      expect(service.status().action).toBe('setup');
    });

    it('needs attention after a failure, and not while healthy', () => {
      ready$.next(true);
      expect(service.needsAttention()).toBeFalse();
      state$.next('ERROR');
      expect(service.needsAttention()).toBeTrue();
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

    it('reports offline ahead of the provider state', () => {
      ready$.next(true);
      online$.next(false);
      expect(service.status().id).toBe('offline');
      online$.next(true);
      expect(service.status().id).toBe('up-to-date');
    });

    it('keeps a provider that needs reconnecting ahead of offline', () => {
      ready$.next(false);
      online$.next(false);
      expect(service.status().id).toBe('provider-attention');
    });
  });
});
