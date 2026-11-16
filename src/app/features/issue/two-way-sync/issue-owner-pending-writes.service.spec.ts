import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DEFAULT_TASK } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { IssueProviderService } from '../issue-provider.service';
import { IssueProviderOwnershipService } from '../issue-provider-ownership.service';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { IssueSyncStateService } from './issue-sync-state.service';
import { IssueOwnerPendingWritesService } from './issue-owner-pending-writes.service';

describe('IssueOwnerPendingWritesService', () => {
  const task = {
    ...DEFAULT_TASK,
    projectId: 'test-project',
    id: 'task-1',
    title: 'Peer edit',
    issueType: 'GITHUB' as const,
    issueProviderId: 'connection-1',
    issueId: '42',
    issueLastSyncedValues: { title: 'Source title' },
  };
  let service: IssueOwnerPendingWritesService;
  let tasks: jasmine.SpyObj<TaskService>;
  let ownership: jasmine.SpyObj<IssueProviderOwnershipService>;
  let sync: jasmine.SpyObj<IssueSyncStateService>;
  beforeEach(() => {
    tasks = jasmine.createSpyObj('Tasks', ['getByIdOnce$']);
    tasks.getByIdOnce$.and.returnValue(of(task));
    ownership = jasmine.createSpyObj('Ownership', ['isOwner']);
    ownership.isOwner.and.returnValue(true);
    sync = jasmine.createSpyObj('Sync', ['pushPending']);
    sync.pushPending.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: TaskService, useValue: tasks },
        { provide: IssueProviderOwnershipService, useValue: ownership },
        { provide: IssueSyncStateService, useValue: sync },
        {
          provide: IssueProviderService,
          useValue: { getCfgOnce$: () => of({ integrationOwnerId: 'owner' }) },
        },
        {
          provide: IssueSyncAdapterResolverService,
          useValue: {
            getAdapter: () => ({
              getFieldMappings: () => [
                {
                  taskField: 'title',
                  issueField: 'title',
                  defaultDirection: 'both',
                  toIssueValue: (value: unknown) => value,
                },
              ],
              getSyncConfig: () => ({}),
            }),
          },
        },
      ],
    });
    service = TestBed.inject(IssueOwnerPendingWritesService);
  });
  it('drains the current local value after a source refresh, including a peer edit', async () => {
    await service.flush([task]);
    expect(sync.pushPending).toHaveBeenCalledOnceWith(task.id);
  });
  it('does not contact a source from a peer installation', async () => {
    ownership.isOwner.and.returnValue(false);
    await service.flush([task]);
    expect(sync.pushPending).not.toHaveBeenCalled();
  });
  it('does not send an acknowledged or stopped task', async () => {
    tasks.getByIdOnce$.and.returnValue(of({ ...task, title: 'Source title' }));
    await service.flush([task]);
    tasks.getByIdOnce$.and.returnValue(of({ ...task, issueId: '' }));
    await service.flush([task]);
    expect(sync.pushPending).not.toHaveBeenCalled();
  });
});
