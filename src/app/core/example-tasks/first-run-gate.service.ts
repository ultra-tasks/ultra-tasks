import { Injectable } from '@angular/core';
import { defer, Observable, of, Subject } from 'rxjs';
import { take } from 'rxjs/operators';

/** How the first-run welcome ended, or `not-offered` when it never opens. */
export type FirstRunOutcome =
  | 'not-offered'
  | 'fresh'
  | 'sync'
  | 'restore'
  | 'import'
  | 'skip';

/**
 * Lets the first-run welcome decide before example tasks are seeded.
 *
 * The welcome holds the gate when it may open, and releases it with the user's
 * choice. `ExampleTasksService` waits on {@link whenReleased$}, so nothing is
 * created behind a dialog that offers "Start fresh", and nothing is created for
 * someone who syncs from another device, restores a backup or imports tasks. When nobody holds the gate
 * (returning profile, tests) the wait resolves at once as `not-offered`.
 *
 * Device-local and in memory only: no persisted state, no sync surface.
 */
@Injectable({ providedIn: 'root' })
export class FirstRunGateService {
  private _isHeld = false;
  private _outcome: FirstRunOutcome | null = null;
  private readonly _released$ = new Subject<FirstRunOutcome>();

  hold(): void {
    this._isHeld = true;
  }

  release(outcome: FirstRunOutcome): void {
    this._isHeld = false;
    this._outcome = outcome;
    this._released$.next(outcome);
  }

  /** Emits once: now if the gate is free or already released, else on release. */
  whenReleased$(): Observable<FirstRunOutcome> {
    return defer(() => {
      if (this._outcome) {
        return of(this._outcome);
      }
      return this._isHeld ? this._released$.pipe(take(1)) : of('not-offered' as const);
    });
  }
}
