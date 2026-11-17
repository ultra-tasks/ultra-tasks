import { inject, Injectable, Injector } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { dialogSize, viewportHeight } from '../../../ui/dialog-size.util';

const SEARCH_DIALOG_ID = 'search-popup';

/** Opens the global search as a popup over the current page. */
@Injectable({ providedIn: 'root' })
export class SearchDialogService {
  private readonly _dialogs = inject(MatDialog);
  private readonly _injector = inject(Injector);

  async open(): Promise<void> {
    if (this._dialogs.getDialogById(SEARCH_DIALOG_ID)) {
      return;
    }
    // Lazy: the search page and its result mapping load on first use.
    const { DialogSearchComponent } = await import('./dialog-search.component');
    if (this._dialogs.getDialogById(SEARCH_DIALOG_ID)) {
      return;
    }
    this._dialogs.open(DialogSearchComponent, {
      id: SEARCH_DIALOG_ID,
      ...dialogSize('l', 'search-popup'),
      position: { top: viewportHeight(10) },
      backdropClass: 'settings-backdrop',
      autoFocus: false,
      restoreFocus: true,
      ariaLabel: this._injector.get(TranslateService).instant(T.MH.SEARCH),
    });
  }
}
