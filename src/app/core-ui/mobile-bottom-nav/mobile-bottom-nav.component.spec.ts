import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter, RouterLink } from '@angular/router';
import { By } from '@angular/platform-browser';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { LayoutService } from '../layout/layout.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { AppFeaturesConfig } from '../../features/config/global-config.model';

/**
 * The phone's floating navigation is four labelled destinations and nothing
 * else: Today, Upcoming, Inbox and Browse. It has no add button (the lists carry
 * their own "Add task" rows) and no right-panel toggles (they live in the phone
 * drawer, see `magic-nav-config.service.panels.spec`).
 */
describe('MobileBottomNavComponent', () => {
  let fixture: ComponentFixture<MobileBottomNavComponent>;
  let isMobileSideNavOpen: ReturnType<typeof signal<boolean>>;

  const render = async (over: Partial<AppFeaturesConfig> = {}): Promise<void> => {
    isMobileSideNavOpen = signal(false);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), MobileBottomNavComponent],
      providers: [
        provideRouter([]),
        { provide: LayoutService, useValue: { isMobileSideNavOpen } },
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
    it('opens the drawer and reports the open state', async () => {
      await render();
      const browse = nav().querySelector<HTMLElement>('.e2e-bottom-nav-browse')!;
      let emitted = 0;
      fixture.componentInstance.toggleMobileNavEvent.subscribe(() => emitted++);

      expect(browse.getAttribute('aria-expanded')).toBe('false');
      expect(browse.classList).not.toContain('active');

      browse.click();
      isMobileSideNavOpen.set(true);
      fixture.detectChanges();

      expect(emitted).toBe(1);
      expect(browse.getAttribute('aria-expanded')).toBe('true');
      expect(browse.classList).toContain('active');
    });
  });
});
