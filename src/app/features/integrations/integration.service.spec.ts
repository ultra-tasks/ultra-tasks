import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { IntegrationService } from './integration.service';
import { TaskService } from '../tasks/task.service';
import { IssueService } from '../issue/issue.service';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import {
  selectAllTasks,
  selectCurrentTaskId,
  selectTaskEntities,
} from '../tasks/store/task.selectors';
import { selectAll as selectProviders } from '../issue/store/issue-provider.selectors';
import { IssueProvider } from '../issue/issue.model';

// Real task shapes and reactive state, with API calls isolated at the service boundary.
describe('Integration lifecycle', () => {
  const tasks = signal<Task[]>([]);
  const providers = signal<IssueProvider[]>([]);
  let service: IntegrationService;
  let dispatch: jasmine.Spy;
  let updateUi: jasmine.Spy;
  let refresh: jasmine.Spy;
  let pause: jasmine.Spy;
  const currentId = signal<string | null>(null);
  beforeEach(() => {
    tasks.set([
      {
        ...DEFAULT_TASK,
        id: 'one',
        projectId: 'project',
        issueProviderId: 'source',
        issueType: 'GITHUB',
        issueId: '142',
        notes: 'Private notes',
        timeSpent: 9000,
      },
    ]);
    providers.set([
      {
        id: 'source',
        isEnabled: true,
        issueProviderKey: 'GITHUB',
        pluginId: 'github-issue-provider',
        pluginConfig: {},
      },
    ]);
    currentId.set(null);
    dispatch = jasmine.createSpy('dispatch');
    updateUi = jasmine
      .createSpy('updateUi')
      .and.callFake((id: string, changes: Partial<Task>) =>
        tasks.update((all) => all.map((t) => (t.id === id ? { ...t, ...changes } : t))),
      );
    refresh = jasmine.createSpy('refreshIssueTask').and.resolveTo();
    pause = jasmine.createSpy('pauseCurrent');
    const entities = computed(() => Object.fromEntries(tasks().map((t) => [t.id, t])));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Store,
          useValue: {
            dispatch,
            selectSignal: (selector: unknown) => {
              if (selector === selectAllTasks) return tasks;
              if (selector === selectProviders) return providers;
              if (selector === selectTaskEntities) return entities;
              if (selector === selectCurrentTaskId) return currentId;
              throw new Error('Unexpected selector');
            },
          },
        },
        { provide: TaskService, useValue: { updateUi, pauseCurrent: pause } },
        {
          provide: IssueService,
          useValue: {
            getById: () => Promise.resolve({ id: '142' }),
            refreshIssueTask: refresh,
          },
        },
        { provide: ProjectService, useValue: { add: () => 'new-project' } },
        { provide: TagService, useValue: {} },
      ],
    });
    service = TestBed.inject(IntegrationService);
  });
  it('stops tracking while retaining local work and a persistent source exclusion', () => {
    service.stop(['one']);
    expect(tasks()[0].issueId).toBe('');
    expect(tasks()[0].issueProviderId).toBe('');
    expect(tasks()[0].notes).toBe('Private notes');
    expect(tasks()[0].timeSpent).toBe(9000);
    expect(tasks()[0].integration).toEqual(
      jasmine.objectContaining({ mode: 'import', stopped: true, remoteId: '142' }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
  it('hides a running task without clearing its remote identity', () => {
    currentId.set('one');
    service.setHidden(['one'], true);
    expect(pause).toHaveBeenCalled();
    expect(tasks()[0].issueId).toBe('142');
    expect(tasks()[0].integration?.hidden).toBeTrue();
    service.setHidden(['one'], false);
    expect(tasks()[0].integration?.hidden).toBeFalse();
  });
  it('resumes the same task after fetching a source baseline', async () => {
    service.stop(['one']);
    await service.resume('one');
    expect(tasks()[0].id).toBe('one');
    expect(tasks()[0].issueId).toBe('142');
    expect(tasks()[0].integration?.stopped).toBeFalse();
    expect(tasks()[0].issueLastSyncedValues).toEqual({});
    expect(refresh).toHaveBeenCalled();
  });
  it('keeps stopped tasks detached when a connection is unavailable', async () => {
    service.stop(['one']);
    providers.set([]);
    await expectAsync(service.resume('one')).toBeRejected();
    expect(tasks()[0].issueId).toBe('');
    expect(tasks()[0].integration?.stopped).toBeTrue();
  });
  it('disables automatic import and outbound creation for an Import connection', () => {
    const saved = service.saveConnection(
      { ...providers()[0], isAutoPoll: true, isAutoAddToBacklog: true },
      'import',
      'Source project',
      '',
    );
    expect(saved.isAutoPoll).toBeFalse();
    expect(saved.isAutoAddToBacklog).toBeFalse();
    expect(saved.defaultProjectId).toBe('new-project');
    expect(dispatch).toHaveBeenCalled();
  });
});
