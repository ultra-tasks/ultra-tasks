import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AccountSyncActionsService } from '../account-sync-actions.service';
import { AccountSyncStatusService } from '../account-sync-status.service';
import { AccountSyncTextService } from '../account-sync-text.service';
import { NativeSyncService } from '../native-sync.service';

/** The legacy provider a host has probed, shown while the provider engine is the active one. */
export interface AccountSyncSummaryProvider {
  providerId: string | null;
  needsAuth: boolean;
  isEncrypted: boolean;
}

/** How long "Copied" stays on screen. */
const COPIED_MS = 2000;

/**
 * Where is my sync? One summary for the Account window and the provider dialog, driven by the
 * shared {@link AccountSyncStatusService}: a connected account (even a locked, offline or
 * signed-out-by-the-server one) is shown as that account, never as "Set up sync".
 *
 * Presentational: it starts only user actions, through {@link AccountSyncActionsService}, and
 * leaves opening the provider dialog to its host.
 */
@Component({
  selector: 'account-sync-summary',
  templateUrl: './account-sync-summary.component.html',
  styleUrls: ['./account-sync-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIconButton, MatIcon, MatTooltip, TranslatePipe],
})
export class AccountSyncSummaryComponent implements OnDestroy {
  private static _nextId = 0;

  private readonly _statusService = inject(AccountSyncStatusService);
  private readonly _native = inject(NativeSyncService);
  private readonly _text = inject(AccountSyncTextService);
  private readonly _actions = inject(AccountSyncActionsService);
  // The app's shared live region, not one of this view's own: the provider dialog that hosts this
  // summary already has a status region for its saving state, and a second one would be noise.
  private readonly _announcer = inject(LiveAnnouncer);
  private readonly _translate = inject(TranslateService);
  private _copiedTimer?: ReturnType<typeof setTimeout>;

  readonly T = T;
  readonly syncSource = this._statusService.syncSource;
  /** Unique per instance: the provider dialog can open over the Account window's summary. */
  readonly hintId = `account-sync-id-hint-${AccountSyncSummaryComponent._nextId++}`;

  /** For a dialog with a primary action of its own: Sync now is then not a second filled button. */
  readonly compact = input(false);
  /** The legacy provider and its pills, probed by the host; used for the provider engine only. */
  readonly provider = input<AccountSyncSummaryProvider | null>(null);
  /** The provider dialog is itself the way to other options, so it hides that entry. */
  readonly showOtherOptions = input(true);
  /** The user wants the provider dialog: set up sync, configure the provider, other options. */
  readonly setupRequested = output<void>();

  readonly status = this._statusService.status;
  readonly identity = this._native.accountIdentity;
  readonly lastSynced = this._text.lastSynced;
  readonly copied = signal(false);

  readonly isAccount = computed(() => this.status().engine === 'account');
  readonly isProvider = computed(() => this.status().engine === 'provider');
  readonly isLocalOnly = computed(() => !this.status().configured);
  /** "Open Ultra Tasks account" beside the primary action, unless the primary already goes there. */
  readonly hasOpenAccountButton = computed(() => {
    const action = this.status().action;
    return action === 'sync' || action === 'retry' || action === 'choose-data' || !action;
  });
  /** The button label of the primary action; Sync now while there is nothing else to do. */
  readonly primaryLabelKey = computed(
    () => this.status().actionLabelKey ?? T.ACCOUNT_STATUS.ACTION_SYNC,
  );

  runPrimary(): void {
    void this._actions.run(this.status());
  }

  syncNow(): void {
    void this._actions.syncNow();
  }

  openAccount(): void {
    void this._actions.openAccount();
  }

  requestSetup(): void {
    this.setupRequested.emit();
  }

  async copyAccountId(): Promise<void> {
    const id = this.identity()?.id;
    if (!id || !(await this._actions.copyAccountId(id))) {
      return;
    }
    clearTimeout(this._copiedTimer);
    this.copied.set(true);
    void this._announcer.announce(
      this._translate.instant(T.ACCOUNT_STATUS.COPIED),
      'polite',
    );
    this._copiedTimer = setTimeout(() => this.copied.set(false), COPIED_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this._copiedTimer);
  }
}
