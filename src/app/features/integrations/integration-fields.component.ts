import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { IssueProvider } from '../issue/issue.model';
import { FieldSyncConfig, SyncDirection } from '../issue/two-way-sync/issue-sync.model';
import { Task } from '../tasks/task.model';
import {
  IntegrationCapabilityService,
  IntegrationField,
} from './integration-capability.service';
import { T } from '../../t.const';

@Component({
  selector: 'integration-fields',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <table>
      <thead>
        <tr>
          <th>{{ I.FIELD | translate }}</th>
          <th>{{ I.SOURCE_FIELD | translate }}</th>
          <th>{{ I.DIRECTION | translate }}</th>
        </tr>
      </thead>
      <tbody>
        @for (field of fields(); track field.key) {
          <tr>
            <td>{{ field.label | translate }}</td>
            <td>{{ field.remoteField }}</td>
            <td>
              <select
                [attr.aria-label]="field.label | translate"
                [ngModel]="value(field)"
                (ngModelChange)="change(field.key, $event)"
              >
                @if (allowDefault()) {
                  <option value="">{{ I.DEFAULT | translate }}</option>
                }
                <option value="pullOnly">{{ I.RECEIVE | translate }}</option>
                @if (field.canWrite) {
                  <option value="both">{{ I.BOTH | translate }}</option>
                  <option value="pushOnly">{{ I.SEND | translate }}</option>
                }
                <option value="off">{{ I.LOCAL | translate }}</option>
              </select>
            </td>
          </tr>
        }
      </tbody>
    </table>
    @if (readOnly()) {
      <p class="help">{{ I.READ_ONLY_HELP | translate }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
      }
      th,
      td {
        padding: var(--s1-5) var(--s);
        border-bottom: 1px solid var(--palette-border);
      }
      th,
      .help {
        font: var(--type-meta);
        color: var(--text-color-muted);
      }
      select {
        font: var(--type-body);
        color: var(--text-color);
        background: var(--card-bg);
        padding: var(--s);
        border: 1px solid var(--palette-border);
        border-radius: var(--r-sm);
        max-width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationFieldsComponent {
  readonly I = T.F.INTEGRATIONS;
  private readonly _capabilities = inject(IntegrationCapabilityService);
  readonly provider = input.required<IssueProvider>();
  readonly policy = input<FieldSyncConfig>({});
  readonly allowDefault = input(false);
  readonly policyChange = output<FieldSyncConfig>();
  readonly fields = computed(() => this._capabilities.fields(this.provider()));
  readonly readOnly = computed(() => this.fields().every((f) => !f.canWrite));
  value(field: IntegrationField): string {
    return (
      this.policy()[field.key as keyof Task] ??
      (this.allowDefault() ? '' : field.defaultDirection)
    );
  }
  change(key: string, value: SyncDirection | ''): void {
    const next = { ...this.policy() };
    if (value) next[key as keyof Task] = value;
    else delete next[key as keyof Task];
    this.policyChange.emit(next);
  }
}
