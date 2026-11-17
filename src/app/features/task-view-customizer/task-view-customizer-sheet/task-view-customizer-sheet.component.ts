import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TaskViewCustomizerService } from '../task-view-customizer.service';
import {
  BaseOption,
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_PRIORITY,
  FILTER_SCHEDULE,
  FILTER_TIME,
  FilterOption,
  GroupOption,
  OPTIONS,
  PRESETS,
  SORT_ORDER,
  SortOption,
} from '../types';

type SheetView = 'root' | 'sort' | 'group' | 'filter' | 'filter-values';

type FilterPreset = BaseOption<
  FILTER_COMMON | FILTER_SCHEDULE | FILTER_TIME | FILTER_PRIORITY
>;

/** The fixed values each filter kind offers. Tag and project take free text. */
const PRESETS_BY_FILTER_TYPE: Partial<Record<FILTER_OPTION_TYPE, FilterPreset[]>> = {
  [FILTER_OPTION_TYPE.tag]: PRESETS.tag,
  [FILTER_OPTION_TYPE.scheduledDate]: PRESETS.schedule,
  [FILTER_OPTION_TYPE.deadline]: PRESETS.deadline,
  [FILTER_OPTION_TYPE.estimatedTime]: PRESETS.time,
  [FILTER_OPTION_TYPE.timeSpent]: PRESETS.time,
  [FILTER_OPTION_TYPE.priority]: PRESETS.priority,
};

/**
 * Sort, group and filter on a phone: the content of the bottom sheet.
 *
 * The same three choices as the header's menu cascade, which opened three panels
 * of 126 to 164px over one another, flush to the screen edges, with a text field
 * inside a menu. Here each choice is a list of 48px rows in the sheet: the root
 * shows the three with what is set, Sort and Group are radio lists, and Filter
 * goes in two steps (the kind, then its values). A choice goes back to the root.
 *
 * The state is the customizer service's, so the cascade (desktop), this sheet and
 * the saved per-context sort all stay one thing.
 */
@Component({
  selector: 'task-view-customizer-sheet',
  templateUrl: './task-view-customizer-sheet.component.html',
  styleUrl: './task-view-customizer-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatFormField, MatIcon, MatIconButton, MatInput, TranslatePipe],
})
export class TaskViewCustomizerSheetComponent {
  readonly customizerService = inject(TaskViewCustomizerService);

  readonly T = T;
  readonly DEFAULT = DEFAULT_OPTIONS;
  readonly OPTIONS = OPTIONS;
  readonly SORT_ORDER = SORT_ORDER;
  readonly FILTER_COMMON = FILTER_COMMON;

  readonly view = signal<SheetView>('root');
  /** The filter kind whose values are listed (view `filter-values`). */
  readonly activeFilterType = signal<FILTER_OPTION_TYPE | null>(null);

  readonly title = computed(() => {
    switch (this.view()) {
      case 'sort':
        return T.F.TASK_VIEW.CUSTOMIZER.SORT;
      case 'group':
        return T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY;
      case 'filter':
        return T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY;
      case 'filter-values':
        return (
          OPTIONS.filter.list.find((o) => o.type === this.activeFilterType())?.label ??
          T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY
        );
      default:
        return T.MH.SORT_GROUP_FILTER;
    }
  });

  /** Tag and project are typed, everything else is picked. */
  readonly isTextFilter = computed(() => {
    const type = this.activeFilterType();
    return type === FILTER_OPTION_TYPE.tag || type === FILTER_OPTION_TYPE.project;
  });
  readonly textFilterPlaceholder = computed(() =>
    this.activeFilterType() === FILTER_OPTION_TYPE.project
      ? T.F.TASK_VIEW.CUSTOMIZER.ENTER_PROJECT
      : T.F.TASK_VIEW.CUSTOMIZER.ENTER_TAG,
  );
  readonly activePresets = computed<FilterPreset[]>(() => {
    const type = this.activeFilterType();
    return (type && PRESETS_BY_FILTER_TYPE[type]) || [];
  });

  /** The text the tag or project filter is set to, for the field. */
  readonly filterText = computed(() => {
    const filter = this.customizerService.selectedFilter();
    if (
      !this.isTextFilter() ||
      filter.type !== this.activeFilterType() ||
      filter.preset === FILTER_COMMON.NOT_SPECIFIED
    ) {
      return '';
    }
    return filter.preset ?? '';
  });

  /** The translation key of the filter's chosen value, for the root row. */
  readonly filterValueKey = computed(() => {
    const filter = this.customizerService.selectedFilter();
    if (!filter.type) {
      return null;
    }
    const presets = PRESETS_BY_FILTER_TYPE[filter.type] ?? [];
    return presets.find((p) => p.type === filter.preset)?.label ?? null;
  });
  readonly filterValueText = computed(() => {
    const filter = this.customizerService.selectedFilter();
    const isText =
      filter.type === FILTER_OPTION_TYPE.tag ||
      filter.type === FILTER_OPTION_TYPE.project;
    return isText && filter.preset !== FILTER_COMMON.NOT_SPECIFIED ? filter.preset : null;
  });

  go(view: SheetView): void {
    this.view.set(view);
  }

  back(): void {
    this.view.set(this.view() === 'filter-values' ? 'filter' : 'root');
  }

  setSort(option: SortOption): void {
    this.customizerService.setSort(option);
    this.view.set('root');
  }

  async saveSort(): Promise<void> {
    this.view.set('root');
    await this.customizerService.saveSort();
  }

  setGroup(option: GroupOption): void {
    this.customizerService.setGroup(option);
    this.view.set('root');
  }

  /** Chooses a filter kind: "no filter" is done, any other asks for its value. */
  chooseFilterKind(kind: FilterOption): void {
    if (!kind.type) {
      this.customizerService.setFilter(DEFAULT_OPTIONS.filter);
      this.view.set('root');
      return;
    }
    this.activeFilterType.set(kind.type);
    this.view.set('filter-values');
  }

  chooseFilterPreset(preset: FilterPreset): void {
    const type = this.activeFilterType();
    if (type) {
      this.customizerService.setFilterPreset(type, preset.type);
    }
    this.view.set('root');
  }

  /** Typed text filters apply as the text changes, as they do in the menu. */
  onFilterTextChange(value: string | null): void {
    const type = this.activeFilterType();
    if (type) {
      this.customizerService.setFilterPreset(type, value);
    }
  }

  isFilterPresetSelected(preset: FilterPreset): boolean {
    const filter = this.customizerService.selectedFilter();
    return filter.type === this.activeFilterType() && filter.preset === preset.type;
  }

  resetAll(): void {
    this.customizerService.resetAll();
    this.view.set('root');
  }
}
