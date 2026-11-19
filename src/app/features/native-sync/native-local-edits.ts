import type { Action } from '@ngrx/store';
import { filter, type Observable } from 'rxjs';
import {
  isPersistentAction,
  type PersistentAction,
} from '../../op-log/core/persistent-action.interface';

/** Whether anything of the person's was changed since the watch began. */
export interface LocalEditWatch {
  readonly changed: boolean;
  stop(): void;
}

/**
 * Watches the local, persistent actions (what would become an op: tasks, projects, settings
 * ...) from now on. A switch that replaces this device's data starts one BEFORE it measures
 * the device, so an edit between "nothing here" and the start of the switch is never missed.
 * `ignore` names actions the switch itself causes.
 */
export const watchLocalEdits = (
  actions: Observable<Action>,
  ignore: (action: PersistentAction) => boolean = () => false,
): LocalEditWatch => {
  let changed = false;
  const subscription = actions.pipe(filter(isPersistentAction)).subscribe((action) => {
    if (!ignore(action)) changed = true;
  });
  return {
    get changed(): boolean {
      return changed;
    },
    stop: () => subscription.unsubscribe(),
  };
};
