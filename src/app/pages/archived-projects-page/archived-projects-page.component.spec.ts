import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  ARCHIVED_SEARCH_MIN_PROJECTS,
  ArchivedProjectsPageComponent,
} from './archived-projects-page.component';
import { ProjectService } from '../../features/project/project.service';
import { Project } from '../../features/project/project.model';
import { selectArchivedProjectsSortedByTitle } from '../../features/project/store/project.selectors';

const makeProject = (id: string, title: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    title,
    isArchived: true,
    isHiddenFromMenu: false,
    theme: { primary: '#fff' },
    ...over,
  }) as unknown as Project;

describe('ArchivedProjectsPageComponent', () => {
  let fixture: ComponentFixture<ArchivedProjectsPageComponent>;
  let component: ArchivedProjectsPageComponent;
  let projectService: jasmine.SpyObj<ProjectService>;

  const setUp = async (projects: Project[]): Promise<void> => {
    projectService = jasmine.createSpyObj('ProjectService', ['unarchive', 'reopen']);

    await TestBed.configureTestingModule({
      imports: [
        ArchivedProjectsPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [{ selector: selectArchivedProjectsSortedByTitle, value: projects }],
        }),
        { provide: ProjectService, useValue: projectService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArchivedProjectsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('renders the empty state when there are no archived projects', async () => {
    await setUp([]);
    const empty = fixture.debugElement.query(By.css('.empty-state'));
    expect(empty).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.project-list'))).toBeNull();
  });

  it('renders one row per archived project, alphabetised by the selector', async () => {
    await setUp([makeProject('p-a', 'Alpha'), makeProject('p-b', 'Beta')]);
    const rows = fixture.debugElement.queryAll(By.css('.project-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].nativeElement.textContent).toContain('Alpha');
    expect(rows[1].nativeElement.textContent).toContain('Beta');
  });

  const manyProjects = (): Project[] => [
    ...['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map((title, i) =>
      makeProject(`p-${i}`, title),
    ),
  ];

  it('filters rows by the search term (case-insensitive substring)', async () => {
    await setUp(manyProjects());

    component.searchTerm.set('ET');
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.project-row'));
    expect(
      rows.map((r) => r.query(By.css('.project-title')).nativeElement.textContent.trim()),
    ).toEqual(['Beta', 'Zeta', 'Eta']);
  });

  it('shows no search field when there is nothing, or little, to search', async () => {
    await setUp([]);
    expect(fixture.debugElement.query(By.css('.search-header'))).toBeNull();
  });

  it('shows no search field up to the threshold, and one above it', async () => {
    await setUp(manyProjects().slice(0, ARCHIVED_SEARCH_MIN_PROJECTS));
    expect(component.showSearch()).toBeFalse();
    expect(fixture.debugElement.query(By.css('.search-header'))).toBeNull();
  });

  it('shows the search field once the list is longer than the threshold', async () => {
    await setUp(manyProjects());
    expect(manyProjects().length).toBeGreaterThan(ARCHIVED_SEARCH_MIN_PROJECTS);
    expect(component.showSearch()).toBeTrue();
    expect(fixture.debugElement.query(By.css('.search-header'))).not.toBeNull();
  });

  it('ignores a leftover term when the list has no search field', async () => {
    await setUp(manyProjects().slice(0, 3));
    component.searchTerm.set('zzz');
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('.project-row')).length).toBe(3);
  });

  it('offers a Restore text button on a phone and the icon button elsewhere', async () => {
    await setUp([makeProject('p-a', 'Alpha')]);
    const iconBtn = fixture.debugElement.query(By.css('.project-row button.hide-xs'));
    const textBtn = fixture.debugElement.query(
      By.css('.project-row button.show-xs-only'),
    );
    expect(iconBtn).not.toBeNull();
    expect(textBtn).not.toBeNull();
    expect(textBtn.nativeElement.textContent.trim()).toBe(
      'F.PROJECT.ARCHIVED_PROJECTS.RESTORE',
    );
    // the visible word is part of the accessible name
    expect(textBtn.nativeElement.getAttribute('aria-label')).toBe(
      'F.PROJECT.ARCHIVED_PROJECTS.UNARCHIVE',
    );
    textBtn.nativeElement.click();
    expect(projectService.unarchive).toHaveBeenCalledWith('p-a');
  });

  it('links each row to /project/<id>/tasks', async () => {
    await setUp([makeProject('p-a', 'Alpha')]);
    const link = fixture.debugElement.query(By.css('.project-link'));
    expect(link).not.toBeNull();
    // RouterLink directive sets the resolved href attribute.
    expect(link.nativeElement.getAttribute('href')).toBe('/project/p-a/tasks');
  });

  it('calls ProjectService.unarchive when the row button is clicked', async () => {
    await setUp([makeProject('p-a', 'Alpha')]);
    const btn = fixture.debugElement.query(By.css('.project-row button'));
    btn.nativeElement.click();
    expect(projectService.unarchive).toHaveBeenCalledWith('p-a');
  });

  it('calls ProjectService.reopen for completed projects', async () => {
    const project = makeProject('p-a', 'Alpha', { isDone: true, doneOn: 1234 });
    await setUp([project]);
    const btn = fixture.debugElement.query(By.css('.project-row button'));
    btn.nativeElement.click();
    expect(projectService.reopen).toHaveBeenCalledWith('p-a', project);
  });
});
