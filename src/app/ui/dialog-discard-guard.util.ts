import { DestroyRef, effect, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { merge } from 'rxjs';
import { distinctUntilChanged, filter, map, take } from 'rxjs/operators';
import { T } from '../t.const';
import { setDialogBackHandler } from './dialog-back-handler.util';
import { DialogConfirmComponent } from './dialog-confirm/dialog-confirm.component';

/**
 * True once the user has changed something in one of the forms. A value the dialog
 * sets itself (a default, a loaded config) never makes a control dirty.
 * Call it in a field initialiser: it reads the forms through a signal.
 */
export const useFormsDirty = (...forms: AbstractControl[]): Signal<boolean> =>
  toSignal(
    merge(...forms.map((form) => form.valueChanges)).pipe(
      map(() => forms.some((form) => form.dirty)),
      distinctUntilChanged(),
    ),
    { initialValue: false },
  );

/**
 * A create or edit dialog holds typed text that one stray tap on the backdrop, or
 * a press of Escape, would throw away with no way back. While `isDirty()` is true
 * neither closes it: they ask "You have unsaved changes. Discard them?" instead,
 * and only Discard closes. The buttons the user presses on purpose (Cancel, Save)
 * close as always, and so does the backdrop of a dialog nothing was typed in.
 *
 * The Android back button is answered the same way (see dialog-back-handler.util.ts):
 * a dialog with something to lose asks, on any screen, also over the phone's drawer,
 * where the back press would otherwise navigate and dispose it. A pristine dialog
 * declines, and the usual rules close it: `disableClose` follows `isDirty()` rather
 * than staying set, so it is dismissable again.
 *
 * `isBusy` is for a dialog that locks itself while it works (a save in flight): the
 * dialog cannot be closed then, so nothing is asked either, and the press is swallowed
 * the way `disableClose` swallows it.
 *
 * Call it in an injection context (a field initialiser of the dialog component).
 */
export const useDiscardGuard = (
  isDirty: Signal<boolean>,
  isBusy?: Signal<boolean>,
): void => {
  const dialogRef = inject<MatDialogRef<unknown>>(MatDialogRef);
  const matDialog = inject(MatDialog);
  const destroyRef = inject(DestroyRef);
  let isAsking = false;

  effect(() => {
    dialogRef.disableClose = isDirty() || !!isBusy?.();
  });

  const askToDiscard = (): void => {
    // Not while saving, and not over a dialog that is already on its way out (a press
    // right after "Discard" would otherwise ask a second time).
    if (isAsking || isBusy?.() || dialogRef.getState() !== MatDialogState.OPEN) {
      return;
    }
    isAsking = true;
    const question = matDialog.open(DialogConfirmComponent, {
      restoreFocus: true,
      data: {
        message: T.G.CONFIRM_DISCARD_CHANGES,
        okTxt: T.G.DISCARD,
        cancelTxt: T.G.KEEP_EDITING,
      },
    });
    // Back on the question is "Keep editing". It answers for itself: left to the
    // history rules, a press over the drawer would dispose both dialogs.
    setDialogBackHandler(question, () => {
      question.close();
      return true;
    });
    question
      .afterClosed()
      .pipe(take(1))
      .subscribe((isDiscard) => {
        isAsking = false;
        if (isDiscard === true) {
          dialogRef.disableClose = false;
          dialogRef.close();
        }
      });
  };

  setDialogBackHandler(dialogRef, () => {
    if (isBusy?.()) {
      return true;
    }
    if (!isDirty()) {
      return false;
    }
    askToDiscard();
    return true;
  });
  destroyRef.onDestroy(() => setDialogBackHandler(dialogRef, undefined));

  merge(
    dialogRef.backdropClick(),
    dialogRef.keydownEvents().pipe(filter((event) => event.key === 'Escape')),
  )
    .pipe(takeUntilDestroyed(destroyRef))
    .subscribe(() => {
      if (isDirty()) {
        askToDiscard();
      }
    });
};
