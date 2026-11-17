import { MatDialogRef } from '@angular/material/dialog';

/**
 * What a dialog does when the Android back button is pressed while it is the top
 * one. Returns true when it dealt with the press (nothing else happens), false to
 * leave the press to the usual rules: close the dialog, or keep a `disableClose`
 * dialog open.
 */
export type DialogBackHandler = () => boolean;

const backHandlers = new WeakMap<MatDialogRef<unknown>, DialogBackHandler>();

/**
 * Lets a dialog answer the back button itself. A dialog that asks before it throws
 * typed text away (useDiscardGuard) answers it the way it answers a tap on its
 * backdrop or Escape; AndroidBackButtonService asks the top dialog's handler before
 * it closes or swallows. A dialog with no handler behaves as it always did.
 *
 * Keyed weakly by the dialog ref, so a closed dialog leaves nothing behind. Pass
 * `undefined` to remove a handler.
 */
export const setDialogBackHandler = (
  dialogRef: MatDialogRef<unknown>,
  handler: DialogBackHandler | undefined,
): void => {
  if (handler) {
    backHandlers.set(dialogRef, handler);
  } else {
    backHandlers.delete(dialogRef);
  }
};

export const getDialogBackHandler = (
  dialogRef: MatDialogRef<unknown>,
): DialogBackHandler | undefined => backHandlers.get(dialogRef);
