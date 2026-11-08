import { TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';
import { Router } from '@angular/router';
import {
  AccountClient,
  newBrowserLogin,
  randomKey,
  type PendingBrowserLogin,
} from '@sp/sync-providers/ultra-tasks';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { NativeSyncService } from './native-sync.service';
import { NativeAccountLoginService } from './native-account-login.service';
import { type AccountLoginStoreApi } from '../../../../electron/shared-with-frontend/account-login-api';

describe('NativeAccountLoginService', () => {
  let service: NativeAccountLoginService;
  let client: AccountClient;
  let flow: PendingBrowserLogin;
  let store: jasmine.SpyObj<AccountLoginStoreApi>;
  let native: {
    createBrowserAccount: jasmine.Spy;
    finishBrowserAccount: jasmine.Spy;
    serverUrl: string;
  };
  let hydration: ReplaySubject<boolean>;
  let hydrationOwner: { isAllDataLoadedInitially$: ReplaySubject<boolean> };
  let navigate: jasmine.Spy;
  let oldEa: Window['ea'];
  let open: jasmine.Spy;
  beforeEach(async () => {
    const created = await newBrowserLogin({
      serverId: '3e2edea8-ff50-4f20-87f6-a8f0465f9945',
      serverUrl: 'https://self-host.example.test',
      redirectUri: 'ultratasks://account-login',
      deviceName: 'Desktop',
    });
    flow = {
      request: { ...created.input, ticket: randomKey(), expiresAt: Date.now() + 300000 },
      privateKey: created.privateKey,
      verifier: created.verifier,
    };
    client = new AccountClient(async () => {
      throw new Error('Unexpected HTTP request');
    });
    spyOn(client, 'startBrowserLogin').and.resolveTo(flow);
    spyOn(client, 'resumeBrowserLogin').and.resolveTo();
    spyOn(client, 'pollBrowserLogin').and.resolveTo(false);
    spyOn(client, 'cancelBrowserLogin').and.resolveTo();
    store = jasmine.createSpyObj<AccountLoginStoreApi>('store', [
      'load',
      'save',
      'clear',
    ]);
    store.load.and.resolveTo(null);
    store.save.and.resolveTo();
    store.clear.and.resolveTo();
    oldEa = window.ea;
    open = jasmine.createSpy('open');
    window.ea = {
      consumeAccountLoginStore: () => store,
      on: () => undefined,
      openExternalUrl: open,
    } as unknown as Window['ea'];
    native = {
      createBrowserAccount: jasmine.createSpy().and.resolveTo(client),
      finishBrowserAccount: jasmine.createSpy().and.resolveTo(),
      serverUrl: flow.request.serverUrl,
    };
    hydration = new ReplaySubject<boolean>(1);
    hydration.next(true);
    hydrationOwner = { isAllDataLoadedInitially$: hydration };
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_ELECTRON_TOKEN, useValue: true },
        { provide: NativeSyncService, useValue: native },
        { provide: DataInitStateService, useValue: hydrationOwner },
        { provide: Router, useValue: { navigate } },
      ],
    });
    service = TestBed.inject(NativeAccountLoginService);
  });
  afterEach(async () => {
    await service.cancel().catch(() => undefined);
    TestBed.resetTestingModule();
    window.ea = oldEa;
  });
  it('persists device proof before opening only the selected server', async () => {
    let saved!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      saved = resolve;
    });
    store.save.and.callFake(() => {
      saved();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const starting = service.start(flow.request.serverUrl, '');
    await reached;
    expect(open).not.toHaveBeenCalled();
    release();
    await starting;
    expect(store.save).toHaveBeenCalledWith(JSON.stringify(flow));
    const url = new URL(open.calls.first().args[0]);
    expect(url.origin).toBe('https://self-host.example.test');
    expect(url.searchParams.get('login')).toBe(flow.request.ticket);
    expect(url.href).not.toContain(flow.verifier);
    expect(url.href).not.toContain(flow.privateKey.d!);
    expect(service.active()).toBeTrue();
  });
  it('does not open the browser when protected persistence fails', async () => {
    store.save.and.rejectWith(new Error('Keystore unavailable'));
    await expectAsync(service.start(flow.request.serverUrl, '')).toBeRejectedWithError(
      'Keystore unavailable',
    );
    expect(open).not.toHaveBeenCalled();
    expect(client.cancelBrowserLogin).toHaveBeenCalled();
    expect(service.active()).toBeFalse();
  });
  it('ignores unrelated callbacks and completes matching callbacks only after hydration', async () => {
    await service.start(flow.request.serverUrl, '');
    await service.handleCallback({ result: randomKey(), state: flow.request.state });
    expect(client.pollBrowserLogin).not.toHaveBeenCalled();
    (client.pollBrowserLogin as jasmine.Spy).and.resolveTo(true);
    hydration = new ReplaySubject<boolean>(1);
    // Replacing the observable on the provided owner retains the real hydration boundary.
    hydrationOwner.isAllDataLoadedInitially$ = hydration;
    const done = service.handleCallback({
      result: flow.request.ticket,
      state: flow.request.state,
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(native.finishBrowserAccount).not.toHaveBeenCalled();
    hydration.next(true);
    await done;
    expect(native.finishBrowserAccount).toHaveBeenCalledWith(
      client,
      flow.request.serverUrl,
    );
    expect(service.active()).toBeFalse();
  });
  it('restores a cold-launch attempt before processing the callback', async () => {
    store.load.and.resolveTo(JSON.stringify(flow));
    service.initialize();
    await service.handleCallback({
      result: flow.request.ticket,
      state: flow.request.state,
    });
    expect(client.resumeBrowserLogin).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/native-sync']);
    expect(service.active()).toBeTrue();
  });
  it('still cancels the server attempt if clearing protected storage fails', async () => {
    await service.start(flow.request.serverUrl, '');
    store.clear.and.rejectWith(new Error('Storage busy'));
    await expectAsync(service.cancel()).toBeRejectedWithError('Storage busy');
    expect(client.cancelBrowserLogin).toHaveBeenCalled();
    expect(service.active()).toBeFalse();
  });
  it('reports a background cleanup failure without an unhandled rejection or session install', async () => {
    await service.start(flow.request.serverUrl, '');
    (client.pollBrowserLogin as jasmine.Spy).and.resolveTo(true);
    store.clear.and.rejectWith(new Error('Protected storage unavailable'));
    await expectAsync(service.check()).toBeResolved();
    expect(service.error()).toBe('NATIVE_SYNC.BROWSER_RESTART');
    expect(native.finishBrowserAccount).not.toHaveBeenCalled();
    expect(client.cancelBrowserLogin).toHaveBeenCalled();
    expect(service.active()).toBeFalse();
  });
  it('cannot install a grant after cancellation while hydration is pending', async () => {
    await service.start(flow.request.serverUrl, '');
    (client.pollBrowserLogin as jasmine.Spy).and.resolveTo(true);
    hydration = new ReplaySubject<boolean>(1);
    hydrationOwner.isAllDataLoadedInitially$ = hydration;
    const done = service.check();
    await Promise.resolve();
    await Promise.resolve();
    await service.cancel();
    hydration.next(true);
    await done;
    expect(native.finishBrowserAccount).not.toHaveBeenCalled();
  });
  it('revokes an issued session when local finalization locks the account and fails', async () => {
    await service.start(flow.request.serverUrl, '');
    client.adoptTokens({
      accessToken: 'issued-device-access',
      refreshToken: 'issued-device-refresh',
      expiresIn: 600,
    });
    (client.pollBrowserLogin as jasmine.Spy).and.resolveTo(true);
    const transport = spyOn(client, 'transport').and.callFake(async (path) =>
      path === '/sessions' ? [{ id: 'issued-session', current: true }] : {},
    );
    native.finishBrowserAccount.and.callFake(async (account: AccountClient) => {
      account.lock();
      throw new Error('Local workspace is unavailable');
    });

    await service.check();

    expect(transport).toHaveBeenCalledWith(
      '/sessions',
      undefined,
      'issued-device-access',
    );
    expect(transport).toHaveBeenCalledWith(
      '/sessions/revoke',
      { sessionId: 'issued-session' },
      'issued-device-access',
    );
    expect(client.tokens).toBeUndefined();
    expect(service.active()).toBeFalse();
    expect(service.error()).toBe('NATIVE_SYNC.BROWSER_RESTART');
  });
});
