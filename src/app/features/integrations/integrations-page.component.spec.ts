import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { EMPTY } from 'rxjs';
import { provideRouter } from '@angular/router';
import { IntegrationsPageComponent } from './integrations-page.component';
import { IntegrationService } from './integration.service';
import { IntegrationCapabilityService } from './integration-capability.service';
import { IssueService } from '../issue/issue.service';
import { IssueProvider } from '../issue/issue.model';
import { selectProjectFeatureState } from '../project/store/project.selectors';

const GITHUB_PROVIDER = {
  id: 'p1',
  issueProviderKey: 'GITHUB',
  isEnabled: true,
  pluginConfig: { repo: 'demo/app' },
} as unknown as IssueProvider;

describe('IntegrationsPageComponent', () => {
  let fixture: ComponentFixture<IntegrationsPageComponent>;
  const providers = signal<IssueProvider[]>([]);
  const el = (): HTMLElement => fixture.nativeElement;
  const text = (selector: string): string[] =>
    Array.from(el().querySelectorAll(selector)).map((e) => e.textContent?.trim() ?? '');

  beforeEach(async () => {
    providers.set([]);
    await TestBed.configureTestingModule({
      imports: [
        IntegrationsPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideRouter([]),
        // the setup wizard's services reach for the action stream
        provideMockActions(() => EMPTY),
        provideMockStore({
          selectors: [
            {
              selector: selectProjectFeatureState,
              value: { ids: [], entities: {} } as never,
            },
          ],
        }),
        {
          provide: IntegrationService,
          useValue: { tasks: signal([]), entities: signal({}), providers },
        },
        {
          provide: IntegrationCapabilityService,
          useValue: {
            name: (key: string) => key,
            isCalendar: () => false,
            isReady: () => true,
            quirk: () => '',
          },
        },
        { provide: IssueService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(IntegrationsPageComponent);
  });

  describe('with nothing connected', () => {
    beforeEach(() => fixture.detectChanges());

    it('shows one empty state with the Connect action, and nothing else to operate', () => {
      expect(el().querySelectorAll('.empty-state').length).toBe(1);
      const connect = Array.from(el().querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('F.INTEGRATIONS.CONNECT'),
      );
      // the one in the empty state; the header's Connect waits for a provider
      expect(connect.length).toBe(1);
      expect(connect[0].closest('.empty-state')).not.toBeNull();
      // no filters, no search, no side cards, no selection bar
      expect(el().querySelector('.tabs')).toBeNull();
      expect(el().querySelector('.toolbar')).toBeNull();
      expect(el().querySelector('input, select')).toBeNull();
      expect(el().querySelector('.workspace-grid')).toBeNull();
    });

    it('does not repeat the page title: the shell header names the page', () => {
      expect(el().querySelector('h1')).toBeNull();
      expect(el().querySelector('.eyebrow')).toBeNull();
      expect(text('.heading .muted')).toEqual(['F.INTEGRATIONS.INTRO']);
    });

    it('keeps the marketplace link', () => {
      const labels = text('.heading button');
      expect(labels.length).toBe(1);
      expect(labels[0]).toContain('F.INTEGRATIONS.BROWSE_MARKETPLACE');
    });

    it('starts the connection setup from the empty state', () => {
      // spy, so the setup wizard itself (and its services) is not rendered in this suite
      const setSetup = spyOn(fixture.componentInstance.setup, 'set');
      (el().querySelector('.empty-state button') as HTMLButtonElement).click();
      expect(setSetup).toHaveBeenCalledWith(true);
    });
  });

  describe('with a connected provider', () => {
    beforeEach(() => {
      providers.set([GITHUB_PROVIDER]);
      fixture.detectChanges();
    });

    it('shows the filters, the side cards and the header Connect button', () => {
      expect(fixture.debugElement.queryAll(By.css('.tabs .tab')).length).toBe(5);
      expect(el().querySelector('.toolbar input.search')).not.toBeNull();
      expect(el().querySelector('.workspace-grid aside')).not.toBeNull();
      expect(text('.heading .actions button').join(' ')).toContain(
        'F.INTEGRATIONS.CONNECT',
      );
    });

    it('says no task matches (not "nothing connected") when the list is empty', () => {
      const empty = el().querySelector('.empty-state');
      expect(empty?.textContent).toContain('F.INTEGRATIONS.EMPTY');
      expect(empty?.textContent).not.toContain('EMPTY_NO_SOURCE');
      expect(empty?.querySelector('button')).toBeNull();
    });
  });
});
