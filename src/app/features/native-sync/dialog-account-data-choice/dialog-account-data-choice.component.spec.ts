import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogAccountDataChoiceComponent } from './dialog-account-data-choice.component';
import { NativeSyncService } from '../native-sync.service';
import type { AccountDataChoice } from '../account-sync.types';
import enTranslations from '../../../../assets/i18n/en.json';

const choice = (over: Partial<AccountDataChoice> = {}): AccountDataChoice => ({
  local: { tasks: 2, projects: 0, notes: 1, archived: 0, hasUserData: true },
  account: { tasks: 40, projects: 3, notes: 5, archived: 12, hasUserData: true },
  since: 1,
  deferred: false,
  ...over,
});

describe('DialogAccountDataChoiceComponent', () => {
  let fixture: ComponentFixture<DialogAccountDataChoiceComponent>;
  let ref: jasmine.SpyObj<MatDialogRef<DialogAccountDataChoiceComponent>>;
  let notice: ReturnType<typeof signal<string>>;
  let dataChoice: ReturnType<typeof signal<AccountDataChoice | null>>;

  const buttons = (): string[] =>
    fixture.debugElement
      .queryAll(By.css('button'))
      .map((button) => (button.nativeElement as HTMLElement).textContent!.trim());
  const press = (label: string): void => {
    const button = fixture.debugElement
      .queryAll(By.css('button'))
      .find(
        (candidate) =>
          (candidate.nativeElement as HTMLElement).textContent!.trim() === label,
      );
    (button!.nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent!;

  beforeEach(async () => {
    ref = jasmine.createSpyObj('MatDialogRef', ['close', 'addPanelClass']);
    notice = signal('');
    dataChoice = signal<AccountDataChoice | null>(choice());
    await TestBed.configureTestingModule({
      imports: [
        DialogAccountDataChoiceComponent,
        NoopAnimationsModule,
        MatDialogModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: ref },
        { provide: NativeSyncService, useValue: { dataChoice, dataNotice: notice } },
      ],
    }).compileComponents();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', enTranslations);
    translate.use('en');
    fixture = TestBed.createComponent(DialogAccountDataChoiceComponent);
    fixture.detectChanges();
  });

  it('offers exactly the three agreed choices, in plain words', () => {
    expect(buttons()).toEqual([
      'Replace account data with this device',
      'Decide later',
      'Download account data',
    ]);
    expect(text()).toContain('Which tasks do you want to keep?');
  });

  it('never reads as a merge', () => {
    expect(text().toLowerCase()).not.toContain('merge d');
    expect(text()).toContain('never merged');
  });

  it('shows bounded counts for both sides, never content', () => {
    expect(text()).toContain('Tasks: 40 · Projects: 3 · Notes: 5 · Archived: 12');
    expect(text()).toContain('Tasks: 2 · Projects: 0 · Notes: 1 · Archived: 0');
  });

  it('says a recovery copy of THIS device is saved when downloading, and that replacing is for every device', () => {
    expect(text()).toContain('A recovery copy of this device');
    expect(text()).toContain('for every device');
  });

  it('closes with "download" for the safe, primary choice', () => {
    press('Download account data');
    expect(ref.close).toHaveBeenCalledOnceWith('download');
  });

  it('closes with "later" and changes nothing for "Decide later"', () => {
    press('Decide later');
    expect(ref.close).toHaveBeenCalledOnceWith('later');
  });

  it('closes with "replace" for the destructive choice; the host asks for the confirmation', () => {
    press('Replace account data with this device');
    expect(ref.close).toHaveBeenCalledOnceWith('replace');
  });

  it('puts the destructive choice apart from the safe one, at the start of the actions', () => {
    const replace = fixture.debugElement
      .queryAll(By.css('button'))
      .map((button) => button.nativeElement as HTMLElement)
      .find((button) => button.textContent!.trim().startsWith('Replace'))!;
    expect(replace.classList).toContain('dialog-action-start');
  });

  it('is named by its title and shows why it was asked again', () => {
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#account-data-choice-title')!
        .textContent,
    ).toContain('Which tasks do you want to keep?');
    expect(fixture.debugElement.query(By.css('[role="alert"]'))).toBeNull();
    notice.set('ACCOUNT_DATA.NOTICE_LOCAL_CHANGED');
    fixture.detectChanges();
    const alert = fixture.debugElement.query(By.css('[role="alert"]'));
    expect((alert.nativeElement as HTMLElement).textContent).toContain(
      'Your tasks changed while switching',
    );
  });

  it('shows new numbers when the situation is measured again', () => {
    dataChoice.set(
      choice({
        account: { tasks: 99, projects: 0, notes: 0, archived: 0, hasUserData: true },
      }),
    );
    fixture.detectChanges();
    expect(text()).toContain('Tasks: 99');
  });
});
