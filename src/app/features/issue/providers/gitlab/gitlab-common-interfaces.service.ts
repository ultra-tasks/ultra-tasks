import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Task } from 'src/app/features/tasks/task.model';
import { BaseIssueProviderService } from '../../base/base-issue-provider.service';
import { IssueData, SearchResultItem } from '../../issue.model';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { GitlabCfg } from './gitlab.model';
import { GitlabIssue } from './gitlab-issue.model';
import { truncate } from '../../../../util/truncate';
import { GITLAB_BASE_URL, GITLAB_POLL_INTERVAL } from './gitlab.const';
import { GitlabSyncAdapterService } from './gitlab-sync-adapter.service';
import { computeFieldPullChanges } from '../../two-way-sync/compute-field-pull';
import { integrationSyncPolicy } from '../../../integrations/integration.model';

type FreshGitlabTask = {
  taskChanges: Partial<Task>;
  issue: GitlabIssue;
  issueTitle: string;
};

@Injectable({
  providedIn: 'root',
})
export class GitlabCommonInterfacesService extends BaseIssueProviderService<GitlabCfg> {
  private readonly _gitlabApiService = inject(GitlabApiService);
  private readonly _syncAdapter = inject(GitlabSyncAdapterService);

  readonly providerKey = 'GITLAB' as const;
  readonly pollInterval: number = GITLAB_POLL_INTERVAL;

  isEnabled(cfg: GitlabCfg): boolean {
    return !!cfg && cfg.isEnabled && !!cfg.project;
  }

  testConnection(cfg: GitlabCfg): Promise<boolean> {
    return firstValueFrom(
      this._gitlabApiService
        .searchIssueInProject$('', cfg)
        .pipe(map((res) => Array.isArray(res))),
    ).then((result) => result ?? false);
  }

  issueLink(issueId: string, issueProviderId: string): Promise<string> {
    return firstValueFrom(
      this._getCfgOnce$(issueProviderId).pipe(
        map((cfg) => {
          const project: string | null = cfg.project;

          if (!project) {
            return '';
          }

          // Extract just the numeric issue ID from formats like 'project/repo#123' or '#123'
          const cleanIssueId = issueId.toString().replace(/^.*#/, '');

          if (cfg.gitlabBaseUrl) {
            const fixedUrl = cfg.gitlabBaseUrl.match(/.*\/$/)
              ? cfg.gitlabBaseUrl
              : `${cfg.gitlabBaseUrl}/`;
            return `${fixedUrl}${project}/-/issues/${cleanIssueId}`;
          } else {
            return `${GITLAB_BASE_URL}${project}/-/issues/${cleanIssueId}`;
          }
        }),
      ),
    ).then((result) => result ?? '');
  }

  getAddTaskData(issue: GitlabIssue): Partial<Task> & { title: string } {
    return {
      title: this._formatIssueTitle(issue),
      issuePoints: issue.weight,
      issueWasUpdated: false,
      issueLastUpdated: new Date(issue.updated_at).getTime(),
      issueId: issue.id,
      isDone: issue.state === 'closed',
      dueDay: issue.due_date || undefined,
      issueLastSyncedValues: this._syncAdapter.extractSyncValues({ ...issue }),
    };
  }

  getAddTaskDataForCfg(
    issue: GitlabIssue,
    cfg: GitlabCfg,
  ): Partial<Task> & { title: string } {
    const direction = cfg.integrationFieldPolicy?.notes;
    return {
      ...this.getAddTaskData(issue),
      ...(direction === 'pullOnly' || direction === 'both'
        ? { notes: issue.body ?? '' }
        : {}),
    };
  }

  override async getFreshDataForIssueTask(task: Task): Promise<FreshGitlabTask | null> {
    if (!task.issueProviderId || !task.issueId)
      throw new Error('No linked GitLab issue.');
    const cfg = await firstValueFrom(this._getCfgOnce$(task.issueProviderId));
    // Existing connections keep the completion behavior of #9909. New field
    // directions are explicit, through the shared integration policy controls.
    if (!cfg.integrationFieldPolicy)
      return super.getFreshDataForIssueTask(task) as Promise<FreshGitlabTask | null>;
    const issue = await firstValueFrom(
      this._gitlabApiService.getById$(task.issueId, cfg),
    );
    const wasUpdated = this._wasUpdated(task, issue);
    const addTaskData = { ...this.getAddTaskData(issue) };
    delete addTaskData.dueDay;
    const taskChanges = computeFieldPullChanges({
      task,
      wasUpdated,
      issueValues: this._syncAdapter.extractSyncValues({ ...issue }),
      addTaskData,
      fieldMappings: this._syncAdapter.getFieldMappings(),
      syncConfig: integrationSyncPolicy(task, this._syncAdapter, cfg),
      ctx: { issueId: issue.id, issueNumber: issue.number },
      isPullOnlyAuthoritative: false,
    });
    return taskChanges
      ? {
          taskChanges: { ...taskChanges, issueWasUpdated: true },
          issue,
          issueTitle: this._formatIssueTitleForSnack(issue),
        }
      : null;
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    _allExistingIssueIds: number[] | string[],
  ): Promise<IssueData[]> {
    const cfg = await firstValueFrom(this._getCfgOnce$(issueProviderId));
    return await firstValueFrom(this._gitlabApiService.getProjectIssues$(cfg));
  }

  protected _apiGetById$(
    id: string | number,
    cfg: GitlabCfg,
  ): Observable<IssueData | null> {
    return this._gitlabApiService.getById$(id.toString(), cfg);
  }

  protected _apiSearchIssues$(
    searchTerm: string,
    cfg: GitlabCfg,
  ): Observable<SearchResultItem[]> {
    return this._gitlabApiService.searchIssueInProject$(searchTerm, cfg);
  }

  protected _formatIssueTitleForSnack(issue: IssueData): string {
    return truncate(this._formatIssueTitle(issue as GitlabIssue));
  }

  protected _getIssueLastUpdated(issue: IssueData): number {
    return new Date((issue as GitlabIssue).updated_at).getTime();
  }

  private _formatIssueTitle(issue: GitlabIssue): string {
    return `#${issue.number} ${issue.title}`;
  }
}
