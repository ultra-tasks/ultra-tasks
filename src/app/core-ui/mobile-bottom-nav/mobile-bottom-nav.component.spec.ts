import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { By } from '@angular/platform-browser';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { LayoutService } from '../layout/layout.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';

@Component({ standalone: true, template: '' })
class DummyPageComponent {}

/**
 * The phone's floating navigation is four labelled destinations and nothing
 * else: Today, Upcoming, Inbox and Browse. It has no add button (the lists carry
 * their own "Add task" rows) and no right-panel toggles (they live in the phone
 * drawer, see `magic-nav-config.service.panels.spec`).
 */
describe('MobileBottomNavComponent', () => {
  let fixture: ComponentFixture<MobileBottomNavComponent>;
  let isMobileSideNavOpen: ReturnType<typeof signal<boolean>>;
  let scrollPageToTop: jasmine.Spy;

  const render = async (
    over: Partial<AppFeaturesConfig> = {},
    url = '/tag/TODAY/tasks',
  ): Promise<void> => {
    isMobileSideNavOpen = signal(false);
    scrollPageToTop = jasmine.createSpy('scrollPageToTop');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), MobileBottomNavComponent],
      providers: [
        provideRouter([{ path: '**', component: DummyPageComponent }]),
        { provide: LayoutService, useValue: { isMobileSideNavOpen, scrollPageToTop } },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: signal<AppFeaturesConfig>({
              ...DEFAULT_GLOBAL_CONFIG.appFeatures,
              ...over,
            }),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(MobileBottomNavComponent);
    await navigate(url);
  };

  const navigate = async (url: string): Promise<void> => {
    await TestBed.inject(Router).navigateByUrl(url);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const nav = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const buttons = (): HTMLElement[] =>
    Array.from(nav().querySelectorAll<HTMLElement>('.nav-button'));
  const labels = (): string[] =>
    buttons().map((b) => b.querySelector('.nav-label')?.textContent?.trim() ?? '');

  it('lists Today, Upcoming, Inbox and Browse, each with a visible label', async () => {
    await render({ isPlannerEnabled: true });

    expect(buttons().length).toBe(4);
    expect(buttons().map((b) => b.className)).toEqual([
      jasmine.stringContaining('e2e-bottom-nav-today'),
      jasmine.stringContaining('e2e-bottom-nav-upcoming'),
      jasmine.stringContaining('e2e-bottom-nav-inbox'),
      jasmine.stringContaining('e2e-bottom-nav-browse'),
    ]);
    // Untranslated in this spec, so the labels are the translation keys.
    expect(labels().every((l) => l.length > 0)).toBeTrue();
  });

  it('has no add button', async () => {
    await render();

    expect(nav().querySelector('.add-task-button')).toBeFalsy();
    expect(nav().querySelector('[mat-fab]')).toBeFalsy();
  });

  it('drops Upcoming when the Planner is switched off', async () => {
    await render({ isPlannerEnabled: false });

    expect(nav().querySelector('.e2e-bottom-nav-upcoming')).toBeFalsy();
    expect(buttons().length).toBe(3);
  });

  it('routes Today and Inbox, and Upcoming to the planner', async () => {
    await render({ isPlannerEnabled: true });

    const url = (cls: string): string | undefined =>
      fixture.debugElement
        .query(By.css(cls))
        ?.injector.get(RouterLink)
        .urlTree?.toString();
    expect(url('.e2e-bottom-nav-today')).toContain('/tag/TODAY/tasks');
    expect(url('.e2e-bottom-nav-upcoming')).toBe('/planner');
    expect(url('.e2e-bottom-nav-inbox')).toContain('/project/INBOX_PROJECT/tasks');
  });

  describe('Browse', () => {
    const browse = (): HTMLElement =>
      nav().querySelector<HTMLElement>('.e2e-bottom-nav-browse')!;
    const activeButtons = (): string[] =>
      buttons()
        .filter((b) => b.classList.contains('active'))
        .map((b) => b.className.match(/e2e-bottom-nav-(\w+)/)![1]);

    it('opens the drawer and reports the open state', async () => {
      await render();
      let emitted = 0;
      fixture.componentInstance.toggleMobileNavEvent.subscribe(() => emitted++);

      expect(browse().getAttribute('aria-expanded')).toBe('false');
      expect(browse().classList).not.toContain('active');

      browse().click();
      isMobileSideNavOpen.set(true);
      fixture.detectChanges();

      expect(emitted).toBe(1);
      expect(browse().getAttribute('aria-expanded')).toBe('true');
      expect(browse().classList).toContain('active');
    });

    it('is a folder, which agrees with its label', async () => {
      await render();

      expect(browse().querySelector('mat-icon')?.textContent?.trim()).toBe('folder_open');
    });

    it('marks the tab of the page that is open, and not Browse', async () => {
      await render({ isPlannerEnabled: true }, '/tag/TODAY/tasks');
      expect(activeButtons()).toEqual(['today']);

      await navigate('/planner');
      expect(activeButtons()).toEqual(['upcoming']);

      await navigate('/project/INBOX_PROJECT/tasks');
      expect(activeButtons()).toEqual(['inbox']);
    });

    // Eight pages had no mark at all: a project, a tag, Calendar, Boards, Habits,
    // Search, History and Metrics.
    [
      '/project/work/tasks',
      '/tag/urgent/tasks',
      '/schedule',
      '/boards',
      '/habits',
      '/search',
      '/tag/TODAY/quick-history',
      '/tag/TODAY/metrics',
      '/config',
    ].forEach((url) => {
      it(`is marked on ${url}, which is none of the tabs`, async () => {
        await render({ isPlannerEnabled: true }, url);

        expect(activeButtons()).toEqual(['browse']);
        expect(browse().getAttribute('aria-expanded')).toBe('false');
      });
    });

    it('is marked while the drawer is open, even on a tab', async () => {
      await render({ isPlannerEnabled: true }, '/tag/TODAY/tasks');

      isMobileSideNavOpen.set(true);
      fixture.detectChanges();

      expect(activeButtons()).toEqual(['today', 'browse']);
    });

    it('marks Browse on the planner page when Upcoming is switched off', async () => {
      await render({ isPlannerEnabled: false }, '/planner');

      expect(activeButtons()).toEqual(['browse']);
    });
  });

  describe('tapping the active tab again', () => {
    it('scrolls the page to the top', async () => {
      await render({ isPlannerEnabled: true }, '/tag/TODAY/tasks');

      nav().querySelector<HTMLElement>('.e2e-bottom-nav-today')!.click();

      expect(scrollPageToTop).toHaveBeenCalledTimes(1);
    });

    it('scrolls for Upcoming and Inbox too', async () => {
      await render({ isPlannerEnabled: true }, '/planner');
      nav().querySelector<HTMLElement>('.e2e-bottom-nav-upcoming')!.click();
      expect(scrollPageToTop).toHaveBeenCalledTimes(1);

      await navigate('/project/INBOX_PROJECT/tasks');
      nav().querySelector<HTMLElement>('.e2e-bottom-nav-inbox')!.click();
      expect(scrollPageToTop).toHaveBeenCalledTimes(2);
    });

    it('leaves the page where it is when the tap goes to another tab', async () => {
      await render({ isPlannerEnabled: true }, '/tag/TODAY/tasks');

      nav().querySelector<HTMLElement>('.e2e-bottom-nav-inbox')!.click();

      expect(scrollPageToTop).not.toHaveBeenCalled();
    });

    it('does not scroll for Browse, which opens the drawer', async () => {
      await render({ isPlannerEnabled: true }, '/schedule');

      nav().querySelector<HTMLElement>('.e2e-bottom-nav-browse')!.click();

      expect(scrollPageToTop).not.toHaveBeenCalled();
    });
  });

  describe('under the gesture bar', () => {
    it('has a strip for it, which is only there for the pill to float above', async () => {
      await render();

      const scrim = nav().querySelector<HTMLElement>('.inset-scrim')!;
      expect(scrim.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(scrim).position).toBe('fixed');
    });
  });
});
