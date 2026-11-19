import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { AccountDataChoiceHostService } from './account-data-choice-host.service';
import { DialogAccountDataChoiceComponent } from './dialog-account-data-choice.component';
import { NativeSyncService } from '../native-sync.service';
import type { AccountDataChoice, DataConnectionState } from '../account-sync.types';

const choice = (deferred = false): AccountDataChoice => ({
  local: { tasks: 1, projects: 0, notes: 0, archived: 0, hasUserData: true },
  account: { tasks: 5, projects: 0, notes: 0, archived: 0, hasUserData: true },
  since: 1,
  deferred,
});

describe('AccountDataChoiceHostService', () => {
  let dataChoice: ReturnType<typeof signal<AccountDataChoice | null>>;
  let unlocked: ReturnType<typeof signal<boolean>>;
  let connection: ReturnType<typeof signal<DataConnectionState>>;
  let native: {
    dataChoice: typeof dataChoice;
    unlocked: typeof unlocked;
    connection: typeof connection;
    chooseData: jasmine.Spy;
    deferDataChoice: jasmine.Spy;
  };
  let dialog: { open: jasmine.Spy };
  let refs: { close: jasmine.Spy }[];

  const flush = (): void => TestBed.flushEffects();
  /** The dialog classes opened so far, in order. */
  const opened = (): unknown[] =>
    dialog.open.calls.allArgs().map(([component]) => component);

  beforeEach(() => {
    dataChoice = signal<AccountDataChoice | null>(null);
    unlocked = signal(true);
    connection = signal<DataConnectionState>('idle');
    native = {
      dataChoice,
      unlocked,
      connection,
      chooseData: jasmine.createSpy('chooseData').and.resolveTo(),
      deferDataChoice: jasmine.createSpy('deferDataChoice'),
    };
    refs = [];
    dialog = {
      open: jasmine.createSpy('open').and.callFake(() => {
        const result = new Subject<unknown>();
        const ref = {
          afterClosed: () => result.asObservable(),
          close: jasmine.createSpy('close').and.callFake((value?: unknown) => {
            result.next(value);
            result.complete();
          }),
        };
        refs.push(ref);
        return ref;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: NativeSyncService, useValue: native },
        { provide: MatDialog, useValue: dialog },
        {
          provide: TranslateService,
          useValue: {
            instant: (key: string, params: Record<string, number>) =>
              `${key}|${params.tasks}/${params.projects}/${params.notes}/${params.archived}`,
          },
        },
      ],
    });
    TestBed.inject(AccountDataChoiceHostService);
    flush();
  });

  it('stays closed while nothing needs a decision', () => {
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('opens at once on whatever screen the person is on, as a focused modal', () => {
    dataChoice.set(choice());
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    const [component, config] = dialog.open.calls.mostRecent().args;
    expect(component).toBe(DialogAccountDataChoiceComponent);
    // Focus the dialog, not a button, so Enter never picks a side; give focus back on close.
    expect(config).toEqual(
      jasmine.objectContaining({
        autoFocus: 'dialog',
        restoreFocus: true,
        ariaLabelledBy: 'account-data-choice-title',
        ariaDescribedBy: 'account-data-choice-body',
      }),
    );
  });

  it('does not open twice for the same choice', () => {
    dataChoice.set(choice());
    flush();
    dataChoice.set(choice());
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('does not open for a deferred choice, or before the vault is open', () => {
    dataChoice.set(choice(true));
    flush();
    expect(dialog.open).not.toHaveBeenCalled();
    dataChoice.set(choice(false));
    unlocked.set(false);
    flush();
    expect(dialog.open).not.toHaveBeenCalled();
    unlocked.set(true);
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('carries out "Download account data" at once, and nothing else', () => {
    dataChoice.set(choice());
    flush();
    refs[0].close('download');
    expect(native.chooseData).toHaveBeenCalledOnceWith('download');
    expect(native.deferDataChoice).not.toHaveBeenCalled();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('treats closing the dialog any other way (Escape, backdrop, "Decide later") as deciding later', () => {
    dataChoice.set(choice());
    flush();
    refs[0].close(undefined);
    expect(native.deferDataChoice).toHaveBeenCalledTimes(1);
    expect(native.chooseData).not.toHaveBeenCalled();

    dataChoice.set(choice());
    flush();
    refs[1].close('later');
    expect(native.deferDataChoice).toHaveBeenCalledTimes(2);
  });

  it('stays closed while a switch is running, and asks again if the switch did not happen', () => {
    dataChoice.set(choice());
    flush();
    refs[0].close('download');
    connection.set('downloading');
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    // Refused (this device changed): the choice is back with a reason and the stage idles.
    connection.set('idle');
    dataChoice.set(choice());
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('closes by itself, without deferring, when the choice goes away', () => {
    dataChoice.set(choice());
    flush();
    dataChoice.set(null);
    flush();
    expect(refs[0].close).toHaveBeenCalled();
    expect(native.deferDataChoice).not.toHaveBeenCalled();
    expect(native.chooseData).not.toHaveBeenCalled();
  });

  it('closes when the account is locked or signed out', () => {
    dataChoice.set(choice());
    flush();
    unlocked.set(false);
    flush();
    expect(refs[0].close).toHaveBeenCalled();
    expect(native.deferDataChoice).not.toHaveBeenCalled();
  });

  it('"Finish connecting" brings it back after a deferral', () => {
    dataChoice.set(choice());
    flush();
    refs[0].close('later');
    dataChoice.set(choice(true));
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    dataChoice.set(choice(false));
    flush();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  describe('replacing the account', () => {
    beforeEach(() => {
      dataChoice.set(choice());
      flush();
      refs[0].close('replace');
    });

    it('is never done by the button alone: the shared destructive confirmation comes first', () => {
      expect(native.chooseData).not.toHaveBeenCalled();
      expect(opened()).toEqual([
        DialogAccountDataChoiceComponent,
        DialogConfirmComponent,
      ]);
      const [, config] = dialog.open.calls.mostRecent().args;
      expect(config.restoreFocus).toBeTrue();
      expect(config.data).toEqual(
        jasmine.objectContaining({
          title: T.ACCOUNT_DATA.CONFIRM_TITLE,
          message: T.ACCOUNT_DATA.CONFIRM_BODY,
          okTxt: T.ACCOUNT_DATA.CONFIRM_REPLACE,
          cancelTxt: T.ACCOUNT_DATA.BACK,
          isDestructive: true,
        }),
      );
    });

    it('spells out what each side holds, in the confirmation itself', () => {
      const [, config] = dialog.open.calls.mostRecent().args;
      expect(config.data.translateParams).toEqual({
        account: `${T.ACCOUNT_DATA.COUNTS}|5/0/0/0`,
        device: `${T.ACCOUNT_DATA.COUNTS}|1/0/0/0`,
      });
    });

    it('replaces only once the person confirms', () => {
      refs[1].close(true);
      expect(native.chooseData).toHaveBeenCalledOnceWith('replace');
      expect(native.deferDataChoice).not.toHaveBeenCalled();
    });

    it('"Back" returns to the choice; nothing is replaced and nothing is deferred', () => {
      refs[1].close(false);
      expect(native.chooseData).not.toHaveBeenCalled();
      expect(native.deferDataChoice).not.toHaveBeenCalled();
      expect(opened()).toEqual([
        DialogAccountDataChoiceComponent,
        DialogConfirmComponent,
        DialogAccountDataChoiceComponent,
      ]);
    });

    it('Escape on the confirmation also returns to the choice instead of deferring', () => {
      refs[1].close(undefined);
      expect(native.chooseData).not.toHaveBeenCalled();
      expect(native.deferDataChoice).not.toHaveBeenCalled();
      expect(opened()[2]).toBe(DialogAccountDataChoiceComponent);
    });

    it('does not stack a second choice dialog while the confirmation is on screen', () => {
      dataChoice.set(choice());
      flush();
      expect(dialog.open).toHaveBeenCalledTimes(2);
    });

    it('closes the confirmation, replacing nothing, when the situation goes away', () => {
      dataChoice.set(null);
      flush();
      expect(refs[1].close).toHaveBeenCalled();
      expect(native.chooseData).not.toHaveBeenCalled();
      expect(native.deferDataChoice).not.toHaveBeenCalled();
      expect(dialog.open).toHaveBeenCalledTimes(2);
    });
  });

  it('does not ask for a confirmation once the choice has gone away', () => {
    dataChoice.set(choice());
    flush();
    // The choice disappears (the vault locked) in the moment between the press and the host.
    dataChoice.set(null);
    refs[0].close('replace');
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(native.chooseData).not.toHaveBeenCalled();
  });
});
