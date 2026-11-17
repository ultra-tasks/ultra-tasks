import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { MatMenuItem } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';
import { PageOptionsMenuComponent } from './page-options-menu.component';
import { WorkContextMenuComponent } from '../../work-context-menu/work-context-menu.component';
import { LayoutService } from '../../layout/layout.service';
import { ProjectLayoutService } from '../../../features/project/project-layout.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { LS } from '../../../core/persistence/storage-keys.const';
import { T } from '../../../t.const';

// The real menu pulls in half the app's services; what this spec is about is the
// rows the page-options menu adds above it, so it is a stand-in with one row.
@Component({
  selector: 'work-context-menu',
  standalone: true,
  imports: [MatMenuItem],
  template: `<button
    mat-menu-item
    class="stub-context-row"
  >
    {{ contextType() }}:{{ contextId() }}
  </button>`,
})
class WorkContextMenuStubComponent {
  readonly contextId = input.required<string>();
  readonly contextType = input.required<WorkContextType>();
}

describe('PageOptionsMenuComponent', () => {
  let fixture: ComponentFixture<PageOptionsMenuComponent>;
  let customizationCount: WritableSignal<number>;
  let isShowCustomizerPanel: WritableSignal<boolean>;
  let toggleCustomizerPanel: jasmine.Spy;

  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button.project-settings-btn');
  const panel = (): HTMLElement | null => document.querySelector('.mat-mdc-menu-panel');
  const menuItems = (): HTMLElement[] =>
    Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [mat-menu-item]'),
    );
  const menuTexts = (): string[] =>
    menuItems().map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  const create = (
    o: { type?: WorkContextType; id?: string; isWorkViewPage?: boolean } = {},
  ): void => {
    fixture = TestBed.createComponent(PageOptionsMenuComponent);
    fixture.componentRef.setInput('contextId', o.id ?? 'p1');
    fixture.componentRef.setInput('contextType', o.type ?? WorkContextType.PROJECT);
    fixture.componentRef.setInput('isWorkViewPage', o.isWorkViewPage ?? true);
    fixture.detectChanges();
  };

  const openMenu = (): void => {
    trigger().click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };

  const closeMenu = (): void => {
    document
      .querySelectorAll('.cdk-overlay-backdrop')
      .forEach((b) => (b as HTMLElement).click());
    fixture.detectChanges();
    flush();
  };

  beforeEach(async () => {
    customizationCount = signal(0);
    isShowCustomizerPanel = signal(false);
    toggleCustomizerPanel = jasmine.createSpy('toggleTaskViewCustomizerPanel');
    await TestBed.configureTestingModule({
      imports: [PageOptionsMenuComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: TaskViewCustomizerService,
          useValue: {
            customizationCount,
            isCustomized: () => customizationCount() > 0,
          },
        },
        {
          provide: LayoutService,
          useValue: {
            isShowTaskViewCustomizerPanel: isShowCustomizerPanel,
            toggleTaskViewCustomizerPanel: toggleCustomizerPanel,
          },
        },
      ],
    })
      .overrideComponent(PageOptionsMenuComponent, {
        remove: { imports: [WorkContextMenuComponent] },
        add: { imports: [WorkContextMenuStubComponent] },
      })
      .compileComponents();
  });

  afterEach(() => {
    ['p1', 'p2'].forEach((id) => localStorage.removeItem(`${LS.PROJECT_LAYOUT}:${id}`));
  });

  describe('the button', () => {
    it('is the one options button, named for what it opens', () => {
      create();
      expect(trigger().getAttribute('aria-label')).toBe(T.MH.PAGE_OPTIONS);
      // the class the e2e specs open the work-context menu by
      expect(trigger().classList).toContain('project-settings-btn');
    });

    it('carries a dot, and says so in its name, while a sort, group or filter is on', () => {
      create();
      expect(trigger().classList).not.toContain('has-customization');

      customizationCount.set(2);
      fixture.detectChanges();

      expect(trigger().classList).toContain('has-customization');
      expect(trigger().getAttribute('aria-label')).toBe(T.MH.PAGE_OPTIONS_ACTIVE);
    });
  });

  describe('the menu on a project page', () => {
    it('leads with the layouts, then sort/group/filter, then the work-context items', fakeAsync(() => {
      create();
      openMenu();

      const texts = menuTexts();
      expect(texts.slice(0, 4)).toEqual([
        jasmine.stringContaining(T.F.PROJECT.LAYOUT.LIST),
        jasmine.stringContaining(T.F.PROJECT.LAYOUT.BOARD),
        jasmine.stringContaining(T.F.PROJECT.LAYOUT.CALENDAR),
        jasmine.stringContaining(T.F.PROJECT.LAYOUT.UPCOMING),
      ]);
      expect(texts[4]).toContain(T.MH.SORT_GROUP_FILTER);
      expect(menuItems()[5].classList).toContain('stub-context-row');
      // a divider between the view group and the context items
      expect(panel()!.querySelectorAll('.mat-divider').length).toBe(1);
      closeMenu();
    }));

    it('hands the work-context menu the context it is for', fakeAsync(() => {
      create({ id: 'p1' });
      openMenu();

      expect(menuTexts().pop()).toBe(`${WorkContextType.PROJECT}:p1`);
      closeMenu();
    }));

    it('marks the current layout, and changes only this project', fakeAsync(() => {
      create({ id: 'p1' });
      openMenu();

      const radios = menuItems().filter(
        (el) => el.getAttribute('role') === 'menuitemradio',
      );
      expect(radios.map((el) => el.getAttribute('aria-checked'))).toEqual([
        'true',
        'false',
        'false',
        'false',
      ]);

      radios[1].click();
      fixture.detectChanges();
      flush();

      const layouts = TestBed.inject(ProjectLayoutService);
      expect(layouts.prefsFor('p1').layout).toBe('board');
      expect(layouts.prefsFor('p2').layout).toBe('list');
    }));

    it('offers the calendar-events toggle on the calendar and upcoming layouts, and keeps the menu open for it', fakeAsync(() => {
      TestBed.inject(ProjectLayoutService).setLayout('p1', 'calendar');
      create({ id: 'p1' });
      openMenu();

      const toggle = menuItems().find(
        (el) => el.getAttribute('role') === 'menuitemcheckbox',
      )!;
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute('aria-checked')).toBe('false');

      toggle.click();
      fixture.detectChanges();
      tick();

      expect(
        TestBed.inject(ProjectLayoutService).prefsFor('p1').isShowCalendarEvents,
      ).toBe(true);
      expect(panel()).not.toBeNull();
      closeMenu();
    }));

    it('opens the bottom sheet from the sort, group and filter row', fakeAsync(() => {
      create();
      openMenu();

      menuItems()
        .find((el) => el.textContent?.includes(T.MH.SORT_GROUP_FILTER))!
        .click();
      fixture.detectChanges();
      flush();

      expect(toggleCustomizerPanel).toHaveBeenCalledTimes(1);
    }));

    it('does not toggle the panel closed when it is already open', fakeAsync(() => {
      isShowCustomizerPanel.set(true);
      create();
      openMenu();

      menuItems()
        .find((el) => el.textContent?.includes(T.MH.SORT_GROUP_FILTER))!
        .click();
      fixture.detectChanges();
      flush();

      expect(toggleCustomizerPanel).not.toHaveBeenCalled();
    }));

    it('shows how many of sort, group and filter are on', fakeAsync(() => {
      customizationCount.set(2);
      create();
      openMenu();

      const row = menuItems().find((el) =>
        el.textContent?.includes(T.MH.SORT_GROUP_FILTER),
      )!;
      expect(row.querySelector('.page-options-count')?.textContent?.trim()).toBe('2');
      closeMenu();
    }));
  });

  describe('the menu elsewhere', () => {
    it('has no layouts on a tag page, only sort/group/filter and the context items', fakeAsync(() => {
      create({ type: WorkContextType.TAG, id: 'TODAY' });
      openMenu();

      expect(menuItems().some((el) => el.getAttribute('role') === 'menuitemradio')).toBe(
        false,
      );
      expect(menuTexts()[0]).toContain(T.MH.SORT_GROUP_FILTER);
      expect(menuItems()[1].classList).toContain('stub-context-row');
      closeMenu();
    }));

    it('is only the context items on a page that is not a task list', fakeAsync(() => {
      create({ isWorkViewPage: false });
      openMenu();

      expect(menuItems().length).toBe(1);
      expect(menuItems()[0].classList).toContain('stub-context-row');
      expect(panel()!.querySelectorAll('.mat-divider').length).toBe(0);
      closeMenu();
    }));
  });
});
