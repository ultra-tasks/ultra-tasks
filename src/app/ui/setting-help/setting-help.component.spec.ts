import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { SettingHelpComponent } from './setting-help.component';

describe('SettingHelpComponent', () => {
  let fixture: ComponentFixture<SettingHelpComponent>;
  let component: SettingHelpComponent;

  const create = (
    { isTouch }: { isTouch: boolean },
    text = '<b>Shows</b> the&nbsp;help <i>text</i> &amp; more',
  ): void => {
    TestBed.configureTestingModule({
      imports: [SettingHelpComponent, TranslateModule.forRoot()],
    });
    fixture = TestBed.createComponent(SettingHelpComponent);
    component = fixture.componentInstance;
    // The test browser reports a mouse; the component asks for the input intent.
    spyOn(component, 'isTouch').and.returnValue(isTouch);
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('label', 'Upcoming');
    fixture.detectChanges();
  };

  const button = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button.setting-help-button');
  const card = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.setting-help-card');
  const tooltip = (): MatTooltip =>
    fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip);

  it('names the button after the setting', () => {
    create({ isTouch: false });
    expect(button().getAttribute('aria-label')).toContain('Upcoming');
  });

  it('shows plain text, without tags or entities', () => {
    create({ isTouch: false });
    expect(component.plainText()).toBe('Shows the help text & more');
  });

  describe('with a mouse or keyboard', () => {
    beforeEach(() => create({ isTouch: false }));

    it('shows the tooltip on click and opens no card', () => {
      const show = spyOn(tooltip(), 'show');
      button().click();
      fixture.detectChanges();
      expect(show).toHaveBeenCalledTimes(1);
      expect(card()).toBeNull();
    });

    it('is not an expandable control', () => {
      expect(button().hasAttribute('aria-expanded')).toBeFalse();
      expect(button().hasAttribute('aria-controls')).toBeFalse();
    });

    it('keeps the tooltip enabled', () => {
      expect(tooltip().disabled).toBeFalse();
    });
  });

  describe('on a touch screen', () => {
    beforeEach(() => create({ isTouch: true }));

    it('opens the help as a card under the row on a tap', () => {
      const show = spyOn(tooltip(), 'show');
      expect(card()).toBeNull();

      button().click();
      fixture.detectChanges();

      expect(card()?.textContent?.trim()).toBe('Shows the help text & more');
      expect(show).not.toHaveBeenCalled();
    });

    it('toggles the card and reports it with aria-expanded and aria-controls', () => {
      expect(button().getAttribute('aria-expanded')).toBe('false');
      expect(button().hasAttribute('aria-controls')).toBeFalse();

      button().click();
      fixture.detectChanges();
      expect(button().getAttribute('aria-expanded')).toBe('true');
      expect(button().getAttribute('aria-controls')).toBe(card()?.id as string);

      button().click();
      fixture.detectChanges();
      expect(button().getAttribute('aria-expanded')).toBe('false');
      expect(card()).toBeNull();
    });

    it('keeps the card open until the next tap, however long the text', fakeAsync(() => {
      button().click();
      fixture.detectChanges();

      tick(60_000);
      fixture.detectChanges();

      expect(card()).not.toBeNull();
    }));

    it('has no tooltip to compete with the card', () => {
      expect(tooltip().disabled).toBeTrue();
    });

    it('gives every card its own id', () => {
      const other = TestBed.createComponent(SettingHelpComponent);
      other.componentRef.setInput('text', 'Another setting');
      other.componentRef.setInput('label', 'Another setting');
      expect(other.componentInstance.cardId).not.toBe(component.cardId);
    });
  });

  it('opens the card for a touch tap even while the input intent still says mouse', () => {
    create({ isTouch: false });
    const tap = new PointerEvent('click', { pointerType: 'touch', bubbles: true });
    button().dispatchEvent(tap);
    fixture.detectChanges();
    expect(card()).not.toBeNull();
  });
});
