import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { distinctUntilChanged, filter, map, startWith } from 'rxjs/operators';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { T } from '../../t.const';
import {
  ACCOUNT_PAGE_ROUTE,
  AccountSyncActionsService,
} from './account-sync-actions.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import { NativeSyncService } from './native-sync.service';

/**
 * How long a state has to last before it earns a banner. Opening the app restores the account
 * session in the background, and a reconnect can flicker through "locked" on its way: a banner
 * that flashed up for a second and vanished would be the noise this exists to avoid.
 */
export const ACCOUNT_ATTENTION_SETTLE_MS = 3000;

type AttentionKind = 'reauth' | 'locked' | 'chooseData';

/** The account page itself, with or without a query string or a trailing slash. */
const isAccountPage = (url: string): boolean => {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return path === ACCOUNT_PAGE_ROUTE || path.startsWith(`${ACCOUNT_PAGE_ROUTE}/`);
};

/**
 * A durable, actionable banner for the three account states that only the user can resolve:
 * the server signed this device out (sign in again), the account is configured but its keys are
 * closed (unlock), and the data connection was put off (finish connecting). It stays until the
 * state clears and then removes itself.
 *
 * Deliberately never for offline, syncing or a transient failure (those recover by themselves
 * and have the header icon), and no toast per background attempt: one banner, one state. Nor on
 * the account page, which shows the same state and its action itself and would be told twice.
 */
@Injectable({ providedIn: 'root' })
export class AccountAttentionBannerService {
  private readonly _banner = inject(BannerService);
  private readonly _status = inject(AccountSyncStatusService);
  private readonly _native = inject(NativeSyncService);
  private readonly _actions = inject(AccountSyncActionsService);
  private readonly _router = inject(Router);
  private _timer?: ReturnType<typeof setTimeout>;

  private readonly _isOnAccountPage = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => isAccountPage(event.urlAfterRedirects)),
      startWith(isAccountPage(this._router.url)),
      distinctUntilChanged(),
    ),
    { requireSync: true },
  );

  /** Which banner the status asks for, if any. Only an account state can; a provider has its own flows. */
  private readonly _kind = computed<AttentionKind | null>(() => {
    const status = this._status.status();
    if (status.engine !== 'account') {
      return null;
    }
    switch (status.id) {
      case 'reauth':
        return 'reauth';
      case 'locked':
        return 'locked';
      case 'choose-data':
        // While the focused choice is on screen nothing needs a banner; it is the deferred one.
        return this._native.dataChoice()?.deferred ? 'chooseData' : null;
      default:
        return null;
    }
  });

  constructor() {
    effect(() => {
      const kind = this._isOnAccountPage() ? null : this._kind();
      untracked(() => this._apply(kind));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this._timer));
  }

  private _apply(kind: AttentionKind | null): void {
    clearTimeout(this._timer);
    if (!kind) {
      this._banner.dismiss(BannerId.AccountSyncAttention);
      return;
    }
    this._timer = setTimeout(() => this._open(kind), ACCOUNT_ATTENTION_SETTLE_MS);
  }

  private _open(kind: AttentionKind): void {
    const banner = {
      reauth: {
        ico: 'lock',
        msg: T.ACCOUNT_STATUS.REAUTH,
        label: T.ACCOUNT_STATUS.ACTION_SIGN_IN,
        fn: (): void => void this._actions.openAccount(),
      },
      locked: {
        ico: 'lock',
        msg: T.ACCOUNT_STATUS.LOCKED,
        label: T.ACCOUNT_STATUS.ACTION_UNLOCK,
        fn: (): void => void this._actions.openAccount(),
      },
      chooseData: {
        ico: 'sync_problem',
        msg: T.ACCOUNT_STATUS.CHOOSE_DATA_DETAIL,
        label: T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA,
        fn: (): void => void this._native.resumeDataConnection(),
      },
    }[kind];
    this._banner.open({
      id: BannerId.AccountSyncAttention,
      ico: banner.ico,
      msg: banner.msg,
      action: { label: banner.label, fn: banner.fn },
      // It goes away when the state clears, not when the button is pressed: signing in can fail
      // or be abandoned, and the banner must still be there.
      isKeepVisibleAfterAction: true,
      isHideDismissBtn: true,
    });
  }
}
