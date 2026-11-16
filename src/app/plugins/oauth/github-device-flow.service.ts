import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { OAuthTokenResult } from '@super-productivity/plugin-api';

export interface GitHubDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

const abortError = (): DOMException =>
  new DOMException('Sign-in cancelled.', 'AbortError');
const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError();
};

@Injectable({ providedIn: 'root' })
export class GithubDeviceFlowService {
  private readonly _http = inject(HttpClient);

  async requestCode(
    clientId: string,
    signal: AbortSignal,
  ): Promise<GitHubDeviceAuthorization> {
    const body = await this._post(
      'https://github.com/login/device/code',
      { client_id: clientId, scope: 'repo' },
      signal,
    );
    if (
      typeof body.device_code !== 'string' ||
      !body.device_code ||
      typeof body.user_code !== 'string' ||
      !body.user_code ||
      body.verification_uri !== 'https://github.com/login/device' ||
      typeof body.expires_in !== 'number' ||
      body.expires_in <= 0 ||
      !Number.isFinite(body.expires_in)
    ) {
      throw new Error('GitHub did not return a valid sign-in code.');
    }
    const lifetimeMs = body.expires_in * 1000;
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      expiresAt: Date.now() + lifetimeMs,
      intervalMs:
        typeof body.interval === 'number' &&
        body.interval > 0 &&
        Number.isFinite(body.interval)
          ? body.interval * 1000
          : 5000,
    };
  }

  async poll(
    clientId: string,
    authorization: GitHubDeviceAuthorization,
    signal: AbortSignal,
  ): Promise<OAuthTokenResult> {
    let interval = authorization.intervalMs;
    while (Date.now() < authorization.expiresAt) {
      await this._sleep(Math.min(interval, authorization.expiresAt - Date.now()), signal);
      throwIfAborted(signal);
      if (Date.now() >= authorization.expiresAt) break;
      const body = await this._post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          device_code: authorization.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        signal,
      );
      if (typeof body.access_token === 'string' && body.access_token) {
        const lifetimeMs =
          typeof body.expires_in === 'number' && body.expires_in > 0
            ? body.expires_in * 1000
            : undefined;
        return {
          accessToken: body.access_token,
          refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
          expiresAt: lifetimeMs ? Date.now() + lifetimeMs : Number.MAX_SAFE_INTEGER,
        };
      }
      if (body.error === 'authorization_pending') continue;
      if (body.error === 'slow_down') {
        interval += 5000;
        continue;
      }
      if (body.error === 'access_denied') throw new Error('GitHub sign-in was declined.');
      if (body.error === 'expired_token') break;
      throw new Error('GitHub could not complete sign-in.');
    }
    throw new Error('The GitHub sign-in code expired. Start sign-in again.');
  }

  private async _post(
    url: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    throwIfAborted(signal);
    try {
      return await firstValueFrom(
        this._http
          .post<Record<string, unknown>>(url, new URLSearchParams(params).toString(), {
            headers: new HttpHeaders()
              .set('Accept', 'application/json')
              .set('Content-Type', 'application/x-www-form-urlencoded'),
          })
          .pipe(timeout(30000), takeUntil(fromEvent(signal, 'abort'))),
      );
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (
        error instanceof HttpErrorResponse &&
        error.error &&
        typeof error.error === 'object' &&
        'error' in error.error
      ) {
        return error.error as Record<string, unknown>;
      }
      throw error;
    }
  }

  private _sleep(ms: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const aborted = (): void => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      }, ms);
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
}
