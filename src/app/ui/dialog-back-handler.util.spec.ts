import { MatDialogRef } from '@angular/material/dialog';
import { getDialogBackHandler, setDialogBackHandler } from './dialog-back-handler.util';

describe('dialog back handler', () => {
  const fakeRef = (): MatDialogRef<unknown> => ({}) as MatDialogRef<unknown>;

  it('has no handler for a dialog nobody registered one for', () => {
    expect(getDialogBackHandler(fakeRef())).toBeUndefined();
  });

  it('returns the handler of the dialog it was set for, and only that one', () => {
    const first = fakeRef();
    const second = fakeRef();
    const handler = (): boolean => true;

    setDialogBackHandler(first, handler);

    expect(getDialogBackHandler(first)).toBe(handler);
    expect(getDialogBackHandler(second)).toBeUndefined();
  });

  it('keeps the last handler a dialog was given', () => {
    const ref = fakeRef();
    const latest = (): boolean => false;

    setDialogBackHandler(ref, () => true);
    setDialogBackHandler(ref, latest);

    expect(getDialogBackHandler(ref)).toBe(latest);
  });

  it('forgets a handler that is set to undefined', () => {
    const ref = fakeRef();
    setDialogBackHandler(ref, () => true);

    setDialogBackHandler(ref, undefined);

    expect(getDialogBackHandler(ref)).toBeUndefined();
  });
});
