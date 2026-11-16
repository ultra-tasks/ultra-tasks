import { effect, EffectRef, inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom } from 'rxjs';
import { selectAll } from '../../features/issue/store/issue-provider.selectors';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { PluginLog } from '../../core/log';
import { PluginService } from '../plugin.service';
import { selectPluginMetadataFeatureState } from '../store/plugin-metadata.reducer';

/** Reconcile trusted bundled issue-provider runtimes with synced enabled metadata. */
@Injectable({ providedIn: 'root' })
export class PluginConnectionRuntimeService {
  private readonly _injector = inject(Injector);
  private readonly _plugins = inject(PluginService);
  private readonly _hydration = inject(HydrationStateService);
  private readonly _store = inject(Store);
  private readonly _providers = this._store.selectSignal(selectAll);
  private readonly _metadata = this._store.selectSignal(selectPluginMetadataFeatureState);
  private readonly _pending = new Set<string>();
  private _effect?: EffectRef;

  start(): void {
    this._effect ??= effect(
      () => {
        // This signal retries after replay/cooldown, including a sparse sync import.
        // Activation changes only local runtime state: no new metadata action/op.
        if (this._hydration.isInSyncWindow()) return;
        const providers = this._providers();
        const metadata = this._metadata();
        for (const [id, state] of this._plugins.pluginStates()) {
          const key = state.manifest.issueProvider?.issueProviderKey;
          if (
            state.type !== 'built-in' ||
            state.manifest.type !== 'issueProvider' ||
            state.manifest.permissions?.includes('nodeExecution') ||
            !key
          )
            continue;
          const isEnabled = metadata.find((entry) => entry.id === id)?.isEnabled;
          // An absent entry is legacy state, not an explicit request to disable.
          // In-flight activations recheck their final state on completion below.
          if (
            state.status === 'loaded' &&
            isEnabled === false &&
            !this._pending.has(id)
          ) {
            this._plugins.unloadPlugin(id);
            continue;
          }
          if (
            state.status !== 'not-loaded' ||
            state.isEnabled ||
            !isEnabled ||
            !providers.some(
              (provider) => provider.isEnabled && provider.issueProviderKey === key,
            ) ||
            this._pending.has(id)
          )
            continue;
          this._pending.add(id);
          // This existing path updates the runtime's enabled flag without writing
          // metadata again. Bundled providers here never need native consent.
          void this._plugins
            .activatePlugin(id, true)
            .then(async () => {
              // Loading can finish after a disable or another replay started.
              // Read settled state, rather than undoing a transient replay value.
              while (this._hydration.isInSyncWindow()) {
                await firstValueFrom(
                  this._hydration.isInSyncWindow$.pipe(
                    filter(() => !this._hydration.isInSyncWindow()),
                  ),
                );
              }
              const isStillConnected = this._providers().some(
                (provider) => provider.isEnabled && provider.issueProviderKey === key,
              );
              const isStillEnabled = this._metadata().some(
                (entry) => entry.id === id && entry.isEnabled,
              );
              if (!isStillEnabled || !isStillConnected) this._plugins.unloadPlugin(id);
            })
            .catch(() =>
              PluginLog.err('Connected provider plugin failed to load', { id }),
            )
            .finally(() => this._pending.delete(id));
        }
      },
      { injector: this._injector },
    );
  }
}
