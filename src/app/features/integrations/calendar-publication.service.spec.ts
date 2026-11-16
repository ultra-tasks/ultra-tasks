import { TestBed, fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { CalendarPublicationService } from './calendar-publication.service';
import { NativeSyncService } from '../native-sync/native-sync.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { DEFAULT_TASK } from '../tasks/task.model';

describe('CalendarPublicationService', () => {
  const key = 'ultra-calendar-publications:https://calendar.test:account';
  const tasks = signal([
    {
      ...DEFAULT_TASK,
      id: 'one',
      projectId: 'work',
      title: 'Secret title',
      notes: 'Secret note',
      dueDay: new Date().toISOString().slice(0, 10),
    },
  ]);
  const native = {
    unlocked: signal(true),
    linked: signal(true),
    busy: signal(false),
    serverUrl: 'https://calendar.test',
    account: {
      identity: () => ({ accountId: 'account' }),
      request: jasmine.createSpy('request'),
    },
  };
  const hydration = signal(false);
  let service: CalendarPublicationService;
  beforeEach(() => {
    localStorage.removeItem(key);
    native.unlocked.set(true);
    native.linked.set(true);
    native.busy.set(false);
    hydration.set(false);
    tasks.set([
      {
        ...DEFAULT_TASK,
        id: 'one',
        projectId: 'work',
        title: 'Secret title',
        notes: 'Secret note',
        dueDay: new Date().toISOString().slice(0, 10),
      },
    ]);
    native.account.request.calls.reset();
    let created = false;
    native.account.request.and.callFake(
      async (path: string, data?: object, method?: string) => {
        if (path === '/calendar-feeds' && !data)
          return {
            feeds: created
              ? [
                  {
                    id: 'feed',
                    label: 'Work',
                    privacy: 'busy',
                    revision: 0,
                    generation: 1,
                  },
                ]
              : [],
          };
        if (method === 'PUT')
          return {
            id: 'feed',
            label: 'Work',
            privacy: 'busy',
            revision: 1,
            generation: 1,
          };
        created = true;
        return {
          id: 'feed',
          label: 'Work',
          privacy: 'busy',
          revision: 0,
          generation: 1,
          url: 'https://calendar.test/cal/secret.ics',
        };
      },
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: NativeSyncService, useValue: native },
        { provide: Store, useValue: { selectSignal: () => tasks } },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        { provide: HydrationStateService, useValue: { isInSyncWindow: hydration } },
      ],
    });
    service = TestBed.inject(CalendarPublicationService);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(key);
  });
  it('requires explicit creation, persists only local metadata and debounces selected task updates', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    tick(2001);
    flushMicrotasks();
    expect(native.account.request.calls.allArgs().some((args) => !!args[1])).toBeFalse();
    let url = '';
    void service
      .create('Work', 'busy', { type: 'project', id: 'work' })
      .then((value) => (url = value));
    flushMicrotasks();
    expect(url).toContain('/cal/secret.ics');
    expect(localStorage.getItem(key)).not.toContain('secret.ics');
    expect(localStorage.getItem(key)).not.toContain('Secret title');
    const createBody = native.account.request.calls
      .allArgs()
      .find((args) => args[0] === '/calendar-feeds' && !!args[1])![1] as {
      body: string;
      consent: boolean;
    };
    expect(createBody.consent).toBeTrue();
    expect(createBody.body).toContain('SUMMARY:Busy');
    expect(createBody.body).not.toContain('Secret');
    tasks.update((current) =>
      current.map((task) => ({
        ...task,
        dueDay: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      })),
    );
    TestBed.tick();
    tick(1999);
    flushMicrotasks();
    expect(
      native.account.request.calls.allArgs().filter((args) => args[2] === 'PUT').length,
    ).toBe(0);
    tick(2);
    flushMicrotasks();
    TestBed.tick();
    tick(2001);
    flushMicrotasks();
    expect(
      native.account.request.calls.allArgs().filter((args) => args[2] === 'PUT').length,
    ).toBe(1);
  }));
  it('waits during hydration and cancels publishing when the account locks', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    void service.create('Work', 'busy', { type: 'all' });
    flushMicrotasks();
    native.account.request.calls.reset();
    hydration.set(true);
    tasks.update((current) => current.map((task) => ({ ...task, timeEstimate: 60000 })));
    TestBed.tick();
    tick(2100);
    flushMicrotasks();
    expect(native.account.request).not.toHaveBeenCalled();
    hydration.set(false);
    TestBed.tick();
    native.unlocked.set(false);
    TestBed.tick();
    tick(2100);
    flushMicrotasks();
    expect(native.account.request).not.toHaveBeenCalled();
  }));
  it('publishes a schedule edit while ordinary time-tracking ticks continue', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    void service.create('Work', 'busy', { type: 'all' });
    flushMicrotasks();
    tasks.update((current) =>
      current.map((task) => ({
        ...task,
        dueDay: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      })),
    );
    TestBed.tick();
    for (let i = 0; i < 5; i++) {
      tick(500);
      tasks.update((current) =>
        current.map((task) => ({ ...task, timeSpent: task.timeSpent + 500 })),
      );
      TestBed.tick();
      flushMicrotasks();
    }
    expect(
      native.account.request.calls.allArgs().filter((args) => args[2] === 'PUT').length,
    ).toBe(1);
    native.unlocked.set(false);
    TestBed.tick();
  }));
  it('publishes once sync settles without starting another debounce window', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    void service.create('Work', 'busy', { type: 'all' });
    flushMicrotasks();
    tasks.update((current) =>
      current.map((task) => ({ ...task, timeEstimate: 60000, dueWithTime: Date.now() })),
    );
    TestBed.tick();
    tick(1000);
    native.busy.set(true);
    TestBed.tick();
    tick(1100);
    flushMicrotasks();
    expect(
      native.account.request.calls.allArgs().filter((args) => args[2] === 'PUT').length,
    ).toBe(0);
    native.busy.set(false);
    TestBed.tick();
    flushMicrotasks();
    expect(
      native.account.request.calls.allArgs().filter((args) => args[2] === 'PUT').length,
    ).toBe(1);
    native.unlocked.set(false);
    TestBed.tick();
  }));
  it('uses the acknowledged revision and latest data after a slow upload', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    void service.create('Work', 'busy', { type: 'all' });
    flushMicrotasks();
    let finishFirst: (() => void) | undefined;
    let uploads = 0;
    native.account.request.and.callFake(
      async (_path: string, data: { revision: number }) => {
        uploads++;
        const result = {
          id: 'feed',
          label: 'Work',
          privacy: 'busy',
          revision: data.revision,
          generation: 1,
        };
        if (uploads === 1) await new Promise<void>((resolve) => (finishFirst = resolve));
        return result;
      },
    );
    tasks.update((current) =>
      current.map((task) => ({ ...task, dueWithTime: Date.now(), timeEstimate: 60000 })),
    );
    TestBed.tick();
    tick(2001);
    TestBed.tick();
    flushMicrotasks();
    expect(uploads).toBe(1);
    tasks.update((current) => current.map((task) => ({ ...task, timeEstimate: 120000 })));
    TestBed.tick();
    tick(2001);
    TestBed.tick();
    flushMicrotasks();
    expect(uploads).toBe(1);
    finishFirst!();
    flushMicrotasks();
    const writes = native.account.request.calls
      .allArgs()
      .filter((args) => args[2] === 'PUT');
    expect(writes.map((args) => (args[1] as { revision: number }).revision)).toEqual([
      1, 2,
    ]);
    expect((writes[1][1] as { body: string }).body).toContain('SEQUENCE:2');
    native.unlocked.set(false);
    TestBed.tick();
  }));
  it('retries a failed publication after connectivity returns', fakeAsync(() => {
    TestBed.tick();
    flushMicrotasks();
    void service.create('Work', 'busy', { type: 'all' });
    flushMicrotasks();
    let uploads = 0;
    native.account.request.and.callFake(
      async (_path: string, data: { revision: number }) => {
        if (++uploads === 1) throw new Error('offline');
        return {
          id: 'feed',
          label: 'Work',
          privacy: 'busy',
          revision: data.revision,
          generation: 1,
        };
      },
    );
    tasks.update((current) =>
      current.map((task) => ({ ...task, dueWithTime: Date.now() })),
    );
    TestBed.tick();
    tick(2001);
    TestBed.tick();
    flushMicrotasks();
    expect(uploads).toBe(1);
    expect(service.error()).toBeTrue();
    tick(10000);
    TestBed.tick();
    flushMicrotasks();
    expect(uploads).toBe(1);
    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    tick(2001);
    TestBed.tick();
    flushMicrotasks();
    expect(uploads).toBe(2);
    expect(service.error()).toBeFalse();
    native.unlocked.set(false);
    TestBed.tick();
  }));
});
