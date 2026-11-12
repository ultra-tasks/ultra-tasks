import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER } from '@sp/sync-core';
import {
  buildNextcloudDavFilesUrl,
  NextcloudLoginFlowError,
  normalizeNextcloudServerUrl,
  pollNextcloudLoginFlow,
  startNextcloudLoginFlow,
  type NextcloudLoginFlowDeps,
} from '../../../src/webdav';

interface RecordedReq {
  url: string;
  init?: RequestInit;
}

const makeDeps = (fetchImpl: typeof fetch): NextcloudLoginFlowDeps => ({
  logger: NOOP_SYNC_LOGGER,
  platformInfo: { isNativePlatform: false, isAndroidWebView: false, isIosNative: false },
  webFetch: () => fetchImpl,
  nativeHttp: vi.fn(),
});

const scriptedFetch = (
  calls: RecordedReq[],
  responses: (() => Response)[],
): typeof fetch =>
  vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as unknown as typeof fetch;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const START_BODY = {
  poll: { token: 'poll-token', endpoint: 'https://cloud.example.com/login/v2/poll' },
  login: 'https://cloud.example.com/login/v2/flow/abc',
};

const SESSION = {
  loginUrl: START_BODY.login,
  pollEndpoint: START_BODY.poll.endpoint,
  pollToken: 'poll-token',
};

const noSleep = (): Promise<void> => Promise.resolve();

describe('normalizeNextcloudServerUrl', () => {
  it('strips trailing slashes and pasted index.php / DAV paths, keeping a sub-path', () => {
    expect(normalizeNextcloudServerUrl(' https://cloud.example.com/ ')).toBe(
      'https://cloud.example.com',
    );
    expect(
      normalizeNextcloudServerUrl('https://example.com/nc/remote.php/dav/files/jane/'),
    ).toBe('https://example.com/nc');
    expect(
      normalizeNextcloudServerUrl('https://example.com/nc/index.php/apps/deck'),
    ).toBe('https://example.com/nc');
  });

  it('rejects a schemeless address so nothing is sent to a guessed host', () => {
    expect(() => normalizeNextcloudServerUrl('cloud.example.com')).toThrowError(
      NextcloudLoginFlowError,
    );
  });
});

describe('startNextcloudLoginFlow', () => {
  it('POSTs to /index.php/login/v2 and returns the login page and poll handle', async () => {
    const calls: RecordedReq[] = [];
    const session = await startNextcloudLoginFlow(
      'https://cloud.example.com/',
      makeDeps(scriptedFetch(calls, [() => json(START_BODY)])),
    );
    expect(calls[0]?.url).toBe('https://cloud.example.com/index.php/login/v2');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(session).toEqual(SESSION);
  });

  it('refuses a poll endpoint on another host, so the poll token stays with the chosen server', async () => {
    const calls: RecordedReq[] = [];
    await expect(
      startNextcloudLoginFlow(
        'https://cloud.example.com',
        makeDeps(
          scriptedFetch(calls, [
            () =>
              json({
                ...START_BODY,
                poll: { token: 't', endpoint: 'https://evil.example.net/poll' },
              }),
          ]),
        ),
      ),
    ).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' });
  });

  it('refuses an https -> http downgrade but accepts an http -> https upgrade', async () => {
    await expect(
      startNextcloudLoginFlow(
        'https://cloud.example.com',
        makeDeps(
          scriptedFetch(
            [],
            [
              () =>
                json({
                  ...START_BODY,
                  poll: {
                    token: 't',
                    endpoint: 'http://cloud.example.com/login/v2/poll',
                  },
                }),
            ],
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' });

    await expect(
      startNextcloudLoginFlow(
        'http://cloud.example.com',
        makeDeps(scriptedFetch([], [() => json(START_BODY)])),
      ),
    ).resolves.toEqual(SESSION);
  });

  it('reports a non-Nextcloud server clearly', async () => {
    await expect(
      startNextcloudLoginFlow(
        'https://cloud.example.com',
        makeDeps(
          scriptedFetch([], [() => new Response('<html></html>', { status: 200 })]),
        ),
      ),
    ).rejects.toMatchObject({ code: 'NOT_NEXTCLOUD' });
  });
});

describe('pollNextcloudLoginFlow', () => {
  it('keeps polling while the server answers 404, then returns the app password', async () => {
    const calls: RecordedReq[] = [];
    const creds = await pollNextcloudLoginFlow(
      SESSION,
      makeDeps(
        scriptedFetch(calls, [
          () => new Response('', { status: 404 }),
          () => new Response('', { status: 404 }),
          () =>
            json({
              server: 'https://cloud.example.com/',
              loginName: 'jane@example.com',
              appPassword: 'app-pw',
            }),
        ]),
      ),
      { sleep: noSleep },
    );
    expect(creds).toEqual({
      serverUrl: 'https://cloud.example.com',
      loginName: 'jane@example.com',
      appPassword: 'app-pw',
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe(SESSION.pollEndpoint);
    expect(calls[0]?.init?.body).toBe('token=poll-token');
  });

  it('refuses credentials that name another server', async () => {
    await expect(
      pollNextcloudLoginFlow(
        SESSION,
        makeDeps(
          scriptedFetch(
            [],
            [
              () =>
                json({
                  server: 'https://evil.example.net',
                  loginName: 'jane',
                  appPassword: 'pw',
                }),
            ],
          ),
        ),
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' });
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollNextcloudLoginFlow(SESSION, makeDeps(scriptedFetch([], [])), {
        signal: controller.signal,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('times out after the token lifetime', async () => {
    let t = 0;
    await expect(
      pollNextcloudLoginFlow(
        SESSION,
        makeDeps(
          scriptedFetch(
            [],
            [
              () => new Response('', { status: 404 }),
              () => new Response('', { status: 404 }),
            ],
          ),
        ),
        {
          sleep: noSleep,
          timeoutMs: 1000,
          intervalMs: 600,
          now: () => (t += 600),
        },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('surfaces other HTTP failures instead of polling forever', async () => {
    await expect(
      pollNextcloudLoginFlow(
        SESSION,
        makeDeps(scriptedFetch([], [() => new Response('', { status: 500 })])),
        { sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('buildNextcloudDavFilesUrl', () => {
  it('uses the canonical user id, encoded', () => {
    expect(buildNextcloudDavFilesUrl('https://cloud.example.com/', 'jane doe')).toBe(
      'https://cloud.example.com/remote.php/dav/files/jane%20doe/',
    );
  });
});
