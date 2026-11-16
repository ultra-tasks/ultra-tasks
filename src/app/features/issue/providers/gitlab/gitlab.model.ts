import { BaseIssueProviderCfg } from '../../issue.model';

export interface GitlabCfg extends BaseIssueProviderCfg {
  /** Explicit creation opt-in; absent on older persisted connections means false. */
  isAutoCreateIssues?: boolean;
  project: string | null;
  filterUsername: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  gitlabBaseUrl?: string | null;
  token: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  scope?: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  filter?: string | null;
  /** @deprecated backwards compatibility: optional for persisted data created before this field existed */
  isEnableTimeTracking?: boolean;
}
