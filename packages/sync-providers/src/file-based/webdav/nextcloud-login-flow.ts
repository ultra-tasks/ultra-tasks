import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import { RemoteFileNotFoundAPIError } from '../../errors';
import { errorMeta } from '../../log/error-meta';
import { WebDavHttpAdapter } from './webdav-http-adapter';
import { WebDavHttpHeader } from './webdav.const';

/**
 * Nextcloud Login Flow v2: the user signs in on their own Nextcloud page in the
 * system browser and the server hands this device a dedicated, revocable app
 * password. It needs no client registration, so it works for every self-hosted
 * instance, and the user never types their account password into the app.
 * https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/
 */
export interface NextcloudLoginFlowDeps {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttp: NativeHttpExecutor;
}

export interface NextcloudLoginFlowSession {
  /** Page the user opens in the system browser to approve this device. */
  loginUrl: string;
  pollEndpoint: string;
  pollToken: string;
}

export interface NextcloudLoginFlowCredentials {
  /** Server root without a trailing slash, e.g. `https://cloud.example.com`. */
  serverUrl: string;
  /** Login name (may be an email); not necessarily the WebDAV user id. */
  loginName: string;
  appPassword: string;
}

export interface PollNextcloudLoginFlowOptions {
  /** Default 2 s. */
  intervalMs?: number;
  /** Default 20 min, the server-side lifetime of a login flow token. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class NextcloudLoginFlowError extends Error {
  override name = 'NextcloudLoginFlowError';
  constructor(
    message: string,
    readonly code:
      | 'INVALID_URL'
      | 'NOT_NEXTCLOUD'
      | 'ORIGIN_MISMATCH'
      | 'TIMEOUT'
      | 'ABORTED',
  ) {
    super(message);
  }
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export const startNextcloudLoginFlow = async (
  serverUrl: string,
  deps: NextcloudLoginFlowDeps,
): Promise<NextcloudLoginFlowSession> => {
  const base = normalizeNextcloudServerUrl(serverUrl);
  const response = await _adapter(deps).request({
    url: `${base}/index.php/login/v2`,
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const parsed = _parseJson(response.data) as {
    poll?: { token?: unknown; endpoint?: unknown };
    login?: unknown;
  } | null;
  const token = parsed?.poll?.token;
  const endpoint = parsed?.poll?.endpoint;
  const login = parsed?.login;
  if (
    typeof token !== 'string' ||
    typeof endpoint !== 'string' ||
    typeof login !== 'string'
  ) {
    throw new NextcloudLoginFlowError(
      'The server did not start a Nextcloud sign-in. Check the server address.',
      'NOT_NEXTCLOUD',
    );
  }
  // The poll token is a bearer secret for the new app password: only send it
  // back to the server the user entered, never to a host named in the reply.
  _assertSameServer(base, endpoint);
  _assertSameServer(base, login);
  return { loginUrl: login, pollEndpoint: endpoint, pollToken: token };
};

/**
 * Poll until the user approves the device in the browser. The endpoint answers
 * 404 until then; a 200 carries the credentials exactly once.
 */
export const pollNextcloudLoginFlow = async (
  session: NextcloudLoginFlowSession,
  deps: NextcloudLoginFlowDeps,
  opts: PollNextcloudLoginFlowOptions = {},
): Promise<NextcloudLoginFlowCredentials> => {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const adapter = _adapter(deps);

  while (now() < deadline) {
    if (opts.signal?.aborted) {
      throw new NextcloudLoginFlowError('Sign-in was cancelled.', 'ABORTED');
    }
    try {
      const response = await adapter.request({
        url: session.pollEndpoint,
        method: 'POST',
        headers: {
          [WebDavHttpHeader.CONTENT_TYPE]: 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `token=${encodeURIComponent(session.pollToken)}`,
      });
      const creds = _parseCredentials(response.data);
      if (creds) {
        _assertSameServer(session.pollEndpoint, creds.serverUrl);
        return creds;
      }
      throw new NextcloudLoginFlowError(
        'The server finished sign-in but returned no app password.',
        'NOT_NEXTCLOUD',
      );
    } catch (e) {
      if (!(e instanceof RemoteFileNotFoundAPIError)) {
        deps.logger.normal('pollNextcloudLoginFlow() failed', errorMeta(e));
        throw e;
      }
    }
    await sleep(interval);
  }
  throw new NextcloudLoginFlowError(
    'Sign-in timed out. Start again and approve the device within 20 minutes.',
    'TIMEOUT',
  );
};

/** Trim whitespace, trailing slashes and a pasted `/index.php` or DAV path. */
export const normalizeNextcloudServerUrl = (serverUrl: string): string => {
  const trimmed = serverUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new NextcloudLoginFlowError(
      'Server URL must start with https:// or http://',
      'INVALID_URL',
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new NextcloudLoginFlowError('Server URL is not valid.', 'INVALID_URL');
  }
  const path = url.pathname
    .replace(/\/(index\.php|remote\.php)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
};

/**
 * WebDAV files root for a Login Flow result. `userId` is the canonical id from
 * OCS, which can differ from the login name (issue #7617).
 */
export const buildNextcloudDavFilesUrl = (serverUrl: string, userId: string): string =>
  `${serverUrl.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(userId)}/`;

const _adapter = (deps: NextcloudLoginFlowDeps): WebDavHttpAdapter =>
  new WebDavHttpAdapter({
    logger: deps.logger,
    platformInfo: deps.platformInfo,
    webFetch: deps.webFetch,
    nativeHttp: deps.nativeHttp,
  });

const _parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const _parseCredentials = (body: string): NextcloudLoginFlowCredentials | null => {
  const parsed = _parseJson(body) as {
    server?: unknown;
    loginName?: unknown;
    appPassword?: unknown;
  } | null;
  if (
    typeof parsed?.server !== 'string' ||
    typeof parsed.loginName !== 'string' ||
    typeof parsed.appPassword !== 'string' ||
    !parsed.loginName ||
    !parsed.appPassword
  ) {
    return null;
  }
  return {
    serverUrl: normalizeNextcloudServerUrl(parsed.server),
    loginName: parsed.loginName,
    appPassword: parsed.appPassword,
  };
};

/**
 * Same host as the server the user chose. An http -> https upgrade is fine
 * (servers behind a TLS proxy often report it); a downgrade is not.
 */
const _assertSameServer = (expected: string, actual: string): void => {
  let a: URL;
  let b: URL;
  try {
    a = new URL(expected);
    b = new URL(actual);
  } catch {
    throw new NextcloudLoginFlowError(
      'The server returned an invalid address.',
      'NOT_NEXTCLOUD',
    );
  }
  const downgrade = a.protocol === 'https:' && b.protocol !== 'https:';
  if (a.host.toLowerCase() !== b.host.toLowerCase() || downgrade) {
    throw new NextcloudLoginFlowError(
      `The server answered for a different address (${b.host}). Enter that address and try again.`,
      'ORIGIN_MISMATCH',
    );
  }
};
