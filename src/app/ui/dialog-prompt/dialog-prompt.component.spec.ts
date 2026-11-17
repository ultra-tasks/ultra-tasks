import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { DialogPromptComponent } from './dialog-prompt.component';

describe('DialogPromptComponent', () => {
  let fixture: ComponentFixture<DialogPromptComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogPromptComponent>>;

  const create = async (data: Record<string, unknown>): Promise<void> => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    await TestBed.configureTestingModule({
      imports: [
        DialogPromptComponent,
        NoopAnimationsModule,
        MatDialogModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DialogPromptComponent);
    fixture.detectChanges();
  };

  const titleText = (): string =>
    fixture.debugElement.query(By.css('h2[mat-dialog-title]')).nativeElement.textContent;

  it('should name the dialog with its plain message', async () => {
    await create({ message: 'Add section', placeholder: 'Section title' });
    expect(titleText()).toContain('Add section');
    // the message is the title, not repeated in the body
    expect(fixture.debugElement.query(By.css('mat-dialog-content > div'))).toBeNull();
  });

  it('should keep rich text in the body and title the dialog with the field label', async () => {
    await create({ message: '<ol><li>Step</li></ol>', placeholder: 'Insert cookie' });
    expect(titleText()).toContain('Insert cookie');
    expect(
      fixture.debugElement.query(By.css('mat-dialog-content > div li')),
    ).not.toBeNull();
  });

  it('should title a message-less prompt with the field label', async () => {
    await create({ placeholder: 'New project name', txtValue: 'Work' });
    expect(titleText()).toContain('New project name');
  });

  it('should return the entered text on save and undefined on cancel', async () => {
    await create({ placeholder: 'Name', txtValue: 'Work' });
    const component = fixture.componentInstance;
    component.close(true);
    expect(dialogRef.close).toHaveBeenCalledWith('Work');
    component.close(false);
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });

  describe('mobile keyboard hints', () => {
    const input = (): HTMLInputElement =>
      fixture.debugElement.query(By.css('input')).nativeElement;

    it('ends a text prompt in Done and leaves capitals and correction on', async () => {
      await create({ placeholder: 'Name' });
      expect(input().getAttribute('enterkeyhint')).toBe('done');
      expect(input().hasAttribute('autocapitalize')).toBeFalse();
      expect(input().hasAttribute('spellcheck')).toBeFalse();
    });

    it('asks for the URL keyboard, without capitals or correction, for a URL', async () => {
      await create({ placeholder: 'Address', type: 'url' });
      expect(input().getAttribute('inputmode')).toBe('url');
      expect(input().getAttribute('autocapitalize')).toBe('none');
      expect(input().getAttribute('autocorrect')).toBe('off');
      expect(input().getAttribute('spellcheck')).toBe('false');
    });

    it('does not capitalise or correct a password', async () => {
      await create({ placeholder: 'Secret', type: 'password' });
      expect(input().getAttribute('autocapitalize')).toBe('none');
      expect(input().getAttribute('spellcheck')).toBe('false');
    });
  });
});
