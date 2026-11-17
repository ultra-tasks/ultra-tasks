import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { Observable, of, Subject } from 'rxjs';
import { T } from '../t.const';
import { getDialogBackHandler } from './dialog-back-handler.util';
import { DialogConfirmComponent } from './dialog-confirm/dialog-confirm.component';
import { useDiscardGuard, useFormsDirty } from './dialog-discard-guard.util';

describe('dialog discard guard', () => {
  describe('useFormsDirty', () => {
    const create = (form: FormGroup): (() => boolean) =>
      TestBed.runInInjectionContext(() => useFormsDirty(form));

    it('is false until the user changes something', () => {
      const form = new FormGroup({ title: new FormControl('') });
      const isDirty = create(form);
      expect(isDirty()).toBeFalse();
    });

    it('stays false for a value the dialog sets itself', () => {
      const form = new FormGroup({ title: new FormControl('') });
      const isDirty = create(form);

      form.controls['title'].setValue('Default title');
      form.patchValue({ title: 'Loaded' });

      expect(isDirty()).toBeFalse();
    });

    it('turns true on the first change the user makes', () => {
      const form = new FormGroup({ title: new FormControl('') });
      const isDirty = create(form);

      form.controls['title'].markAsDirty();
      form.controls['title'].setValue('My new project');

      expect(isDirty()).toBeTrue();
    });

    it('watches every form it is given', () => {
      const basic = new FormGroup({ title: new FormControl('') });
      const theme = new FormGroup({ primary: new FormControl('#fff') });
      const isDirty = TestBed.runInInjectionContext(() => useFormsDirty(basic, theme));

      theme.controls['primary'].markAsDirty();
      theme.controls['primary'].setValue('#000');

      expect(isDirty()).toBeTrue();
    });
  });

  describe('useDiscardGuard', () => {
    let backdrop$: Subject<MouseEvent>;
    let keydown$: Subject<KeyboardEvent>;
    let dialogState: MatDialogState;
    let dialogRef: {
      disableClose?: boolean;
      close: jasmine.Spy;
      getState: () => MatDialogState;
      backdropClick: () => Observable<MouseEvent>;
      keydownEvents: () => Observable<KeyboardEvent>;
    };
    let matDialog: { open: jasmine.Spy };
    let isDirty: WritableSignal<boolean>;
    let answer: Observable<unknown>;

    beforeEach(() => {
      backdrop$ = new Subject<MouseEvent>();
      keydown$ = new Subject<KeyboardEvent>();
      dialogState = MatDialogState.OPEN;
      dialogRef = {
        disableClose: false,
        close: jasmine.createSpy('close'),
        getState: () => dialogState,
        backdropClick: () => backdrop$,
        keydownEvents: () => keydown$,
      };
      answer = of(false);
      matDialog = {
        open: jasmine.createSpy('open').and.callFake(() => ({
          afterClosed: () => answer,
          close: jasmine.createSpy('closeQuestion'),
        })),
      };
      isDirty = signal(false);
      TestBed.configureTestingModule({
        providers: [
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MatDialog, useValue: matDialog },
        ],
      });
      TestBed.runInInjectionContext(() => useDiscardGuard(isDirty));
      TestBed.flushEffects();
    });

    const escape = (): void => keydown$.next({ key: 'Escape' } as KeyboardEvent);

    it('leaves a dialog nothing was typed in to close on the backdrop and Escape', () => {
      expect(dialogRef.disableClose).toBeFalse();

      backdrop$.next({} as MouseEvent);
      escape();

      expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('stops the backdrop and Escape from closing it once something was typed', () => {
      isDirty.set(true);
      TestBed.flushEffects();

      expect(dialogRef.disableClose).toBeTrue();
    });

    it('lets Android Back dismiss it again when the changes are gone', () => {
      isDirty.set(true);
      TestBed.flushEffects();
      isDirty.set(false);
      TestBed.flushEffects();

      expect(dialogRef.disableClose).toBeFalse();
    });

    it('asks to discard on a tap on the backdrop', () => {
      isDirty.set(true);
      TestBed.flushEffects();

      backdrop$.next({} as MouseEvent);

      expect(matDialog.open).toHaveBeenCalledTimes(1);
      const [component, config] = matDialog.open.calls.mostRecent().args;
      expect(component).toBe(DialogConfirmComponent);
      expect(config.data).toEqual({
        message: T.G.CONFIRM_DISCARD_CHANGES,
        okTxt: T.G.DISCARD,
        cancelTxt: T.G.KEEP_EDITING,
      });
    });

    it('asks on Escape and ignores every other key', () => {
      isDirty.set(true);
      TestBed.flushEffects();

      keydown$.next({ key: 'a' } as KeyboardEvent);
      keydown$.next({ key: 'Enter' } as KeyboardEvent);
      expect(matDialog.open).not.toHaveBeenCalled();

      escape();
      expect(matDialog.open).toHaveBeenCalledTimes(1);
    });

    it('closes the dialog when the user discards', () => {
      isDirty.set(true);
      TestBed.flushEffects();
      answer = of(true);

      backdrop$.next({} as MouseEvent);

      expect(dialogRef.close).toHaveBeenCalledTimes(1);
      expect(dialogRef.disableClose).toBeFalse();
    });

    it('keeps the dialog open when the user keeps editing, and asks again next time', () => {
      isDirty.set(true);
      TestBed.flushEffects();

      backdrop$.next({} as MouseEvent);
      answer = of(undefined);
      backdrop$.next({} as MouseEvent);

      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(matDialog.open).toHaveBeenCalledTimes(2);
    });

    it('asks once while the question is open', () => {
      isDirty.set(true);
      TestBed.flushEffects();
      // a question that is not answered yet
      answer = new Subject<boolean>();

      backdrop$.next({} as MouseEvent);
      backdrop$.next({} as MouseEvent);
      escape();

      expect(matDialog.open).toHaveBeenCalledTimes(1);
    });

    describe('a dialog that locks itself while it works (isBusy)', () => {
      let busy: WritableSignal<boolean>;
      let busyRef: typeof dialogRef;
      let busyBackdrop$: Subject<MouseEvent>;
      let busyKeydown$: Subject<KeyboardEvent>;
      let injector: EnvironmentInjector;
      const pressBack = (): boolean | undefined =>
        getDialogBackHandler(busyRef as unknown as MatDialogRef<unknown>)?.();

      beforeEach(() => {
        busy = signal(false);
        busyBackdrop$ = new Subject<MouseEvent>();
        busyKeydown$ = new Subject<KeyboardEvent>();
        busyRef = {
          ...dialogRef,
          close: jasmine.createSpy('closeBusy'),
          backdropClick: () => busyBackdrop$,
          keydownEvents: () => busyKeydown$,
        };
        injector = createEnvironmentInjector(
          [{ provide: MatDialogRef, useValue: busyRef }],
          TestBed.inject(EnvironmentInjector),
        );
        runInInjectionContext(injector, () => useDiscardGuard(isDirty, busy));
        TestBed.flushEffects();
      });

      afterEach(() => injector.destroy());

      it('cannot be closed while busy, with nothing typed, and can again afterwards', () => {
        expect(busyRef.disableClose).toBeFalse();

        busy.set(true);
        TestBed.flushEffects();
        expect(busyRef.disableClose).toBeTrue();

        busy.set(false);
        TestBed.flushEffects();
        expect(busyRef.disableClose).toBeFalse();
      });

      it('keeps a typed-in dialog locked after the work is over', () => {
        isDirty.set(true);
        busy.set(true);
        TestBed.flushEffects();
        busy.set(false);
        TestBed.flushEffects();

        expect(busyRef.disableClose).toBeTrue();
      });

      it('swallows Back while busy and asks nothing, typed text or not', () => {
        isDirty.set(true);
        busy.set(true);
        TestBed.flushEffects();

        expect(pressBack()).toBeTrue();

        expect(matDialog.open).not.toHaveBeenCalled();
        expect(busyRef.close).not.toHaveBeenCalled();
      });

      it('asks nothing on the backdrop or Escape while busy', () => {
        isDirty.set(true);
        busy.set(true);
        TestBed.flushEffects();

        busyBackdrop$.next({} as MouseEvent);
        busyKeydown$.next({ key: 'Escape' } as KeyboardEvent);

        expect(matDialog.open).not.toHaveBeenCalled();
      });

      it('asks again once it is no longer busy', () => {
        isDirty.set(true);
        busy.set(true);
        TestBed.flushEffects();
        busy.set(false);
        TestBed.flushEffects();

        expect(pressBack()).toBeTrue();

        expect(matDialog.open).toHaveBeenCalledTimes(1);
      });
    });

    describe('Android Back', () => {
      const backHandlerOf = (ref: unknown): (() => boolean) | undefined =>
        getDialogBackHandler(ref as MatDialogRef<unknown>);
      const pressBack = (): boolean | undefined => backHandlerOf(dialogRef)?.();

      it('registers a back handler for its dialog', () => {
        expect(backHandlerOf(dialogRef)).toBeDefined();
      });

      it('declines for a dialog nothing was typed in, so the usual rules close it', () => {
        expect(pressBack()).toBeFalse();

        expect(matDialog.open).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();
        // the usual rules close a dialog that has not opted out
        expect(dialogRef.disableClose).toBeFalse();
      });

      it('asks the question of the backdrop once something was typed, and keeps the dialog', () => {
        isDirty.set(true);
        TestBed.flushEffects();

        expect(pressBack()).toBeTrue();

        expect(matDialog.open).toHaveBeenCalledTimes(1);
        const [component, config] = matDialog.open.calls.mostRecent().args;
        expect(component).toBe(DialogConfirmComponent);
        expect(config.data).toEqual({
          message: T.G.CONFIRM_DISCARD_CHANGES,
          okTxt: T.G.DISCARD,
          cancelTxt: T.G.KEEP_EDITING,
        });
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('closes the dialog when the user discards', () => {
        isDirty.set(true);
        TestBed.flushEffects();
        answer = of(true);

        pressBack();

        expect(dialogRef.close).toHaveBeenCalledTimes(1);
      });

      it('keeps the dialog when the user keeps editing, and asks again on the next press', () => {
        isDirty.set(true);
        TestBed.flushEffects();
        answer = of(undefined);

        pressBack();
        pressBack();

        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(matDialog.open).toHaveBeenCalledTimes(2);
      });

      it('answers a press on the question with Keep editing, whatever is open beneath it', () => {
        isDirty.set(true);
        TestBed.flushEffects();
        const answered = new Subject<unknown>();
        answer = answered;
        pressBack();
        const question = matDialog.open.calls.mostRecent().returnValue;
        // closing the question answers it with nothing, like a tap outside it
        question.close.and.callFake(() => answered.next(undefined));

        expect(backHandlerOf(question)?.()).toBeTrue();

        expect(question.close).toHaveBeenCalledTimes(1);
        expect(dialogRef.close).not.toHaveBeenCalled();
        // the question is over: the next press asks again
        answer = of(undefined);
        pressBack();
        expect(matDialog.open).toHaveBeenCalledTimes(2);
      });

      it('swallows the press without a second question once the dialog is closing', () => {
        isDirty.set(true);
        TestBed.flushEffects();
        dialogState = MatDialogState.CLOSING;

        expect(pressBack()).toBeTrue();
        backdrop$.next({} as MouseEvent);
        escape();

        expect(matDialog.open).not.toHaveBeenCalled();
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('stops answering once the dialog is gone', () => {
        const otherRef = { ...dialogRef, close: jasmine.createSpy('closeOther') };
        const injector = createEnvironmentInjector(
          [{ provide: MatDialogRef, useValue: otherRef }],
          TestBed.inject(EnvironmentInjector),
        );
        runInInjectionContext(injector, () => useDiscardGuard(isDirty));
        expect(backHandlerOf(otherRef)).toBeDefined();

        injector.destroy();

        expect(backHandlerOf(otherRef)).toBeUndefined();
      });
    });
  });
});
