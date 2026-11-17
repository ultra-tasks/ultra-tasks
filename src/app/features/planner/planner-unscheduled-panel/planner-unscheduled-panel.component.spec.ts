import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { LS } from '../../../core/persistence/storage-keys.const';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { Project } from '../../project/project.model';
import { Task } from '../../tasks/task.model';
import {
  PlannerUnscheduledPanelComponent,
  UNSCHEDULED_MAX_ROWS,
} from './planner-unscheduled-panel.component';
import {
  PlannerUnscheduledPanelService,
  UNSCHEDULED_FILTER_ALL,
} from './planner-unscheduled-panel.service';

describe('PlannerUnscheduledPanelComponent', () => {
  let fixture: ComponentFixture<PlannerUnscheduledPanelComponent>;
  let panel: PlannerUnscheduledPanelService;
  let dialogOpen: jasmine.Spy;

  const task = (id: string, over: Partial<Task> = {}): Task =>
    ({ id, title: `Task ${id}`, projectId: 'INBOX_PROJECT', ...over }) as Task;
  const project = (id: string, over: Partial<Project> = {}): Project =>
    ({ id, title: id, backlogTaskIds: [], ...over }) as Project;

  const setup = async (
    tasks: Task[],
    projects: Project[],
    isSheet = false,
  ): Promise<void> => {
    dialogOpen = jasmine.createSpy('open');
    await TestBed.configureTestingModule({
      imports: [PlannerUnscheduledPanelComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: LayoutService, useValue: { isXs: signal(isSheet) } },
        provideMockStore({
          selectors: [
            { selector: selectAllTasks, value: tasks },
            { selector: selectUnarchivedProjects, value: projects },
          ],
        }),
      ],
    }).compileComponents();
    panel = TestBed.inject(PlannerUnscheduledPanelService);
    fixture = TestBed.createComponent(PlannerUnscheduledPanelComponent);
    fixture.componentRef.setInput('isSheet', isSheet);
    fixture.detectChanges();
  };

  const rowTitles = (): string[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.row .title'),
    ).map((el) => el.textContent?.trim() ?? '');

  beforeEach(() => {
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_FILTER);
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_OPEN);
  });

  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_FILTER);
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_OPEN);
  });

  it('lists unscheduled top-level tasks from every project, and nothing else', async () => {
    await setup(
      [
        task('inbox'),
        task('work', { projectId: 'work' }),
        task('planned', { dueDay: '2026-11-12' }),
        task('timed', { dueWithTime: 1234 }),
        task('done', { isDone: true }),
        task('child', { parentId: 'inbox' }),
        task('hidden', { integration: { hidden: true } } as Partial<Task>),
        task('later', { projectId: 'work' }),
      ],
      [project('INBOX_PROJECT'), project('work', { backlogTaskIds: ['later'] })],
    );

    expect(rowTitles()).toEqual(['Task inbox', 'Task work']);
  });

  it('filters to one project and offers the rest again on All', async () => {
    await setup(
      [task('inbox'), task('work', { projectId: 'work' })],
      [project('INBOX_PROJECT'), project('work')],
    );

    panel.setProjectFilter('work');
    fixture.detectChanges();
    expect(rowTitles()).toEqual(['Task work']);

    panel.setProjectFilter(UNSCHEDULED_FILTER_ALL);
    fixture.detectChanges();
    expect(rowTitles()).toEqual(['Task inbox', 'Task work']);
  });

  it('falls back to all projects when the stored project is gone', async () => {
    localStorage.setItem(LS.PLANNER_UNSCHEDULED_FILTER, 'deleted-project');
    await setup([task('inbox')], [project('INBOX_PROJECT')]);

    expect(rowTitles()).toEqual(['Task inbox']);
  });

  it('draws at most the row cap and says how many more there are', async () => {
    const many = Array.from({ length: UNSCHEDULED_MAX_ROWS + 5 }, (_, i) =>
      task(`t${i}`),
    );
    await setup(many, [project('INBOX_PROJECT')]);

    expect(rowTitles().length).toBe(UNSCHEDULED_MAX_ROWS);
    expect(fixture.nativeElement.textContent).toContain('F.PLANNER.UNSCHEDULED_MORE');
  });

  it('shows an empty line when nothing is unscheduled', async () => {
    await setup([], [project('INBOX_PROJECT')]);

    expect(rowTitles()).toEqual([]);
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
  });

  it('opens the scheduling dialog from a row, and closes through the service', async () => {
    const t = task('inbox');
    await setup([t], [project('INBOX_PROJECT')]);

    (fixture.nativeElement.querySelector('.schedule-btn') as HTMLButtonElement).click();
    expect(dialogOpen).toHaveBeenCalledWith(jasmine.any(Function), { data: { task: t } });

    panel.toggle();
    expect(panel.isOpen()).toBe(true);
    (fixture.nativeElement.querySelector('.close-btn') as HTMLButtonElement).click();
    expect(panel.isOpen()).toBe(false);
    expect(localStorage.getItem(LS.PLANNER_UNSCHEDULED_OPEN)).toBe('false');
  });

  describe('as the phone sheet', () => {
    it('closes the sheet, not the desktop panel, from its close button', async () => {
      await setup([task('inbox')], [project('INBOX_PROJECT')], true);
      const closeSheet = spyOn(panel, 'closeSheet');
      panel.open();

      (fixture.nativeElement.querySelector('.close-btn') as HTMLButtonElement).click();

      expect(closeSheet).toHaveBeenCalledTimes(1);
      expect(panel.isOpen()).toBe(true);
    });

    it('marks itself for the sheet styles and drops the drag hint', async () => {
      await setup([task('inbox')], [project('INBOX_PROJECT')], true);

      expect(fixture.nativeElement.classList).toContain('is-sheet');
      expect(fixture.nativeElement.querySelector('.hint')).toBeNull();
    });

    it('has no day to drag a row onto, so a row cannot be dragged', async () => {
      await setup([task('inbox'), task('work')], [project('INBOX_PROJECT')], true);

      const drags = fixture.debugElement.queryAll(By.directive(CdkDrag));
      expect(drags.length).toBe(2);
      for (const drag of drags) {
        expect((drag.injector.get(CdkDrag) as CdkDrag).disabled).toBe(true);
      }
    });

    it('keeps the Schedule button, the one way to give a task its day', async () => {
      const t = task('inbox');
      await setup([t], [project('INBOX_PROJECT')], true);

      (fixture.nativeElement.querySelector('.schedule-btn') as HTMLButtonElement).click();

      expect(dialogOpen).toHaveBeenCalledWith(jasmine.any(Function), {
        data: { task: t },
      });
    });

    it('still shows the drag hint and drags rows beside the days', async () => {
      await setup([task('inbox')], [project('INBOX_PROJECT')]);

      expect(fixture.nativeElement.querySelector('.hint')).not.toBeNull();
      const drag = fixture.debugElement.query(By.directive(CdkDrag));
      expect((drag.injector.get(CdkDrag) as CdkDrag).disabled).toBe(false);
    });

    it('marks a row that has a project or an estimate, so a bare title can centre', async () => {
      await setup(
        [task('bare'), task('estimated', { timeEstimate: 1800000 })],
        [project('INBOX_PROJECT')],
        true,
      );

      const rows = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.row'),
      );
      expect(rows.map((row) => row.classList.contains('has-meta'))).toEqual([
        false,
        true,
      ]);
    });
  });
});
