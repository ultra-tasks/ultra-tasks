import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterResolverService } from '../issue/two-way-sync/issue-sync-adapter-resolver.service';
import { IssueProvider } from '../issue/issue.model';
import { IntegrationCapabilityService } from './integration-capability.service';
import { T } from '../../t.const';

describe('Integration capability presentation', () => {
  const mapping = { taskField: 'title', issueField: 'title', defaultDirection: 'both' };
  let canWrite = false;
  const version = signal(0);
  let displayName = 'Example';
  let service: IntegrationCapabilityService;
  beforeEach(() => {
    canWrite = false;
    version.set(0);
    displayName = 'Example';
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            registrationVersion: version,
            hasProvider: () => true,
            getName: () => displayName,
            getUseAgendaView: () => false,
            getProvider: () => ({
              definition: {
                fieldMappings: [mapping],
                updateIssue: canWrite ? () => Promise.resolve() : undefined,
              },
            }),
          },
        },
        {
          provide: IssueSyncAdapterResolverService,
          useValue: { getAdapter: () => undefined },
        },
      ],
    });
    service = TestBed.inject(IntegrationCapabilityService);
  });
  it('updates source names when a plugin finishes loading after page hydration', () => {
    const name = computed(() => service.name('GITHUB'));
    expect(name()).toBe('Example');
    displayName = 'GitHub Issues';
    version.set(1);
    expect(name()).toBe('GitHub Issues');
  });
  it('does not offer write directions just because a mapping defaults to both', () => {
    const fields = service.fields({ issueProviderKey: 'LINEAR' } as IssueProvider);
    expect(fields[0].canWrite).toBeFalse();
    expect(fields[0].defaultDirection).toBe('pullOnly');
  });
  it('offers supported writes and explains Trello completion', () => {
    canWrite = true;
    expect(
      service.fields({ issueProviderKey: 'TRELLO' } as IssueProvider)[0].canWrite,
    ).toBeTrue();
    expect(service.quirk('TRELLO')).toBe(T.F.INTEGRATIONS.Q_TRELLO);
  });
});
