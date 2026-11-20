import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { toSyncProviderId } from '../../op-log/sync-providers/provider.const';
import { IS_ONLINE$ } from '../../util/is-online.token';
import { T } from '../../t.const';
import { NativeSyncService } from './native-sync.service';
import {
  isAttentionStatus,
  type AccountStatusId,
  type AccountSyncStatus,
} from './account-sync-status.model';

type StatusSeed = Pick<
  AccountSyncStatus,
  'id' | 'severity' | 'icon' | 'isSvgIcon' | 'labelKey'
> &
  Partial<
    Pick<AccountSyncStatus, 'busy' | 'detailKey' | 'reason' | 'action' | 'actionLabelKey'>
  >;

const SVG = { isSvgIcon: true } as const;
const MATERIAL = { isSvgIcon: false } as const;

/**
 * The one, read-only answer to "where is my sync?" for the header, mobile navigation, Account
 * dialog, Settings, search commands, safety reminder and the account page.
 *
 * It only reads: {@link NativeSyncService} (the account engine) and {@link SyncWrapperService}
 * (the legacy OneDrive/WebDAV/SuperSync engine). It never starts work, so it cannot create a
 * cycle with either. A configured account always wins over a legacy provider — switching to
 * the account disables the provider, and the two never sync in parallel.
 */
@Injectable({ providedIn: 'root' })
export class AccountSyncStatusService {
  private readonly native = inject(NativeSyncService);
  private readonly legacy = inject(SyncWrapperService);

  // The injectable form of the shared `isOnline$` (same stream at runtime), so a spec can drive it.
  private readonly online = toSignal(inject(IS_ONLINE$), { initialValue: true });
  private readonly providerConfigured = toSignal(
    this.legacy.syncCfg$.pipe(
      map((cfg) => !!cfg?.isEnabled && toSyncProviderId(cfg.syncProvider) !== null),
      distinctUntilChanged(),
    ),
    { initialValue: false },
  );
  private readonly providerReady = toSignal(this.legacy.isEnabledAndReady$, {
    initialValue: false,
  });
  private readonly providerState = toSignal(this.legacy.syncState$);
  private readonly providerBusy = toSignal(this.legacy.isSyncInProgress$, {
    initialValue: false,
  });
  private readonly providerClean = toSignal(this.legacy.hasNoPendingOps$, {
    initialValue: false,
  });

  /** An Ultra Tasks account is configured, signing in, or open on this device. */
  readonly isAccountEngine = computed(
    () =>
      this.native.configured() ||
      this.native.unlocked() ||
      this.native.phase() !== 'signed-out',
  );

  /** Account or provider: something is configured, so sync status must stay reachable. */
  readonly isConfigured = computed(
    () => this.isAccountEngine() || this.providerConfigured(),
  );

  readonly status = computed<AccountSyncStatus>(() =>
    this.isAccountEngine() ? this.accountStatus() : this.providerStatus(),
  );

  /**
   * Something is configured and needs the user (sign in again, unlock, choose data, a failed
   * sync, a provider to reconnect). A boolean, so its dependents only run when it flips, not on
   * every sync cycle: the header override, the navigation badge and the banner read this.
   */
  readonly needsAttention = computed(() => isAttentionStatus(this.status()));

  private build(
    seed: StatusSeed,
    engine: AccountSyncStatus['engine'],
    configured: boolean,
  ): AccountSyncStatus {
    return {
      engine,
      configured,
      busy: false,
      detailKey: null,
      reason: null,
      action: null,
      actionLabelKey: null,
      lastSyncedAt: engine === 'account' ? this.native.lastSyncedAt() : null,
      pendingChanges: engine === 'account' ? this.native.pendingChanges() : 0,
      phase: engine === 'account' ? this.native.phase() : null,
      ...seed,
    };
  }

  private accountStatus(): AccountSyncStatus {
    const native = this.native;
    const account = (seed: StatusSeed): AccountSyncStatus =>
      this.build(seed, 'account', true);
    const phase = native.phase();
    const error = native.error();

    if (error === T.NATIVE_SYNC.ERROR_HISTORY_CHANGED) {
      return account({
        id: 'error',
        severity: 'error',
        icon: 'sync_error',
        ...SVG,
        labelKey: T.ACCOUNT_STATUS.ERROR,
        reason: error,
        action: 'open-account',
        actionLabelKey: T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT,
      });
    }

    switch (phase) {
      case 'signing-in':
        return account({
          id: 'signing-in',
          severity: 'progress',
          busy: true,
          icon: 'sync_ring',
          ...SVG,
          labelKey: T.ACCOUNT_STATUS.SIGNING_IN,
        });
      case 'verify-device':
        return account({
          id: 'verify-device',
          severity: 'warning',
          icon: 'sync_problem',
          ...MATERIAL,
          labelKey: T.ACCOUNT_STATUS.VERIFY_DEVICE,
          detailKey: T.ACCOUNT_STATUS.VERIFY_DEVICE_DETAIL,
          action: 'open-account',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT,
        });
      case 'choose-data':
        return account({
          id: 'choose-data',
          severity: 'warning',
          icon: 'sync_problem',
          ...MATERIAL,
          labelKey: T.ACCOUNT_STATUS.CHOOSE_DATA,
          detailKey: T.ACCOUNT_STATUS.CHOOSE_DATA_DETAIL,
          action: 'choose-data',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA,
        });
      case 'reauth':
        return account({
          id: 'reauth',
          severity: 'error',
          icon: 'lock',
          ...MATERIAL,
          labelKey: T.ACCOUNT_STATUS.REAUTH,
          detailKey: T.ACCOUNT_STATUS.REAUTH_DETAIL,
          action: 'sign-in',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_SIGN_IN,
        });
      case 'locked':
        return account({
          id: 'locked',
          severity: 'warning',
          icon: 'lock',
          ...MATERIAL,
          labelKey: T.ACCOUNT_STATUS.LOCKED,
          // Secure storage that cannot be read is a different problem from a vault that simply
          // has not been unlocked yet; every surface that shows this status says which.
          detailKey:
            this.native.lockReason() === 'storage-unavailable'
              ? T.ACCOUNT_DATA.ERROR_STORAGE
              : T.ACCOUNT_STATUS.LOCKED_DETAIL,
          action: 'unlock',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_UNLOCK,
        });
      default:
        break;
    }

    // A failure outranks any earlier "up to date": stale success is never shown over an error.
    if (error && !native.busy()) {
      return account({
        id: 'error',
        severity: 'error',
        icon: 'sync_error',
        ...SVG,
        labelKey: T.ACCOUNT_STATUS.ERROR,
        detailKey: T.ACCOUNT_STATUS.ERROR_DETAIL,
        reason: error,
        action: 'retry',
        actionLabelKey: T.ACCOUNT_STATUS.ACTION_RETRY,
      });
    }
    if (native.offline() || !this.online()) {
      return account({
        id: 'offline',
        severity: 'warning',
        icon: 'cloud_off',
        ...MATERIAL,
        labelKey: T.ACCOUNT_STATUS.OFFLINE,
        detailKey: T.ACCOUNT_STATUS.OFFLINE_DETAIL,
        // A manual attempt is allowed: it fails fast and says so, or it recovers.
        action: 'sync',
        actionLabelKey: T.ACCOUNT_STATUS.ACTION_SYNC,
      });
    }
    if (phase === 'downloading' || phase === 'applying' || phase === 'syncing') {
      const labels: Record<'downloading' | 'applying' | 'syncing', string> = {
        downloading: T.ACCOUNT_STATUS.DOWNLOADING,
        applying: T.ACCOUNT_STATUS.APPLYING,
        syncing: T.ACCOUNT_STATUS.SYNCING,
      };
      return account({
        id: phase,
        severity: 'progress',
        busy: true,
        icon: 'sync_ring',
        ...SVG,
        labelKey: labels[phase],
      });
    }
    return account({
      id: native.emptyAccount() ? 'up-to-date-empty' : 'up-to-date',
      severity: 'ok',
      icon: 'sync_done',
      ...SVG,
      labelKey: native.emptyAccount()
        ? T.ACCOUNT_STATUS.UP_TO_DATE_EMPTY
        : T.ACCOUNT_STATUS.UP_TO_DATE,
      action: 'sync',
      actionLabelKey: T.ACCOUNT_STATUS.ACTION_SYNC,
    });
  }

  private providerStatus(): AccountSyncStatus {
    if (!this.providerConfigured()) {
      return this.build(
        {
          id: 'local-only',
          severity: 'neutral',
          icon: 'sync_off',
          ...SVG,
          labelKey: T.ACCOUNT_STATUS.LOCAL_ONLY,
          detailKey: T.ACCOUNT_STATUS.LOCAL_ONLY_DETAIL,
          action: 'setup',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_SETUP,
        },
        null,
        false,
      );
    }
    const provider = (seed: StatusSeed): AccountSyncStatus =>
      this.build(seed, 'provider', true);
    // Same precedence the header always had: not ready → offline → error → syncing → in sync.
    if (!this.providerReady()) {
      return provider({
        id: 'provider-attention',
        severity: 'warning',
        icon: 'sync_off',
        ...SVG,
        labelKey: T.ACCOUNT_STATUS.PROVIDER_ATTENTION,
        detailKey: T.ACCOUNT_STATUS.PROVIDER_ATTENTION_DETAIL,
        // Reconnecting a provider happens in its own dialog, not on the account page.
        action: 'setup',
        actionLabelKey: T.ACCOUNT_STATUS.ACTION_SYNC_SETTINGS,
      });
    }
    if (!this.online()) {
      return provider({
        id: 'offline',
        severity: 'warning',
        icon: 'cloud_off',
        ...MATERIAL,
        labelKey: T.ACCOUNT_STATUS.OFFLINE,
        detailKey: T.ACCOUNT_STATUS.OFFLINE_DETAIL,
      });
    }
    if (this.providerState() === 'ERROR') {
      return provider({
        id: 'error',
        severity: 'error',
        icon: 'sync_error',
        ...SVG,
        labelKey: T.ACCOUNT_STATUS.ERROR,
        detailKey: T.ACCOUNT_STATUS.ERROR_DETAIL,
        action: 'retry',
        actionLabelKey: T.ACCOUNT_STATUS.ACTION_RETRY,
      });
    }
    const id: AccountStatusId =
      this.providerBusy() || !this.providerClean() ? 'syncing' : 'up-to-date';
    return provider({
      id,
      severity: id === 'syncing' ? 'progress' : 'ok',
      busy: !!this.providerBusy(),
      icon: id === 'syncing' ? 'sync_ring' : 'sync_done',
      ...SVG,
      labelKey: id === 'syncing' ? T.ACCOUNT_STATUS.SYNCING : T.ACCOUNT_STATUS.UP_TO_DATE,
    });
  }
}
