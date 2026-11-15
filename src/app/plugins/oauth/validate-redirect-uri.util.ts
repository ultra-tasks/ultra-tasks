import {
  OAUTH_LOOPBACK_PORT_MIN,
  OAUTH_LOOPBACK_PORT_MAX,
} from '../../../../electron/shared-with-frontend/oauth-loopback.const';

export const WEB_OAUTH_CALLBACK_PATH = '/assets/oauth-callback.html';

/**
 * https hand-off pages a native build may send as the redirect address, for providers
 * that refuse the app's custom scheme (Trello OAuth 2.0). The page, served by the
 * website, passes `code` and `state` on to `app.ultratasks:/plugin-oauth-callback`. An
 * allowlist of exact values: a plugin must never be able to send the authorization code
 * to a page it controls.
 */
export const NATIVE_OAUTH_HANDOFF_URIS: readonly string[] = [
  'https://ultratasks.app/oauth-callback/',
];

export interface RedirectUriPlatform {
  isElectron: boolean;
  isNative: boolean;
  /** window.location.origin — passed in for testability */
  origin: string;
}

/**
 * Validate a plugin-supplied OAuth redirectUri for the current platform, throwing a clear
 * error on anything the transport can't actually service (so misconfigurations fail fast
 * instead of hanging on the IdP redirect).
 */
export const validateOAuthRedirectUri = (
  redirectUri: string,
  platform: RedirectUriPlatform,
): void => {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error(`Invalid OAuth redirectUri: ${redirectUri}`);
  }

  if (platform.isElectron) {
    const port = Number(parsed.port);
    // Require 127.0.0.1 specifically (not localhost / [::1]): the loopback server binds
    // 127.0.0.1, and 'localhost' can resolve to ::1 first and miss the IPv4 listener.
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      !parsed.port ||
      !Number.isInteger(port) ||
      port < OAUTH_LOOPBACK_PORT_MIN ||
      port > OAUTH_LOOPBACK_PORT_MAX
    ) {
      throw new Error(
        `OAuth redirectUri on desktop must be a loopback URI http://127.0.0.1:<port>/ with port in [${OAUTH_LOOPBACK_PORT_MIN}, ${OAUTH_LOOPBACK_PORT_MAX}]; got ${redirectUri}`,
      );
    }
    return;
  }

  if (platform.isNative) {
    // A native OAuth callback uses the app's fixed custom scheme, so a plugin-supplied
    // redirectUri override is meaningless here, with one exception: the exact https
    // hand-off pages in NATIVE_OAUTH_HANDOFF_URIS. Everything else is rejected — an
    // allowlist, which also closes the incomplete-scheme-check (no scheme can slip
    // through a denylist).
    if (NATIVE_OAUTH_HANDOFF_URIS.includes(redirectUri)) {
      return;
    }
    throw new Error(
      `OAuth redirectUri override is not supported on native; the app's fixed callback scheme is used. Got ${redirectUri}`,
    );
  }

  // web — must be the app's built-in OAuth callback page (the only page that resolves the
  // postMessage callback); a same-origin URI with any other path would hang until timeout.
  if (parsed.origin !== platform.origin || parsed.pathname !== WEB_OAUTH_CALLBACK_PATH) {
    throw new Error(
      `OAuth redirectUri on web must be ${platform.origin}${WEB_OAUTH_CALLBACK_PATH}; got ${redirectUri}`,
    );
  }
};
