import type { App, BrowserWindow, PowerMonitor } from 'electron';
import { info, warn } from 'electron-log/main';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Why the previous run of the app ended, recorded so an unexplained restart (the
 * overnight sign-in incident of 2026-11-18) can be attributed the next time.
 *
 * Only a coarse reason, process facts and timestamps are kept: no account data, no task
 * content, no secrets.
 */
export type ExitReason =
  | 'updater'
  | 'os-session-end'
  | 'renderer-crash'
  | 'uncaught-exception'
  | 'user-quit'
  | 'window-close';

export interface LifecycleMarker {
  v: 1;
  pid: number;
  startedAt: number;
  /** Refreshed periodically: the last moment the process is known to have been alive. */
  lastAliveAt: number;
  reason: ExitReason | null;
  /** Renderer crash reason or process exit code, when known. */
  detail: string | null;
  endedAt: number | null;
}

/** An OS- or crash-level cause outranks the quit path that merely carried it out. */
const STRONG: ReadonlySet<ExitReason> = new Set([
  'updater',
  'os-session-end',
  'renderer-crash',
  'uncaught-exception',
]);
const HEARTBEAT_MS = 5 * 60 * 1000;

export const parseLifecycleMarker = (raw: string | null): LifecycleMarker | null => {
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as Partial<LifecycleMarker>;
    return marker.v === 1 &&
      typeof marker.pid === 'number' &&
      typeof marker.startedAt === 'number' &&
      typeof marker.lastAliveAt === 'number'
      ? {
          v: 1,
          pid: marker.pid,
          startedAt: marker.startedAt,
          lastAliveAt: marker.lastAliveAt,
          reason: (marker.reason as ExitReason | null | undefined) ?? null,
          detail: typeof marker.detail === 'string' ? marker.detail : null,
          endedAt: typeof marker.endedAt === 'number' ? marker.endedAt : null,
        }
      : null;
  } catch {
    return null;
  }
};

const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes < 90
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
};

/** One line, no secrets: what ended the previous run and when it was last seen alive. */
export const describePreviousExit = (marker: LifecycleMarker | null): string => {
  if (!marker)
    return 'previous run: no lifecycle marker (first start, or it was removed)';
  const ran = duration((marker.endedAt ?? marker.lastAliveAt) - marker.startedAt);
  if (marker.reason)
    return (
      `previous run ended: ${marker.reason}` +
      (marker.detail ? ` (${marker.detail})` : '') +
      `, after ${ran}, at ${new Date(marker.endedAt ?? marker.lastAliveAt).toISOString()}`
    );
  return (
    'previous run ended: unknown (no exit was recorded; a crash, kill, power loss or an ' +
    `OS session end without notice), after ${ran}, last seen alive at ` +
    new Date(marker.lastAliveAt).toISOString()
  );
};

export interface LifecycleStorage {
  read(): string | null;
  write(value: string): void;
}

/** The marker file: written synchronously so it survives a process that exits right after. */
export const createLifecycleMarker = (
  storage: LifecycleStorage,
  now: () => number,
  pid: number,
): {
  previous: LifecycleMarker | null;
  record(reason: ExitReason, detail?: string): void;
  alive(): void;
  finish(exitCode: number): void;
} => {
  let previous: LifecycleMarker | null = null;
  try {
    previous = parseLifecycleMarker(storage.read());
  } catch {
    previous = null;
  }
  const marker: LifecycleMarker = {
    v: 1,
    pid,
    startedAt: now(),
    lastAliveAt: now(),
    reason: null,
    detail: null,
    endedAt: null,
  };
  const save = (): void => {
    try {
      storage.write(JSON.stringify(marker));
    } catch (error) {
      warn('[lifecycle] Could not write the lifecycle marker', error);
    }
  };
  save();
  return {
    previous,
    record: (reason, detail) => {
      // First cause wins among the quit paths; a strong cause replaces a weak one.
      if (marker.reason && !(STRONG.has(reason) && !STRONG.has(marker.reason))) return;
      marker.reason = reason;
      marker.detail = detail ?? null;
      marker.endedAt = now();
      save();
    },
    alive: () => {
      marker.lastAliveAt = now();
      save();
    },
    finish: (exitCode) => {
      marker.endedAt = now();
      marker.lastAliveAt = marker.endedAt;
      if (!marker.reason && exitCode === 333) {
        marker.reason = 'uncaught-exception';
        marker.detail = 'exit code 333';
      }
      if (!marker.reason) {
        marker.reason = 'user-quit';
        marker.detail = `quit event, exit code ${exitCode}`;
      }
      save();
    },
  };
};

/**
 * Logs why the previous run ended and records why this one ends. Reasons: `updater`, `user-quit`, `window-close`,
 * `os-session-end`, `renderer-crash`, `uncaught-exception`, or `unknown` (no marker was
 * finished: a crash, kill or power loss).
 */
export const initLifecycleDiagnostics = ({
  app,
  userDataPath,
  updater,
}: {
  app: Pick<App, 'on'>;
  userDataPath: string;
  /** Electron's built-in `autoUpdater`, when an installer flow uses it. */
  updater?: { on(event: 'before-quit-for-update', listener: () => void): unknown };
}): { watchPower(powerMonitor: Pick<PowerMonitor, 'on'>): void } => {
  const file = join(userDataPath, 'lifecycle.json');
  const marker = createLifecycleMarker(
    {
      read: () => {
        try {
          return readFileSync(file, 'utf8');
        } catch {
          return null;
        }
      },
      write: (value) => writeFileSync(file, value, 'utf8'),
    },
    () => Date.now(),
    process.pid,
  );
  info('lifecycle: ' + describePreviousExit(marker.previous));

  const heartbeat = setInterval(() => marker.alive(), HEARTBEAT_MS);
  heartbeat.unref();

  app.on('browser-window-created', (_event: unknown, win: BrowserWindow) => {
    win.on('close', () => marker.record('window-close'));
    // Windows only: the session is ending (log off, restart or forced shutdown).
    win.on('session-end', () => {
      info('lifecycle: the OS session is ending');
      marker.record('os-session-end');
    });
  });
  // Menu, tray or shortcut quit. A window close that came first keeps its own reason.
  app.on('before-quit', () => marker.record('user-quit'));
  app.on('render-process-gone', (_event, _contents, details) => {
    info(`lifecycle: renderer gone (${details.reason}, exit code ${details.exitCode})`);
    if (details.reason !== 'clean-exit')
      marker.record('renderer-crash', `${details.reason}, exit code ${details.exitCode}`);
  });
  app.on('child-process-gone', (_event, details) => {
    info(`lifecycle: ${details.type} process gone (${details.reason})`);
  });
  app.on('quit', (_event: unknown, exitCode: number) => marker.finish(exitCode));
  process.on('exit', (code) => {
    // 333 is the uncaughtException handler's exit. The only other non-zero exit is the
    // main window's crashed-renderer path, which leaves before the app-level event fires.
    if (code === 333) marker.record('uncaught-exception', 'exit code 333');
    else if (code !== 0) marker.record('renderer-crash', `process exit code ${code}`);
  });
  updater?.on('before-quit-for-update', () => marker.record('updater'));

  return {
    // `powerMonitor` may only be used once the app is ready. Suspend, resume and lock are
    // logged by power-monitor-handlers; shutdown (Linux and macOS) is the one OS-level
    // end that is not.
    watchPower: (powerMonitor) => {
      powerMonitor.on('shutdown', () => {
        info('lifecycle: powerMonitor shutdown');
        marker.record('os-session-end', 'shutdown');
      });
    },
  };
};
