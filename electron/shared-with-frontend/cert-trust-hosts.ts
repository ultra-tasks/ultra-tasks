// Hosts whose invalid (e.g. self-signed) TLS certificates the app accepts: only
// hosts the user typed into their own provider settings (WebDAV, SuperSync,
// self-hosted issue providers, ...). Everything else gets normal validation. #11097

const MAX_HOSTS = 200;
// Endpoint fields used by built-in providers and plugin provider configuration.
// Never infer trust from credentials, descriptions, or link-only settings.
const ENDPOINT_KEYS = new Set([
  'host',
  'baseUrl',
  'serverUrl',
  'gitlabBaseUrl',
  'caldavUrl',
  'icalUrl',
  'url',
  'apiUrl',
]);
// URL.host output: lowercase hostname / IPv6 literal, optional :port
const HOST_PATTERN = /^[a-z0-9._\-[\]:]{1,260}$/;

const getHttpHost = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    return new URL(value).host || null;
  } catch {
    // not a URL — just some other config string
    return null;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Collects `URL.host` (hostname + non-default port) from provider endpoints.
 * Plugin endpoints are read only from `pluginConfig`, one nesting level deep.
 * URL-shaped secrets and alternative browser-link hosts do not confer trust.
 */
export const getConfiguredHosts = (configs: readonly unknown[]): string[] => {
  const hosts = new Set<string>();
  const add = (value: unknown): void => {
    const host = getHttpHost(value);
    if (host) {
      hosts.add(host);
    }
  };
  for (const cfg of configs) {
    if (!isObject(cfg)) {
      continue;
    }
    for (const [key, value] of Object.entries(cfg)) {
      if (ENDPOINT_KEYS.has(key)) {
        add(value);
      }
      if (key === 'pluginConfig' && isObject(value)) {
        for (const [pluginKey, pluginValue] of Object.entries(value)) {
          if (ENDPOINT_KEYS.has(pluginKey)) {
            add(pluginValue);
          }
        }
      }
    }
  }
  return [...hosts];
};

/** Validates an untrusted IPC payload into the main-process allowlist. */
export const toTrustedHostSet = (payload: unknown): Set<string> => {
  if (!Array.isArray(payload)) {
    return new Set();
  }
  return new Set(
    payload
      .filter((h): h is string => typeof h === 'string' && HOST_PATTERN.test(h))
      .slice(0, MAX_HOSTS),
  );
};

/** `URL.host` of a request URL, or null if unparsable. */
export const getUrlHost = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    // unparsable URL — callers fail closed
    return null;
  }
};

/** True only if the failing request's exact host (incl. port) is allowlisted. */
export const isCertErrorTrusted = (
  url: string,
  trustedHosts: ReadonlySet<string>,
): boolean => {
  const host = getUrlHost(url);
  return host !== null && trustedHosts.has(host);
};

/** One-shot preload API; claimed by trusted startup code before plugins load. */
export interface CertTrustElectronApi {
  setTrustedHosts(hosts: string[]): void;
}
