import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  GithubDeviceFlowService,
  GitHubDeviceAuthorization,
} from './github-device-flow.service';
import { OAuthTokenResult } from '@super-productivity/plugin-api';

describe('GithubDeviceFlowService', () => {
  let service: GithubDeviceFlowService;
  let http: HttpTestingController;
  const code: GitHubDeviceAuthorization = {
    deviceCode: 'private-device-code',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Number.MAX_SAFE_INTEGER,
    intervalMs: 5000,
  };
  const tokenUrl = 'https://github.com/login/oauth/access_token';
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(GithubDeviceFlowService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('requests a code with the public app id and private-repository issue scope', async () => {
    const result = service.requestCode('public-client', new AbortController().signal);
    const request = http.expectOne('https://github.com/login/device/code');
    expect(new URLSearchParams(request.request.body).get('scope')).toBe('repo');
    expect(request.request.headers.get('Accept')).toBe('application/json');
    request.flush({
      device_code: code.deviceCode,
      user_code: code.userCode,
      verification_uri: code.verificationUri,
      expires_in: 900,
      interval: 5,
    });
    expect(await result).toEqual(
      jasmine.objectContaining({ userCode: 'ABCD-EFGH', intervalMs: 5000 }),
    );
  });

  it('honors pending and slow-down intervals before returning a non-expiring token', fakeAsync(() => {
    let result: OAuthTokenResult | undefined;
    service
      .poll('public-client', code, new AbortController().signal)
      .then((value) => (result = value));
    tick(4999);
    http.expectNone(tokenUrl);
    tick(1);
    flushMicrotasks();
    const first = http.expectOne(tokenUrl);
    expect(new URLSearchParams(first.request.body).get('device_code')).toBe(
      code.deviceCode,
    );
    first.flush({ error: 'authorization_pending' });
    flushMicrotasks();
    tick(5000);
    flushMicrotasks();
    http.expectOne(tokenUrl).flush({ error: 'slow_down' });
    flushMicrotasks();
    tick(9999);
    http.expectNone(tokenUrl);
    tick(1);
    flushMicrotasks();
    http.expectOne(tokenUrl).flush({ access_token: 'approved-access' });
    flushMicrotasks();
    expect(result).toEqual({
      accessToken: 'approved-access',
      refreshToken: '',
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
  }));

  it('stops polling on denial', fakeAsync(() => {
    let error: Error | undefined;
    service
      .poll('public-client', code, new AbortController().signal)
      .catch((value) => (error = value));
    tick(5000);
    flushMicrotasks();
    http.expectOne(tokenUrl).flush({ error: 'access_denied' });
    flushMicrotasks();
    expect(error?.message).toContain('declined');
    tick(30000);
    http.expectNone(tokenUrl);
  }));

  it('cancels the wait immediately when the dialog closes', fakeAsync(() => {
    const controller = new AbortController();
    let error: Error | undefined;
    service
      .poll('public-client', code, controller.signal)
      .catch((value) => (error = value));
    controller.abort();
    flushMicrotasks();
    expect(error?.name).toBe('AbortError');
    tick(30000);
    http.expectNone(tokenUrl);
  }));

  it('expires a code without making another request', fakeAsync(() => {
    let error: Error | undefined;
    service
      .poll(
        'public-client',
        { ...code, expiresAt: Date.now() + 1000 },
        new AbortController().signal,
      )
      .catch((value) => (error = value));
    tick(1000);
    flushMicrotasks();
    expect(error?.message).toContain('expired');
    http.expectNone(tokenUrl);
  }));
});
