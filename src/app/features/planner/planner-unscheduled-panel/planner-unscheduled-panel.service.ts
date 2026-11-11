import { Injectable, signal } from '@angular/core';
import { LS } from '../../../core/persistence/storage-keys.const';
import { lsGetBoolean } from '../../../util/ls-util';

/** The "all projects" filter value; any other value is a project id. */
export const UNSCHEDULED_FILTER_ALL = 'ALL';

/**
 * Open state and project filter of Upcoming's unscheduled-tasks panel.
 *
 * Device-local presentation, like the per-project layout: kept in localStorage,
 * never part of the synced data, so it adds no persisted model field and no
 * sync surface. Both values survive a reload and are shared by every visit to
 * Upcoming on this device.
 */
@Injectable({ providedIn: 'root' })
export class PlannerUnscheduledPanelService {
  readonly isOpen = signal(lsGetBoolean(LS.PLANNER_UNSCHEDULED_OPEN, false));
  readonly projectFilter = signal<string>(readFilter());

  toggle(): void {
    this._setOpen(!this.isOpen());
  }

  close(): void {
    this._setOpen(false);
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
