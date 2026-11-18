/**
 * The one rule for an Ultra Tasks account server address, shared by the sign-in form (to
 * validate the origin the user actually selected) and {@link NativeSyncService} (before any
 * credential or request leaves the device).
 *
 * HTTPS is required; plain HTTP is accepted for localhost development only. Credentials,
 * query strings and fragments are never part of an origin. Returns the origin without a
 * trailing slash, which is also the namespace of the cached account (`ultra-native-account:`
 * and `ultra-native-server`), so a value that passes here always maps to the same keys.
 *
 * Throws `NATIVE_SYNC.ERROR_URL` for a well-formed but unacceptable address, and the
 * platform `TypeError` for text that is not a URL at all; callers show both the same way.
 */
export const normalizeServerUrl = (serverUrl: string): string => {
  const url = new URL(serverUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  )
    throw new Error('NATIVE_SYNC.ERROR_URL');
  return url.href.replace(/\/$/, '');
};

/** True when {@link normalizeServerUrl} accepts the address. */
export const isAcceptableServerUrl = (serverUrl: string): boolean => {
  try {
    normalizeServerUrl(serverUrl);
    return true;
  } catch {
    return false;
  }
};
