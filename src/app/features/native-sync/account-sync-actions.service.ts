import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';
import { ShareService } from '../../core/share/share.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { T } from '../../t.const';
import { AccountSyncStatusService } from './account-sync-status.service';
import type { AccountSyncStatus } from './account-sync-status.model';
import { NativeSyncService } from './native-sync.service';

/** The page that holds the full account state: sign in, unlock, data choice, security. */
export const ACCOUNT_PAGE_ROUTE = '/native-sync';

/**
 * What the sync surfaces (header, Account window, provider dialog, search commands, banner) do
 * when the user acts on the one shared status. It routes to the engine that is active right now,
 * so a native account and a legacy provider never sync in parallel from a button.
 *
 * It only starts user-initiated work. Background syncing stays with the engines.
 */
@Injectable({ providedIn: 'root' })
export class AccountSyncActionsService {
  private readonly _status = inject(AccountSyncStatusService);
  private readonly _native = inject(NativeSyncService);
  private readonly _legacy = inject(SyncWrapperService);
  private readonly _router = inject(Router);
  private readonly _dialogs = inject(MatDialog);
  private readonly _snack = inject(SnackService);
  private readonly _share = inject(ShareService);

  /**
   * A manual sync on the active engine; with nothing configured it opens the setup dialog. An
   * account that cannot sync until something else happens (unlock, sign in, finish connecting)
   * is asked for that instead, so "Sync now" never silently does nothing.
   */
  async syncNow(): Promise<void> {
    const status = this._status.status();
    switch (status.engine) {
      case 'account': {
        const needsSomethingElse =
          !!status.action && status.action !== 'sync' && status.action !== 'retry';
        return needsSomethingElse ? this.run(status) : this._syncAccount();
      }
      case 'provider':
        await this._legacy.sync(true);
        return;
      default:
        return this.openSetup();
    }
  }

  /**
   * For callers with no screen of their own (a keyboard shortcut, a plugin): syncs the engine that
   * is active right now and never opens a dialog or a page. An account that needs something first
   * (unlock, sign in, a data choice) or a provider that is not ready is left alone; the header and
   * the banner already say so.
   */
  async syncQuietly(isUserTriggered = true): Promise<void> {
    const status = this._status.status();
    if (status.engine === 'account') {
      if (!status.action || status.action === 'sync' || status.action === 'retry') {
        await this._syncAccount();
      }
    } else if (status.engine === 'provider') {
      if (await firstValueFrom(this._legacy.isEnabledAndReady$.pipe(first()))) {
        await this._legacy.sync(isUserTriggered);
      }
    }
  }

  /**
   * Runs the primary action of a status (what its button says). A status with no action, such as
   * one that is already working, opens the account page where the full state lives.
   */
  async run(status: AccountSyncStatus = this._status.status()): Promise<void> {
    if (status.engine !== 'account') {
      // A legacy provider reconnects in its own dialog; anything else is a manual sync.
      return status.action === 'setup' ? this.openSetup() : this.syncNow();
    }
    switch (status.action) {
      case 'sync':
      case 'retry':
        return this.syncNow();
      case 'choose-data':
        return this._native.resumeDataConnection();
      case 'unlock':
      case 'sign-in':
      case 'open-account':
      default:
        return this.openAccount();
    }
  }

  /**
   * Opens the account page. The Account window is a dialog that survives a router navigation
   * (it handles Back itself), so it is closed first or it would stay on top of the destination.
   */
  async openAccount(): Promise<void> {
    this._dialogs.closeAll();
    await this._router.navigateByUrl(ACCOUNT_PAGE_ROUTE);
  }

  /** The provider dialog: sign in to the account, or switch this device to another provider. */
  async openSetup(): Promise<void> {
    const { DialogSyncCfgComponent } =
      await import('../../imex/sync/dialog-sync-cfg/dialog-sync-cfg.component');
    this._dialogs.open(DialogSyncCfgComponent);
  }

  /** Copies the support ID. The ID is not a secret; it identifies the account to support. */
  async copyAccountId(id: string): Promise<boolean> {
    const result = await this._share.copyToClipboard(id, 'Account ID');
    if (!result.success) {
      this._snack.open({ type: 'ERROR', msg: T.ACCOUNT_STATUS.COPY_FAILED });
    }
    return result.success;
  }

  /**
   * A user-started sync gets one short answer. Background cycles never reach here, so they never
   * toast; a persistent recovery action that is waiting keeps the snack slot to itself.
   */
  private async _syncAccount(): Promise<void> {
    await this._native.syncNow();
    if (this._snack.hasPendingPersistentAction()) {
      return;
    }
    const after = this._status.status();
    if (after.id === 'up-to-date' || after.id === 'up-to-date-empty') {
      this._snack.open({ type: 'SUCCESS', msg: T.ACCOUNT_STATUS.UP_TO_DATE });
    } else if (after.id === 'error') {
      this._snack.open({ type: 'ERROR', msg: after.reason || T.ACCOUNT_STATUS.ERROR });
    }
  }
}
