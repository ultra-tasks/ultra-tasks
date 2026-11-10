import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { LS } from '../../core/persistence/storage-keys.const';
import { ExampleTasksService } from '../../core/example-tasks/example-tasks.service';
import { FirstRunChoice } from './first-run-setup.component';
import { FirstRunSetupService } from './first-run-setup.service';
import { OnboardingHintService, OnboardingStep } from './onboarding-hint.service';

describe('FirstRunSetupService', () => {
  const keys = [
    LS.FIRST_RUN_SETUP_DONE,
    LS.EXAMPLE_TASKS_CREATED,
    LS.IS_SKIP_TOUR,
    LS.ONBOARDING_HINTS_DONE,
    LS.ONBOARDING_PRESET_DONE,
    LS.APP_START_COUNT,
  ];
  let saved: Map<string, string | null>;
  let step: ReturnType<typeof signal<OnboardingStep | null>>;
  let closed: Subject<FirstRunChoice | undefined>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let router: jasmine.SpyObj<Router>;
  let state: ReturnType<typeof signal<Record<string, unknown>>>;

  beforeEach(() => {
    saved = new Map(keys.map((key) => [key, localStorage.getItem(key)]));
    keys.forEach((key) => localStorage.removeItem(key));
    step = signal<OnboardingStep | null>(null);
    state = signal<Record<string, unknown>>({});
    closed = new Subject<FirstRunChoice | undefined>();
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => closed.asObservable() } as never);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: OnboardingHintService, useValue: { currentStep: step } },
        { provide: ExampleTasksService, useValue: { createdExampleTaskIds: signal([]) } },
        { provide: Store, useValue: { selectSignal: () => state } },
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: router },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
  });

  afterEach(() => {
    keys.forEach((key) => {
      const value = saved.get(key);
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
  });

  it('offers setup once only after first-run guidance is eligible', () => {
    const service = TestBed.inject(FirstRunSetupService);
    TestBed.tick();
    expect(dialog.open).not.toHaveBeenCalled();
    step.set('create-task');
    TestBed.tick();
    expect(service.isOpen()).toBeTrue();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    closed.next('skip');
    expect(service.isOpen()).toBeFalse();
    expect(localStorage.getItem(LS.FIRST_RUN_SETUP_DONE)).toBe('true');
    step.set(null);
    step.set('create-task');
    TestBed.tick();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not interrupt a previously used profile', () => {
    localStorage.setItem(LS.EXAMPLE_TASKS_CREATED, 'true');
    TestBed.inject(FirstRunSetupService);
    step.set('create-task');
    TestBed.tick();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('does not interrupt a profile with data when local flags are missing', () => {
    state.set({ task: { ids: ['existing-task'] } });
    TestBed.inject(FirstRunSetupService);
    step.set('create-task');
    TestBed.tick();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('still offers setup when the only task was seeded in this boot', () => {
    state.set({ task: { ids: ['example'] } });
    TestBed.overrideProvider(ExampleTasksService, {
      useValue: { createdExampleTaskIds: signal(['example']) },
    });
    TestBed.inject(FirstRunSetupService);
    step.set('create-task');
    TestBed.tick();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('opens the existing import settings rather than importing data itself', () => {
    TestBed.inject(FirstRunSetupService);
    step.set('create-task');
    TestBed.tick();
    closed.next('restore');
    expect(router.navigate).toHaveBeenCalledWith(['/config'], {
      queryParams: { tab: 5 },
    });
  });
});
