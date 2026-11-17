import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { ScheduledListPageComponent } from './scheduled-list-page.component';
import { TaskRepeatCfgService } from '../../features/task-repeat-cfg/task-repeat-cfg.service';
import { TaskRepeatCfg } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { selectTaskRepeatCfgsSortedByTitleAndProject } from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { TaskTitleComponent } from '../../ui/task-title/task-title.component';
import { TagListComponent } from '../../features/tag/tag-list/tag-list.component';

@Component({ selector: 'task-title', template: '' })
class TaskTitleStubComponent {
  readonly value = input<string>('');
  readonly valueEdited = output<{ wasChanged: boolean; newVal: string }>();
}

@Component({ selector: 'tag-list', template: '' })
class TagListStubComponent {
  readonly task = input<unknown>();
  readonly isShowProjectTagAlways = input<boolean>(false);
}

const cfg = (id: string, title: string, isPaused: boolean): TaskRepeatCfg =>
  ({ id, title, isPaused }) as unknown as TaskRepeatCfg;

describe('ScheduledListPageComponent', () => {
  let fixture: ComponentFixture<ScheduledListPageComponent>;
  const el = (): HTMLElement => fixture.nativeElement;

  const setUp = async (cfgs: TaskRepeatCfg[]): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [
        ScheduledListPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectTaskRepeatCfgsSortedByTitleAndProject, value: cfgs },
          ],
        }),
        { provide: TaskRepeatCfgService, useValue: { updateTaskRepeatCfg: () => {} } },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
      ],
    })
      .overrideComponent(ScheduledListPageComponent, {
        remove: { imports: [TaskTitleComponent, TagListComponent] },
        add: { imports: [TaskTitleStubComponent, TagListStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ScheduledListPageComponent);
    // The recurrence sentence needs the whole date-format service: not under test.
    fixture.componentInstance.getRepeatInfoText = (c): string => `every ${c.title}`;
    fixture.componentInstance.getTooltipText = (): string => '';
    fixture.detectChanges();
  };

  it('says nothing is repeating when there are no repeats', async () => {
    await setUp([]);
    expect(el().querySelector('.empty-state')).not.toBeNull();
    expect(el().querySelectorAll('.repeat-task-cfg').length).toBe(0);
  });

  it('keeps the repeat glyph on every row, whatever the width', async () => {
    await setUp([cfg('a', 'Daily', false), cfg('b', 'Weekly', true)]);
    const rows = Array.from(el().querySelectorAll('.repeat-task-cfg'));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const glyph = row.querySelector('.repeat-text-and-icon mat-icon');
      expect(glyph?.textContent?.trim()).toBe('repeat');
    }
  });

  it('marks a paused repeat as paused, and only that one', async () => {
    await setUp([cfg('a', 'Daily', false), cfg('b', 'Weekly', true)]);
    const rows = Array.from(el().querySelectorAll('.repeat-task-cfg'));
    expect(rows[0].querySelector('.repeat-paused')).toBeNull();
    const paused = rows[1].querySelector('.repeat-paused');
    expect(paused?.textContent?.trim()).toBe('F.TASK_REPEAT.F.IS_PAUSED');
  });

  it('names the pause in the edit button too, for assistive tech', async () => {
    await setUp([cfg('a', 'Daily', false), cfg('b', 'Weekly', true)]);
    const buttons = Array.from(
      el().querySelectorAll('.repeat-text-and-icon[role="button"]'),
    );
    expect(buttons[0].getAttribute('aria-label')).not.toContain('IS_PAUSED');
    expect(buttons[1].getAttribute('aria-label')).toContain('F.TASK_REPEAT.F.IS_PAUSED');
  });
});
