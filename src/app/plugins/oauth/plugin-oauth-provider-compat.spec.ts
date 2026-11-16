import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PluginOAuthService } from './plugin-oauth.service';

describe('Provider OAuth token compatibility', () => {
  let service: PluginOAuthService;
  let http: HttpTestingController;
  const tokens = {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: 1,
    clientId: 'public-client',
    tokenUrl: 'https://api.linear.app/oauth/token',
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(PluginOAuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('persists a rotated refresh token and uses it for the next refresh', async () => {
    service.storeTokens('linear__oauth__connection-1', tokens);
    const refreshed = service.getValidToken('linear__oauth__connection-1');
    const firstRequest = http.expectOne(tokens.tokenUrl);
    firstRequest.flush({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    });
    expect(await refreshed).toBe('new-access');
    const stored = JSON.parse(service.serializeTokens('linear__oauth__connection-1')!);
    expect(stored.refreshToken).toBe('new-refresh');
    service.storeTokens('linear__oauth__connection-1', { ...stored, expiresAt: 1 });
    const next = service.getValidToken('linear__oauth__connection-1');
    const request = http.expectOne(tokens.tokenUrl);
    expect(new URLSearchParams(request.request.body).get('refresh_token')).toBe(
      'new-refresh',
    );
    request.flush({ access_token: 'next-access', expires_in: 3600 });
    expect(await next).toBe('next-access');
  });

  it('retains a refresh token when the provider does not rotate it', async () => {
    service.storeTokens('google', tokens);
    const refreshed = service.getValidToken('google');
    http
      .expectOne(tokens.tokenUrl)
      .flush({ access_token: 'new-access', expires_in: 3600 });
    await refreshed;
    expect(JSON.parse(service.serializeTokens('google')!).refreshToken).toBe(
      'old-refresh',
    );
  });

  it('restores a non-expiring device-flow token without requiring a refresh grant', async () => {
    service.restoreTokens(
      'github__oauth__connection-2',
      JSON.stringify({
        ...tokens,
        accessToken: 'device-access',
        refreshToken: '',
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    );
    expect(await service.getValidToken('github__oauth__connection-2')).toBe(
      'device-access',
    );
  });
});
