import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { Store } from '@ngrx/store';
import { Task } from '../../../features/tasks/task.model';
import { TaskService } from '../../../features/tasks/task.service';
import { MagicNavConfigService } from '../../magic-side-nav/magic-nav-config.service';
import { PlayButtonComponent } from './play-button.component';
import { T } from '../../../t.const';

describe('PlayButtonComponent', () => {
  let taskService: jasmine.SpyObj<TaskService>;
  let navConfigService: jasmine.SpyObj<MagicNavConfigService>;
  let component: PlayButtonComponent;
  let fixture: ComponentFixture<PlayButtonComponent>;
  let lastCurrentTask$: BehaviorSubject<Task | null>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', ['toggleStartTask'], {
      currentTask$: of(null),
      currentTaskProgress$: of(0),
    });
    navConfigService = jasmine.createSpyObj<MagicNavConfigService>(
      'MagicNavConfigService',
      ['disableFeature'],
    );

    lastCurrentTask$ = new BehaviorSubject<Task | null>(null);
    TestBed.configureTestingModule({
      imports: [PlayButtonComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: Store, useValue: { select: () => lastCurrentTask$ } },
        { provide: TaskService, useValue: taskService },
        { provide: MagicNavConfigService, useValue: navConfigService },
      ],
    });
    fixture = TestBed.createComponent(PlayButtonComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('toggles tracking on a normal click', () => {
    component.onPlayPointerDown();
    component.onPlayClick();
    expect(taskService.toggleStartTask).toHaveBeenCalledTimes(1);
  });

  it('ignores the click that ends a long press', () => {
    component.onPlayPointerDown();
    component.onLongPress();
    component.onPlayClick();
    expect(taskService.toggleStartTask).not.toHaveBeenCalled();
  });

  it('does not swallow the next tap when the long press ended without a click', () => {
    // e.g. the menu backdrop took the release, then the menu was closed
    component.onPlayPointerDown();
    component.onLongPress();

    component.onPlayPointerDown();
    component.onPlayClick();
    expect(taskService.toggleStartTask).toHaveBeenCalledTimes(1);
  });

  it('disables time tracking like the side nav disables its features', () => {
    component.disableTimeTracking();
    expect(navConfigService.disableFeature).toHaveBeenCalledOnceWith(
      'isTimeTrackingEnabled',
      jasmine.any(String),
    );
  });
  // A static "Start/stop tracking time" said neither what pressing would do nor,
  // with a task running, which task: the name follows the state.
  describe('accessible name', () => {
    const label = (): string | null =>
      fixture.nativeElement.querySelector('button.play-btn').getAttribute('aria-label');

    it('says it starts tracking while idle', () => {
      expect(component.tooltipKey()).toBe(T.F.TASK.CMP.TRACK_TIME);
      expect(label()).toBe(T.F.TASK.CMP.TRACK_TIME);
    });

    it('says why it is off when there is nothing to track', () => {
      fixture.componentRef.setInput('hasTrackableTasks', false);
      fixture.detectChanges();

      expect(component.tooltipKey()).toBe(T.MH.NO_TASKS_TO_TRACK);
      expect(label()).toBe(T.MH.NO_TASKS_TO_TRACK);
    });

    it('names the task a press would resume while idle, when it can still be tracked', () => {
      lastCurrentTask$.next({
        id: 't9',
        title: 'Review PRs',
        isDone: false,
        subTaskIds: [],
      } as unknown as Task);
      fixture.detectChanges();

      expect(component.tooltipKey()).toBe(T.MH.RESUME_TRACKING_TASK);
      expect(component.tooltipParams()).toEqual({ title: 'Review PRs' });
    });

    it('does not name a last task that would not be picked up', () => {
      lastCurrentTask$.next({
        id: 't9',
        title: 'Done thing',
        isDone: true,
        subTaskIds: [],
      } as unknown as Task);
      fixture.detectChanges();
      expect(component.tooltipKey()).toBe(T.F.TASK.CMP.TRACK_TIME);

      lastCurrentTask$.next({
        id: 't9',
        title: 'Parent',
        isDone: false,
        subTaskIds: ['s1'],
      } as unknown as Task);
      fixture.detectChanges();
      expect(component.tooltipKey()).toBe(T.F.TASK.CMP.TRACK_TIME);
    });

    it('names the task it would pause while one is tracked', () => {
      fixture.componentRef.setInput('currentTaskId', 't1');
      fixture.componentRef.setInput('currentTaskTitle', 'Write the report');
      fixture.detectChanges();

      expect(component.tooltipKey()).toBe(T.MH.PAUSE_TRACKING_TASK);
      expect(component.tooltipParams()).toEqual({ title: 'Write the report' });
    });

    it('falls back to a plain "pause" when the title is not known yet', () => {
      fixture.componentRef.setInput('currentTaskId', 't1');
      fixture.detectChanges();

      expect(component.tooltipKey()).toBe(T.F.TASK.CMP.TRACK_TIME_STOP);
    });

    it('opts in to the touch size the shared button layer gives mini FABs', () => {
      expect(fixture.nativeElement.querySelector('button.play-btn').classList).toContain(
        'mat-mini-fab-touch',
      );
    });
  });
});
