import { inject, Injectable } from '@angular/core';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { IssueSyncAdapterResolverService } from '../issue/two-way-sync/issue-sync-adapter-resolver.service';
import { IssueProvider, IssueProviderKey } from '../issue/issue.model';
import { FieldMapping, SyncDirection } from '../issue/two-way-sync/issue-sync.model';
import { ISSUE_PROVIDER_HUMANIZED } from '../issue/issue.const';
import { T } from '../../t.const';

export interface IntegrationField {
  key: string;
  label: string;
  remoteField: string;
  defaultDirection: SyncDirection;
  canWrite: boolean;
}

@Injectable({ providedIn: 'root' })
export class IntegrationCapabilityService {
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _adapters = inject(IssueSyncAdapterResolverService);
  readonly version = this._registry.registrationVersion;

  name(key: IssueProviderKey): string {
    this.version();
    return (
      (this._registry.hasProvider(key)
        ? this._registry.getName(key)
        : ISSUE_PROVIDER_HUMANIZED[key]) || key
    );
  }

  isCalendar(key: IssueProviderKey): boolean {
    this.version();
    return key === 'ICAL' || this._registry.getUseAgendaView(key);
  }

  fields(provider: IssueProvider): IntegrationField[] {
    this.version();
    const definition = this._registry.getProvider(provider.issueProviderKey)?.definition;
    const adapter = this._adapters.getAdapter(provider.issueProviderKey);
    const writable =
      !!definition?.updateIssue ||
      ['CALDAV', 'PLAINSPACE'].includes(provider.issueProviderKey);
    const configured = {
      ...adapter?.getSyncConfig(provider),
      ...provider.integrationFieldPolicy,
    };
    const mappings: Pick<
      FieldMapping,
      'taskField' | 'issueField' | 'defaultDirection'
    >[] = definition?.fieldMappings?.length
      ? (definition.fieldMappings as FieldMapping[])
      : (adapter?.getFieldMappings() ?? [
          { taskField: 'title', issueField: 'title', defaultDirection: 'pullOnly' },
        ]);
    const labels: Record<string, string> = {
      title: T.F.INTEGRATIONS.FIELD_TITLE,
      isDone: T.F.INTEGRATIONS.FIELD_COMPLETION,
      notes: T.F.INTEGRATIONS.FIELD_NOTES,
      dueWithTime: T.F.INTEGRATIONS.FIELD_START,
      dueDay: T.F.INTEGRATIONS.FIELD_DATE,
      timeEstimate: T.F.INTEGRATIONS.FIELD_DURATION,
      tagIds: T.F.INTEGRATIONS.FIELD_TAGS,
    };
    return mappings.map((m) => {
      let direction = configured[m.taskField] ?? m.defaultDirection;
      if (!writable && (direction === 'both' || direction === 'pushOnly'))
        direction = 'pullOnly';
      return {
        key: m.taskField,
        label: labels[m.taskField] ?? m.taskField,
        remoteField: m.issueField,
        defaultDirection: direction,
        canWrite: writable,
      };
    });
  }

  quirk(key: IssueProviderKey): string {
    return integrationQuirk(key, this.isCalendar(key));
  }
}

export const integrationQuirk = (key: IssueProviderKey, isCalendar = false): string => {
  const quirks: Partial<Record<IssueProviderKey, string>> = {
    TRELLO: T.F.INTEGRATIONS.Q_TRELLO,
    PLAINSPACE: T.F.INTEGRATIONS.Q_PLAINSPACE,
    JIRA: T.F.INTEGRATIONS.Q_JIRA,
    ICAL: T.F.INTEGRATIONS.Q_ICAL,
    GITHUB: T.F.INTEGRATIONS.Q_GITHUB,
    GITLAB: T.F.INTEGRATIONS.Q_GITLAB,
    NEXTCLOUD_DECK: T.F.INTEGRATIONS.Q_DECK,
  };
  if (isCalendar) return quirks[key] ?? T.F.INTEGRATIONS.Q_CALENDAR;
  return quirks[key] ?? T.F.INTEGRATIONS.Q_READ_ONLY;
};
