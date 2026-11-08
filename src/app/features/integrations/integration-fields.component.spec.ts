import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IntegrationFieldsComponent } from './integration-fields.component';
import { IntegrationCapabilityService } from './integration-capability.service';
import { FieldSyncConfig } from '../issue/two-way-sync/issue-sync.model';

describe('Integration field choices', () => {
  it('preserves multiple choices made before the parent passes back its updated policy', () => {
    TestBed.configureTestingModule({
      imports: [IntegrationFieldsComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: IntegrationCapabilityService,
          useValue: {
            fields: () =>
              ['title', 'isDone'].map((key) => ({
                key,
                label: key,
                remoteField: key,
                defaultDirection: 'pullOnly',
                canWrite: true,
              })),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(IntegrationFieldsComponent);
    fixture.componentRef.setInput('provider', { issueProviderKey: 'GITHUB' });
    fixture.componentRef.setInput('policy', { title: 'pullOnly', isDone: 'pullOnly' });
    fixture.detectChanges();
    let saved: FieldSyncConfig = {};
    fixture.componentInstance.policyChange.subscribe((value) => (saved = value));
    const selects = fixture.nativeElement.querySelectorAll(
      'select',
    ) as NodeListOf<HTMLSelectElement>;
    selects[0].value = 'both';
    selects[0].dispatchEvent(new Event('change'));
    selects[1].value = 'off';
    selects[1].dispatchEvent(new Event('change'));
    expect(saved).toEqual({ title: 'both', isDone: 'off' });
  });
});
