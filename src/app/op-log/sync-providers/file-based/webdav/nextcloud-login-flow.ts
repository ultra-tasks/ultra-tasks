import { Capacitor } from '@capacitor/core';
import {
  buildNextcloudDavFilesUrl,
  pollNextcloudLoginFlow,
  startNextcloudLoginFlow,
  type NextcloudLoginFlowCredentials,
  type NextcloudLoginFlowDeps,
} from '@sp/sync-providers/webdav';
import { IS_ELECTRON } from '../../../../app.constants';
import { OP_LOG_SYNC_LOGGER } from '../../../core/sync-logger.adapter';
import { APP_PROVIDER_PLATFORM_INFO } from '../../platform/app-provider-platform-info';
import { APP_WEB_FETCH } from '../../platform/app-web-fetch';
import { APP_WEBDAV_NATIVE_HTTP } from './capacitor-webdav-http/app-webdav-native-http';
import { discoverNextcloudUserId } from './discover-nextcloud-user-id';

const DEPS: NextcloudLoginFlowDeps = {
  logger: OP_LOG_SYNC_LOGGER,
  platformInfo: APP_PROVIDER_PLATFORM_INFO,
  webFetch: APP_WEB_FETCH,
  nativeHttp: APP_WEBDAV_NATIVE_HTTP,
};

export interface NextcloudSignInResult extends NextcloudLoginFlowCredentials {
  /** Canonical WebDAV user id, when the OCS lookup succeeded. */
  userId?: string;
  /** WebDAV files root built from `userId` (falls back to the login name). */
  davFilesUrl: string;
}

const openInSystemBrowser = async (url: string): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else if (IS_ELECTRON) {
    window.ea.openExternalUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

/**
 * "Sign in with Nextcloud": opens the server's own login page in the system
 * browser and waits for the device's app password (Login Flow v2). Nothing is
 * saved here; the caller writes the result into the form for review.
 */
export const signInWithNextcloud = async (
  serverUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<NextcloudSignInResult> => {
  const session = await startNextcloudLoginFlow(serverUrl, DEPS);
  await openInSystemBrowser(session.loginUrl);
  const creds = await pollNextcloudLoginFlow(session, DEPS, { signal: opts.signal });
  const discovered = await discoverNextcloudUserId({
    serverUrl: creds.serverUrl,
    userName: '',
    loginName: creds.loginName,
    password: creds.appPassword,
  });
  const userId = discovered.success ? discovered.userId : undefined;
  return {
    ...creds,
    userId,
    davFilesUrl: buildNextcloudDavFilesUrl(creds.serverUrl, userId ?? creds.loginName),
  };
};
