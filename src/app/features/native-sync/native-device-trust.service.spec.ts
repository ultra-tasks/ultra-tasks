import { TestBed } from '@angular/core/testing';
import type { AccountClient } from '@sp/sync-providers/ultra-tasks';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { deviceTrustKey, NativeDeviceTrustService } from './native-device-trust.service';
import { NativeSessionStoreService } from './native-session-store.service';

const SERVER = '3e2edea8-ff50-4f20-87f6-a8f0465f9946';
const OTHER_SERVER = '9b1c3f5e-6a2d-4c81-8e07-5d2f9a4b7c10';
const TOKEN = 'T'.repeat(43);
const STORAGE_KEY = 'ultra-native-device-trust';

const account = (
  deviceToken: string | undefined,
  email = 'ada@example.test',
): AccountClient =>
  ({
    deviceToken,
    capabilities: { serverId: SERVER },
    account: { email },
  }) as unknown as AccountClient;

describe('deviceTrustKey', () => {
  it('is the SHA-256 of the lower-cased, trimmed name, as hex', async () => {
    // sha256("ada@example.test")
    const key = await deviceTrustKey('  ADA@Example.Test ');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(await deviceTrustKey('ada@example.test'));
    expect(key).not.toBe(await deviceTrustKey('grace@example.test'));
  });
});

describe('NativeDeviceTrustService on a browser or phone', () => {
  let trust: NativeDeviceTrustService;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [{ provide: IS_ELECTRON_TOKEN, useValue: false }],
    });
    trust = TestBed.inject(NativeDeviceTrustService);
  });
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('recognises an account by its email and by any other name it signed in with', async () => {
    await trust.remember(SERVER, ['Ada@Example.test', 'ada'], TOKEN);
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBe(TOKEN);
    expect(await trust.recall(SERVER, ['  ADA '])).toBe(TOKEN);
    expect(await trust.recall(SERVER, ['unknown', 'ada'])).toBe(TOKEN);
  });

  it('never mixes accounts or servers', async () => {
    await trust.remember(SERVER, ['ada@example.test'], TOKEN);
    expect(await trust.recall(SERVER, ['grace@example.test'])).toBeUndefined();
    expect(await trust.recall(OTHER_SERVER, ['ada@example.test'])).toBeUndefined();
    expect(await trust.recall(SERVER, [])).toBeUndefined();
    expect(await trust.recall(SERVER, [undefined, ' '])).toBeUndefined();
  });

  it('keeps the email out of storage in the clear', async () => {
    await trust.remember(SERVER, ['ada@example.test'], TOKEN);
    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(raw).not.toContain('ada');
    expect(raw).not.toContain('example.test');
  });

  it('keeps the newest marker per account and replaces an older one', async () => {
    await trust.remember(SERVER, ['ada@example.test'], TOKEN);
    await trust.remember(SERVER, ['ada@example.test'], 'N'.repeat(43));
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBe('N'.repeat(43));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).entries.length).toBe(1);
  });

  it('forgets one account and leaves the others alone', async () => {
    await trust.remember(SERVER, ['ada@example.test', 'ada'], TOKEN);
    await trust.remember(SERVER, ['grace@example.test'], 'G'.repeat(43));
    await trust.forget({ serverId: SERVER, names: ['ada@example.test', 'ada'] });
    expect(await trust.recall(SERVER, ['ada'])).toBeUndefined();
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
    expect(await trust.recall(SERVER, ['grace@example.test'])).toBe('G'.repeat(43));
    await trust.forget({ serverId: SERVER, names: ['grace@example.test'] });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    await expectAsync(trust.forget(undefined)).toBeResolved();
  });

  it('drops the least recently used markers past a small bound', async () => {
    for (let i = 0; i < 40; i++) {
      await trust.remember(SERVER, [`person${i}@example.test`], TOKEN);
    }
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)!).entries;
    expect(entries.length).toBe(32);
    expect(await trust.recall(SERVER, ['person0@example.test'])).toBeUndefined();
    expect(await trust.recall(SERVER, ['person39@example.test'])).toBe(TOKEN);
  });

  it('stores only what looks like a marker', async () => {
    await trust.remember(SERVER, ['ada@example.test'], 'short');
    await trust.remember(SERVER, ['ada@example.test'], 'x'.repeat(44));
    await trust.remember(SERVER, ['ada@example.test'], 'a b'.repeat(15));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('is a convenience: unreadable or blocked storage reads as "none" and never throws', async () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries: [{ s: 1 }] }));
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');
    await expectAsync(trust.remember(SERVER, ['ada@example.test'], TOKEN)).toBeResolved();
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
    await expectAsync(
      trust.forget({ serverId: SERVER, names: ['ada@example.test'] }),
    ).toBeResolved();
  });

  it('keeps what a sign-in left on the SDK, under the email and the typed name', async () => {
    await trust.rememberFrom(account(TOKEN), 'ADA');
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBe(TOKEN);
    expect(await trust.recall(SERVER, ['ada'])).toBe(TOKEN);
    // A sign-in that left no marker changes nothing (an offline unlock, a restored session).
    await trust.rememberFrom(account(undefined, 'grace@example.test'));
    expect(await trust.recall(SERVER, ['grace@example.test'])).toBeUndefined();
    await trust.rememberFrom(undefined);
  });

  it('notes who an account is before the SDK forgets it', () => {
    expect(trust.whoIs(account(TOKEN), 'ada')).toEqual({
      serverId: SERVER,
      names: ['ada@example.test', 'ada'],
    });
    expect(trust.whoIs(undefined)).toBeUndefined();
    expect(trust.whoIs({ capabilities: undefined } as unknown as AccountClient)).toBe(
      undefined,
    );
  });
});

describe('NativeDeviceTrustService in the desktop app', () => {
  let trust: NativeDeviceTrustService;
  let sessions: jasmine.SpyObj<
    Pick<
      NativeSessionStoreService,
      'loadDeviceToken' | 'saveDeviceToken' | 'forgetDeviceToken'
    >
  >;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessions = jasmine.createSpyObj('sessions', [
      'loadDeviceToken',
      'saveDeviceToken',
      'forgetDeviceToken',
    ]);
    sessions.loadDeviceToken.and.resolveTo(TOKEN);
    sessions.saveDeviceToken.and.resolveTo();
    sessions.forgetDeviceToken.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        { provide: NativeSessionStoreService, useValue: sessions },
      ],
    });
    trust = TestBed.inject(NativeDeviceTrustService);
  });
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('asks the protected store by server and hashed names, never with the email itself', async () => {
    expect(await trust.recall(SERVER, ['Ada@example.test', 'ada'])).toBe(TOKEN);
    const request = sessions.loadDeviceToken.calls.mostRecent().args[0];
    expect(request.serverId).toBe(SERVER);
    expect(request.keys).toEqual([
      await deviceTrustKey('ada@example.test'),
      await deviceTrustKey('ada'),
    ]);
    expect(JSON.stringify(request)).not.toContain('example.test');
  });

  it('stores and forgets through the protected store and never in renderer storage', async () => {
    await trust.remember(SERVER, ['ada@example.test'], TOKEN);
    expect(sessions.saveDeviceToken).toHaveBeenCalledOnceWith({
      serverId: SERVER,
      keys: [await deviceTrustKey('ada@example.test')],
      token: TOKEN,
    });
    await trust.forget({ serverId: SERVER, names: ['ada@example.test'] });
    expect(sessions.forgetDeviceToken).toHaveBeenCalledOnceWith({
      serverId: SERVER,
      keys: [await deviceTrustKey('ada@example.test')],
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('treats a store that says nothing as no marker', async () => {
    sessions.loadDeviceToken.and.resolveTo(null);
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
    sessions.loadDeviceToken.and.rejectWith(new Error('unavailable'));
    expect(await trust.recall(SERVER, ['ada@example.test'])).toBeUndefined();
  });
});
