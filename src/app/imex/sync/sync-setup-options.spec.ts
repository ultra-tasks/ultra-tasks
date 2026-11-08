import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import {
  basicSyncSetupOptions,
  isLegacySyncSetupProvider,
  ULTRA_SYNC_SETUP,
} from './sync-setup-options';

describe('sync setup options', () => {
  it('offers only supported basic providers for a new connection', () => {
    expect(basicSyncSetupOptions(true, null).map((option) => option.value)).toEqual([
      SyncProviderId.OneDrive,
      SyncProviderId.WebDAV,
    ]);
    expect(basicSyncSetupOptions(false, null).map((option) => option.value)).toEqual([
      SyncProviderId.WebDAV,
    ]);
  });

  it('retains only the saved deprecated provider without exposing other retired providers', () => {
    for (const saved of [
      SyncProviderId.SuperSync,
      SyncProviderId.Dropbox,
      SyncProviderId.Nextcloud,
      SyncProviderId.LocalFile,
    ]) {
      expect(basicSyncSetupOptions(true, saved).map((option) => option.value)).toEqual([
        SyncProviderId.OneDrive,
        SyncProviderId.WebDAV,
        saved,
      ]);
      expect(isLegacySyncSetupProvider(saved)).toBeTrue();
    }
  });

  it('retains an existing OneDrive connection on an unsupported web build', () => {
    expect(
      basicSyncSetupOptions(false, SyncProviderId.OneDrive).map((option) => option.value),
    ).toEqual([SyncProviderId.OneDrive, SyncProviderId.WebDAV]);
    expect(isLegacySyncSetupProvider(ULTRA_SYNC_SETUP)).toBeFalse();
    expect(isLegacySyncSetupProvider(SyncProviderId.WebDAV)).toBeFalse();
  });
  it('retains dormant saved connections without duplicating the active connection', () => {
    expect(
      basicSyncSetupOptions(true, SyncProviderId.OneDrive, [
        SyncProviderId.Dropbox,
        SyncProviderId.Dropbox,
      ]).map((option) => option.value),
    ).toEqual([SyncProviderId.OneDrive, SyncProviderId.WebDAV, SyncProviderId.Dropbox]);
  });
});
