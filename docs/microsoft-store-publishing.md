# Microsoft Store publishing

Ultra Tasks has a separate unsigned AppX build for manual Microsoft Partner Center
submission. Microsoft signs the approved packages and delivers Store updates.
The existing Windows Setup and Portable downloads keep their own build and release
workflow. Store builds go to `.tmp/store-builds`, not `.tmp/app-builds`.

## Partner Center setup

1. Start at [Microsoft Store developer registration](https://storedeveloper.microsoft.com/)
   and choose **Get started for free**. Microsoft's current onboarding flow has no
   registration fee. Choose Individual for a personal project or Company when
   publishing for a registered business; Partner Center does not support converting
   an Individual account into a Company account later.
2. Complete Microsoft's identity verification. Individual onboarding requests a
   government-issued ID and selfie; complete these directly with Microsoft.
   Company onboarding requires business verification. Use the exact legal name
   and address shown on the supporting documents, and follow the account's
   verification requests before attempting publication.
3. In Partner Center **Apps & games**, choose **New product → MSIX or PWA app**
   and reserve **Ultra Tasks**, if available. This is the packaged-app route used
   by this repository's AppX workflow. The EXE/MSI route requires publisher signing
   and does not receive Microsoft's complimentary package signing.
4. Open the product's **Product management → Product identity**. Copy the following
   exact, case-sensitive values into this repository's GitHub
   **Settings → Secrets and variables → Actions → Variables**:

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

### Ultra Tasks registration

The independent Ultra Tasks product is reserved in Partner Center:

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| Package identity name  | `UltraTasks.UltraTasks`                   |
| Publisher              | `CN=DBB770D5-3C11-4E18-9E4D-82C2D35C2D51` |
| Publisher display name | `Ultra Tasks`                             |
| Package Family Name    | `UltraTasks.UltraTasks_x07rkr3gbe2et`     |
| Store ID               | `9PK998SNVCDS`                            |

The four build variables are configured in `ultra-tasks/ultra-tasks`. Product
reservation is not certification or publication; the Store link becomes useful
to customers after the app is published. The intended website distribution path
is the free Store Web Installer, without an Azure signing subscription.

The first submission, version `0.3.0.0` for x64 and ARM64, was submitted for
certification on 2026-11-16. Packages came from the successful
[Store build](https://github.com/ultra-tasks/ultra-tasks/actions/runs/43991868649)
of commit `19d5e8e97b0a567d60b4db7a474266cf2ea9fc4b` on `main`. Both passed
Partner Center package validation. The submission includes the English listing,
four desktop screenshots, IARC ratings, the `runFullTrust` explanation and reviewer
instructions. Publication is held until **Publish now** is selected. Check the
[Partner Center product overview](https://partner.microsoft.com/en-us/dashboard/products/9PK998SNVCDS/overview)
for the current review result; submission does not establish certification.
Installed-package acceptance testing and Windows App Certification Kit testing
have not been completed locally for these artifacts.

The `0.3.0` review was subsequently withdrawn and replaced with application source
`0.4.0-beta.1`, using Windows package version `0.4.0.0`, for both x64 and ARM64.
The replacement came from [Store build 44019453730](https://github.com/ultra-tasks/ultra-tasks/actions/runs/44019453730)
at commit `542a82a171a45593ce757d1ccdbecc1d7318faaa`. Both replacement packages
passed checksum, manifest, embedded source-version and frontend beta-label
verification, and Partner Center validation. The old packages were removed from
the draft, beta release notes and reviewer instructions were saved, and the
replacement was submitted for certification with the manual publication hold
retained. Approval is still determined by Microsoft's review.

### What Microsoft approves and signs

Account identity verification and app certification are separate steps. First
Microsoft verifies the publisher account; then it reviews the submitted app.
After the AppX submission passes certification, Microsoft signs the package for
Store distribution. There is no separate certificate application, Azure signing
subscription or purchased code-signing certificate for this route.

If account verification is pending or rejected, inspect the verification details
in Partner Center and supply the requested corrections. For company accounts,
check **Account settings → Legal info → Developer**, including any **Fix now**
action. If the reason remains unclear, use Partner Center **Help → Contact
Support** with the exact status or rejection text. For an app certification
failure, use the submission's certification report to identify what must change;
rebuilding an identical package will not resolve an account verification failure.

## Build

Run **Windows Store AppX** in GitHub Actions on the desired source version.
For prerelease source, explicitly enter a numeric **store_version** such as
`0.4.0` in the manual workflow form. It becomes Store package version `0.4.0.0`;
the source remains `0.4.0-beta.1` and is recorded in the artifact filename and
embedded `ultraTasksWindowsStore.sourceVersion` metadata. The production frontend
is built from the original source version before packaging, retaining its beta
version label. Electron's packaged version uses the numeric Store version.

Store versions must increase independently of source versions once an override
has been used: after `0.4.0.0`, use `0.4.1.0` or higher for the next Store update,
including a later beta or the stable `0.4.0` app. This is an explicit packaging
choice, not a promotion of the source app to a stable release.

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
# Required for beta source; omit for a numeric source version when no override is needed.
$env:WINDOWS_STORE_VERSION = '0.4.0'
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
without an explicit numeric override are rejected rather than silently mapped
to the same Store version. Increment the Store version for a subsequent Store
update; keep the fourth component zero.
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

Use the Microsoft Store Web Installer for the website's Store-backed Windows
download once the free listing is live. This route needs no Azure Artifact
Signing subscription: Microsoft signs the approved AppX package and delivers it
through Store infrastructure. The website badge's **Direct** launch mode downloads
a small Microsoft-generated EXE that fetches the app online; it is not a complete
offline installer. Store updates apply to the installed app.

Existing Setup and Portable downloads are a separate distribution channel. Their
signing status is independent of Store signing. Never label the unsigned
submission AppX as a ready-to-install public download.

The current `desktop-release.yml` workflow produces unsigned Windows downloads.
The inherited `build.yml` contains a SignPath integration for the upstream
`super-productivity` project; it does not establish signing approval for Ultra
Tasks. Store approval does not grant access to that certificate or sign the
separate Setup/Portable files.

For Microsoft signing of direct downloads, Azure Artifact Signing (formerly
Trusted Signing) is a separate service with its own identity validation and
billing. As checked on 2026-11-16, Public Trust individual validation is limited
to developers in the United States or Canada. Organization validation supports
a wider, explicitly listed set of countries; check the current quickstart before
creating resources. A supported Azure resource region does not establish
publisher eligibility. Store package signing does not have this service's
individual-country restriction.

If Azure Public Trust validation is unavailable, an eligible open-source project
can apply to the SignPath Foundation, or obtain a public code-signing certificate
from a certificate authority that supports its legal identity and country.
Provider approval and integration into `desktop-release.yml` are additional work.
Private Trust and self-signed certificates are not public-download substitutes.

Once the free Store listing is live, use its Store ID in the
[Microsoft Store badge generator](https://apps.microsoft.com/badge), selecting
**Direct** launch mode. This offers a Microsoft-generated web installer from the
website, with the app downloaded through Store infrastructure. It is not a
self-hosted offline installer. Prepare any website changes in the sibling
`website-landing` checkout under its release/approval rules.

## References

- [Microsoft developer account onboarding](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account)
- [Reserve a packaged app name](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/reserve-your-apps-name)
- [Company verification and rejection guidance](https://learn.microsoft.com/en-us/windows/apps/publish/store-business-verification-reqs)
- [Windows code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Azure Artifact Signing eligibility and setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [SignPath Foundation application](https://signpath.org/apply.html)
- [Microsoft package and signing requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Microsoft Store Web Installer](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-use-store-web-installer-for-distribution)
- [Electron AppX protocol registration](https://www.electronjs.org/docs/latest/api/app#appsetasdefaultprotocolclientprotocol-path-args)
