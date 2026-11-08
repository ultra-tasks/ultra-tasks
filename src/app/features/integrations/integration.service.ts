import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from '../tasks/task.service';
import {
  selectAllTasks,
  selectTaskEntities,
  selectCurrentTaskId,
} from '../tasks/store/task.selectors';
import { selectAll as selectProviders } from '../issue/store/issue-provider.selectors';
import { IssueService } from '../issue/issue.service';
import { IssueProvider, SearchResultItem } from '../issue/issue.model';
import { IssueProviderActions } from '../issue/store/issue-provider.actions';
import { Task } from '../tasks/task.model';
import { FieldSyncConfig } from '../issue/two-way-sync/issue-sync.model';
import { integrationForTask, IntegrationMode } from './integration.model';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { saveAs } from 'file-saver';
import { createIntegrationCalendar } from './integration-calendar';

@Injectable({ providedIn: 'root' })
export class IntegrationService {
  private readonly _store = inject(Store);
  private readonly _tasks = inject(TaskService);
  private readonly _issues = inject(IssueService);
  private readonly _projects = inject(ProjectService);
  private readonly _tags = inject(TagService);
  readonly tasks = this._store.selectSignal(selectAllTasks);
  readonly entities = this._store.selectSignal(selectTaskEntities);
  readonly providers = this._store.selectSignal(selectProviders);
  private readonly _currentId = this._store.selectSignal(selectCurrentTaskId);

  saveConnection(
    provider: IssueProvider,
    mode: IntegrationMode,
    projectName: string,
    projectId: string,
  ): IssueProvider {
    const defaultProjectId =
      projectId ||
      (projectName.trim()
        ? this._projects.add({ title: projectName.trim() })
        : provider.defaultProjectId);
    const configured: IssueProvider = {
      ...provider,
      defaultProjectId,
      integrationMode: mode,
      ...(mode === 'import' ? { isAutoPoll: false, isAutoAddToBacklog: false } : {}),
    };
    if (mode === 'import' && 'pluginConfig' in configured) {
      configured.pluginConfig = {
        ...configured.pluginConfig,
        isAutoTimeBlock: false,
        isAutoCreateIssues: false,
      };
    }
    if (mode === 'import' && configured.issueProviderKey === 'ICAL')
      configured.isAutoImportForCurrentDay = false;
    if (this.providers().some((p) => p.id === provider.id)) {
      this._store.dispatch(
        IssueProviderActions.updateIssueProvider({
          issueProvider: { id: configured.id, changes: configured },
        }),
      );
    } else
      this._store.dispatch(
        IssueProviderActions.addIssueProvider({ issueProvider: configured }),
      );
    return configured;
  }

  setHidden(ids: string[], hidden: boolean): void {
    for (const id of ids) {
      const task = this.entities()[id];
      const link = task && integrationForTask(task);
      if (!task || !link) continue;
      if (
        hidden &&
        (this._currentId() === id || task.subTaskIds.includes(this._currentId() ?? ''))
      )
        this._tasks.pauseCurrent();
      this._tasks.updateUi(id, { integration: { ...link, hidden } });
    }
  }

  stop(ids: string[]): void {
    for (const id of ids) {
      const task = this.entities()[id];
      const link = task && integrationForTask(task);
      if (!task || !link) continue;
      // Empty legacy IDs also stop clients predating clearedFields; current clients clear the type.
      // updateUi does not fire task deletion, transition, worklog or time-block effects.
      this._tasks.updateUi(id, {
        issueId: '',
        issueProviderId: '',
        issueType: undefined,
        integration: { ...link, mode: 'import', stopped: true },
      });
    }
  }

  async resume(id: string): Promise<void> {
    const task = this.entities()[id];
    const link = task && integrationForTask(task);
    if (!task || !link) return;
    const provider = this.providers().find((p) => p.id === link.providerId);
    if (!provider?.isEnabled) throw new Error('Connection is unavailable');
    // Fetch before attaching. Failure leaves the snapshot/stopped relationship intact.
    const remote = await this._issues.getById(
      link.providerKey,
      link.remoteId,
      link.providerId,
    );
    if (!remote && link.providerKey !== 'ICAL')
      throw new Error('Source item is unavailable');
    const current = this.entities()[id];
    if (current?.integration !== task.integration) return;
    this._tasks.updateUi(id, {
      issueId: link.remoteId,
      issueProviderId: link.providerId,
      issueType: link.providerKey,
      issueLastUpdated: 0,
      issueLastSyncedValues: {},
      integration: { ...link, mode: 'sync', stopped: false },
    });
    await this._issues.refreshIssueTask(this.entities()[id]!);
  }

  setFieldPolicy(id: string, fieldPolicy: FieldSyncConfig): void {
    const task = this.entities()[id];
    const link = task && integrationForTask(task);
    if (link) this._tasks.updateUi(id, { integration: { ...link, fieldPolicy } });
  }

  setPinnedSearch(id: string, pinnedSearch: string): void {
    this._store.dispatch(
      IssueProviderActions.updateIssueProvider({
        issueProvider: { id, changes: { pinnedSearch } },
      }),
    );
  }

  async addItem(
    item: SearchResultItem,
    provider: IssueProvider,
    mode: IntegrationMode,
    importTags: boolean,
  ): Promise<string | undefined> {
    let tagIds: string[] = [];
    if (importTags) {
      const detail = await this._issues.getById(
        provider.issueProviderKey,
        String(item.issueData.id),
        provider.id,
      );
      const labels = detail && 'labels' in detail ? detail.labels : [];
      if (Array.isArray(labels)) {
        tagIds = labels.flatMap((label: unknown) => {
          const name =
            typeof label === 'string'
              ? label
              : label && typeof label === 'object' && 'name' in label
                ? String(label.name)
                : '';
          if (!name) return [];
          // Namespace imported tags so equal labels in different connections are not merged.
          const title = `${provider.id.slice(0, 6)} / ${name}`;
          const existing = this._tags
            .tagsNoMyDayAndNoListSorted()
            .find((tag) => tag.title === title);
          return [existing?.id ?? this._tags.addTag({ title })];
        });
      }
    }
    return this._issues.addTaskFromIssue({
      issueDataReduced: item.issueData,
      issueProviderId: provider.id,
      issueProviderKey: provider.issueProviderKey,
      isForceDefaultProject: true,
      additional: {
        ...(tagIds.length ? { tagIds } : {}),
        integration: {
          providerId: provider.id,
          providerKey: provider.issueProviderKey,
          remoteId: String(item.issueData.id),
          mode,
        },
      },
    });
  }

  openTask(task: Task): void {
    this._tasks.setSelectedId(task.id);
  }
  exportCalendar(ids: string[]): void {
    const tasks = ids.map((id) => this.entities()[id]).filter((t): t is Task => !!t);
    saveAs(
      new Blob([createIntegrationCalendar(tasks)], {
        type: 'text/calendar;charset=utf-8',
      }),
      'ultratasks.ics',
    );
  }
}
