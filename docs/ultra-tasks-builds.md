# Install and build Ultra Tasks

## Download and install

[Get the latest desktop release](https://github.com/ultra-tasks/ultra-tasks/releases/latest). Version 0.2.0 is available for Windows, macOS, and Linux. The release page includes `SHA256SUMS.txt` for checking downloads.

- **Windows (x64 or ARM64):** run the Setup installer, or use the Portable executable. Builds are unsigned, so SmartScreen may ask for confirmation. Check that the download came from this repository before approving it.
- **macOS:** choose `arm64` for Apple Silicon, `x64` for Intel, or the Universal DMG for either. Open the DMG and move Ultra Tasks into Applications; ZIP alternatives are also provided. Builds are ad-hoc signed, without an Apple Developer ID, and are not Apple-notarized. If Gatekeeper blocks the first launch, open **System Settings → Privacy & Security → Open Anyway** and confirm the app you downloaded.
- **Linux (x64):** install the DEB or RPM with your distribution's package manager, or make the AppImage executable and open it. The AppImage may require FUSE support from your distribution.

These are desktop downloads from GitHub. Ultra Tasks mobile and app-store releases are not available yet. Upstream Super Productivity store links install Super Productivity.

Updates are installed manually. The optional update check notifies you about a new release; it does not install it. Keep a backup before upgrading or trying development builds.

## Bringing your tasks over

Ultra Tasks has its own application identity (`app.ultratasks`), data folder, and `ultratasks://` desktop URL scheme, so it can be installed alongside Super Productivity.

- **From Super Productivity:** export a complete backup from the upstream app, then import that file into Ultra Tasks. Your existing installation is not imported automatically. In the current development interface, backup controls are under **Settings → Import & export**.
- **From Todoist or TickTick:** use the file importers in Settings. Review the import preview before confirming.
- **From earlier fork builds:** when no Ultra Tasks profile exists, the desktop app can reuse an existing `Super Tasks` or `super-tasks` profile without moving or deleting it. An explicit `--user-data-dir` takes precedence.

## Optional sync and compatibility

Core tasks and time tracking work offline. Sync is optional. The fork inherits provider implementations including Nextcloud/WebDAV, Dropbox, SuperSync, desktop local-file sync, and OneDrive where supported. See the [sync comparison](wiki/3.08-Sync-Integration-Comparison.md) for provider and platform differences. The hosted Ultra Tasks sync service is coming soon.

Upstream-compatible data and sync remain a project requirement: Ultra Tasks must follow upstream migrations and must not introduce a separate task-storage format, sync protocol, encryption scheme, or conflict-resolution model. New display preferences should stay device-local where possible.

A complete provider-by-provider and mixed Ultra Tasks/Super Productivity test matrix has **not** been completed. Inherited provider code does not guarantee working rebranded sign-in callbacks. Services returning OAuth redirects to `superproductivity://` still open the upstream app; configure a `ultratasks://` callback where supported. Back up your data before experimenting with mixed clients or changing providers.

## Run from source

Use the Node.js and package-manager versions declared in [package.json](../package.json).

```sh
git clone https://github.com/ultra-tasks/ultra-tasks.git
cd ultra-tasks
npm ci
npm run startFrontend
```

See the [development setup](wiki/2.11-Run-the-Development-Server.md) and [repository map](repository-map.md) for the codebase and focused checks.

## Package a desktop build

Compile the frontend and Electron entry point first:

```sh
npm run buildFrontend:prod:es6
npm run electron:build
```

Then use the fork's packaging configuration for your platform:

```sh
# Windows
npx electron-builder --config electron-builder.ultra-tasks.cjs --win nsis portable --x64 --publish never

# macOS (run on a Mac)
npx electron-builder --config electron-builder.ultra-tasks.cjs --mac dmg zip --x64 --arm64 --publish never

# Linux
npx electron-builder --config electron-builder.ultra-tasks.cjs --linux AppImage deb rpm --x64 --publish never
```

Local packaging output goes to `.tmp/ultra-tasks-builds`. Local artifact names can differ from the finalized names attached to a GitHub release. Upstream provenance is recorded in [build/upstream-base.json](../build/upstream-base.json).

Ultra Tasks is independently maintained; it is not an official Super Productivity release. Preserve the upstream credits and licensing notices when redistributing builds.
