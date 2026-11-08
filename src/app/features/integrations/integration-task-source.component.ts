import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Task } from '../tasks/task.model';
import { integrationForTask } from './integration.model';
import { IntegrationService } from './integration.service';
import { IntegrationCapabilityService } from './integration-capability.service';
import { IntegrationItemDialogComponent } from './integration-item-dialog.component';
import { T } from '../../t.const';

@Component({
  selector: 'integration-task-source',
  standalone: true,
  imports: [MatButton, RouterLink, TranslatePipe],
  template: `@if (link(); as source) {
    <section class="source-info">
      <div>
        <span class="badge">{{
          (source.mode === 'sync' ? I.SYNCED : I.IMPORTED) | translate
        }}</span>
        <a routerLink="/integrations"
          >{{ capabilities.name(source.providerKey) }} · {{ source.remoteId }}</a
        >
      </div>
      <p>
        {{
          (source.stopped
            ? I.TRACKING_STOPPED
            : source.mode === 'import'
              ? I.SNAPSHOT
              : I.COMPLETION_LOCAL
          ) | translate
        }}
      </p>
      @if (provider(); as connection) {
        <button
          mat-button
          (click)="edit()"
        >
          {{ I.POLICY | translate }}
        </button>
      }
      <button
        mat-button
        (click)="data.setHidden([task().id], !source.hidden)"
      >
        {{ (source.hidden ? I.SHOW : I.HIDE) | translate }}
      </button>
    </section>
  }`,
  styles: [
    `
      .source-info {
        padding: var(--s2);
        border: 1px solid var(--palette-border);
        border-radius: var(--r-md);
        margin: var(--s2) 0;
      }
      .badge {
        display: inline-block;
        padding: var(--s-quarter) var(--s);
        border-radius: var(--r-full);
        background: var(--palette-selected);
        color: var(--palette-selected-ink);
        font: var(--type-meta);
      }
      p {
        font: var(--type-meta);
        color: var(--text-color-muted);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationTaskSourceComponent {
  readonly I = T.F.INTEGRATIONS;
  readonly task = input.required<Task>();
  readonly data = inject(IntegrationService);
  readonly capabilities = inject(IntegrationCapabilityService);
  private readonly _dialog = inject(MatDialog);
  readonly link = computed(() => integrationForTask(this.task()));
  readonly provider = computed(() =>
    this.data.providers().find((p) => p.id === this.link()?.providerId),
  );
  edit(): void {
    const provider = this.provider();
    if (provider)
      this._dialog.open(IntegrationItemDialogComponent, {
        data: { task: this.task(), provider },
      });
  }
}
