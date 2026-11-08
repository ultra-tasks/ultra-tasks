import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { IntegrationFieldsComponent } from './integration-fields.component';
import { IntegrationService } from './integration.service';
import { IntegrationCapabilityService } from './integration-capability.service';
import { integrationForTask } from './integration.model';
import { FieldSyncConfig } from '../issue/two-way-sync/issue-sync.model';
import { Task } from '../tasks/task.model';
import { IssueProvider } from '../issue/issue.model';
import { useDialogSize } from '../../ui/dialog-size.util';
import { T } from '../../t.const';

@Component({
  selector: 'integration-item-dialog',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslatePipe,
    IntegrationFieldsComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ I.ITEM_POLICY | translate }}</h2>
    <mat-dialog-content>
      <h3>{{ data.task.title }}</h3>
      <p>{{ I.ITEM_POLICY_HELP | translate }}</p>
      <p class="callout">
        {{ capabilities.quirk(data.provider.issueProviderKey) | translate }}
      </p>
      <integration-fields
        [provider]="data.provider"
        [policy]="policy()"
        [allowDefault]="true"
        (policyChange)="policy.set($event)"
      />
    </mat-dialog-content>
    <mat-dialog-actions align="end"
      ><button
        mat-button
        (click)="dialog.close()"
      >
        {{ I.CANCEL | translate }}</button
      ><button
        mat-flat-button
        (click)="save()"
      >
        {{ I.SAVE | translate }}
      </button></mat-dialog-actions
    >
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationItemDialogComponent {
  private readonly _size = useDialogSize('l');
  readonly I = T.F.INTEGRATIONS;
  readonly data = inject<{ task: Task; provider: IssueProvider }>(MAT_DIALOG_DATA);
  readonly dialog = inject(MatDialogRef<IntegrationItemDialogComponent>);
  readonly capabilities = inject(IntegrationCapabilityService);
  private readonly _integrations = inject(IntegrationService);
  readonly policy = signal<FieldSyncConfig>({
    ...integrationForTask(this.data.task)?.fieldPolicy,
  });
  save(): void {
    this._integrations.setFieldPolicy(this.data.task.id, this.policy());
    this.dialog.close(true);
  }
}
