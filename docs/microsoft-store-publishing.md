# Microsoft Store publishing

Ultra Tasks has a separate unsigned AppX build for manual Microsoft Partner Center
submission. Microsoft signs the approved packages and delivers Store updates.
The existing Windows Setup and Portable downloads keep their own build and release
workflow. Store builds go to `.tmp/store-builds`, not `.tmp/app-builds`.

## Partner Center setup

Create a Microsoft Store developer account, reserve Ultra Tasks, and open
**Product management → Product identity**. Copy the following exact, case-sensitive
values into GitHub **Settings → Secrets and variables → Actions → Variables**:

| Partner Center field                    | Repository variable                    |
| --------------------------------------- | -------------------------------------- |
| Package/Identity/Name                   | `WINDOWS_STORE_IDENTITY_NAME`          |
| Package/Identity/Publisher              | `WINDOWS_STORE_PUBLISHER`              |
| Package/Properties/PublisherDisplayName | `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` |
| Package Family Name (PFN)               | `WINDOWS_STORE_PACKAGE_FAMILY_NAME`    |

These identifiers are public. No certificate, certificate password, Azure signing
subscription, or Partner Center publishing credential is needed by this workflow.
The **Store ID** is also useful later for the website's Store badge/web installer,
but is not needed to build AppX files. Do not reuse upstream's identity.

## Build

Run **Windows Store AppX** in GitHub Actions on the desired stable numeric version.
The workflow also runs on `ultra-tasks-v*` tags. It validates the tag against
`package.json`, builds x64 and ARM64 AppX packages, verifies each package's identity,
version, architecture, protocol, desktop capability, absence of a local signature,
and packaged JavaScript dependencies, and uploads **WindowsStore-AppX** with
SHA-256 checksums. It does
not submit to Partner Center or attach unsigned packages to public releases.
Missing identity variables produce an actionable failure before dependency install.

For local builds, set the same four environment variables in PowerShell:

```powershell
$env:WINDOWS_STORE_IDENTITY_NAME = '<Package/Identity/Name>'
$env:WINDOWS_STORE_PUBLISHER = '<Package/Identity/Publisher>'
$env:WINDOWS_STORE_PUBLISHER_DISPLAY_NAME = '<PublisherDisplayName>'
$env:WINDOWS_STORE_PACKAGE_FAMILY_NAME = '<Package Family Name>'
npm run dist:win:appx
```

If the production frontend and Electron code are already built, use
`npm run dist:win:appx:only`. `npm run dist:win:store` is an alias for the full build.
Configuration is in [`build/electron-builder.appx.cjs`](../build/electron-builder.appx.cjs),
with validation in [`tools/windows-store-config.js`](../tools/windows-store-config.js).
It extends the shared packaging configuration without rewriting it.

AppX is supported by the installed electron-builder 26 and accepted by the Store;
switching to a newer MSIX target is unnecessary. Store versions use
`major.minor.patch.0`, with numeric components at most 65535. Prerelease versions
are rejected rather than silently mapped to the same Store version. Increment the
app version for a subsequent Store update; keep the fourth component zero.
Both architectures share the same version and identity. The application ID inside
the package is `UltraTasks`; the Windows notification ID is `<PFN>!UltraTasks`.
The manifest registers `ultratasks://`, and declares `runFullTrust` for the
existing Electron desktop application. It does not add login auto-start.

## Verify and submit

1. Download **WindowsStore-AppX** and upload both `.appx` files to the same
   Partner Center submission. Confirm package identities and supported architectures.
2. Complete the listing, screenshots, age rating, availability, support and privacy
   URLs. Explain `runFullTrust` as required for an Electron desktop productivity
   application and its existing desktop integrations if Partner Center requests it.
3. Run the Windows App Certification Kit and test an installed package on x64 and
   ARM64. Unsigned packages cannot be installed by ordinary end users. For local
   testing only, sign a disposable copy with a test certificate trusted on a test
   machine, or use a Store private audience/flight once available. Never distribute
   a test certificate as the public installation solution.
4. Check first launch, tray, reminders/notifications, keyboard shortcuts,
   `ultratasks://` activation (closed and running), OAuth return links, file dialogs,
   local sync, backup/restore and Open backup folder, plugins and the local API.
5. Test an update retaining existing tasks/settings/backups, and verify the Store
   build has no GitHub update prompt. Test switching from Setup/Portable with an
   explicit backup export/import; package virtualization can give the Store app a
   separate profile. Do not promise automatic migration or concurrent shared data.
6. Submit for certification, review the result, then publish in Partner Center.

The runtime uses this build's embedded PFN for virtualized backup paths and
notifications. Non-Store builds do not use Store metadata or admit upstream's
Store backup directories. No task schema or sync protocol changes are involved.

## Website and direct downloads

Keep the existing Setup and Portable download links. Their signing status is
independent of Store signing. Never label the unsigned submission AppX as a
ready-to-install public download.

Once the free Store listing is live, use its Store ID in the
[Microsoft Store badge generator](https://apps.microsoft.com/badge), selecting
**Direct** launch mode. This offers a Microsoft-generated web installer from the
website, with the app downloaded through Store infrastructure. It is not a
self-hosted offline installer. Prepare any website changes in the sibling
`website-landing` checkout under its release/approval rules.

## References

- [Microsoft package and signing requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Microsoft Store Web Installer](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-use-store-web-installer-for-distribution)
- [Electron AppX protocol registration](https://www.electronjs.org/docs/latest/api/app#appsetasdefaultprotocolclientprotocol-path-args)
