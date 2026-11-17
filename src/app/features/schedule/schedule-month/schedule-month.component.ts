import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { ScheduleEvent } from '../schedule.model';
import { SVEType } from '../schedule.const';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { ScheduleEventComponent } from '../schedule-event/schedule-event.component';
import { safeFormatDate } from 'src/app/util/safe-format-date';
import { ScheduleService } from '../schedule.service';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';
import { parseDbDateStr } from 'src/app/util/parse-db-date-str';
import { TranslatePipe, TranslateService, TranslateStore } from '@ngx-translate/core';
import { getPluralKey } from '../../../util/get-plural-key';
import { TaskCopy } from '../../tasks/task.model';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { T } from '../../../t.const';

// `grid-template-rows` repeats `var(--nr-of-weeks)`, which otherwise resolves to
// the static 6 declared on `schedule`. At 5 weeks that leaves a sixth, empty row
// and sizes every row 1/6 instead of 1/5 (#9584).
const HOST_WEEKS_VAR = '[style.--nr-of-weeks]' as const;

const HOST_BINDINGS = {
  [HOST_WEEKS_VAR]: 'weeksToShow()',
} as const;

// How many events a day cell of a six-week month has room for: one on a phone
// or a short window, two from a typical laptop height, three on a tall screen.
// The rest are counted in the cell header ("+N") instead of scrolling out of
// sight inside the cell.
const TWO_EVENTS_QUERY = '(min-width: 600px) and (min-height: 880px)';
const THREE_EVENTS_QUERY = '(min-width: 600px) and (min-height: 1100px)';

// On a phone a cell is about 50px wide: a chip would read "Re…". There a day is
// one tap target that opens it, and its events are dots (a hollow one for a
// repeat that has no task yet); the cell header counts the rest ("+N").
const MAX_DOTS_PER_DAY = 3;

const PROJECTED_EVENT_TYPES: ReadonlySet<SVEType> = new Set([
  SVEType.RepeatProjection,
  SVEType.RepeatProjectionSplit,
  SVEType.RepeatProjectionSplitContinued,
  SVEType.RepeatProjectionSplitContinuedLast,
  SVEType.ScheduledRepeatProjection,
]);

/** A repeat's projected occurrence: not a task yet, drawn as a hollow dot. */
export const isProjectedEvent = (ev: Pick<ScheduleEvent, 'type'>): boolean =>
  PROJECTED_EVENT_TYPES.has(ev.type);

@Component({
  selector: 'schedule-month',
  imports: [ScheduleEventComponent, TranslatePipe, MatIcon, MatTooltip],
  templateUrl: './schedule-month.component.html',
  styleUrl: './schedule-month.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  host: HOST_BINDINGS,
})
export class ScheduleMonthComponent {
  private _scheduleService = inject(ScheduleService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translateService = inject(TranslateService);
  private _translateStore = inject(TranslateStore);

  /** The phone layout: days are dots that open the day instead of event chips. */
  readonly isXs = inject(LayoutService).isXs;

  readonly maxVisibleEvents = toSignal(
    inject(BreakpointObserver)
      .observe([TWO_EVENTS_QUERY, THREE_EVENTS_QUERY])
      .pipe(
        map(({ breakpoints }) =>
          breakpoints[THREE_EVENTS_QUERY] ? 3 : breakpoints[TWO_EVENTS_QUERY] ? 2 : 1,
        ),
      ),
    { initialValue: 1 },
  );

  readonly events = input<ScheduleEvent[] | null>([]);
  readonly daysToShow = input<string[]>([]);
  readonly weeksToShow = input<number>(6);
  readonly firstDayOfWeek = input<number>(1);
  readonly deadlineTasksByDay = input<Record<string, TaskCopy[]> | null>(null);
  /** A day was tapped (phone layout): show it in the day view. */
  readonly openDay = output<string>();

  /** How many events a cell draws: chips by window size, or the dots on a phone. */
  readonly maxEventsShown = computed(() =>
    this.isXs() ? MAX_DOTS_PER_DAY : this.maxVisibleEvents(),
  );

  // Generate weekday headers based on firstDayOfWeek setting
  readonly weekdayHeaders = computed(() => {
    const firstDay = this.firstDayOfWeek();
    const headers: string[] = [];
    const isoTextLocale = this._dateTimeFormatService.isoTextLocale();
    const formatter = isoTextLocale
      ? new Intl.DateTimeFormat(isoTextLocale, { weekday: 'short' })
      : null;
    const locale = this._dateTimeFormatService.currentLocale();

    // Create a date for each day of week (using a week starting on Sunday)
    // January 2, 2000 was a Sunday
    const sundayDate = new Date(2000, 0, 2);

    for (let i = 0; i < 7; i++) {
      const dayIndex = (firstDay + i) % 7;
      const date = new Date(sundayDate);
      date.setDate(sundayDate.getDate() + dayIndex);
      headers.push(
        formatter ? formatter.format(date) : safeFormatDate(date, 'EEE', locale),
      );
    }

    return headers;
  });

  // Precompute the day-of-month label for every visible day, keyed on the day
  // list + current locale. Replaces a per-cell `| localeDate: 'd'` pipe (up to
  // 42 cells) so no date formatting happens during change detection; the map
  // only recomputes when the days or the locale change.
  readonly dayNumberByDay = computed<Record<string, string>>(() => {
    const locale = this._dateTimeFormatService.currentLocale();
    const labels: Record<string, string> = {};
    for (const day of this.daysToShow()) {
      labels[day] = safeFormatDate(day, 'd', locale);
    }
    return labels;
  });

  /**
   * The name of each day's tap target (phone layout): the date, and how many
   * events it holds. Built once per change, not per cell during change detection.
   */
  readonly openDayLabelByDay = computed<Record<string, string>>(() => {
    if (!this.isXs()) return {};
    const textLocale = this._dateTimeFormatService.textLocale();
    const isIso = this._dateTimeFormatService.isoTextLocale() !== null;
    const formatter = new Intl.DateTimeFormat(textLocale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      ...(isIso ? { calendar: 'gregory', numberingSystem: 'latn' } : {}),
    });
    const events = this.events() || [];
    const labels: Record<string, string> = {};
    for (const day of this.daysToShow()) {
      const date = formatter.format(parseDbDateStr(day));
      const count = this._scheduleService.getEventsForDay(day, events).length;
      labels[day] = count
        ? this._translateService.instant(
            getPluralKey(
              this._translateService,
              this._translateStore,
              count,
              'F.SCHEDULE.DAY_EVENTS',
            ),
            { date, count },
          )
        : date;
    }
    return labels;
  });

  readonly deadlineBadgesByDay = computed<
    Record<string, { count: number; tooltip: string }>
  >(() => {
    const deadlinesByDay = this.deadlineTasksByDay() || {};
    const badges: Record<string, { count: number; tooltip: string }> = {};

    for (const day of this.daysToShow()) {
      const tasks = deadlinesByDay[day] || [];
      if (tasks.length === 0) continue;

      badges[day] = {
        count: tasks.length,
        tooltip: this._translateService.instant(
          tasks.length === 1
            ? T.F.SCHEDULE.DEADLINE_TASKS_TOOLTIP_ONE
            : T.F.SCHEDULE.DEADLINE_TASKS_TOOLTIP,
          {
            count: tasks.length,
            titles: tasks.map((task) => task.title).join(', '),
          },
        ),
      };
    }

    return badges;
  });

  // Determine the reference month from the displayed days
  // Find the first day that's actually in the target month (not padding days)
  readonly referenceMonth = computed(() => {
    const days = this.daysToShow();
    if (days.length === 0) return new Date();

    // Use the middle day as reference (around day 14-15 of the month)
    // This ensures we get a day that's actually in the target month
    const middleIndex = Math.floor(days.length / 2);
    return parseDbDateStr(days[middleIndex]);
  });

  getDayClass(day: string): string {
    return this._scheduleService.getDayClass(day, this.referenceMonth());
  }

  getWeekIndex(dayIndex: number): number {
    return Math.floor(dayIndex / 7);
  }

  getDayIndex(dayIndex: number): number {
    return dayIndex % 7;
  }

  getEventsForDay(day: string): ScheduleEvent[] {
    return this._scheduleService.getEventsForDay(day, this.events() || []);
  }

  isProjected(ev: ScheduleEvent): boolean {
    return isProjectedEvent(ev);
  }

  getMoreEventsKey(count: number): string {
    return getPluralKey(
      this._translateService,
      this._translateStore,
      count,
      'F.SCHEDULE.MORE_EVENTS',
    );
  }

  getEventDayStr(ev: ScheduleEvent): string | null {
    return this._scheduleService.getEventDayStr(ev);
  }
}
