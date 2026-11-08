import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { shouldScopePluginOAuth } from '../../plugins/oauth/plugin-oauth-token-key.util';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
  OnDestroy,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PluginService } from '../../plugins/plugin.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import {
  IssueProvider,
  IssueProviderKey,
  isValidIssueProviderKey,
} from '../issue/issue.model';
import { DialogEditIssueProviderComponent } from '../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component';
import { selectUnarchivedProjects } from '../project/store/project.selectors';
import { getIssueProviderTooltip } from '../issue/mapping-helper/get-issue-provider-tooltip';
import { IntegrationCapabilityService } from './integration-capability.service';
import { IntegrationFieldsComponent } from './integration-fields.component';
import { IntegrationService } from './integration.service';
import { IntegrationMode, configureIntegrationPolicy } from './integration.model';
import { FieldSyncConfig } from '../issue/two-way-sync/issue-sync.model';
import { T } from '../../t.const';

@Component({
  selector: 'integration-setup',
  standalone: true,
  imports: [MatButton, MatIcon, TranslatePipe, FormsModule, IntegrationFieldsComponent],
  templateUrl: './integration-setup.component.html',
  styleUrl: './integrations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationSetupComponent implements OnDestroy {
  private readonly _bridge = inject(PluginBridgeService);
  private _saved = false;
  readonly I = T.F.INTEGRATIONS;
  readonly done = output<IssueProvider>();
  readonly setupCanceled = output<void>();
  readonly marketplace = output<void>();
  readonly capabilities = inject(IntegrationCapabilityService);
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _plugins = inject(PluginService);
  private readonly _dialog = inject(MatDialog);
  private readonly _integrations = inject(IntegrationService);
  readonly projects = inject(Store).selectSignal(selectUnarchivedProjects);
  readonly step = signal(0);
  readonly draft = signal<IssueProvider | null>(null);
  readonly mode = signal<IntegrationMode>('sync');
  readonly policy = signal<FieldSyncConfig>({});
  readonly projectId = signal('');
  readonly projectName = signal('');
  readonly createProject = signal(true);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly steps = [
    this.I.STEP_CONNECT,
    this.I.STEP_MODE,
    this.I.STEP_MAP,
    this.I.STEP_REVIEW,
  ];
  readonly scope = computed(() =>
    this.draft() ? getIssueProviderTooltip(this.draft()!) : '',
  );
  readonly choices = computed(() => {
    this._registry.registrationVersion();
    const builtIn: { key: IssueProviderKey; name: string; pluginId?: string }[] = [
      { key: 'JIRA', name: 'Jira' },
      { key: 'GITLAB', name: 'GitLab' },
      { key: 'ICAL', name: 'Calendar (iCal / Outlook)' },
      { key: 'CALDAV', name: 'CalDAV Todo' },
      { key: 'OPEN_PROJECT', name: 'OpenProject' },
      { key: 'PLAINSPACE', name: 'Plainspace' },
    ];
    const active = this._registry
      .getAvailableProviders()
      .map((p) => ({ key: p.registeredKey, name: p.name, pluginId: p.pluginId }));
    const disabled = this._plugins
      .getDisabledIssueProviderPlugins()
      .flatMap((p) =>
        isValidIssueProviderKey(p.issueProviderKey)
          ? [{ key: p.issueProviderKey, name: p.name, pluginId: p.pluginId }]
          : [],
      );
    return [...builtIn, ...active, ...disabled];
  });

  async connect(choice: { key: IssueProviderKey; pluginId?: string }): Promise<void> {
    this.busy.set(true);
    this.error.set(false);
    try {
      if (choice.pluginId && !this._registry.hasProvider(choice.key))
        await this._plugins.enableAndActivatePlugin(choice.pluginId);
      const configured: IssueProvider | undefined = await firstValueFrom(
        this._dialog
          .open(DialogEditIssueProviderComponent, {
            data: { issueProviderKey: choice.key, deferSave: true },
            restoreFocus: true,
          })
          .afterClosed(),
      );
      if (!configured) return;
      this.draft.set(configured);
      this.policy.set(
        Object.fromEntries(
          this.capabilities
            .fields(configured)
            .map((field) => [
              field.key,
              field.defaultDirection === 'off' ? 'off' : 'pullOnly',
            ]),
        ),
      );
      this.projectName.set(getIssueProviderTooltip(configured));
      this.step.set(1);
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    const provider = this.draft();
    if (
      !this._saved &&
      provider &&
      'pluginId' in provider &&
      shouldScopePluginOAuth(provider.pluginId)
    ) {
      void this._bridge
        .clearOAuthToken(
          provider.pluginId,
          shouldScopePluginOAuth(provider.pluginId) ? provider.id : undefined,
        )
        .catch(() => undefined);
    }
  }

  save(): void {
    const provider = this.draft();
    if (!provider) return;
    const configured = configureIntegrationPolicy(provider, this.policy());
    this._saved = true;
    this.done.emit(
      this._integrations.saveConnection(
        configured,
        this.mode(),
        this.createProject() ? this.projectName() : '',
        this.createProject() ? '' : this.projectId(),
      ),
    );
  }
}
