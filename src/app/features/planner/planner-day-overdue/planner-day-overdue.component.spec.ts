import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { DateService } from '../../../core/date/date.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { TaskCopy } from '../../tasks/task.model';
import { TaskMultiSelectService } from '../../tasks/task-multi-select.service';
import { PlannerDayOverdueComponent } from './planner-day-overdue.component';

describe('PlannerDayOverdueComponent', () => {
  let fixture: ComponentFixture<PlannerDayOverdueComponent>;
  let component: PlannerDayOverdueComponent;
  let store: MockStore;

  const task = (id: string, timeEstimate = 0): TaskCopy =>
    ({ id, title: id, timeEstimate }) as TaskCopy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlannerDayOverdueComponent],
      providers: [
        provideMockStore(),
        { provide: LayoutService, useValue: { isXs: signal(true) } },
        {
          provide: TaskMultiSelectService,
          useValue: { isTouchSelectionMode: signal(false) },
        },
        {
          provide: DateService,
          useValue: {
            todayStr: () => '2026-11-15',
            getStartOfNextDayDiffMs: () => 4 * 3600 * 1000,
          },
        },
      ],
    })
      // The rows and the disclosure are other components' business; this is about
      // the block's own state and what its action does.
      .overrideComponent(PlannerDayOverdueComponent, {
        set: { imports: [], template: '' },
      })
      .compileComponents();

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    fixture = TestBed.createComponent(PlannerDayOverdueComponent);
    component = fixture.componentInstance;
  });

  it('opens collapsed, so Upcoming starts on today and not on what is behind', () => {
    expect(component['isExpanded']()).toBe(false);
  });

  it('counts a task that is overdue and has a deadline once', () => {
    fixture.componentRef.setInput('overdueTasks', [task('a'), task('b'), task('c')]);
    fixture.componentRef.setInput('overdueDeadlineTasks', [task('c'), task('d')]);

    expect(component.overdueCount()).toBe(4);
  });

  it('counts deadlines alone, and nothing for nothing', () => {
    expect(component.overdueCount()).toBe(0);

    fixture.componentRef.setInput('overdueDeadlineTasks', [task('d')]);

    expect(component.overdueCount()).toBe(1);
  });

  it('sums the estimate of the overdue tasks', () => {
    fixture.componentRef.setInput('overdueTasks', [
      task('a', 1800000),
      task('b', 600000),
    ]);

    expect(component.totalEstimate()).toBe(2400000);
  });

  describe('Add to Today', () => {
    it('plans every overdue task for today, as the Today list does', () => {
      fixture.componentRef.setInput('overdueTasks', [task('a'), task('b')]);
      fixture.componentRef.setInput('overdueDeadlineTasks', [task('d')]);

      component['addAllToToday'](new Event('click'));

      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.planTasksForToday({
          taskIds: ['a', 'b'],
          today: '2026-11-15',
          startOfNextDayDiffMs: 4 * 3600 * 1000,
        }),
      );
    });

    it('does not also toggle the disclosure line it sits in', () => {
      fixture.componentRef.setInput('overdueTasks', [task('a')]);
      const event = new Event('click');
      spyOn(event, 'stopPropagation');

      component['addAllToToday'](event);

      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('does nothing when only deadlines are behind', () => {
      fixture.componentRef.setInput('overdueDeadlineTasks', [task('d')]);

      component['addAllToToday'](new Event('click'));

      expect(store.dispatch).not.toHaveBeenCalled();
    });
  });
});
