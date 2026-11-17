import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { selectArchivedProjectsSortedByTitle } from '../../features/project/store/project.selectors';
import { ProjectService } from '../../features/project/project.service';
import { Project } from '../../features/project/project.model';
import { DEFAULT_PROJECT_ICON } from '../../features/project/project.const';
import { T } from '../../t.const';

/** The search field appears above this many archived projects. */
export const ARCHIVED_SEARCH_MIN_PROJECTS = 6;

@Component({
  selector: 'archived-projects-page',
  templateUrl: './archived-projects-page.component.html',
  styleUrls: ['./archived-projects-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    MatFormField,
    MatLabel,
    MatInput,
    MatSuffix,
    FormsModule,
    RouterLink,
    DatePipe,
    TranslatePipe,
  ],
})
export class ArchivedProjectsPageComponent {
  private readonly _store = inject(Store);
  private readonly _projectService = inject(ProjectService);

  readonly T = T;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  readonly searchTerm = signal('');

  private readonly _archivedProjectsSorted = this._store.selectSignal(
    selectArchivedProjectsSortedByTitle,
  );

  /** Searching a short list is noise: the field is for a long one. */
  readonly showSearch = computed(
    () => this._archivedProjectsSorted().length > ARCHIVED_SEARCH_MIN_PROJECTS,
  );

  readonly filteredProjects = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const projects = this._archivedProjectsSorted();
    // A term typed earlier must not filter a list that now has no field to clear it.
    if (!term || !this.showSearch()) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(term));
  });

  unarchive(project: Project): void {
    this._projectService.unarchive(project.id);
  }

  reopen(project: Project): void {
    this._projectService.reopen(project.id, project);
  }
}
