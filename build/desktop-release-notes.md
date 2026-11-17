# Ultra Tasks 0.4.0-beta.1

First testing release of Ultra Tasks 0.4.0. Export a backup before upgrading and keep your account recovery key.

## What's new

- A calmer interface across desktop and mobile: compact navigation, page actions, settings organization, task details, notes, calendar and planning improvements.
- Improved Android edge-to-edge layout, keyboard handling, system bars and back navigation.
- Task planning messages now offer Undo without accidentally reversing a later task edit.
- GitHub, GitLab, Linear and Trello connections support explicit field directions and creation where available. Official sign-in uses configured public app registrations; manual token setup remains available.
- New connection credentials stay on the device. One device owns source communication; edits from other devices wait for that owner. Ownership can be moved explicitly.
- GitLab and Linear gain title, description and completion write-back. Trello can optionally move completed cards to a selected Done list instead of archiving them. GitHub label mapping preserves unrelated local tags.
- Opt-in calendar publication is implemented with busy-only output by default, stable event identities and URL rotation/revocation. It requires a compatible server with the feature enabled and an updated operator privacy notice.
- Native credential-storage, recovery and iOS bridge fixes from the remaining worktrees are included.

## Beta limits and testing

- Live provider consent, registered callbacks and real-account write-back still need testing for all four providers. Automated mocked-provider checks do not certify account permissions.
- Calendar subscriptions still need acceptance in Google Calendar, Apple Calendar, Outlook and Thunderbird. This beta publishes existing scheduled instances only; future recurrence projections are deferred.
- The hosted web build is local-only. Browser account sync and calendar publishing from that build are outside this beta.
- Physical Android/iOS acceptance, independent security review and the remaining documented sync-order limitations are not certified by this testing release.
- Official account registration remains closed until the operator enables it. Keep an exported backup and your recovery key.

## Distribution

- Windows: unsigned Setup and Portable executables for x64 and ARM64.
- macOS: Developer ID signed, notarized and stapled Intel, Apple Silicon and Universal DMGs, plus architecture-specific ZIPs. Publication requires signature and Gatekeeper checks to pass.
- Linux x64: AppImage, DEB and RPM.
- Android: signed standard and F-Droid-flavor APKs for direct installation. No Google Play submission or promotion is part of this beta.
- Web: a versioned standalone bundle for operator installation.
- iOS: TestFlight distribution is being prepared through the separate Apple signing pipeline; availability is recorded with the beta artifacts once upload succeeds.

SHA256SUMS.txt covers the published direct-download files. Native installers and live accounts should be tested before any stable release or Android store submission.

Ultra Tasks remains AGPL-3.0-only, with preserved upstream and third-party rights. This beta does not change the license or declare the server production ready.
