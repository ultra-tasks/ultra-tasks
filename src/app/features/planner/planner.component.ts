import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { DateService } from '../../core/date/date.service';
import { PlannerActions } from './store/planner.actions';
import { selectAllTasks, selectTaskFeatureState } from '../tasks/store/task.selectors';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import {
  filterPlannerDayMapByProject,
  ProjectScope,
} from '../project/filter-by-project.util';
import { T } from '../../t.const';
import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { PlannerPlanViewComponent } from './planner-plan-view/planner-plan-view.component';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { PlannerCalendarNavComponent } from './planner-calendar-nav/planner-calendar-nav.component';
import { PlannerService } from './planner.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { selectPlannerDayMap } from './store/planner.selectors';
import { ADD_TASK_PANEL_ID } from './planner.model';
import { INBOX_PROJECT } from '../project/project.const';
import { Task } from '../tasks/task.model';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DialogScheduleTaskComponent } from './dialog-schedule-task/dialog-schedule-task.component';

@Component({
  selector: 'planner',
  templateUrl: './planner.component.html',
  styleUrl: './planner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    PlannerPlanViewComponent,
    CdkScrollable,
    PlannerCalendarNavComponent,
    MatIcon,
    TranslatePipe,
  ],
})
export class PlannerComponent {
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _plannerService = inject(PlannerService);
  private _dialog = inject(MatDialog);
  layoutService = inject(LayoutService);

  readonly T = T;
  readonly inboxPanelId = ADD_TASK_PANEL_ID;
  readonly isInboxOpen = signal(false);
  readonly rejectIncoming = (): boolean => false;
  private readonly _allTasks = this._store.selectSignal(selectAllTasks);
  readonly unscheduledInboxTasks = computed(() =>
    this._allTasks().filter(
      (task) =>
        task.projectId === INBOX_PROJECT.id &&
        !task.isDone &&
        !task.parentId &&
        !task.dueDay &&
        !task.dueWithTime,
    ),
  );

  /** Narrows Upcoming to one project (a project's Upcoming layout). Unset = all projects. */
  readonly scope = input<ProjectScope | null>(null);

  openSchedule(task: Task): void {
    this._dialog.open(DialogScheduleTaskComponent, { data: { task } });
  }

  private _days = toSignal(
    toObservable(this.scope).pipe(
      switchMap((scope) =>
        scope ? this._plannerService.daysForProject$(scope) : this._plannerService.days$,
      ),
    ),
    { initialValue: [] },
  );
  private _plannerDayMap = toSignal(this._store.select(selectPlannerDayMap), {
    initialValue: {},
  });
  private _prevDaysWithTasksKey = '';
  private _prevDaysWithTasks: ReadonlySet<string> = new Set();
  daysWithTasks = computed<ReadonlySet<string>>(() => {
    const days = this._days();
    const plannerDayMap = filterPlannerDayMapByProject(
      this._plannerDayMap(),
      this.scope()?.projectId,
    );
    const dayDates = new Set(
      Object.entries(plannerDayMap)
        .filter(([, tasks]) => tasks.length > 0)
        .map(([dayDate]) => dayDate),
    );
    for (const day of days) {
      if (day.tasks.length > 0) {
        dayDates.add(day.dayDate);
      }
    }
    const sortedDayDates = [...dayDates].sort();
    const key = sortedDayDates.join(',');
    if (key === this._prevDaysWithTasksKey) {
      return this._prevDaysWithTasks;
    }
    this._prevDaysWithTasksKey = key;
    this._prevDaysWithTasks = new Set(sortedDayDates);
    return this._prevDaysWithTasks;
  });

  constructor() {
    this._store
      .select(selectTaskFeatureState)
      .pipe(takeUntilDestroyed())
      .subscribe((taskState) => {
        this._store.dispatch(
          PlannerActions.cleanupOldAndUndefinedPlannerTasks({
            today: this._dateService.todayStr(),
            allTaskIds: taskState.ids as string[],
          }),
        );
      });
  }
}
