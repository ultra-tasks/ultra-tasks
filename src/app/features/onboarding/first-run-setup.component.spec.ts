import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { GlobalThemeService } from '../../core/theme/global-theme.service';
import { FirstRunSetupComponent } from './first-run-setup.component';

describe('FirstRunSetupComponent', () => {
  let fixture: ComponentFixture<FirstRunSetupComponent>;
  let close: jasmine.Spy;
  let host: HTMLElement;

  const el = (selector: string): HTMLElement =>
    fixture.nativeElement.querySelector(selector) as HTMLElement;

  beforeEach(async () => {
    close = jasmine.createSpy('close');
    await TestBed.configureTestingModule({
      imports: [FirstRunSetupComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: { close } },
        { provide: GlobalThemeService, useValue: { darkMode: signal('system') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FirstRunSetupComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('continues with the chosen way to begin, and skips from the header', () => {
    fixture.detectChanges();

    // By its label: the sync choice only exists where sync is available.
    const restore = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.choices button'),
    ).find((button) => button.textContent?.includes('ONBOARDING.SETUP.RESTORE'));
    restore!.click();
    fixture.detectChanges();
    el('footer button').click();
    expect(close).toHaveBeenCalledWith('restore');

    el('header button').click();
    expect(close).toHaveBeenCalledWith('skip');
  });

  // Continue sat at the end of the scrolling content, below the fold on a short
  // phone (7px at 360x740, 195px at 320x568). It is the dialog's footer now.
  describe('on a screen too short for all of it', () => {
    let pane: HTMLDivElement;

    beforeEach(() => {
      // What the dialog surface is: a flex column with a maximum height.
      pane = document.createElement('div');
      pane.style.cssText =
        'display:flex;flex-direction:column;height:320px;max-height:320px;width:320px;';
      host.parentElement!.insertBefore(pane, host);
      pane.appendChild(host);
      fixture.detectChanges();
    });

    afterEach(() => pane.remove());

    it('keeps Continue and Skip inside the pane while the choices scroll', () => {
      const paneRect = pane.getBoundingClientRect();
      const continueRect = el('footer button').getBoundingClientRect();
      const skipRect = el('header button').getBoundingClientRect();

      expect(continueRect.bottom).toBeLessThanOrEqual(paneRect.bottom + 0.5);
      expect(skipRect.top).toBeGreaterThanOrEqual(paneRect.top - 0.5);
      expect(el('main').scrollHeight).toBeGreaterThan(el('main').clientHeight);
    });

    it('puts the footer outside the scrolling part', () => {
      expect(el('main').contains(el('footer'))).toBe(false);
      expect(el('footer').contains(el('button[cdkFocusInitial]'))).toBe(true);
    });
  });
});
