import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { IPC } from '../../../../electron/shared-with-frontend/ipc-events.const';
import { NativeSyncService } from './native-sync.service';
import {
  NativeSessionStoreService,
  type StoredAccountSession,
  type StoredSessionState,
} from './native-session-store.service';
import { NativeSessionRestoreService } from './native-session-restore.service';

const stored: StoredAccountSession = {
  v: 1,
  serverUrl: 'https://account.example.test',
  accountId: '3e2edea8-ff50-4f20-87f6-a8f0465f9945',
  serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
  masterKey: 'A'.repeat(43),
  refreshToken: 'B'.repeat(43),
};

describe('NativeSessionRestoreService', () => {
  let loaded: ReplaySubject<boolean>;
  let native: {
    unlocked: ReturnType<typeof signal<boolean>>;
    signingIn: ReturnType<typeof signal<boolean>>;
    configured: ReturnType<typeof signal<boolean>>;
    restoreSession: jasmine.Spy;
    markStorageUnavailable: jasmine.Spy;
    resume: jasmine.Spy;
  };
  let store: {
    supported: boolean;
    initialize: jasmine.Spy;
    load: jasmine.Spy;
    clear: jasmine.Spy;
  };
  let onIpc: Record<string, () => void>;
  let oldEa: Window['ea'];

  const create = (): NativeSessionRestoreService => {
    TestBed.configureTestingModule({
      providers: [
        { provide: NativeSyncService, useValue: native },
        { provide: NativeSessionStoreService, useValue: store },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: loaded },
        },
        { provide: IS_ELECTRON_TOKEN, useValue: true },
      ],
    });
    return TestBed.inject(NativeSessionRestoreService);
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    loaded = new ReplaySubject<boolean>(1);
    native = {
      unlocked: signal(false),
      signingIn: signal(false),
      configured: signal(true),
      restoreSession: jasmine.createSpy('restoreSession').and.resolveTo('restored'),
      markStorageUnavailable: jasmine.createSpy('markStorageUnavailable'),
      resume: jasmine.createSpy('resume'),
    };
    store = {
      supported: true,
      initialize: jasmine.createSpy('initialize'),
      load: jasmine
        .createSpy('load')
        .and.resolveTo({ state: 'found', session: stored } as StoredSessionState),
      clear: jasmine.createSpy('clear').and.resolveTo(),
    };
    onIpc = {};
    oldEa = window.ea;
    window.ea = {
      on: (channel: string, listener: () => void) => {
        onIpc[channel] = listener;
      },
    } as unknown as Window['ea'];
  });
  afterEach(() => {
    window.ea = oldEa;
  });

  it('does nothing where sessions are not remembered (web, mobile)', async () => {
    store.supported = false;
    const service = create();
    service.initialize();
    await settle();
    expect(service.outcome()).toBe('none');
    expect(store.load).not.toHaveBeenCalled();
    expect(native.restoreSession).not.toHaveBeenCalled();
  });

  it('is settled only once the attempt to bring the session back has ended', async () => {
    const service = create();
    expect(service.restoreSettled()).toBeFalse();
    service.initialize();
    await settle();
    // Still waiting for the app's own data: the account is not "locked", it is on its way.
    expect(service.restoreSettled()).toBeFalse();
    loaded.next(true);
    await settle();
    expect(service.restoreSettled()).toBeTrue();
  });

  it('is settled at once where nothing is remembered', async () => {
    store.supported = false;
    const service = create();
    service.initialize();
    expect(service.restoreSettled()).toBeTrue();
  });

  it('waits for the app data before opening the account', async () => {
    const service = create();
    service.initialize();
    await settle();
    expect(store.load).not.toHaveBeenCalled();
    loaded.next(true);
    await settle();
    expect(native.restoreSession).toHaveBeenCalledOnceWith(stored);
    expect(service.outcome()).toBe('restored');
  });

  it('reports a revoked session as a reason to sign in again, and does not clear anything itself', async () => {
    native.restoreSession.and.resolveTo('reauth');
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    expect(service.outcome()).toBe('reauth');
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('keeps the configured account and every credential when protected storage is unavailable', async () => {
    store.load.and.resolveTo({ state: 'unavailable' } as StoredSessionState);
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    expect(service.outcome()).toBe('unavailable');
    expect(native.markStorageUnavailable).toHaveBeenCalled();
    expect(native.restoreSession).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('does not claim "storage unavailable" for a device that has no account', async () => {
    native.configured.set(false);
    store.load.and.resolveTo({ state: 'unavailable' } as StoredSessionState);
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    expect(native.markStorageUnavailable).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing was remembered', async () => {
    store.load.and.resolveTo({ state: 'none' } as StoredSessionState);
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    expect(service.outcome()).toBe('none');
    expect(native.restoreSession).not.toHaveBeenCalled();
  });

  it('never interferes with a sign-in that is already running or finished', async () => {
    native.signingIn.set(true);
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    expect(store.load).not.toHaveBeenCalled();
    native.signingIn.set(false);
    native.unlocked.set(true);
    await service.retry();
    expect(native.restoreSession).not.toHaveBeenCalled();
  });

  it('runs one attempt at a time, and a retry works once the keychain is back', async () => {
    store.load.and.resolveTo({ state: 'unavailable' } as StoredSessionState);
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    store.load.and.resolveTo({ state: 'found', session: stored } as StoredSessionState);
    const first = service.retry();
    const second = service.retry();
    expect(second).toBe(first);
    await first;
    expect(native.restoreSession).toHaveBeenCalledTimes(1);
    expect(service.outcome()).toBe('restored');
  });

  it('turns the OS wake signal into a sync resume, or a retry while storage was unavailable', async () => {
    const service = create();
    service.initialize();
    loaded.next(true);
    await settle();
    native.unlocked.set(true);
    onIpc[IPC.RESUME]();
    expect(native.resume).toHaveBeenCalledTimes(1);

    native.unlocked.set(false);
    store.load.and.resolveTo({ state: 'unavailable' } as StoredSessionState);
    await service.retry();
    store.load.calls.reset();
    onIpc[IPC.RESUME]();
    await settle();
    expect(store.load).toHaveBeenCalledTimes(1);
  });
});
