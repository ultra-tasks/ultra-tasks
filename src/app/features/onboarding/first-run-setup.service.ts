import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs/operators';
import { LS } from '../../core/persistence/storage-keys.const';
import { ExampleTasksService } from '../../core/example-tasks/example-tasks.service';
import { FirstRunGateService } from '../../core/example-tasks/first-run-gate.service';
import { hasAnyUserData } from '../../op-log/validation/has-meaningful-state-data.util';
import { RootState } from '../../root-store/root-state';
import { T } from '../../t.const';
import { FirstRunChoice, FirstRunSetupComponent } from './first-run-setup.component';
import { OnboardingHintService } from './onboarding-hint.service';

/** A device-local welcome, offered only when existing first-run guidance qualifies. */
@Injectable({ providedIn: 'root' })
export class FirstRunSetupService {
  // Snapshot these before injecting the hint service or the example-task seeder:
  // they may write first-run flags while this application boot is in progress.
  private readonly _hadPriorUse = [
    LS.FIRST_RUN_SETUP_DONE,
    LS.EXAMPLE_TASKS_CREATED,
    LS.IS_SKIP_TOUR,
    LS.ONBOARDING_HINTS_DONE,
    LS.ONBOARDING_PRESET_DONE,
    LS.APP_START_COUNT,
  ].some((key) => localStorage.getItem(key) !== null);
  private readonly _hints = inject(OnboardingHintService);
  private readonly _examples = inject(ExampleTasksService);
  private readonly _gate = inject(FirstRunGateService);
  private readonly _state = inject(Store).selectSignal((state: RootState) => state);
  private readonly _dialog = inject(MatDialog);
  private readonly _router = inject(Router);
  private readonly _translate = inject(TranslateService);
  private _presented = false;
  readonly isOpen = signal(false);

  constructor() {
    if (this._hadPriorUse) return;
    // Example tasks wait for the welcome (see FirstRunGateService). If guidance
    // ends without it opening (sync enabled, a returning profile), they come on
    // the next start, when the flags above make this a used profile.
    this._gate.hold();
    effect(() => {
      if (this._presented || this._hints.currentStep() !== 'create-task') return;
      // A profile can retain IndexedDB after its local flags are cleared. Do
      // not mistake its tasks, projects, notes, archive or work history for a
      // new install; ignore only examples this boot created itself.
      if (
        hasAnyUserData(this._state(), new Set(this._examples.createdExampleTaskIds()))
      ) {
        this._presented = true;
        untracked(() => this._gate.release('not-offered'));
        return;
      }
      this._presented = true;
      untracked(() => this._open());
    });
  }

  private _open(): void {
    this.isOpen.set(true);
    this._dialog
      .open<FirstRunSetupComponent, void, FirstRunChoice>(FirstRunSetupComponent, {
        width: '760px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100dvh - 32px)',
        ariaLabel: this._translate.instant(T.ONBOARDING.SETUP.TITLE),
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((choice) => {
        this.isOpen.set(false);
        localStorage.setItem(LS.FIRST_RUN_SETUP_DONE, 'true');
        const isBringingData =
          choice === 'sync' || choice === 'restore' || choice === 'import';
        if (isBringingData) {
          // They bring their own data: no example task now or on a later start.
          localStorage.setItem(LS.EXAMPLE_TASKS_CREATED, 'true');
        }
        // Closing the dialog any other way (Escape, backdrop) counts as Skip.
        this._gate.release(choice ?? 'skip');
        // Each path opens the page that does the work, by a named target (never
        // a tab index, which would silently point elsewhere if the tabs moved).
        if (choice === 'sync') {
          void this._router.navigate(['/account']);
        } else if (choice === 'restore' || choice === 'import') {
          void this._router.navigate(['/config'], { queryParams: { section: 'data' } });
        }
      });
  }
}
