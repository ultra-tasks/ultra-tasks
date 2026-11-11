import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { INBOX_PROJECT } from '../../project/project.const';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import { DialogScheduleTaskComponent } from '../dialog-schedule-task/dialog-schedule-task.component';
import { ADD_TASK_PANEL_ID } from '../planner.model';
import {
  PlannerUnscheduledPanelService,
  UNSCHEDULED_FILTER_ALL,
} from './planner-unscheduled-panel.service';

/** Rows drawn at once; the project filter narrows a longer list. */
export const UNSCHEDULED_MAX_ROWS = 100;

/**
 * Tasks that have no day yet, beside Upcoming's days: drag one onto a day, or
 * use its Schedule button (the keyboard and touch path). Sub-tasks, done tasks,
 * hidden integration tasks and the projects' backlogs are left out: a backlog is
 * already a deliberate "later" list.
 */
@Component({
  selector: 'planner-unscheduled-panel',
  templateUrl: './planner-unscheduled-panel.component.html',
  styleUrl: './planner-unscheduled-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDrag,
    CdkDropList,
    MatButton,
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MsToStringPipe,
    TranslatePipe,
  ],
})
export class PlannerUnscheduledPanelComponent {
  private readonly _store = inject(Store);
  private readonly _dialog = inject(MatDialog);
  protected readonly panel = inject(PlannerUnscheduledPanelService);

  protected readonly T = T;
  protected readonly ALL = UNSCHEDULED_FILTER_ALL;
  protected readonly inboxId = INBOX_PROJECT.id;
  /**
   * Drop-list id for a task dragged out of this panel. The planner's transfer
   * reducer reads it as "not one of the day lists", so the move is the same
   * single transferTask action a drag between days dispatches.
   */
  protected readonly listId = ADD_TASK_PANEL_ID;
  /** Nothing is dropped back into the panel. */
  protected readonly rejectIncoming = (): boolean => false;

  private readonly _tasks = this._store.selectSignal(selectAllTasks);
  protected readonly projects = this._store.selectSignal(selectUnarchivedProjects);

  /** The stored filter, or all projects when that project is gone. */
  protected readonly activeFilter = computed(() => {
    const id = this.panel.projectFilter();
    return id === UNSCHEDULED_FILTER_ALL || this.projects().some((p) => p.id === id)
      ? id
      : UNSCHEDULED_FILTER_ALL;
  });
  protected readonly activeProjectTitle = computed(
    () => this.projects().find((p) => p.id === this.activeFilter())?.title,
  );
  protected readonly projectTitles = computed(
    () => new Map(this.projects().map((p) => [p.id, p.title])),
  );

  private readonly _backlogIds = computed(
    () => new Set(this.projects().flatMap((p) => p.backlogTaskIds)),
  );
  private readonly _matching = computed<Task[]>(() => {
    const filter = this.activeFilter();
    const backlog = this._backlogIds();
    return this._tasks().filter(
      (task) =>
        !task.isDone &&
        !task.parentId &&
        !task.dueDay &&
        !task.dueWithTime &&
        !task.integration?.hidden &&
        !backlog.has(task.id) &&
        (filter === UNSCHEDULED_FILTER_ALL || task.projectId === filter),
    );
  });
  protected readonly total = computed(() => this._matching().length);
  protected readonly rows = computed(() =>
    this._matching().slice(0, UNSCHEDULED_MAX_ROWS),
  );
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.total() - UNSCHEDULED_MAX_ROWS),
  );

  protected openSchedule(task: Task): void {
    this._dialog.open(DialogScheduleTaskComponent, { data: { task } });
  }
}
