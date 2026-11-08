import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutService } from '../../layout/layout.service';
import { T } from '../../../t.const';
import { KeyboardConfig } from '@sp/keyboard-config';
import { GlobalConfigService } from '../../../features/config/global-config.service';

@Component({
  selector: 'desktop-panel-buttons',
  standalone: true,
  imports: [MatIconButton, MatIcon, MatTooltip, TranslatePipe],
  template: `
    @if (isProjectNotesEnabled()) {
      <button
        class="panel-btn e2e-toggle-notes-btn"
        [class.isActive]="isShowNotes()"
        [attr.aria-pressed]="isShowNotes()"
        (click)="layoutService.toggleNotes()"
        mat-icon-button
        matTooltip="{{ T.MH.TOGGLE_SHOW_NOTES | translate }} {{
          kb()?.openProjectNotes ? '[' + kb()?.openProjectNotes + ']' : ''
        }}"
        [attr.aria-label]="T.MH.TOGGLE_SHOW_NOTES | translate"
      >
        <mat-icon>description</mat-icon>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .panel-btn {
        position: relative;
        transition:
          background-color var(--transition-duration-s) var(--ani-standard-timing),
          color var(--transition-duration-s) var(--ani-standard-timing);
        overflow: visible !important;

        .mat-icon {
          display: block;
        }

        /* A pressed toggle is the one "selected" role: the tonal fill, its
           paired ink and a filled glyph (never the accent). */
        &.isActive {
          box-shadow: none;
          color: var(--palette-selected-ink);
          background-color: var(--palette-selected);

          .mat-icon {
            font-variation-settings: 'FILL' 1;
          }
        }

        &:hover:not(.isActive) {
          background-color: var(--state-hover);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesktopPanelButtonsComponent {
  readonly T = T;
  readonly layoutService = inject(LayoutService);
  private readonly _configService = inject(GlobalConfigService);

  readonly kb = input<KeyboardConfig | null>();
  readonly isShowNotes = input.required<boolean>();

  readonly isProjectNotesEnabled = computed(
    () => this._configService.appFeatures().isProjectNotesEnabled,
  );
}
