import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { T } from '../../t.const';
import { AccountSyncStatusService } from './account-sync-status.service';

/**
 * The words of the shared status, for the places that need a ready sentence instead of a
 * translation key in a template: the header's tooltip and accessible name. Read-only.
 */
@Injectable({ providedIn: 'root' })
export class AccountSyncTextService {
  private readonly _status = inject(AccountSyncStatusService);
  private readonly _translate = inject(TranslateService);
  private readonly _dateTime = inject(DateTimeFormatService);

  /** Re-translates when the language changes or its texts finish loading. */
  private readonly _texts = toSignal(
    merge(this._translate.onLangChange, this._translate.onTranslationChange),
    { initialValue: null },
  );

  /** "14:32" for a sync today, "18/11/2026 14:32" for an older one; null while unknown. */
  readonly lastSyncedWhen = computed<string | null>(() => {
    this._texts();
    const at = this._status.status().lastSyncedAt;
    if (!at) {
      return null;
    }
    const time = this._dateTime.formatTime(at);
    const isToday = new Date(at).toDateString() === new Date().toDateString();
    return isToday ? time : `${this._dateTime.formatDate(new Date(at))} ${time}`;
  });

  /** "Last synced 14:32", or null while the last successful sync is unknown. */
  readonly lastSynced = computed<string | null>(() => {
    this._texts();
    const when = this.lastSyncedWhen();
    return when ? this._translate.instant(T.ACCOUNT_STATUS.LAST_SYNCED, { when }) : null;
  });

  /** The status label, then the last sync when it is known. Also the button's accessible name. */
  readonly tooltip = computed(() => {
    this._texts();
    const label: string = this._translate.instant(this._status.status().labelKey);
    const lastSynced = this.lastSynced();
    return lastSynced ? `${label} · ${lastSynced}` : label;
  });
}
