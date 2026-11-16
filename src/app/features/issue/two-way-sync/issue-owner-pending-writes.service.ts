import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import {
  integrationSyncPolicy,
  managedSourceTagPrefix,
} from '../../integrations/integration.model';
import { IssueProviderService } from '../issue-provider.service';
import { IssueProviderOwnershipService } from '../issue-provider-ownership.service';
import { computePendingLocalChanges } from './compute-field-pull';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';
import { IssueSyncStateService } from './issue-sync-state.service';

/** A source refresh reconciles remote values before draining edits synced from peers. */
@Injectable({ providedIn: 'root' })
export class IssueOwnerPendingWritesService {
  private readonly _providers = inject(IssueProviderService);
  private readonly _ownership = inject(IssueProviderOwnershipService);
  private readonly _tasks = inject(TaskService);
  private readonly _adapters = inject(IssueSyncAdapterResolverService);
  private readonly _sync = inject(IssueSyncStateService);

  async flush(tasks: readonly Task[]): Promise<void> {
    for (const original of tasks) {
      if (!original.issueType || !original.issueProviderId || !original.issueId) continue;
      const cfg = await firstValueFrom(
        this._providers.getCfgOnce$(original.issueProviderId, original.issueType),
      );
      // Legacy connections retain their existing provider-specific retry behavior.
      if (!cfg.integrationOwnerId || !this._ownership.isOwner(cfg)) continue;
      const task = await firstValueFrom(this._tasks.getByIdOnce$(original.id));
      if (
        !task?.issueId ||
        task.integration?.mode === 'import' ||
        task.integration?.stopped
      )
        continue;
      const adapter = this._adapters.getAdapter(task.issueType!);
      if (!adapter) continue;
      const pending = computePendingLocalChanges(
        task,
        adapter.getFieldMappings(),
        integrationSyncPolicy(task, adapter, cfg),
        { issueId: task.issueId, managedTagPrefix: managedSourceTagPrefix(cfg) },
      );
      if (Object.keys(pending).length) await this._sync.pushPending(task.id);
    }
  }
}
