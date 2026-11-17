import { Log } from '../core/log';

type SearchNavDebugPayload = Record<string, unknown>;

interface SearchNavDebugEntry extends SearchNavDebugPayload {
  at: string;
  event: string;
}

const DEBUG_FLAG = 'SP_SEARCH_NAV_DEBUG';
const MAX_ENTRIES = 100;
const DEBUG_CONTEXT = 'search-nav-debug';

let _entries: SearchNavDebugEntry[] = [];

const _isEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem(DEBUG_FLAG) === '1';

/**
 * Records a debug entry when `SP_SEARCH_NAV_DEBUG=1` is set in localStorage.
 *
 * Pass the payload as a function when building it reads layout (`clientHeight`,
 * `scrollHeight`, `getBoundingClientRect()`): an object literal is evaluated
 * before this check, so those reads would force a layout on every call even
 * though nothing is recorded.
 */
export const recordSearchNavDebug = (
  event: string,
  payload: SearchNavDebugPayload | (() => SearchNavDebugPayload) = {},
): void => {
  if (!_isEnabled()) {
    return;
  }

  const entry: SearchNavDebugEntry = {
    at: new Date().toISOString(),
    event,
    ...(typeof payload === 'function' ? payload() : payload),
  };

  _entries = [..._entries.slice(-(MAX_ENTRIES - 1)), entry];
  (
    window as Window & {
      __spSearchNavDebug?: SearchNavDebugEntry[];
    }
  ).__spSearchNavDebug = _entries;

  // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
  Log.log(`[${DEBUG_CONTEXT}]`, entry);
};
