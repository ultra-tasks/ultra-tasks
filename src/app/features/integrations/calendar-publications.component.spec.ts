import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  TranslateLoader,
  TranslateModule,
  TranslateService,
  TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { CalendarPublicationsComponent } from './calendar-publications.component';
import {
  CalendarPublicationService,
  PublishedCalendar,
} from './calendar-publication.service';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import enTranslations from '../../../assets/i18n/en.json';

class JsonTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<TranslationObject> {
    return of(enTranslations as TranslationObject);
  }
}

describe('CalendarPublicationsComponent', () => {
  const feed: PublishedCalendar = {
    id: 'feed-1',
    label: 'Work calendar',
    privacy: 'busy',
    revision: 3,
    generation: 1,
  };
  let available: ReturnType<typeof signal<boolean>>;
  let feeds: ReturnType<typeof signal<PublishedCalendar[]>>;
  let error: ReturnType<typeof signal<boolean>>;
  let publication: {
    available: typeof available;
    feeds: typeof feeds;
    busy: ReturnType<typeof signal<boolean>>;
    error: typeof error;
    ownedIds: ReturnType<typeof signal<Set<string>>>;
    refresh: jasmine.Spy;
    create: jasmine.Spy;
    rotate: jasmine.Spy;
    stop: jasmine.Spy;
  };
  let fixture: ComponentFixture<CalendarPublicationsComponent>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise<void>((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  const label = (b: HTMLElement): string =>
    (b.querySelector('.mdc-button__label') ?? b).textContent?.trim() ?? '';
  const button = (name: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button',
      ),
    ).find((b) => label(b) === name);
  const type = async (selector: string, value: string): Promise<void> => {
    const input = el<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  beforeEach(async () => {
    available = signal(true);
    feeds = signal<PublishedCalendar[]>([]);
    error = signal(false);
    publication = {
      available,
      feeds,
      busy: signal(false),
      error,
      ownedIds: signal(new Set<string>()),
      refresh: jasmine.createSpy('refresh').and.resolveTo(),
      create: jasmine
        .createSpy('create')
        .and.resolveTo('https://accounts.example.test/calendar/secret.ics'),
      rotate: jasmine
        .createSpy('rotate')
        .and.resolveTo('https://accounts.example.test/calendar/rotated.ics'),
      stop: jasmine.createSpy('stop').and.resolveTo(),
    };
    await TestBed.configureTestingModule({
      imports: [
        CalendarPublicationsComponent,
        NoopAnimationsModule,
        MatIconTestingModule,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: JsonTranslateLoader },
        }),
      ],
      providers: [
        { provide: CalendarPublicationService, useValue: publication },
        { provide: ProjectService, useValue: { list: signal([]) } },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList: signal([]) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(CalendarPublicationsComponent);
    await settle();
  });

  it('renders nothing while publishing is not available', async () => {
    available.set(false);
    await settle();
    expect(el('details')).toBeNull();
  });

  it('is one closed, named section that keeps the plaintext disclosure and the consent', () => {
    const section = el<HTMLDetailsElement>('details.calendar-publications')!;
    expect(section.open).toBeFalse();
    expect(section.querySelector('summary')!.textContent).toContain(
      'Published calendars',
    );
    expect(section.textContent).toContain(
      'Publishing sends a readable copy of selected tasks to your server.',
    );
    expect(section.textContent).toContain('This copy is outside end-to-end encryption.');
    expect(section.querySelector('mat-checkbox')!.textContent).toContain(
      'readable by the server operator and anyone with the URL',
    );
    expect(button('Publish calendar')!.disabled).toBeTrue();
  });

  it('uses the shared form fields instead of bare native controls', () => {
    const section = el('details.calendar-publications')!;
    expect(section.querySelectorAll('mat-form-field').length).toBe(3);
    expect(section.querySelectorAll('select').length).toBe(0);
    for (const input of Array.from(section.querySelectorAll('input'))) {
      expect(
        input.closest('mat-form-field') ?? input.closest('mat-checkbox'),
      ).not.toBeNull();
    }
  });

  it('shows only busy times by default and publishes only after consent', async () => {
    await type('input[name="calendarLabel"]', 'Work');
    expect(button('Publish calendar')!.disabled).toBeTrue();
    el<HTMLInputElement>('mat-checkbox input')!.click();
    await settle();
    expect(button('Publish calendar')!.disabled).toBeFalse();
    el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(publication.create).toHaveBeenCalledOnceWith('Work', 'busy', { type: 'all' });
    // The subscription URL is shown once, read-only, with its explanation; consent is spent.
    expect(el<HTMLInputElement>('input[readonly]')!.value).toBe(
      'https://accounts.example.test/calendar/secret.ics',
    );
    expect(el('details')!.textContent).toContain(
      'It is shown only now. Rotating a URL or stopping publication blocks future fetches',
    );
    expect(button('Publish calendar')!.disabled).toBeTrue();
  });

  it('lets a published calendar be rotated or stopped', async () => {
    feeds.set([feed]);
    publication.ownedIds.set(new Set([feed.id]));
    await settle();
    expect(el('.feeds')!.textContent).toContain('Work calendar');
    expect(el('.feeds')!.textContent).toContain('Updated by this device.');
    button('Rotate URL')!.click();
    await settle();
    expect(publication.rotate).toHaveBeenCalledOnceWith(feed);
    expect(el<HTMLInputElement>('input[readonly]')!.value).toBe(
      'https://accounts.example.test/calendar/rotated.ics',
    );
    button('Stop publishing')!.click();
    await settle();
    expect(publication.stop).toHaveBeenCalledOnceWith(feed);
    expect(el('input[readonly]')).toBeNull();
  });

  it('says another device updates a calendar it did not publish', async () => {
    feeds.set([feed]);
    await settle();
    expect(el('.feeds')!.textContent).toContain('Updated by another device.');
  });

  it('reports a problem once, as an alert, and can reload', async () => {
    error.set(true);
    await settle();
    const alerts = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="alert"]',
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain('Could not update the calendar publication.');
    button('Reload')!.click();
    expect(publication.refresh).toHaveBeenCalled();
  });
});
