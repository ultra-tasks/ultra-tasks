import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { Subject } from 'rxjs';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  PlannerUnscheduledPanelService,
  UNSCHEDULED_FILTER_ALL,
} from './planner-unscheduled-panel.service';

describe('PlannerUnscheduledPanelService', () => {
  let isXs: WritableSignal<boolean>;
  let sheetOpen: jasmine.Spy;
  let dismiss: jasmine.Spy;
  let afterDismissed$: Subject<void>;

  const clear = (): void => {
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_OPEN);
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_FILTER);
  };

  beforeEach(() => {
    clear();
    isXs = signal(true);
    afterDismissed$ = new Subject<void>();
    dismiss = jasmine.createSpy('dismiss').and.callFake(() => {
      afterDismissed$.next();
      afterDismissed$.complete();
    });
    sheetOpen = jasmine
      .createSpy('open')
      .and.callFake(() => ({ dismiss, afterDismissed: () => afterDismissed$ }));
    TestBed.configureTestingModule({
      providers: [
        { provide: LayoutService, useValue: { isXs } },
        { provide: MatBottomSheet, useValue: { open: sheetOpen } },
      ],
    });
  });
  afterEach(clear);

  it('starts closed and unfiltered', () => {
    const service = TestBed.inject(PlannerUnscheduledPanelService);
    expect(service.isOpen()).toBe(false);
    expect(service.projectFilter()).toBe(UNSCHEDULED_FILTER_ALL);
  });

  it('remembers its state on this device', () => {
    const first = TestBed.inject(PlannerUnscheduledPanelService);
    first.toggle();
    first.setProjectFilter('project-1');
    expect(localStorage.getItem(LS.PLANNER_UNSCHEDULED_OPEN)).toBe('true');
    expect(localStorage.getItem(LS.PLANNER_UNSCHEDULED_FILTER)).toBe('project-1');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: LayoutService, useValue: { isXs } },
        { provide: MatBottomSheet, useValue: { open: sheetOpen } },
      ],
    });
    const second = TestBed.inject(PlannerUnscheduledPanelService);
    expect(second.isOpen()).toBe(true);
    expect(second.projectFilter()).toBe('project-1');
  });

  it('keeps working when storage is unavailable', () => {
    const service = TestBed.inject(PlannerUnscheduledPanelService);
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    expect(() => service.toggle()).not.toThrow();
    expect(service.isOpen()).toBe(true);
    expect(() => service.setProjectFilter('x')).not.toThrow();
    expect(service.projectFilter()).toBe('x');
  });

  describe('the phone sheet', () => {
    it('opens the bottom sheet on the unscheduled content', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);

      await service.openSheet();

      expect(sheetOpen).toHaveBeenCalledTimes(1);
      const [component, config] = sheetOpen.calls.mostRecent().args;
      expect(typeof component).toBe('function');
      expect(config.data).toEqual({ panelContent: 'UNSCHEDULED' });
      expect(config.panelClass).toBe('bottom-panel-sheet');
      expect(config.autoFocus).toBe(false);
      expect(service.isSheetOpen()).toBe(true);
    });

    it('does not open once the window is wider than a phone', async () => {
      isXs.set(false);
      const service = TestBed.inject(PlannerUnscheduledPanelService);

      await service.openSheet();

      expect(sheetOpen).not.toHaveBeenCalled();
      expect(service.isSheetOpen()).toBe(false);
    });

    it('is never remembered like the desktop panel', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);

      await service.openSheet();

      expect(service.isOpen()).toBe(false);
      expect(localStorage.getItem(LS.PLANNER_UNSCHEDULED_OPEN)).toBeNull();
    });

    it('opens one sheet however often it is asked, also while it is still loading', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);

      await Promise.all([service.openSheet(), service.openSheet()]);
      await service.openSheet();

      expect(sheetOpen).toHaveBeenCalledTimes(1);
    });

    it('is closed again once the sheet is dismissed, by any means, and can reopen', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);
      await service.openSheet();

      afterDismissed$.next();
      expect(service.isSheetOpen()).toBe(false);

      afterDismissed$ = new Subject<void>();
      await service.openSheet();
      expect(sheetOpen).toHaveBeenCalledTimes(2);
      expect(service.isSheetOpen()).toBe(true);
    });

    it('closes through the service', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);
      await service.openSheet();

      service.closeSheet();

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(service.isSheetOpen()).toBe(false);
    });

    it('does nothing to close a sheet that is not open', () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);

      expect(() => service.closeSheet()).not.toThrow();
      expect(dismiss).not.toHaveBeenCalled();
    });

    it('goes away when the window grows past the phone layout (a rotation)', async () => {
      const service = TestBed.inject(PlannerUnscheduledPanelService);
      TestBed.tick();
      await service.openSheet();

      isXs.set(false);
      TestBed.tick();

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(service.isSheetOpen()).toBe(false);
    });
  });
});
