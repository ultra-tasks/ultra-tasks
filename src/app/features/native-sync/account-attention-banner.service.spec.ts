import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { T } from '../../t.const';
import {
  ACCOUNT_ATTENTION_SETTLE_MS,
  AccountAttentionBannerService,
} from './account-attention-banner.service';
import { AccountSyncActionsService } from './account-sync-actions.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import type { AccountStatusId, AccountSyncStatus } from './account-sync-status.model';
import type { AccountDataChoice } from './account-sync.types';
import { NativeSessionRestoreService } from './native-session-restore.service';
import { NativeSyncService } from './native-sync.service';

describe('AccountAttentionBannerService', () => {
  let status: ReturnType<typeof signal<AccountSyncStatus>>;
  let dataChoice: ReturnType<typeof signal<AccountDataChoice | null>>;
  let native: { dataChoice: typeof dataChoice; resumeDataConnection: jasmine.Spy };
  let actions: jasmine.SpyObj<AccountSyncActionsService>;
  let banners: BannerService;
  let restoreSettled: ReturnType<typeof signal<boolean>>;
  let router: { url: string; events: Subject<unknown> };

  const navigate = (url: string): void => {
    router.url = url;
    router.events.next(new NavigationEnd(1, url, url));
  };

  const make = (
    id: AccountStatusId,
    patch: Partial<AccountSyncStatus> = {},
  ): AccountSyncStatus => ({
    id,
    engine: 'account',
    configured: true,
    severity: 'ok',
    busy: false,
    icon: 'sync_done',
    isSvgIcon: true,
    labelKey: `LABEL.${id}`,
    detailKey: null,
    reason: null,
    action: null,
    actionLabelKey: null,
    lastSyncedAt: null,
    pendingChanges: 0,
    phase: null,
    ...patch,
  });
  const choice = (deferred: boolean): AccountDataChoice => ({
    local: { tasks: 1, projects: 0, notes: 0, archived: 0, hasUserData: true },
    account: { tasks: 2, projects: 0, notes: 0, archived: 0, hasUserData: true },
    since: 1,
    deferred,
  });
  const settle = (): void => {
    TestBed.tick();
    tick(ACCOUNT_ATTENTION_SETTLE_MS);
    TestBed.tick();
  };

  beforeEach(() => {
    status = signal(make('up-to-date'));
    dataChoice = signal<AccountDataChoice | null>(null);
    native = {
      dataChoice,
      resumeDataConnection: jasmine.createSpy('resumeDataConnection').and.resolveTo(),
    };
    actions = jasmine.createSpyObj('AccountSyncActionsService', ['openAccount']);
    actions.openAccount.and.resolveTo();
    router = { url: '/tag/TODAY/tasks', events: new Subject<unknown>() };
    restoreSettled = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: NativeSessionRestoreService, useValue: { restoreSettled } },
        { provide: AccountSyncStatusService, useValue: { status } },
        { provide: NativeSyncService, useValue: native },
        { provide: AccountSyncActionsService, useValue: actions },
        { provide: Router, useValue: router },
      ],
    });
    banners = TestBed.inject(BannerService);
    TestBed.inject(AccountAttentionBannerService);
  });

  const shown = (): ReturnType<BannerService['activeBanner']> => banners.activeBanner();

  it('stays away while the account is fine, working or offline', fakeAsync(() => {
    for (const id of ['up-to-date', 'syncing', 'downloading', 'offline'] as const) {
      status.set(make(id));
      settle();
      expect(shown()).withContext(id).toBeNull();
    }
  }));

  it('never shows for a failed sync, which recovers by itself and has the header icon', fakeAsync(() => {
    status.set(make('error', { severity: 'error', reason: 'NATIVE_SYNC.ERROR_SYNC' }));
    settle();
    expect(shown()).toBeNull();
  }));

  it('never shows for a legacy provider', fakeAsync(() => {
    status.set(make('provider-attention', { engine: 'provider' }));
    settle();
    expect(shown()).toBeNull();
  }));

  it('asks to sign in again, and goes to the account page', fakeAsync(() => {
    status.set(make('reauth', { severity: 'error' }));
    settle();
    const banner = shown()!;
    expect(banner.id).toBe(BannerId.AccountSyncAttention);
    expect(banner.msg).toBe(T.ACCOUNT_STATUS.REAUTH);
    expect(banner.action?.label).toBe(T.ACCOUNT_STATUS.ACTION_SIGN_IN);
    banner.action!.fn();
    expect(actions.openAccount).toHaveBeenCalledTimes(1);
  }));

  it('asks to unlock, and goes to the account page', fakeAsync(() => {
    status.set(make('locked', { severity: 'warning' }));
    settle();
    const banner = shown()!;
    expect(banner.msg).toBe(T.ACCOUNT_STATUS.LOCKED);
    expect(banner.action?.label).toBe(T.ACCOUNT_STATUS.ACTION_UNLOCK);
    banner.action!.fn();
    expect(actions.openAccount).toHaveBeenCalledTimes(1);
  }));

  it('does not ask to unlock while the remembered session is still being brought back', fakeAsync(() => {
    restoreSettled.set(false);
    status.set(make('locked', { severity: 'warning' }));
    // A slow start: far longer than the settle time, and still nothing to nag about.
    settle();
    tick(ACCOUNT_ATTENTION_SETTLE_MS * 4);
    TestBed.tick();
    expect(shown()).toBeNull();
    // The restore did not bring it back: now it is a state the person has to resolve.
    restoreSettled.set(true);
    settle();
    expect(shown()?.msg).toBe(T.ACCOUNT_STATUS.LOCKED);
  }));

  it('does not raise a banner for the sign-in that a restore settles by itself', fakeAsync(() => {
    restoreSettled.set(false);
    status.set(make('locked', { severity: 'warning' }));
    settle();
    status.set(make('up-to-date'));
    restoreSettled.set(true);
    settle();
    expect(shown()).toBeNull();
  }));

  it('lets a person wave away the reminder to unlock, but never the server’s sign-in-again', fakeAsync(() => {
    status.set(make('locked', { severity: 'warning' }));
    settle();
    expect(shown()!.isHideDismissBtn).toBeFalsy();
    status.set(make('reauth', { severity: 'error' }));
    settle();
    expect(shown()!.isHideDismissBtn).toBeTrue();
    dataChoice.set(choice(true));
    status.set(make('choose-data', { severity: 'warning' }));
    settle();
    expect(shown()!.isHideDismissBtn).toBeTrue();
  }));

  it('offers to finish an unfinished data connection, and resumes it', fakeAsync(() => {
    dataChoice.set(choice(true));
    status.set(make('choose-data', { severity: 'warning' }));
    settle();
    const banner = shown()!;
    expect(banner.msg).toBe(T.ACCOUNT_STATUS.CHOOSE_DATA_DETAIL);
    expect(banner.action?.label).toBe(T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA);
    banner.action!.fn();
    expect(native.resumeDataConnection).toHaveBeenCalledTimes(1);
  }));

  it('leaves the focused data choice to its own dialog while it is on screen', fakeAsync(() => {
    dataChoice.set(choice(false));
    status.set(make('choose-data', { severity: 'warning' }));
    settle();
    expect(shown()).toBeNull();
  }));

  it('waits for the state to last before it speaks, so a startup flicker costs nothing', fakeAsync(() => {
    status.set(make('locked', { severity: 'warning' }));
    TestBed.tick();
    tick(ACCOUNT_ATTENTION_SETTLE_MS - 1);
    expect(shown()).toBeNull();
    tick(1);
    expect(shown()).not.toBeNull();
  }));

  it('never shows a state that clears within the wait', fakeAsync(() => {
    status.set(make('locked', { severity: 'warning' }));
    TestBed.tick();
    tick(ACCOUNT_ATTENTION_SETTLE_MS - 500);
    status.set(make('up-to-date'));
    settle();
    expect(shown()).toBeNull();
  }));

  it('removes itself as soon as the state clears', fakeAsync(() => {
    status.set(make('reauth', { severity: 'error' }));
    settle();
    expect(shown()).not.toBeNull();
    status.set(make('syncing', { busy: true }));
    TestBed.tick();
    expect(shown()).toBeNull();
  }));

  it('survives a press of its button, because signing in may fail or be abandoned', fakeAsync(() => {
    status.set(make('reauth', { severity: 'error' }));
    settle();
    const banner = shown()!;
    expect(banner.isKeepVisibleAfterAction).toBeTrue();
    expect(banner.isHideDismissBtn).toBeTrue();
  }));

  it('swaps its words when the state changes from one to another', fakeAsync(() => {
    status.set(make('reauth', { severity: 'error' }));
    settle();
    expect(shown()?.msg).toBe(T.ACCOUNT_STATUS.REAUTH);
    status.set(make('locked', { severity: 'warning' }));
    settle();
    expect(shown()?.msg).toBe(T.ACCOUNT_STATUS.LOCKED);
  }));

  describe('on the account page', () => {
    // The page shows the same state and its action itself (an E2E also looks for its
    // "Finish connecting" button by name, and two would be two answers to one question).
    it('stays away, because the page already says it', fakeAsync(() => {
      navigate('/native-sync');
      status.set(make('locked', { severity: 'warning' }));
      settle();
      expect(shown()).toBeNull();

      dataChoice.set(choice(true));
      status.set(make('choose-data', { severity: 'warning' }));
      settle();
      expect(shown()).toBeNull();
    }));

    it('also with a query string, as after a browser sign-in', fakeAsync(() => {
      navigate('/native-sync?code=synthetic');
      status.set(make('reauth', { severity: 'error' }));
      settle();
      expect(shown()).toBeNull();
    }));

    it('leaves a route that merely starts with the same letters alone', fakeAsync(() => {
      navigate('/native-sync-notes');
      status.set(make('locked', { severity: 'warning' }));
      settle();
      expect(shown()).not.toBeNull();
    }));

    it('goes away when the user opens the page, and is back after they leave it', fakeAsync(() => {
      status.set(make('locked', { severity: 'warning' }));
      settle();
      expect(shown()).not.toBeNull();

      navigate('/native-sync');
      TestBed.tick();
      expect(shown()).toBeNull();

      navigate('/tag/TODAY/tasks');
      settle();
      expect(shown()?.msg).toBe(T.ACCOUNT_STATUS.LOCKED);
    }));
  });
});
