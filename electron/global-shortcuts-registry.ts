import {
  GLOBAL_KEY_CFG_KEYS,
  KeyboardConfig,
} from './shared-with-frontend/keyboard-config.model';

/** The part of Electron's `globalShortcut` the registry needs. */
export interface GlobalShortcutBackend {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/** A binding that could not be registered. Also the payload of `IPC.GLOBAL_SHORTCUT_CONFLICT`. */
export interface GlobalShortcutConflict {
  shortcut: string;
  action: string;
}

export interface GlobalShortcutLogger {
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
}

export interface GlobalShortcutRegistryDeps {
  backend: GlobalShortcutBackend;
  /**
   * What runs when the shortcut of `action` is pressed. Registrations outlive the
   * window they were made for, so look the window up when this runs, not here.
   */
  getAction: (action: string) => () => void;
  /** Called once per distinct failure (see `apply`). Must not throw. */
  onConflict: (conflict: GlobalShortcutConflict) => void;
  /** Diagnostics only: shortcut and action keys, never user content. */
  logger?: GlobalShortcutLogger;
}

export interface GlobalShortcutRegistry {
  /**
   * Makes the registered system-wide shortcuts match `cfg`, the complete set of
   * global bindings (everything else is unregistered).
   *
   * Only the difference to what this process has registered is applied: an
   * unchanged working binding stays registered and untouched. A binding that
   * fails is reported once through `onConflict` and then retried silently on
   * every later `apply`, so a shortcut another app released starts working
   * without a second report. The record of a failure is dropped when the config
   * no longer asks for that binding; asking for it again reports it again.
   *
   * Two actions configured with the same shortcut: the first in
   * `GLOBAL_KEY_CFG_KEYS` order keeps it, the others are reported as conflicts.
   */
  apply(cfg: KeyboardConfig | null | undefined): void;
}

const failureKey = (action: string, shortcut: string): string =>
  `${action}\u0000${shortcut}`;

export const createGlobalShortcutRegistry = ({
  backend,
  getAction,
  onConflict,
  logger,
}: GlobalShortcutRegistryDeps): GlobalShortcutRegistry => {
  // shortcut -> action, for every binding this process registered successfully
  const registered = new Map<string, string>();
  // failed bindings (see failureKey) that were already reported
  const failed = new Set<string>();

  const apply = (cfg: KeyboardConfig | null | undefined): void => {
    // shortcut -> action; a fixed order makes duplicates independent of the config's key order
    const wanted = new Map<string, string>();
    const duplicates: GlobalShortcutConflict[] = [];
    if (cfg) {
      for (const action of GLOBAL_KEY_CFG_KEYS) {
        const shortcut = cfg[action];
        if (typeof shortcut !== 'string' || shortcut.length === 0) {
          continue;
        }
        if (wanted.has(shortcut)) {
          duplicates.push({ shortcut, action });
        } else {
          wanted.set(shortcut, action);
        }
      }
    }

    // Release first, so a shortcut handed from one action to another (or swapped) is free again.
    for (const [shortcut, action] of registered) {
      if (wanted.get(shortcut) !== action) {
        backend.unregister(shortcut);
        registered.delete(shortcut);
      }
    }

    const stillFailing = new Set<string>();
    const fail = (shortcut: string, action: string, reason: string): void => {
      const key = failureKey(action, shortcut);
      stillFailing.add(key);
      if (failed.has(key)) {
        return;
      }
      failed.add(key);
      logger?.error('Global shortcut registration failed', { shortcut, action, reason });
      onConflict({ shortcut, action });
    };

    for (const [shortcut, action] of wanted) {
      if (registered.get(shortcut) === action) {
        continue;
      }
      let reason: string | null;
      try {
        reason = backend.register(shortcut, getAction(action))
          ? null
          : 'register() returned false';
      } catch (e) {
        // an accelerator Electron cannot parse
        reason = e instanceof Error ? e.message : String(e);
      }
      if (reason === null) {
        registered.set(shortcut, action);
        if (failed.has(failureKey(action, shortcut))) {
          logger?.info('Global shortcut registered after an earlier failure', {
            shortcut,
            action,
          });
        }
      } else {
        fail(shortcut, action, reason);
      }
    }
    for (const { shortcut, action } of duplicates) {
      fail(shortcut, action, `same shortcut as ${wanted.get(shortcut)}`);
    }

    for (const key of failed) {
      if (!stillFailing.has(key)) {
        failed.delete(key);
      }
    }
  };

  return { apply };
};
