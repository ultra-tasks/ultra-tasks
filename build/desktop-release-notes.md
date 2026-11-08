# Ultra Tasks 0.3.0

This beta introduces **UltraSync**: private, end-to-end encrypted account sync across your devices, with a self-hostable server and an account dashboard.

## What's new

- UltraSync is the default in new sync setup. Use the official service or a custom HTTPS endpoint for your own Docker installation.
- Sign in directly in the app or continue in your browser, complete two-factor authentication, and return to the requesting app. The encrypted handoff supports cold starts and a polling fallback when return links are blocked.
- The account dashboard supports TOTP, passkeys/security keys as second factors, recovery keys, device-session management, and encrypted-storage usage.
- Private changes sync automatically while unlocked, with live notifications and a 60-second HTTP fallback. Mobile suspension, network conditions and account size affect delivery time.
- OneDrive and WebDAV are the basic personal-only alternatives. Saved SuperSync, Dropbox, Nextcloud and local-file configurations remain usable as deprecated connections. Export/backup remains available.
- Switching providers requires disconnecting first. It does not migrate or delete the previous remote dataset. Choose explicitly between this device's tasks and existing account data.
- A unified integrations workspace groups connected services with guided setup, project links and field policies.
- Mobile header glass now extends behind the status bar, notch and island, alongside navigation and persistence fixes.

## Beta scope

UltraSync supports private personal sync. Team collaboration, the full hosted task application, and Google Drive integration follow later. Keep your recovery key and an exported backup. Large accounts still use full-head catch-up and can incur substantial transfer and latency; this beta does not promise sub-two-second convergence for every dataset. Physical-device acceptance and independent specialist cryptographic review remain outstanding.

The official dashboard is at [app.ultratasks.app/account](https://app.ultratasks.app/account). Self-hosting code and Docker installation instructions are in [ultra-tasks-server](https://github.com/ultra-tasks/ultra-tasks-server).

## Downloads

- **Windows:** Setup and Portable executables for Intel/AMD x64 and Windows ARM64.
- **macOS:** Intel, Apple Silicon and Universal DMGs, plus architecture-specific ZIPs.
- **Linux x64:** AppImage, DEB and RPM packages.
- `SHA256SUMS.txt` provides download checksums.

Windows downloads are unsigned. macOS downloads are ad-hoc signed without Apple notarization, matching the previous beta's packaging. This GitHub desktop release does not publish to app stores; Android/iOS source includes the sync implementation, with platform CI coverage.

Ultra Tasks remains [AGPL-3.0-only](https://github.com/ultra-tasks/ultra-tasks/blob/ultra-tasks-v0.3.0/LICENSING.md), with preserved upstream and third-party rights.

[Full changelog from 0.2.0](https://github.com/ultra-tasks/ultra-tasks/compare/ultra-tasks-v0.2.0...ultra-tasks-v0.3.0). Upstream provenance is recorded in [build/upstream-base.json](https://github.com/ultra-tasks/ultra-tasks/blob/ultra-tasks-v0.3.0/build/upstream-base.json).
