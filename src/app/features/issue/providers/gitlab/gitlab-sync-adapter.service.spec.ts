import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SnackService } from '../../../../core/snack/snack.service';
import { GitlabSyncAdapterService } from './gitlab-sync-adapter.service';
import { GitlabCfg } from './gitlab.model';

const CFG: GitlabCfg = {
  isEnabled: true,
  project: 'group/sub/project',
  filterUsername: null,
  token: 'synthetic-token',
  gitlabBaseUrl: 'https://gitlab.example.test/',
};
const ISSUE = {
  id: 900,
  iid: 42,
  title: 'Remote title',
  description: 'Remote notes',
  state: 'opened',
  weight: 5,
  updated_at: '2026-11-15T10:00:00Z',
  labels: [],
  web_url: 'https://gitlab.example.test/group/sub/project/-/issues/42',
  references: { full: 'group/sub/project#42' },
  _links: {},
};
const BASE = 'https://gitlab.example.test/api/v4/projects/group%2Fsub%2Fproject/issues';

describe('GitlabSyncAdapterService real HTTP boundary', () => {
  let adapter: GitlabSyncAdapterService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SnackService, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    adapter = TestBed.inject(GitlabSyncAdapterService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('writes status, title and description using a project-scoped issue iid', async () => {
    const result = adapter.pushChanges(
      'group/sub/project#42',
      {
        state: 'closed',
        title: 'Local title',
        body: '',
        weight: 99,
      },
      CFG,
    );
    const request = http.expectOne(`${BASE}/42`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('PRIVATE-TOKEN')).toBe('synthetic-token');
    expect(request.request.body).toEqual({
      state_event: 'close',
      title: 'Local title',
      description: '',
    });
    request.flush({ ...ISSUE, state: 'closed' });
    expect(await result).toEqual(
      jasmine.objectContaining({ id: 'group/sub/project#42', weight: 5 }),
    );
  });

  it('reopens with the GitLab state event rather than writing the read-only state', async () => {
    const result = adapter.pushChanges('group/sub/project#42', { state: 'open' }, CFG);
    const request = http.expectOne(`${BASE}/42`);
    expect(request.request.body).toEqual({ state_event: 'reopen' });
    request.flush(ISSUE);
    await result;
  });

  it('resolves a numeric project id before allowing a namespace-qualified write', async () => {
    const result = adapter.pushChanges(
      'group/sub/project#42',
      { title: 'New' },
      { ...CFG, project: '900' },
    );
    http
      .expectOne('https://gitlab.example.test/api/v4/projects/900')
      .flush({ path_with_namespace: 'group/sub/project' });
    http.expectOne(`${BASE}/42`).flush(ISSUE);
    await result;
  });

  it('creates in the selected project and retains qualified identity and weight', async () => {
    const result = adapter.createIssue('New title', CFG);
    const request = http.expectOne(BASE);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'New title' });
    request.flush(ISSUE);
    expect(await result).toEqual(
      jasmine.objectContaining({
        issueId: 'group/sub/project#42',
        issueNumber: 42,
        issueData: jasmine.objectContaining({ weight: 5 }),
      }),
    );
  });

  it('rejects a write to an issue in a different project without making a request', async () => {
    await expectAsync(
      adapter.pushChanges('another/project#42', { title: 'New' }, CFG),
    ).toBeRejected();
  });

  it('propagates revoked permission errors without acknowledging the write', async () => {
    const result = adapter.pushChanges('group/sub/project#42', { title: 'New' }, CFG);
    const rejection = expectAsync(result).toBeRejected();
    http.expectOne(`${BASE}/42`).flush({}, { status: 403, statusText: 'Forbidden' });
    await rejection;
  });

  it('defaults to receiving status/title, keeps notes off, and does not map weight to time', () => {
    const mappings = adapter.getFieldMappings();
    expect(
      mappings.map((mapping) => [mapping.taskField, mapping.defaultDirection]),
    ).toEqual([
      ['isDone', 'off'],
      ['title', 'pullOnly'],
      ['notes', 'off'],
    ]);
    const title = mappings.find((mapping) => mapping.taskField === 'title')!;
    expect(mappings[0].toIssueValue(false, { issueId: 'group/sub/project#42' })).toBe(
      'opened',
    );
    const ctx = { issueId: 'group/sub/project#42', issueNumber: 42 };
    expect(title.toIssueValue('#42 Local title', ctx)).toBe('Local title');
    expect(title.toTaskValue('Remote title', ctx)).toBe('#42 Remote title');
    expect(
      adapter.getSyncConfig({ ...CFG, integrationFieldPolicy: { title: 'both' } }),
    ).toEqual({ title: 'both' });
  });
});
