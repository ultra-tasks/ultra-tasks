import { TestBed } from '@angular/core/testing';
import { ClientIdService } from '../../core/util/client-id.service';
import { IssueProviderOwnershipService } from './issue-provider-ownership.service';

describe('IssueProviderOwnershipService', () => {
  let service: IssueProviderOwnershipService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ClientIdService,
          useValue: {
            loadClientId: async () => 'owner-installation',
            getOrGenerateClientId: async () => 'owner-installation',
          },
        },
      ],
    });
    service = TestBed.inject(IssueProviderOwnershipService);
  });
  it('retains legacy behavior when persisted ownership is absent', async () => {
    await expectAsync(service.assertOwner({})).toBeResolved();
    expect(service.isOwner({})).toBeTrue();
  });
  it('rejects a peer before source HTTP and accepts the owner', async () => {
    await expectAsync(
      service.assertOwner({ integrationOwnerId: 'other-installation' }),
    ).toBeRejected();
    await expectAsync(
      service.assertOwner({ integrationOwnerId: 'owner-installation' }),
    ).toBeResolved();
  });
  it('claims the stable op-log installation ID and a coarse device label', async () => {
    const claimed = await service.claim();
    expect(claimed.integrationOwnerId).toBe('owner-installation');
    expect(claimed.integrationOwnerLabel).toBeTruthy();
    expect(service.isOwner(claimed)).toBeTrue();
  });
});
