import { TestBed } from '@angular/core/testing';
import { LS } from '../../../core/persistence/storage-keys.const';
import {
  PlannerUnscheduledPanelService,
  UNSCHEDULED_FILTER_ALL,
} from './planner-unscheduled-panel.service';

describe('PlannerUnscheduledPanelService', () => {
  const clear = (): void => {
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_OPEN);
    localStorage.removeItem(LS.PLANNER_UNSCHEDULED_FILTER);
  };

  beforeEach(clear);
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
});
