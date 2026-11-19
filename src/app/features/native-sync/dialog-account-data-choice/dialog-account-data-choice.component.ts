import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { useDialogSize } from '../../../ui/dialog-size.util';
import { NativeSyncService } from '../native-sync.service';
import type { AccountDataSummary } from '../account-sync.types';

/** What the person pressed. Closing the dialog any other way means "Decide later". */
export type AccountDataChoiceResult = 'download' | 'replace' | 'later';

/**
 * Both this device and the account hold real work: the choice is the person's, made in
 * plain words, never silently and never as a merge.
 *
 * The dialog only reports the decision; `AccountDataChoiceHostService` carries it out, and
 * asks for the explicit confirmation (a separate destructive dialog that spells out the
 * consequences) before the account is replaced. The summaries are live: if the situation
 * is measured again (an edit, a change on another device) this dialog shows the new numbers
 * and the reason.
 */
@Component({
  selector: 'dialog-account-data-choice',
  templateUrl: './dialog-account-data-choice.component.html',
  styleUrl: './dialog-account-data-choice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogAccountDataChoiceComponent {
  private readonly _size = useDialogSize('m');
  private readonly _ref =
    inject<MatDialogRef<DialogAccountDataChoiceComponent, AccountDataChoiceResult>>(
      MatDialogRef,
    );
  private readonly _native = inject(NativeSyncService);
  readonly T = T;
  readonly choice = this._native.dataChoice;
  readonly notice = this._native.dataNotice;
  readonly local = computed(() => this.choice()?.local);
  readonly account = computed(() => this.choice()?.account);

  /** Bounded counts only, never content. */
  counts(summary: AccountDataSummary | undefined): Record<string, number> {
    return {
      tasks: summary?.tasks ?? 0,
      projects: summary?.projects ?? 0,
      notes: summary?.notes ?? 0,
      archived: summary?.archived ?? 0,
    };
  }

  download(): void {
    this._ref.close('download');
  }

  replace(): void {
    this._ref.close('replace');
  }

  later(): void {
    this._ref.close('later');
  }
}
