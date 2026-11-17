import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { TrackedTaskPillComponent } from './tracked-task-pill.component';
import { LayoutService } from '../../layout/layout.service';
import { NavigateToTaskService } from '../../navigate-to-task/navigate-to-task.service';
import { Task } from '../../../features/tasks/task.model';
import { T } from '../../../t.const';

describe('TrackedTaskPillComponent', () => {
  let fixture: ComponentFixture<TrackedTaskPillComponent>;
  let isXs: WritableSignal<boolean>;
  let navigate: jasmine.Spy;

  const chip = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('button.current-task-title');

  beforeEach(async () => {
    isXs = signal(false);
    navigate = jasmine.createSpy('navigate');
    await TestBed.configureTestingModule({
      imports: [
        TrackedTaskPillComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule,
      ],
      providers: [
        { provide: LayoutService, useValue: { isXs } },
        { provide: NavigateToTaskService, useValue: { navigate } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TrackedTaskPillComponent);
    fixture.componentRef.setInput('currentTask', {
      id: 't1',
      title: 'Write the report',
    } as Task);
    fixture.detectChanges();
  });

  it('shows nothing while no task is tracked', async () => {
    fixture.componentRef.setInput('currentTask', undefined);
    fixture.detectChanges();
    // the chip fades out before it leaves the DOM
    await fixture.whenStable();
    fixture.detectChanges();

    expect(chip()).toBeNull();
  });

  it('names the tracked task and jumps to it on a tap', () => {
    expect(chip()!.textContent).toContain('Write the report');
    expect(chip()!.getAttribute('aria-label')).toBe(T.MH.SHOW_TRACKED_TASK);

    chip()!.click();

    expect(navigate).toHaveBeenCalledOnceWith('t1');
  });

  // Below 600px the pill used to be display: none, so on any page but the
  // task's own nothing said which task was running and nothing jumped to it.
  it('is a one-line chip on a phone, shown and tappable rather than hidden', () => {
    expect(chip()!.classList).not.toContain('is-phone-chip');

    isXs.set(true);
    fixture.detectChanges();

    expect(chip()!.classList).toContain('is-phone-chip');
    expect(getComputedStyle(chip()!).display).not.toBe('none');
    chip()!.click();
    expect(navigate).toHaveBeenCalledOnceWith('t1');
  });
});
