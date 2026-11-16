import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IssueSyncAdapter } from '../../two-way-sync/issue-sync-adapter.interface';
import { FieldMapping, FieldSyncConfig } from '../../two-way-sync/issue-sync.model';
import { GitlabApiService } from './gitlab-api/gitlab-api.service';
import { GitlabCfg } from './gitlab.model';

const MAPPINGS: FieldMapping[] = [
  {
    taskField: 'isDone',
    issueField: 'state',
    defaultDirection: 'off',
    toIssueValue: (value) => (value ? 'closed' : 'opened'),
    toTaskValue: (value) => value === 'closed',
  },
  {
    taskField: 'title',
    issueField: 'title',
    defaultDirection: 'pullOnly',
    toIssueValue: (value, ctx) => {
      const title = String(value ?? '');
      const prefix = `#${ctx.issueNumber ?? ctx.issueId.split('#').pop()} `;
      return title.startsWith(prefix) ? title.slice(prefix.length) : title;
    },
    toTaskValue: (value, ctx) => {
      const title = String(value ?? '');
      const prefix = `#${ctx.issueNumber ?? ctx.issueId.split('#').pop()} `;
      return title.startsWith(prefix) ? title : prefix + title;
    },
  },
  {
    taskField: 'notes',
    issueField: 'body',
    defaultDirection: 'off',
    toIssueValue: (value) => value ?? '',
    toTaskValue: (value) => value ?? '',
  },
];

@Injectable({ providedIn: 'root' })
export class GitlabSyncAdapterService implements IssueSyncAdapter<GitlabCfg> {
  private readonly _api = inject(GitlabApiService);

  getFieldMappings(): FieldMapping[] {
    return MAPPINGS;
  }
  getSyncConfig(cfg: GitlabCfg): FieldSyncConfig {
    return cfg.integrationFieldPolicy ?? {};
  }
  async fetchIssue(id: string, cfg: GitlabCfg): Promise<Record<string, unknown>> {
    return { ...(await firstValueFrom(this._api.getById$(id, cfg))) };
  }
  async pushChanges(
    id: string,
    changes: Record<string, unknown>,
    cfg: GitlabCfg,
  ): Promise<Record<string, unknown>> {
    return { ...(await firstValueFrom(this._api.updateIssue$(id, changes, cfg))) };
  }
  extractSyncValues(issue: Record<string, unknown>): Record<string, unknown> {
    return { state: issue.state, title: issue.title, body: issue.body };
  }
  getIssueLastUpdated(issue: Record<string, unknown>): number {
    return Date.parse(String(issue.updated_at));
  }
  async createIssue(
    title: string,
    cfg: GitlabCfg,
  ): Promise<{
    issueId: string;
    issueNumber: number;
    issueData: Record<string, unknown>;
  }> {
    const issue = await firstValueFrom(this._api.createIssue$(title, cfg));
    return { issueId: issue.id, issueNumber: issue.number, issueData: { ...issue } };
  }
}
