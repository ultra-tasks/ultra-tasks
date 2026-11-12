import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { InlineInputComponent } from './inline-input.component';

describe('InlineInputComponent', () => {
  beforeEach(() => {
    // The duration directive reads its unit labels through the translate service.
    TestBed.configureTestingModule({
      providers: [
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
  });

  const field = (inputs: Record<string, unknown>): HTMLInputElement => {
    const fixture = TestBed.createComponent(InlineInputComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  };

  it('names a duration field when given a label', () => {
    expect(
      field({ type: 'duration', value: 0, ariaLabel: 'Estimate' }).getAttribute(
        'aria-label',
      ),
    ).toBe('Estimate');
  });

  it('names any other kind of field too', () => {
    expect(
      field({ type: 'time', value: '10:00', ariaLabel: 'Start' }).getAttribute(
        'aria-label',
      ),
    ).toBe('Start');
  });

  it('adds no label attribute when none is given', () => {
    expect(field({ type: 'duration', value: 0 }).hasAttribute('aria-label')).toBeFalse();
    expect(field({ type: 'text', value: 'x' }).hasAttribute('aria-label')).toBeFalse();
  });
});
