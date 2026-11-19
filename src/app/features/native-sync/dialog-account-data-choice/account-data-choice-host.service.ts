import { effect, inject, Injectable, untracked } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import {
  DialogConfirmComponent,
  type DialogConfirmData,
} from '../../../ui/dialog-confirm/dialog-confirm.component';
import type { AccountDataSummary } from '../account-sync.types';
import { NativeSyncService } from '../native-sync.service';
import {
  DialogAccountDataChoiceComponent,
  type AccountDataChoiceResult,
} from './dialog-account-data-choice.component';

/**
 * Opens the data-choice dialog the moment the account needs a decision, on whatever screen
 * the person is on, and carries out what they pick. Created once at app start (the app
 * component injects it) so a sign-in from any surface, or a restored session, is covered.
 *
 * The dialog shows while the choice is open (both sides hold real data), has not been
 * deferred, and no switch is running. Closing it any way but a button is "Decide later".
 * It reopens by itself when the situation is measured again (an edit during the switch, a
 * change in the account) and when "Finish connecting" asks for it.
 *
 * Replacing the account is destructive for every device, so it is confirmed in the shared
 * confirmation dialog first. Back or Escape there returns to the choice: only a button
 * pressed in the choice itself ever defers.
 */
@Injectable({ providedIn: 'root' })
export class AccountDataChoiceHostService {
  private readonly native = inject(NativeSyncService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  /** The dialog on screen: the choice, or the confirmation that follows "Replace". */
  private ref?: MatDialogRef<unknown, unknown>;
  private closedByHost = false;

  constructor() {
    effect(() => {
      const shown = this.shouldShow();
      untracked(() => (shown ? this.open() : this.close()));
    });
  }

  private shouldShow(): boolean {
    const choice = this.native.dataChoice();
    return (
      !!choice &&
      !choice.deferred &&
      this.native.unlocked() &&
      this.native.connection() === 'idle'
    );
  }

  private evaluate(): void {
    if (this.shouldShow()) this.open();
  }

  private open(): void {
    if (this.ref) return;
    const ref = this.dialog.open<
      DialogAccountDataChoiceComponent,
      undefined,
      AccountDataChoiceResult
    >(DialogAccountDataChoiceComponent, {
      // Focus the dialog itself, not a button: Enter must never pick a side, and the soft
      // keyboard of the sign-in form that is still focused closes.
      autoFocus: 'dialog',
      restoreFocus: true,
      ariaLabelledBy: 'account-data-choice-title',
      ariaDescribedBy: 'account-data-choice-body',
    });
    this.ref = ref;
    ref.afterClosed().subscribe((result) => {
      this.ref = undefined;
      const byHost = this.closedByHost;
      this.closedByHost = false;
      // A pressed button is honoured even if the host asked to close in the same moment.
      if (result === 'download') {
        void this.native.chooseData('download');
        return;
      }
      if (result === 'replace') {
        this.confirmReplace();
        return;
      }
      if (byHost) {
        // The situation changed while it closed: show it again if it is still open.
        this.evaluate();
        return;
      }
      this.native.deferDataChoice();
    });
  }

  /** The account's tasks are about to be replaced for every device: say so, then ask. */
  private confirmReplace(): void {
    const choice = this.native.dataChoice();
    if (!choice) return;
    const ref = this.dialog.open<DialogConfirmComponent, DialogConfirmData, boolean>(
      DialogConfirmComponent,
      {
        restoreFocus: true,
        data: {
          title: T.ACCOUNT_DATA.CONFIRM_TITLE,
          titleIcon: 'warning',
          message: T.ACCOUNT_DATA.CONFIRM_BODY,
          translateParams: {
            account: this.describe(choice.account),
            device: this.describe(choice.local),
          },
          okTxt: T.ACCOUNT_DATA.CONFIRM_REPLACE,
          cancelTxt: T.ACCOUNT_DATA.BACK,
          isDestructive: true,
        },
      },
    );
    this.ref = ref;
    ref.afterClosed().subscribe((confirmed) => {
      this.ref = undefined;
      this.closedByHost = false;
      if (confirmed === true) {
        void this.native.chooseData('replace');
        return;
      }
      // Back, Escape, a click outside, or the situation changed meanwhile.
      this.evaluate();
    });
  }

  /** Bounded counts in words, e.g. "Tasks: 5 · Projects: 1 · Notes: 0 · Archived: 2". */
  private describe(summary: AccountDataSummary): string {
    return this.translate.instant(T.ACCOUNT_DATA.COUNTS, {
      tasks: summary.tasks,
      projects: summary.projects,
      notes: summary.notes,
      archived: summary.archived,
    });
  }

  private close(): void {
    if (!this.ref) return;
    this.closedByHost = true;
    this.ref.close();
  }
}
