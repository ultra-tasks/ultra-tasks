import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import {
  ProjectLayout,
  ProjectLayoutService,
} from '../../../features/project/project-layout.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { LayoutService } from '../../layout/layout.service';
import { WorkContextMenuComponent } from '../../work-context-menu/work-context-menu.component';
import { PROJECT_VIEW_OPTIONS } from '../project-view-menu/project-view-menu.component';

/**
 * The phone header's one options button, in place of the ⋮, the sort/filter
 * button and the Project-view button that no longer fit beside the title.
 *
 * The menu leads with the page's view (the project layout, then sort, group and
 * filter) and goes on with the work-context items, so nothing the three buttons
 * offered is lost. Sort, group and filter opens the bottom sheet on a phone: the
 * three-level menu cascade it replaces opened panels over one another, flush to
 * the screen edges.
 *
 * Declares the rows itself, in the menu's own template, so Material's keyboard
 * navigation sees them (the work-context rows live in another component's view).
 */
@Component({
  selector: 'page-options-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDivider,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    SelectOptionRowComponent,
    TranslatePipe,
    WorkContextMenuComponent,
  ],
  styles: `
    :host {
      display: contents;
    }

    .project-settings-btn {
      position: relative;
      color: var(--text-color-muted);
    }

    .project-settings-btn .mat-icon {
      font-size: var(--icon-md);
      width: var(--icon-md);
      height: var(--icon-md);
      line-height: var(--icon-md);
    }

    .project-settings-btn[aria-expanded='true'] {
      color: var(--palette-selected-ink);
      background-color: var(--palette-selected);
    }

    /* Hover is not a state a finger has: after a tap it would stay on until the
       next tap elsewhere. */
    @media (hover: hover) {
      .project-settings-btn:hover {
        color: var(--text-color);
      }
    }

    .project-settings-btn:focus-visible {
      color: var(--text-color);
    }

    /* A sort, group or filter is on: the dot the old filter button's filled
       state used to say. Away from the glyph, which is three dots wide at most. */
    .project-settings-btn.has-customization::after {
      content: '';
      position: absolute;
      top: var(--s);
      inset-inline-end: var(--s);
      width: var(--s);
      height: var(--s);
      border-radius: var(--r-full);
      background: var(--brand);
    }

    .page-options-heading {
      padding: var(--s) var(--s2) var(--s-half);
      font: var(--type-meta);
      color: var(--text-color-muted);
    }

    /* The menu item's text box spaces its spans apart and gives each an auto
       right margin; the trailing group sits at the end with none. */
    .page-options-trailing {
      display: inline-flex;
      align-items: center;
      gap: var(--s);
      margin-right: 0;
    }

    /* How many of sort, group and filter are on. */
    .page-options-count {
      flex: 0 0 auto;
      min-width: var(--s3);
      padding: 0 var(--s-half);
      border-radius: var(--r-full);
      background: var(--palette-selected);
      color: var(--palette-selected-ink);
      font: var(--type-label);
      text-align: center;
    }

    .page-options-chevron {
      flex: 0 0 auto;
      margin: 0;
      color: var(--text-color-muted);
    }
  `,
  template: `
    <button
      class="project-settings-btn"
      [class.has-customization]="isCustomized()"
      [mat-menu-trigger-for]="menu"
      [attr.aria-label]="label() | translate"
      [matTooltip]="label() | translate"
      mat-icon-button
      type="button"
    >
      <mat-icon>more_vert</mat-icon>
    </button>

    <mat-menu
      #menu="matMenu"
      class="mat-menu-under-header"
    >
      <ng-template matMenuContent>
        @if (isProjectLayoutPage()) {
          <div
            role="group"
            aria-labelledby="page-options-view-heading"
          >
            <div
              class="page-options-heading"
              id="page-options-view-heading"
            >
              {{ T.F.PROJECT.LAYOUT.LABEL | translate }}
            </div>
            @for (option of layoutOptions; track option.id) {
              <button
                mat-menu-item
                role="menuitemradio"
                [class.is-selected]="layout() === option.id"
                [attr.aria-checked]="layout() === option.id"
                (click)="setLayout(option.id)"
              >
                <select-option-row
                  [title]="option.labelKey | translate"
                  [icon]="option.icon"
                  [isSelected]="layout() === option.id"
                  [showCheckmark]="true"
                ></select-option-row>
              </button>
            }
            @if (layout() === 'calendar' || layout() === 'upcoming') {
              <button
                mat-menu-item
                role="menuitemcheckbox"
                [class.is-selected]="prefs().isShowCalendarEvents"
                [attr.aria-checked]="prefs().isShowCalendarEvents"
                (click)="toggleCalendarEvents($event)"
              >
                <select-option-row
                  [title]="T.F.PROJECT.LAYOUT.SHOW_CALENDAR_EVENTS | translate"
                  icon="event"
                  [isSelected]="prefs().isShowCalendarEvents"
                  [showCheckmark]="true"
                ></select-option-row>
              </button>
            }
          </div>
        }
        @if (isWorkViewPage()) {
          <button
            mat-menu-item
            class="page-options-customize"
            (click)="openCustomizer()"
          >
            <mat-icon>tune</mat-icon>
            <span>{{ T.MH.SORT_GROUP_FILTER | translate }}</span>
            <span class="page-options-trailing">
              @if (customizationCount(); as count) {
                <span class="page-options-count">{{ count }}</span>
              }
              <mat-icon
                class="page-options-chevron"
                aria-hidden="true"
                >chevron_right</mat-icon
              >
            </span>
          </button>
          <mat-divider></mat-divider>
        }
        <work-context-menu
          [contextId]="contextId()"
          [contextType]="contextType()"
        ></work-context-menu>
      </ng-template>
    </mat-menu>
  `,
})
export class PageOptionsMenuComponent {
  private readonly _layouts = inject(ProjectLayoutService);
  private readonly _customizer = inject(TaskViewCustomizerService);
  private readonly _layoutService = inject(LayoutService);

  readonly T = T;
  readonly layoutOptions = PROJECT_VIEW_OPTIONS;

  readonly contextId = input.required<string>();
  readonly contextType = input.required<WorkContextType>();
  /** A task list page: where sort, group and filter apply. */
  readonly isWorkViewPage = input(false);

  /** The project's layout (list, board, ...) only exists on a project's task page. */
  readonly isProjectLayoutPage = computed(
    () => this.isWorkViewPage() && this.contextType() === WorkContextType.PROJECT,
  );
  readonly prefs = computed(() => this._layouts.prefsFor(this.contextId()));
  readonly layout = computed(() => this.prefs().layout);

  readonly customizationCount = this._customizer.customizationCount;
  readonly isCustomized = this._customizer.isCustomized;
  /** The name says when something is on, which the dot alone does not. */
  readonly label = computed(() =>
    this.isCustomized() ? T.MH.PAGE_OPTIONS_ACTIVE : T.MH.PAGE_OPTIONS,
  );

  setLayout(layout: ProjectLayout): void {
    this._layouts.setLayout(this.contextId(), layout);
  }

  toggleCalendarEvents(event: Event): void {
    // Keeps the menu open, like the desktop control's menu does.
    event.stopPropagation();
    this._layouts.setShowCalendarEvents(
      this.contextId(),
      !this.prefs().isShowCalendarEvents,
    );
  }

  /** Opens the bottom sheet (the layout service's panel state drives it). */
  openCustomizer(): void {
    if (!this._layoutService.isShowTaskViewCustomizerPanel()) {
      this._layoutService.toggleTaskViewCustomizerPanel();
    }
  }
}
