import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ProjectService } from '../../../features/project/project.service';
import {
  ProjectLayout,
  ProjectLayoutService,
} from '../../../features/project/project-layout.service';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { T } from '../../../t.const';

@Component({
  selector: 'project-view-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    TranslatePipe,
    SelectOptionRowComponent,
  ],
  styles: `
    :host {
      display: contents;
    }
    .project-view-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--s-half);
      min-height: var(--ctl-md);
      padding: 0 var(--s);
      border: 1px solid var(--divider-color);
      border-radius: var(--r-md);
      background: transparent;
      color: var(--text-color);
      font: var(--type-label);
      cursor: pointer;
    }
    .project-view-trigger:hover {
      background: var(--state-hover);
    }
    .project-view-trigger:focus-visible {
      outline: var(--focus-ring-width) solid var(--focus-ring-color);
      outline-offset: var(--focus-ring-offset);
    }
    .project-view-trigger mat-icon {
      width: var(--icon-md);
      height: var(--icon-md);
      font-size: var(--icon-md);
    }
    .project-view-trigger.is-compact .project-view-label,
    .project-view-trigger.is-compact .project-view-chevron {
      display: none;
    }
    @media (max-width: 599px) {
      .project-view-label,
      .project-view-chevron {
        display: none;
      }
    }
  `,
  template: `
    @if (isProjectView()) {
      <button
        type="button"
        class="project-view-trigger"
        [class.is-compact]="compact()"
        [matMenuTriggerFor]="viewMenu"
        [matTooltip]="T.F.PROJECT.LAYOUT.LABEL | translate"
        [attr.aria-label]="T.F.PROJECT.LAYOUT.LABEL | translate"
      >
        <mat-icon [fontIcon]="activeOption().icon"></mat-icon>
        <span class="project-view-label">{{ activeOption().labelKey | translate }}</span>
        <mat-icon
          class="project-view-chevron"
          aria-hidden="true"
          >expand_more</mat-icon
        >
      </button>
      <mat-menu #viewMenu="matMenu">
        @for (option of options; track option.id) {
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
          <hr />
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
      </mat-menu>
    }
  `,
})
export class ProjectViewMenuComponent {
  readonly T = T;
  readonly compact = input(false);
  private readonly _router = inject(Router);
  private readonly _layouts = inject(ProjectLayoutService);
  private readonly _project = toSignal(inject(ProjectService).currentProject$, {
    initialValue: null,
  });
  private readonly _url = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this._router.url },
  );
  readonly projectId = computed(() => this._project()?.id ?? null);
  readonly isProjectView = computed(
    () =>
      !!this.projectId() &&
      /^\/(project\/[^/]+|active)\/tasks(?:[?;#]|$)/.test(this._url()),
  );
  readonly prefs = computed(() => this._layouts.prefsFor(this.projectId() ?? ''));
  readonly layout = computed(() => this.prefs().layout);
  readonly options: ReadonlyArray<{
    id: ProjectLayout;
    labelKey: string;
    icon: string;
  }> = [
    { id: 'list', labelKey: T.F.PROJECT.LAYOUT.LIST, icon: 'view_list' },
    { id: 'board', labelKey: T.F.PROJECT.LAYOUT.BOARD, icon: 'view_kanban' },
    { id: 'calendar', labelKey: T.F.PROJECT.LAYOUT.CALENDAR, icon: 'calendar_view_week' },
    { id: 'upcoming', labelKey: T.F.PROJECT.LAYOUT.UPCOMING, icon: 'edit_calendar' },
  ];
  readonly activeOption = computed(
    () => this.options.find((option) => option.id === this.layout()) ?? this.options[0],
  );

  setLayout(layout: ProjectLayout): void {
    const projectId = this.projectId();
    if (projectId) this._layouts.setLayout(projectId, layout);
  }

  toggleCalendarEvents(event: Event): void {
    event.stopPropagation();
    const projectId = this.projectId();
    if (projectId) {
      this._layouts.setShowCalendarEvents(projectId, !this.prefs().isShowCalendarEvents);
    }
  }
}
