import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AccountSyncStatusService } from '../account-sync-status.service';

/**
 * A small "!" for the rows that lead to the account (Account, Settings and Browse on a phone):
 * shown only while sync needs the user, nothing at all otherwise. The mark is a shape, not just
 * a colour, and a visually hidden "Needs attention" gives it a name. It places nothing itself;
 * the row that hosts it positions the element.
 */
@Component({
  selector: 'account-attention-badge',
  templateUrl: './account-attention-badge.component.html',
  styleUrls: ['./account-attention-badge.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class AccountAttentionBadgeComponent {
  private readonly _status = inject(AccountSyncStatusService);

  readonly T = T;
  /** An id for the hidden text, for a host that describes itself with it. */
  readonly textId = input<string | null>(null);
  readonly attention = this._status.needsAttention;
  readonly isError = computed(() => this._status.status().severity === 'error');
}
