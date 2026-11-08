import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { T } from '../../t.const';

export const ULTRA_SYNC_SETUP = 'ultraSync';
export type SyncSetupProvider = SyncProviderId | typeof ULTRA_SYNC_SETUP;

const LEGACY_LABELS: Partial<Record<SyncProviderId, string>> = {
  [SyncProviderId.SuperSync]: T.SYNC_SETUP.LEGACY_SUPER_SYNC,
  [SyncProviderId.Dropbox]: T.SYNC_SETUP.LEGACY_DROPBOX,
  [SyncProviderId.Nextcloud]: T.SYNC_SETUP.LEGACY_NEXTCLOUD,
  [SyncProviderId.LocalFile]: T.SYNC_SETUP.LEGACY_LOCAL_FILE,
};

/** Keep saved connections usable without offering retired providers to new users. */
export const basicSyncSetupOptions = (
  oneDriveSupported: boolean,
  savedProvider: SyncProviderId | null,
  otherSavedProviders: readonly SyncProviderId[] = [],
): { value: SyncProviderId; label: string }[] => {
  const saved = new Set([savedProvider, ...otherSavedProviders]);
  const options = [
    ...(oneDriveSupported || saved.has(SyncProviderId.OneDrive)
      ? [{ value: SyncProviderId.OneDrive, label: T.SYNC_SETUP.ONEDRIVE }]
      : []),
    { value: SyncProviderId.WebDAV, label: T.SYNC_SETUP.WEBDAV },
  ];
  for (const provider of saved) {
    if (provider && LEGACY_LABELS[provider]) {
      options.push({ value: provider, label: LEGACY_LABELS[provider]! });
    }
  }
  return options;
};

export const isLegacySyncSetupProvider = (provider: SyncSetupProvider): boolean =>
  provider !== ULTRA_SYNC_SETUP && !!LEGACY_LABELS[provider];
