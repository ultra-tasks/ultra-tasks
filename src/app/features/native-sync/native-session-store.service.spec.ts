import { TestBed } from '@angular/core/testing';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import {
  NativeSessionStoreService,
  type StoredAccountSession,
} from './native-session-store.service';
import type { AccountSessionStoreApi } from '../../../../electron/shared-with-frontend/account-session-api';

const session = (refreshToken = 'B'.repeat(43)): StoredAccountSession => ({
  v: 1,
  serverUrl: 'https://account.example.test',
  accountId: '3e2edea8-ff50-4f20-87f6-a8f0465f9945',
  serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
  masterKey: 'A'.repeat(43),
  refreshToken,
});

describe('NativeSessionStoreService', () => {
  let api: jasmine.SpyObj<AccountSessionStoreApi>;
  let consume: jasmine.Spy;
  let oldEa: Window['ea'];

  const create = (isElectron: boolean): NativeSessionStoreService => {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: isElectron }],
    });
    return TestBed.inject(NativeSessionStoreService);
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<AccountSessionStoreApi>('api', [
      'load',
      'save',
      'clear',
      'loadDeviceToken',
      'saveDeviceToken',
      'forgetDeviceToken',
    ]);
    api.load.and.resolveTo(null);
    api.save.and.resolveTo();
    api.clear.and.resolveTo();
    api.loadDeviceToken.and.resolveTo(null);
    api.saveDeviceToken.and.resolveTo();
    api.forgetDeviceToken.and.resolveTo();
    consume = jasmine.createSpy('consumeAccountSessionStore').and.returnValue(api);
    oldEa = window.ea;
    window.ea = { consumeAccountSessionStore: consume } as unknown as Window['ea'];
  });
  afterEach(() => {
    window.ea = oldEa;
  });

  it('remembers nothing outside the desktop app and never touches storage there', async () => {
    const store = create(false);
    store.initialize();
    expect(store.supported).toBeFalse();
    expect(consume).not.toHaveBeenCalled();
    expect(await store.load()).toEqual({ state: 'none' });
    await store.save(session());
    await store.clear();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('claims the one-shot capability exactly once', () => {
    const store = create(true);
    store.initialize();
    store.initialize();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(store.supported).toBeTrue();
  });

  it('keeps unavailable storage apart from an empty one', async () => {
    const store = create(true);
    store.initialize();
    expect(await store.load()).toEqual({ state: 'none' });
    api.load.and.rejectWith(
      new Error('Protected account session storage is unavailable'),
    );
    expect(await store.load()).toEqual({ state: 'unavailable' });
  });

  it('returns what was stored, and treats unreadable text as nothing', async () => {
    const store = create(true);
    store.initialize();
    api.load.and.resolveTo(JSON.stringify(session('C'.repeat(43))));
    expect(await store.load()).toEqual({
      state: 'found',
      session: session('C'.repeat(43)),
    });
    api.load.and.resolveTo('not json');
    expect(await store.load()).toEqual({ state: 'none' });
  });

  it('writes one rotation after another, in order', async () => {
    const store = create(true);
    store.initialize();
    const written: string[] = [];
    let release!: () => void;
    api.save.and.callFake(async (value: string) => {
      written.push((JSON.parse(value) as StoredAccountSession).refreshToken);
      if (written.length === 1) await new Promise<void>((resolve) => (release = resolve));
    });
    const first = store.save(session('1'.repeat(43)));
    const second = store.save(session('2'.repeat(43)));
    await new Promise((resolve) => setTimeout(resolve));
    expect(written).toEqual(['1'.repeat(43)]);
    release();
    await Promise.all([first, second]);
    expect(written).toEqual(['1'.repeat(43), '2'.repeat(43)]);
  });

  it('a rotation that was still queued when the person locked is never written back', async () => {
    const store = create(true);
    store.initialize();
    let release!: () => void;
    api.save.and.callFake(() => new Promise<void>((resolve) => (release = resolve)));
    const inFlight = store.save(session('1'.repeat(43)));
    // The first write has started and is waiting for the OS...
    await new Promise((resolve) => setTimeout(resolve));
    // ...a second rotation queues behind it, and the person locks.
    const queued = store.save(session('2'.repeat(43)));
    const cleared = store.clear();
    release();
    await Promise.all([inFlight, queued, cleared]);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.clear).toHaveBeenCalledTimes(1);
    // The next sign-in writes again.
    api.save.and.resolveTo();
    await store.save(session('3'.repeat(43)));
    expect(api.save).toHaveBeenCalledTimes(2);
  });

  it('reports a store that refuses without breaking later writes', async () => {
    const store = create(true);
    store.initialize();
    api.save.and.rejectWith(
      new Error('Protected account session storage is unavailable'),
    );
    await expectAsync(store.save(session())).toBeRejectedWithError(/unavailable/);
    api.save.and.resolveTo();
    await store.save(session('4'.repeat(43)));
    expect(api.save).toHaveBeenCalledTimes(2);
  });
});

describe('NativeSessionStoreService device trust', () => {
  const request = {
    serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9946',
    keys: ['a'.repeat(64)],
  };
  let api: jasmine.SpyObj<AccountSessionStoreApi>;
  let oldEa: Window['ea'];

  const create = (isElectron: boolean): NativeSessionStoreService => {
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: isElectron }],
    });
    const store = TestBed.inject(NativeSessionStoreService);
    store.initialize();
    return store;
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<AccountSessionStoreApi>('api', [
      'load',
      'save',
      'clear',
      'loadDeviceToken',
      'saveDeviceToken',
      'forgetDeviceToken',
    ]);
    api.loadDeviceToken.and.resolveTo('T'.repeat(43));
    api.saveDeviceToken.and.resolveTo();
    api.forgetDeviceToken.and.resolveTo();
    oldEa = window.ea;
    window.ea = {
      consumeAccountSessionStore: () => api,
    } as unknown as Window['ea'];
  });
  afterEach(() => {
    window.ea = oldEa;
  });

  it('hands the main process one JSON request per call and returns what it knows', async () => {
    const store = create(true);
    expect(await store.loadDeviceToken(request)).toBe('T'.repeat(43));
    await store.saveDeviceToken({ ...request, token: 'N'.repeat(43) });
    await store.forgetDeviceToken(request);
    expect(api.loadDeviceToken).toHaveBeenCalledOnceWith(JSON.stringify(request));
    expect(api.saveDeviceToken).toHaveBeenCalledOnceWith(
      JSON.stringify({ ...request, token: 'N'.repeat(43) }),
    );
    expect(api.forgetDeviceToken).toHaveBeenCalledOnceWith(JSON.stringify(request));
  });

  it('is a convenience: a refusing or unavailable store reads as "none" and never throws', async () => {
    const store = create(true);
    const unavailable = new Error('Protected account session storage is unavailable');
    api.loadDeviceToken.and.rejectWith(unavailable);
    api.saveDeviceToken.and.rejectWith(unavailable);
    api.forgetDeviceToken.and.rejectWith(unavailable);
    expect(await store.loadDeviceToken(request)).toBeNull();
    await expectAsync(
      store.saveDeviceToken({ ...request, token: 'N'.repeat(43) }),
    ).toBeResolved();
    await expectAsync(store.forgetDeviceToken(request)).toBeResolved();
  });

  it('never reaches for the protected store outside the desktop app', async () => {
    const store = create(false);
    expect(await store.loadDeviceToken(request)).toBeNull();
    await store.saveDeviceToken({ ...request, token: 'N'.repeat(43) });
    await store.forgetDeviceToken(request);
    expect(api.loadDeviceToken).not.toHaveBeenCalled();
    expect(api.saveDeviceToken).not.toHaveBeenCalled();
    expect(api.forgetDeviceToken).not.toHaveBeenCalled();
  });
});
