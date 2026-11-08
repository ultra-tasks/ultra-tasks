import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { IntegrationService } from './integration.service';
import { IntegrationCapabilityService } from './integration-capability.service';
import { IntegrationSetupComponent } from './integration-setup.component';
import { IntegrationItemDialogComponent } from './integration-item-dialog.component';
import {
  integrationForTask,
  IntegrationMode,
  visibleIntegrationTask,
  TaskIntegration,
} from './integration.model';
import { IssueService } from '../issue/issue.service';
import { IssueProvider, SearchResultItem } from '../issue/issue.model';
import { Task } from '../tasks/task.model';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { DialogEditIssueProviderComponent } from '../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { getIssueProviderTooltip } from '../issue/mapping-helper/get-issue-provider-tooltip';
import { T } from '../../t.const';

type IntegrationFilter = 'all' | 'sync' | 'import' | 'hidden' | 'stopped';

@Component({
  selector: 'integrations-page',
  standalone: true,
  imports: [FormsModule, MatButton, MatIcon, TranslatePipe, IntegrationSetupComponent],
  templateUrl: './integrations-page.component.html',
  styleUrl: './integrations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationsPageComponent {
  readonly I = T.F.INTEGRATIONS;
  readonly data = inject(IntegrationService);
  readonly capabilities = inject(IntegrationCapabilityService);
  private readonly _issues = inject(IssueService);
  private readonly _dialog = inject(MatDialog);
  private readonly _projects = inject(Store).selectSignal(selectProjectFeatureState);
  readonly setup = signal(false);
  readonly filter = signal<IntegrationFilter>('all');
  readonly search = signal('');
  readonly providerId = signal('');
  readonly selected = signal<Set<string>>(new Set());
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly result = signal(false);
  readonly browseProvider = signal<IssueProvider | null>(null);
  readonly sourceSearch = signal('');
  readonly sourceItems = signal<SearchResultItem[]>([]);
  readonly selectedSource = signal<Set<string>>(new Set());
  readonly browseMode = signal<IntegrationMode>('sync');
  readonly copyTags = signal(false);
  readonly tabs: { key: IntegrationFilter; label: string }[] = [
    { key: 'all', label: this.I.ALL },
    { key: 'sync', label: this.I.SYNCED },
    { key: 'import', label: this.I.IMPORTED },
    { key: 'hidden', label: this.I.HIDDEN },
    { key: 'stopped', label: this.I.STOPPED },
  ];
  readonly rows = computed(() =>
    this.data.tasks().flatMap((task) => {
      const link = integrationForTask(task);
      if (!link) return [];
      return [
        {
          task,
          link,
          hidden: !visibleIntegrationTask(task, this.data.entities()),
          project: this._projects().entities[task.projectId]?.title ?? '',
          provider: this.data.providers().find((p) => p.id === link.providerId),
        },
      ];
    }),
  );
  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      all: rows.filter((r) => !r.hidden && !r.link.stopped).length,
      sync: rows.filter((r) => !r.hidden && !r.link.stopped && r.link.mode === 'sync')
        .length,
      import: rows.filter((r) => !r.hidden && !r.link.stopped && r.link.mode === 'import')
        .length,
      hidden: rows.filter((r) => r.hidden).length,
      stopped: rows.filter((r) => r.link.stopped).length,
    };
  });
  readonly filteredRows = computed(() =>
    this.rows().filter((row) => {
      const f = this.filter();
      const query = this.search().trim().toLowerCase();
      return (
        (!this.providerId() || row.link.providerId === this.providerId()) &&
        (f === 'hidden'
          ? row.hidden
          : f === 'stopped'
            ? row.link.stopped
            : !row.hidden && !row.link.stopped && (f === 'all' || row.link.mode === f)) &&
        (!query ||
          `${row.task.title} ${row.project} ${this.capabilities.name(row.link.providerKey)} ${row.link.remoteId}`
            .toLowerCase()
            .includes(query))
      );
    }),
  );
  readonly groups = computed(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        provider?: IssueProvider;
        scope: string;
        sections: {
          mode: IntegrationMode;
          rows: {
            task: Task;
            link: TaskIntegration;
            hidden: boolean;
            project: string;
            provider: IssueProvider | undefined;
          }[];
        }[];
      }
    >();
    for (const row of this.filteredRows()) {
      let group = groups.get(row.link.providerId);
      if (!group) {
        group = {
          id: row.link.providerId,
          provider: row.provider,
          name: this.capabilities.name(row.link.providerKey),
          scope: row.provider ? getIssueProviderTooltip(row.provider) : '',
          sections: [],
        };
        groups.set(group.id, group);
      }
      let section = group.sections.find((s) => s.mode === row.link.mode);
      if (!section) {
        section = { mode: row.link.mode, rows: [] };
        group.sections.push(section);
      }
      section.rows.push(row);
    }
    return [...groups.values()];
  });
  readonly hasCalendar = computed(() =>
    this.data.providers().some((p) => this.capabilities.isCalendar(p.issueProviderKey)),
  );

  newSet(): Set<string> {
    return new Set<string>();
  }
  selectedIds(): string[] {
    return [...this.selected()];
  }
  changeFilter(filter: IntegrationFilter): void {
    this.filter.set(filter);
    this.selected.set(new Set());
  }
  select(id: string, checked: boolean): void {
    this.selected.update((selected) => {
      const next = new Set(selected);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  selectAll(): void {
    this.selected.set(new Set(this.filteredRows().map((r) => r.task.id)));
  }
  hide(): void {
    this.data.setHidden([...this.selected()], this.filter() !== 'hidden');
    this.selected.set(new Set());
  }
  async refresh(): Promise<void> {
    await this.run(async () => {
      for (const id of this.selected()) {
        const task = this.data.entities()[id];
        if (task?.issueId && task.issueProviderId)
          await this._issues.refreshIssueTask(task, false);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.selected().size) return;
    const confirmed = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          data: {
            message: this.I.STOP_HELP,
            okTxt: this.I.STOP,
            cancelTxt: this.I.CANCEL,
          },
        })
        .afterClosed(),
    );
    if (confirmed) {
      this.data.stop([...this.selected()]);
      this.selected.set(new Set());
      this.result.set(true);
    }
  }
  async resume(): Promise<void> {
    const confirmed = await firstValueFrom(
      this._dialog
        .open(DialogConfirmComponent, {
          data: {
            message: this.I.RESUME_HELP,
            okTxt: this.I.RESUME,
            cancelTxt: this.I.CANCEL,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) return;
    await this.run(async () => {
      for (const id of this.selected()) await this.data.resume(id);
      this.selected.set(new Set());
    });
  }
  policy(task: Task, provider: IssueProvider): void {
    this._dialog.open(IntegrationItemDialogComponent, { data: { task, provider } });
  }
  settings(provider: IssueProvider): void {
    this._dialog.open(DialogEditIssueProviderComponent, {
      data: { issueProvider: provider },
      restoreFocus: true,
    });
  }
  connected(provider: IssueProvider): void {
    this.setup.set(false);
    this.openSource(provider);
  }
  openSource(provider: IssueProvider): void {
    this.browseProvider.set(provider);
    this.sourceItems.set([]);
    this.selectedSource.set(new Set());
    this.browseMode.set(provider.integrationMode ?? 'sync');
    this.sourceSearch.set(provider.pinnedSearch ?? '');
  }
  async searchSource(): Promise<void> {
    const provider = this.browseProvider();
    if (!provider) return;
    await this.run(async () => {
      const items = await this._issues.searchIssues(
        this.sourceSearch(),
        provider.id,
        provider.issueProviderKey,
      );
      const ids = new Set(
        this.rows()
          .filter((r) => r.link.providerId === provider.id)
          .map((r) => r.link.remoteId),
      );
      this.sourceItems.set(items.filter((i) => !ids.has(String(i.issueData.id))));
      this.selectedSource.set(new Set());
    });
  }
  selectSource(id: string, checked: boolean): void {
    this.selectedSource.update((ids) => {
      const next = new Set(ids);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async addSource(): Promise<void> {
    const provider = this.browseProvider();
    if (!provider) return;
    await this.run(async () => {
      for (const item of this.sourceItems().filter((i) =>
        this.selectedSource().has(String(i.issueData.id)),
      )) {
        await this.data.addItem(item, provider, this.browseMode(), this.copyTags());
      }
      this.sourceItems.set(
        this.sourceItems().filter(
          (i) => !this.selectedSource().has(String(i.issueData.id)),
        ),
      );
      this.selectedSource.set(new Set());
    });
  }
  async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(false);
    this.result.set(false);
    try {
      await work();
      this.result.set(true);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
