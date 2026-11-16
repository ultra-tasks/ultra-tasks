import { Injectable, Injector, inject } from '@angular/core';
import { GitlabSyncAdapterService } from '../providers/gitlab/gitlab-sync-adapter.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { TagService } from '../../tag/tag.service';
import { createPluginSyncAdapter } from '../../../plugins/issue-provider/plugin-sync-adapter.service';
import { IssueSyncAdapter } from './issue-sync-adapter.interface';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { IssueProviderOwnershipService } from '../issue-provider-ownership.service';

@Injectable({
  providedIn: 'root',
})
export class IssueSyncAdapterResolverService {
  private readonly _injector = inject(Injector);
  private readonly _adapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttp = inject(PluginHttpService);
  private readonly _tagService = inject(TagService);
  private readonly _ownership = inject(IssueProviderOwnershipService);

  getAdapter(issueType: string): IssueSyncAdapter<unknown> | undefined {
    const existing = this._adapterRegistry.get(issueType);
    if (existing) {
      return existing;
    }

    if (issueType === 'GITLAB') {
      const adapter = this._injector.get(GitlabSyncAdapterService);
      this._adapterRegistry.register(issueType, adapter);
      return adapter;
    }

    const provider = this._pluginRegistry.getProvider(issueType);
    const definition = provider?.definition;
    if (
      !provider ||
      !definition ||
      // `updateIssue` alone is intentional: calendar moves can push direct
      // event changes even when a provider has no task field mappings.
      (!definition.createIssue && !definition.deleteIssue && !definition.updateIssue)
    ) {
      return undefined;
    }

    const adapter = createPluginSyncAdapter(
      definition,
      (getHeadersFn) =>
        this._pluginHttp.createHttpHelper(getHeadersFn, {
          allowPrivateNetwork: provider.allowPrivateNetwork,
        }),
      this._tagService,
      provider.pluginId,
      (cfg) => this._ownership.assertOwner(cfg),
    );

    this._adapterRegistry.register(issueType, adapter);
    return adapter;
  }
}
