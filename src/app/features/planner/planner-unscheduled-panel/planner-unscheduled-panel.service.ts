import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { LS } from '../../../core/persistence/storage-keys.const';
import { lsGetBoolean } from '../../../util/ls-util';
import type { BottomPanelData } from '../../bottom-panel/bottom-panel-container.component';

/** The "all projects" filter value; any other value is a project id. */
export const UNSCHEDULED_FILTER_ALL = 'ALL';

/**
 * Open state and project filter of Upcoming's unscheduled-tasks panel.
 *
 * Device-local presentation, like the per-project layout: kept in localStorage,
 * never part of the synced data, so it adds no persisted model field and no
 * sync surface. Both values survive a reload and are shared by every visit to
 * Upcoming on this device.
 *
 * On a phone the same list is a bottom sheet instead of a panel beside the days
 * (`openSheet`); the sheet is transient and never remembered.
 */
@Injectable({ providedIn: 'root' })
export class PlannerUnscheduledPanelService {
  private readonly _bottomSheet = inject(MatBottomSheet);
  private readonly _layout = inject(LayoutService);
  private _sheetRef: MatBottomSheetRef | null = null;
  private _isOpeningSheet = false;

  readonly isOpen = signal(lsGetBoolean(LS.PLANNER_UNSCHEDULED_OPEN, false));
  readonly projectFilter = signal<string>(readFilter());
  /** The phone's sheet is up. */
  readonly isSheetOpen = signal(false);

  // A sheet that is still up when the window grows past the phone layout (a
  // rotation) would float over a layout that has the panel and its toggle.
  private readonly _closeSheetBeyondPhone = effect(() => {
    if (!this._layout.isXs()) {
      untracked(() => this.closeSheet());
    }
  });

  open(): void {
    this._setOpen(true);
  }

  toggle(): void {
    this._setOpen(!this.isOpen());
  }

  close(): void {
    this._setOpen(false);
  }

  /**
   * Phone: the panel's rows in the bottom sheet. The sheet component is loaded on
   * first use, like the right panel's own sheet.
   */
  async openSheet(): Promise<void> {
    if (this._sheetRef || this._isOpeningSheet) {
      return;
    }
    this._isOpeningSheet = true;
    try {
      const { BottomPanelContainerComponent } =
        await import('../../bottom-panel/bottom-panel-container.component');
      // The window may have grown past the phone layout while the chunk loaded.
      if (!this._layout.isXs()) {
        return;
      }
      const data: BottomPanelData = { panelContent: 'UNSCHEDULED' };
      const ref = this._bottomSheet.open(BottomPanelContainerComponent, {
        hasBackdrop: true,
        // A route change (Schedule's button, the bottom nav) takes the sheet away.
        closeOnNavigation: true,
        panelClass: 'bottom-panel-sheet',
        // Otherwise the first tabbable control (the project filter) takes focus.
        autoFocus: false,
        data,
      });
      this._sheetRef = ref;
      this.isSheetOpen.set(true);
      ref.afterDismissed().subscribe(() => {
        if (this._sheetRef === ref) {
          this._sheetRef = null;
          this.isSheetOpen.set(false);
        }
      });
    } finally {
      this._isOpeningSheet = false;
    }
  }

  closeSheet(): void {
    this._sheetRef?.dismiss();
  }

  setProjectFilter(projectId: string): void {
    this.projectFilter.set(projectId);
    write(LS.PLANNER_UNSCHEDULED_FILTER, projectId);
  }

  private _setOpen(isOpen: boolean): void {
    this.isOpen.set(isOpen);
    write(LS.PLANNER_UNSCHEDULED_OPEN, String(isOpen));
  }
}

const readFilter = (): string => {
  try {
    return localStorage.getItem(LS.PLANNER_UNSCHEDULED_FILTER) || UNSCHEDULED_FILTER_ALL;
  } catch {
    return UNSCHEDULED_FILTER_ALL;
  }
};

// Storage can be unavailable (private mode, blocked site data): the panel then
// simply forgets its state on reload.
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};
