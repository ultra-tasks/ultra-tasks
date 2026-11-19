import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ShareService } from '../../core/share/share.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { T } from '../../t.const';
import {
  ACCOUNT_PAGE_ROUTE,
  AccountSyncActionsService,
} from './account-sync-actions.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import type {
  AccountStatusAction,
  AccountStatusId,
  AccountSyncStatus,
} from './account-sync-status.model';
import { NativeSyncService } from './native-sync.service';

describe('AccountSyncActionsService', () => {
  let service: AccountSyncActionsService;
  let status: ReturnType<typeof signal<AccountSyncStatus>>;
  let native: jasmine.SpyObj<NativeSyncService>;
  let legacy: jasmine.SpyObj<SyncWrapperService>;
  let router: jasmine.SpyObj<Router>;
  let dialogs: jasmine.SpyObj<MatDialog>;
  let snack: jasmine.SpyObj<SnackService>;
  let share: jasmine.SpyObj<ShareService>;
  let providerReady: BehaviorSubject<boolean>;

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
  const withAction = (
    id: AccountStatusId,
    action: AccountStatusAction,
    patch: Partial<AccountSyncStatus> = {},
  ): AccountSyncStatus => make(id, { action, ...patch });

  beforeEach(() => {
    status = signal(withAction('up-to-date', 'sync'));
    native = jasmine.createSpyObj('NativeSyncService', [
      'syncNow',
      'resumeDataConnection',
    ]);
    native.syncNow.and.resolveTo();
    native.resumeDataConnection.and.resolveTo();
    legacy = jasmine.createSpyObj('SyncWrapperService', ['sync']);
    legacy.sync.and.resolveTo('HANDLED_ERROR');
    providerReady = new BehaviorSubject(true);
    Object.assign(legacy, { isEnabledAndReady$: providerReady });
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.resolveTo(true);
    dialogs = jasmine.createSpyObj('MatDialog', ['closeAll', 'open']);
    snack = jasmine.createSpyObj('SnackService', ['open', 'hasPendingPersistentAction']);
    snack.hasPendingPersistentAction.and.returnValue(false);
    share = jasmine.createSpyObj('ShareService', ['copyToClipboard']);
    share.copyToClipboard.and.resolveTo({ success: true, target: 'clipboard-text' });

    TestBed.configureTestingModule({
      providers: [
        { provide: AccountSyncStatusService, useValue: { status } },
        { provide: NativeSyncService, useValue: native },
        { provide: SyncWrapperService, useValue: legacy },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: dialogs },
        { provide: SnackService, useValue: snack },
        { provide: ShareService, useValue: share },
      ],
    });
    service = TestBed.inject(AccountSyncActionsService);
  });

  describe('syncQuietly', () => {
    it('syncs a native account that is ready, with no legacy provider configured', async () => {
      providerReady.next(false);
      await service.syncQuietly();
      expect(native.syncNow).toHaveBeenCalledTimes(1);
      expect(legacy.sync).not.toHaveBeenCalled();
    });

    it('syncs a ready legacy provider the way it was asked to', async () => {
      status.set(make('up-to-date', { engine: 'provider' }));
      await service.syncQuietly(false);
      expect(legacy.sync).toHaveBeenCalledOnceWith(false);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    it('leaves a legacy provider that is not ready alone', async () => {
      status.set(make('up-to-date', { engine: 'provider' }));
      providerReady.next(false);
      await service.syncQuietly();
      expect(legacy.sync).not.toHaveBeenCalled();
    });

    it('opens nothing when there is nothing to sync or the account needs something first', async () => {
      status.set(make('local-only', { engine: null, configured: false }));
      await service.syncQuietly();
      status.set(withAction('locked', 'unlock'));
      await service.syncQuietly();
      expect(native.syncNow).not.toHaveBeenCalled();
      expect(legacy.sync).not.toHaveBeenCalled();
      expect(dialogs.open).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('syncNow', () => {
    it('syncs the account when it is the active engine, and never the legacy provider', async () => {
      await service.syncNow();
      expect(native.syncNow).toHaveBeenCalledTimes(1);
      expect(legacy.sync).not.toHaveBeenCalled();
    });

    it('syncs the legacy provider when that is the active engine, and never the account', async () => {
      status.set(make('up-to-date', { engine: 'provider' }));
      await service.syncNow();
      expect(legacy.sync).toHaveBeenCalledOnceWith(true);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    it('opens the sign-in dialog when nothing is configured', async () => {
      status.set(make('local-only', { engine: null, configured: false }));
      const open = spyOn(service, 'openSetup').and.resolveTo();
      await service.syncNow();
      expect(open).toHaveBeenCalledTimes(1);
      expect(native.syncNow).not.toHaveBeenCalled();
      expect(legacy.sync).not.toHaveBeenCalled();
    });

    it('asks a locked account to unlock instead of doing nothing', async () => {
      status.set(withAction('locked', 'unlock'));
      await service.syncNow();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith(ACCOUNT_PAGE_ROUTE);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    it('resumes the data connection for an account that has not finished connecting', async () => {
      status.set(withAction('choose-data', 'choose-data'));
      await service.syncNow();
      expect(native.resumeDataConnection).toHaveBeenCalledTimes(1);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    it('joins the sync that is already running instead of opening a page', async () => {
      status.set(make('syncing', { busy: true }));
      await service.syncNow();
      expect(native.syncNow).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('answers a manual account sync once, with the result', async () => {
      await service.syncNow();
      expect(snack.open).toHaveBeenCalledOnceWith({
        type: 'SUCCESS',
        msg: T.ACCOUNT_STATUS.UP_TO_DATE,
      });
    });

    it('says why a manual account sync failed', async () => {
      native.syncNow.and.callFake(async () => {
        status.set(make('error', { reason: 'NATIVE_SYNC.ERROR_SYNC', action: 'retry' }));
      });
      await service.syncNow();
      expect(snack.open).toHaveBeenCalledOnceWith({
        type: 'ERROR',
        msg: 'NATIVE_SYNC.ERROR_SYNC',
      });
    });

    it('stays quiet when it ends offline: that has its own status', async () => {
      native.syncNow.and.callFake(async () => {
        status.set(withAction('offline', 'sync'));
      });
      await service.syncNow();
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('does not replace a persistent recovery action waiting in the snack slot', async () => {
      snack.hasPendingPersistentAction.and.returnValue(true);
      await service.syncNow();
      expect(snack.open).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('runs a manual sync for sync and retry', async () => {
      await service.run(withAction('up-to-date', 'sync'));
      await service.run(withAction('error', 'retry'));
      expect(native.syncNow).toHaveBeenCalledTimes(2);
    });

    it('resumes the data connection for choose-data', async () => {
      await service.run(withAction('choose-data', 'choose-data'));
      expect(native.resumeDataConnection).toHaveBeenCalledTimes(1);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    for (const action of ['unlock', 'sign-in', 'open-account'] as const) {
      it(`opens the account page for ${action}`, async () => {
        await service.run(withAction('locked', action));
        expect(router.navigateByUrl).toHaveBeenCalledOnceWith(ACCOUNT_PAGE_ROUTE);
        expect(native.syncNow).not.toHaveBeenCalled();
      });
    }

    it('opens the account page, not a second sync, for a status that is already working', async () => {
      await service.run(make('downloading', { busy: true }));
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith(ACCOUNT_PAGE_ROUTE);
      expect(native.syncNow).not.toHaveBeenCalled();
    });

    it('opens the provider dialog for a provider that needs reconnecting', async () => {
      const open = spyOn(service, 'openSetup').and.resolveTo();
      await service.run(
        withAction('provider-attention', 'setup', { engine: 'provider' }),
      );
      expect(open).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('syncs a healthy provider', async () => {
      status.set(make('up-to-date', { engine: 'provider' }));
      await service.run(make('up-to-date', { engine: 'provider' }));
      expect(legacy.sync).toHaveBeenCalledOnceWith(true);
    });
  });

  describe('openAccount', () => {
    it('closes the Account window first, so it cannot stay on top of the page', async () => {
      const order: string[] = [];
      dialogs.closeAll.and.callFake(() => void order.push('closeAll'));
      router.navigateByUrl.and.callFake(async () => {
        order.push('navigate');
        return true;
      });
      await service.openAccount();
      expect(order).toEqual(['closeAll', 'navigate']);
    });
  });

  describe('copyAccountId', () => {
    it('copies the ID under its own name', async () => {
      expect(await service.copyAccountId('id-1')).toBeTrue();
      expect(share.copyToClipboard).toHaveBeenCalledOnceWith('id-1', 'Account ID');
      expect(snack.open).not.toHaveBeenCalled();
    });

    it('tells the user to copy it by hand when the clipboard refuses', async () => {
      share.copyToClipboard.and.resolveTo({ success: false, error: 'nope' });
      expect(await service.copyAccountId('id-1')).toBeFalse();
      expect(snack.open).toHaveBeenCalledOnceWith({
        type: 'ERROR',
        msg: T.ACCOUNT_STATUS.COPY_FAILED,
      });
    });
  });
});
