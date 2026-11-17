import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { TaskViewCustomizerSheetComponent } from './task-view-customizer-sheet.component';
import { TaskViewCustomizerService } from '../task-view-customizer.service';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_PRIORITY,
  FilterOption,
  GROUP_OPTION_TYPE,
  GroupOption,
  OPTIONS,
  SORT_OPTION_TYPE,
  SORT_ORDER,
  SortOption,
} from '../types';
import { T } from '../../../t.const';

describe('TaskViewCustomizerSheetComponent', () => {
  let fixture: ComponentFixture<TaskViewCustomizerSheetComponent>;
  let host: HTMLElement;
  let selectedSort: WritableSignal<SortOption>;
  let selectedGroup: WritableSignal<GroupOption>;
  let selectedFilter: WritableSignal<FilterOption>;
  let service: {
    selectedSort: WritableSignal<SortOption>;
    selectedGroup: WritableSignal<GroupOption>;
    selectedFilter: WritableSignal<FilterOption>;
    availableGroupOptions: WritableSignal<GroupOption[]>;
    isCustomized: () => boolean;
    setSort: jasmine.Spy;
    setGroup: jasmine.Spy;
    setFilter: jasmine.Spy;
    setFilterPreset: jasmine.Spy;
    resetAll: jasmine.Spy;
    saveSort: jasmine.Spy;
  };

  const rows = (): HTMLElement[] =>
    Array.from(host.querySelectorAll<HTMLElement>('.sheet-row'));
  const rowLabels = (): string[] =>
    rows().map((r) => r.querySelector('.sheet-label')?.textContent?.trim() ?? '');
  const rowByLabel = (key: string): HTMLElement => {
    const row = rows().find(
      (r) => r.querySelector('.sheet-label')?.textContent?.trim() === key,
    );
    if (!row) {
      throw new Error(`no row "${key}" among ${rowLabels().join(', ')}`);
    }
    return row;
  };
  const tap = (el: HTMLElement): void => {
    el.click();
    fixture.detectChanges();
  };
  const title = (): string =>
    host.querySelector('.sheet-title')?.textContent?.trim() ?? '';

  beforeEach(async () => {
    selectedSort = signal<SortOption>(DEFAULT_OPTIONS.sort);
    selectedGroup = signal<GroupOption>(DEFAULT_OPTIONS.group);
    selectedFilter = signal<FilterOption>(DEFAULT_OPTIONS.filter);
    service = {
      selectedSort,
      selectedGroup,
      selectedFilter,
      availableGroupOptions: signal<GroupOption[]>(OPTIONS.group.list),
      isCustomized: () =>
        selectedSort().type !== null ||
        selectedGroup().type !== null ||
        selectedFilter().type !== null,
      setSort: jasmine.createSpy('setSort'),
      setGroup: jasmine.createSpy('setGroup'),
      setFilter: jasmine.createSpy('setFilter'),
      setFilterPreset: jasmine.createSpy('setFilterPreset'),
      resetAll: jasmine.createSpy('resetAll'),
      saveSort: jasmine.createSpy('saveSort').and.resolveTo(),
    };
    await TestBed.configureTestingModule({
      imports: [TaskViewCustomizerSheetComponent, TranslateModule.forRoot()],
      providers: [{ provide: TaskViewCustomizerService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(TaskViewCustomizerSheetComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  describe('the root', () => {
    it('offers sort, group and filter as three rows, titled for all three', () => {
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
      expect(rowLabels()).toEqual([
        T.F.TASK_VIEW.CUSTOMIZER.SORT,
        T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY,
        T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY,
      ]);
    });

    it('shows what each is set to, and nothing for the defaults', () => {
      expect(host.querySelectorAll('.sheet-value').length).toBe(0);

      selectedSort.set({
        type: SORT_OPTION_TYPE.name,
        order: SORT_ORDER.ASC,
        label: T.F.TASK_VIEW.CUSTOMIZER.SORT_NAME,
      });
      selectedGroup.set({
        type: GROUP_OPTION_TYPE.tag,
        label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG,
      });
      selectedFilter.set({
        type: FILTER_OPTION_TYPE.priority,
        preset: FILTER_PRIORITY.high,
        label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY,
      });
      fixture.detectChanges();

      const values = Array.from(host.querySelectorAll('.sheet-value')).map(
        (v) => v.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );
      expect(values.length).toBe(3);
      expect(values[0]).toContain(T.F.TASK_VIEW.CUSTOMIZER.SORT_NAME);
      expect(values[1]).toBe(T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG);
      expect(values[2]).toContain(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY);
      expect(values[2]).toContain(T.F.TASK.CMP.PRIORITY_HIGH);
    });

    it('resets all, and only offers it once something is set', () => {
      const reset = host.querySelector<HTMLButtonElement>('.sheet-reset')!;
      expect(reset.disabled).toBeTrue();

      selectedSort.set({ type: SORT_OPTION_TYPE.name, label: 'x' });
      fixture.detectChanges();
      expect(reset.disabled).toBeFalse();

      reset.click();
      expect(service.resetAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('sort', () => {
    beforeEach(() => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.SORT));
    });

    it('is a radio list of every option, the current one checked', () => {
      expect(title()).toBe(T.F.TASK_VIEW.CUSTOMIZER.SORT);
      const radios = rows().filter((r) => r.getAttribute('role') === 'radio');
      expect(radios.length).toBe(OPTIONS.sort.list.length);
      expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true').length).toBe(
        1,
      );
      // The default (no sort) is the one checked while nothing is set.
      expect(radios[0].getAttribute('aria-checked')).toBe('true');
    });

    it('sets the choice and goes back to the root', () => {
      const name = OPTIONS.sort.list.find((o) => o.type === SORT_OPTION_TYPE.name)!;
      tap(rowByLabel(name.label));

      expect(service.setSort).toHaveBeenCalledOnceWith(name);
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
    });

    it('saves the order as default, which only makes sense once a sort is set', () => {
      const save = rows().find((r) => r.classList.contains('sheet-row--action'))!;
      expect((save as HTMLButtonElement).disabled).toBeTrue();
    });

    it('goes back with the back button', () => {
      host.querySelector<HTMLElement>('.sheet-back')!.click();
      fixture.detectChanges();
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
    });
  });

  describe('group', () => {
    it('lists what the service offers for this context and sets the choice', () => {
      service.availableGroupOptions.set(
        OPTIONS.group.list.filter((o) => o.type !== GROUP_OPTION_TYPE.project),
      );
      fixture.detectChanges();
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.GROUP_BY));

      expect(rowLabels()).not.toContain(T.F.TASK_VIEW.CUSTOMIZER.GROUP_PROJECT);
      const tag = OPTIONS.group.list.find((o) => o.type === GROUP_OPTION_TYPE.tag)!;
      tap(rowByLabel(tag.label));

      expect(service.setGroup).toHaveBeenCalledOnceWith(tag);
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY));
    });

    it('asks for the kind first, then for its value', () => {
      expect(title()).toBe(T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY);
      expect(rowLabels().length).toBe(OPTIONS.filter.list.length);

      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY));
      expect(title()).toBe(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY);
      expect(rowLabels()).toEqual([
        T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED,
        T.F.TASK.CMP.PRIORITY_LOW,
        T.F.TASK.CMP.PRIORITY_MEDIUM,
        T.F.TASK.CMP.PRIORITY_HIGH,
      ]);

      tap(rowByLabel(T.F.TASK.CMP.PRIORITY_HIGH));
      expect(service.setFilterPreset).toHaveBeenCalledOnceWith(
        FILTER_OPTION_TYPE.priority,
        FILTER_PRIORITY.high,
      );
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
    });

    it('clears the filter from the no-filter row', () => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_DEFAULT));

      expect(service.setFilter).toHaveBeenCalledOnceWith(DEFAULT_OPTIONS.filter);
      expect(title()).toBe(T.MH.SORT_GROUP_FILTER);
    });

    it('goes back from the values to the kinds, not to the root', () => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY));
      host.querySelector<HTMLElement>('.sheet-back')!.click();
      fixture.detectChanges();

      expect(title()).toBe(T.F.TASK_VIEW.CUSTOMIZER.FILTER_BY);
    });

    it('marks the chosen value', () => {
      selectedFilter.set({
        type: FILTER_OPTION_TYPE.priority,
        preset: FILTER_PRIORITY.medium,
        label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY,
      });
      fixture.detectChanges();
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY));

      expect(
        rows()
          .filter((r) => r.getAttribute('aria-checked') === 'true')
          .map((r) => r.querySelector('.sheet-label')?.textContent?.trim()),
      ).toEqual([T.F.TASK.CMP.PRIORITY_MEDIUM]);
    });

    it('puts the text field of a tag filter at the top of its list and applies as you type', () => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_TAG));

      const field = host.querySelector<HTMLInputElement>('.sheet-field input')!;
      expect(field).toBeTruthy();
      // above the list of values, not under it
      expect(
        field.compareDocumentPosition(host.querySelector('.sheet-list')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(rowLabels()).toEqual([T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED]);

      field.value = 'home';
      field.dispatchEvent(new Event('input'));
      expect(service.setFilterPreset).toHaveBeenCalledWith(
        FILTER_OPTION_TYPE.tag,
        'home',
      );

      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED));
      expect(service.setFilterPreset).toHaveBeenCalledWith(
        FILTER_OPTION_TYPE.tag,
        FILTER_COMMON.NOT_SPECIFIED,
      );
    });

    it('has only the text field for a project filter', () => {
      tap(rowByLabel(T.F.TASK_VIEW.CUSTOMIZER.FILTER_PROJECT));

      expect(host.querySelector('.sheet-field input')).toBeTruthy();
      expect(rows().length).toBe(0);
    });
  });
});
