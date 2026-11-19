import {
  RealtimeSync,
  createRealtimeSocket,
  type SyncClient,
} from '@sp/sync-providers/ultra-tasks';

/** A sync that already reported its own failure; only the socket's retry needs to hear of it. */
export class RecordedFailure extends Error {}

export interface RealtimeHost {
  readonly client: SyncClient;
  /** What the server advertises (`personalRealtime`, `sharedRealtime`). */
  readonly features: Record<string, boolean | string> | undefined;
  readonly serverUrl: string;
  /** How often the HTTP fallback looks while the socket is down. */
  readonly fallbackMs: number;
  /** Syncs the personal dataset like every other sync, and throws {@link RecordedFailure} if it failed. */
  syncPersonal(): Promise<void>;
  /** The set of datasets or their contents changed. */
  updated(): void;
  revoked(scopeId: string): void;
  /** A failure the sync did not record itself (a shared dataset, the socket). */
  failed(error: unknown): void;
  /** Only whether the socket is open: it says nothing about whether tasks have synced. */
  connected(open: boolean): void;
}

/**
 * The live socket that tells this device when the account changed, with the periodic HTTP look
 * as its fallback. Nothing starts until `start()`; nothing is created for a server that offers
 * no live updates.
 */
export const createRealtime = (host: RealtimeHost): RealtimeSync | undefined => {
  if (!(host.features?.['sharedRealtime'] || host.features?.['personalRealtime']))
    return undefined;
  return new RealtimeSync(host.client, {
    fallbackMs: host.fallbackMs,
    includePersonal: host.features['personalRealtime'] === true,
    includeShared: host.features['sharedRealtime'] === true,
    syncScope: async (scopeId) => {
      if (host.client.state.scopes[scopeId]?.info.kind === 'personal')
        await host.syncPersonal();
      else await host.client.syncScope(scopeId);
    },
    socket: (ticket) =>
      createRealtimeSocket(
        host.serverUrl.replace(/^http/, 'ws') +
          '/api/v2/accounts/sync/events?ticket=' +
          encodeURIComponent(ticket),
      ),
    updated: () => host.updated(),
    revoked: (scopeId) => host.revoked(scopeId),
    failed: (scopeId, error) => {
      if (scopeId && !(error instanceof RecordedFailure)) host.failed(error);
    },
    status: (connected) => host.connected(connected),
  });
};
