import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Store } from '@ngrx/store';
import { T } from '../../../t.const';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { PlannerTaskComponent } from '../planner-task/planner-task.component';
import { PlannerDeadlineTaskComponent } from '../planner-deadline-task/planner-deadline-task.component';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { RoundDurationPipe } from '../../../ui/pipes/round-duration.pipe';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { TaskCopy } from '../../tasks/task.model';
import { OVERDUE_LIST_ID } from '../planner.model';
import { TranslatePipe } from '@ngx-translate/core';
import { DRAG_DELAY_FOR_TOUCH } from '../../../app.constants';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DateService } from '../../../core/date/date.service';
import { CollapsibleComponent } from '../../../ui/collapsible/collapsible.component';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';

@Component({
  selector: 'planner-day-overdue',
  templateUrl: './planner-day-overdue.component.html',
  styleUrl: './planner-day-overdue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkDropList,
    PlannerTaskComponent,
    PlannerDeadlineTaskComponent,
    CdkDrag,
    CollapsibleComponent,
    MatIcon,
    MatButton,
    MsToStringPipe,
    NgTemplateOutlet,
    RoundDurationPipe,
    TranslatePipe,
  ],
})
export class PlannerDayOverdueComponent {
  protected readonly multiSelect = inject(TaskMultiSelectService);
  private _layoutService = inject(LayoutService);
  private _store = inject(Store);
  private _dateService = inject(DateService);
  overdueTasks = input<TaskCopy[] | null>();
  overdueDeadlineTasks = input<TaskCopy[] | null>();
  totalEstimate = computed(() => {
    const tasks = this.overdueTasks();
    if (!tasks) return 0;
    return tasks.reduce((acc, task) => acc + (task.timeEstimate || 0), 0);
  });
  /**
   * How many tasks are behind. A task with a deadline is in both lists, so it is
   * counted once.
   */
  overdueCount = computed(
    () =>
      new Set([
        ...(this.overdueTasks() ?? []).map((task) => task.id),
        ...(this.overdueDeadlineTasks() ?? []).map((task) => task.id),
      ]).size,
  );

  OVERDUE_LIST_ID = OVERDUE_LIST_ID;
  protected readonly T = T;
  // A constant for the template's {touch, mouse} form: CDK picks the delay from the
  // event's own type, so it cannot go stale when the input intent flips (and the
  // rows no longer read a signal each).
  protected readonly DRAG_DELAY_FOR_TOUCH = DRAG_DELAY_FOR_TOUCH;
  // Lock Y-axis on small screens only — on wider screens the planner uses a
  // multi-column grid where cross-column dragging requires horizontal movement.
  protected readonly isXs = this._layoutService.isXs;
  /**
   * Phone: the block opens as one line (the count and "Add to Today") so Today's
   * card is on the first screen, and the rows are one tap away. Wider layouts
   * always show the column.
   */
  protected readonly isExpanded = signal(false);

  enterPredicate(drag: CdkDrag, drop: CdkDropList): boolean {
    return false;
  }

  /** The disclosure line's action, the same one Today offers for its overdue tasks. */
  protected addAllToToday(event: Event): void {
    // The action sits inside the line that opens and closes the block.
    event.stopPropagation();
    const taskIds = (this.overdueTasks() ?? []).map((task) => task.id);
    if (!taskIds.length) return;
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds,
        today: this._dateService.todayStr(),
        startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
      }),
    );
  }
}
