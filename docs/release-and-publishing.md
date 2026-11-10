# Release and publishing runbook

To rebuild a signed Android release for Play after a rejected or invalidated
bundle, manually dispatch `build-android.yml` from `main` with `source_ref` set
to the existing `ultra-tasks-v...` release tag and `version_code` set to an
unused higher Android version code. The visible version comes from that tag.
Download and validate the `sup-android-release` artifact before uploading its AAB
to Play; a manual dispatch does not publish a release or upload to Play.

> **Status:** Maintained
>
> **Last verified against workflows:** 2026-11-04

The GitHub Actions workflows are the executable source of truth. Update this
runbook in the same change whenever their triggers, channels, artifacts, or secret
names change.

## Fork branches and upstream updates

`main` is the canonical Ultra Tasks development branch. Before stable `1.0.0`,
work lands directly on it; afterward, PRs target `ac9492/ultra-tasks:main`.
Use `gh pr create --repo ac9492/ultra-tasks --base main` when opening a fork PR.
The affected-spec runner and sync-fuzz comparison default to `origin/main`.

Keep the GitHub fork relationship and the `upstream` remote. Track only
`upstream/master` and disable automatic upstream tag fetching to keep the local
branch list focused; existing historical tags remain available. Fetching upstream
does not change Ultra Tasks files. To inspect future updates, run
`git fetch upstream` and `git log --oneline main..upstream/master`. Incorporate
them in a separate, tested change by merge, rebase or selected cherry-picks.
Rebasing a published `main` rewrites its history and requires coordinating with
other checkouts before updating the remote branch.

Completed or superseded topic branches can be retired after their work has been
checked against `main`. Preserve their tips in a recovery bundle or archive refs
when the original commits were squashed or rebased. GitHub automatically deletes
head branches after future PRs merge. Inherited store-publishing workflows still
target their original release infrastructure; changing the development branch
does not migrate app identities, signing, or distribution destinations.

## Ultra Tasks version policy

The project was renamed from Super Tasks to **Ultra Tasks** before its first stable release. Its planned website is `https://ultratasks.app`, the repository is `ac9492/ultra-tasks`, and new releases use `ultra-tasks-v…` tags. Historical tags and upstream attribution remain intact. Android and iOS use the independent `app.ultratasks` application ID (with a separate share-extension ID and app group on iOS); Android retains its inherited Java/Kotlin namespace as an internal source compatibility detail. Store listings, signing certificates, provisioning profiles, OAuth registrations, and domain hosting must be configured for the new identity before publishing through those channels. No email address or live domain service is assumed.

Ultra Tasks has its own product version, starting at `0.1.0`. Use `0.x` while
the fork's core experience is taking shape, then `1.0.0` for the first dependable
stable experience. Testing releases use suffixes such as `0.1.0-alpha.1`,
`0.1.0-beta.1`, and `0.1.0-rc.1`.

After `1.0.0`, patches contain fixes and small visual refinements; minor releases
add compatible capabilities or workflow improvements; major releases deliberately
break supported contracts or substantially change established workflows. Plugin
interfaces, imports, shortcuts and automation interfaces must be considered when
assessing compatibility. Product versions do not automatically change persisted
schemas, sync protocols or independently versioned package APIs.

The repository's `.npmrc` makes `npm version` create `ultra-tasks-vX.Y.Z` tags.
Inherited upstream `v*` tags remain historical references and released-client
test fixtures; they are excluded from fork release selection and TestFlight
version calculation. Incorporating upstream changes does not dictate the next
Ultra Tasks version: choose it from the resulting user-visible changes.

[`build/upstream-base.json`](../build/upstream-base.json) records the upstream
repository and incorporated commit separately. Update it when incorporating a
new upstream base; selective cherry-picks should also be identified in release
notes rather than implying that an entire newer upstream release was merged.
The release-note generator includes this provenance and uses the recorded commit
as the first release's comparison base when there is no earlier fork release.

Ultra Tasks uses independent app identifiers, release tags, and update links.
Store distribution still requires the fork's own registrations and signing
credentials. The reset Android version code belongs to a new application
identity; it cannot upgrade the existing Super Productivity store package.
Transfer mobile data through an explicit backup/import. Desktop builds reuse
existing profiles from the fork's former name without moving them; upstream
profiles remain separate. Configure `DOCKER_IMAGE` to the fork's own Docker Hub
repository before enabling container publishing.

The main-branch web preview uses the fork's `ultra-tasks-preview` Cloudflare
Pages project. After configuring hosting and its credentials, set the repository
variable `ULTRA_TASKS_WEB_DEPLOY=true` to enable it. The domain is a planned
website until DNS and hosting are connected.

## Release boundaries

### GitHub-only desktop releases

If validation and all three package jobs pass but publication fails, dispatch
`publish-desktop-artifacts.yml` with the original build run ID. It verifies those
four successful jobs and reuses their artifacts. It verifies that only release
workflows and documentation differ from the tested source before tagging the
current publication commit with `GITHUB_TOKEN`; the release notes record the
original build commit. This avoids GitHub's restriction on tagging historical
workflow revisions. It does not rebuild or move an existing tag.
macOS currently also produces a Universal DMG through the inherited target list,
so publication expects three DMGs, two ZIPs, two Windows executables, and one
Linux x64 download each in AppImage, DEB, and RPM format.

For Ultra Tasks desktop downloads, dispatch **Desktop GitHub Release**
(`desktop-release.yml`) from the reviewed `main` commit. It validates the app,
builds Windows x64/ARM64 executables, macOS Intel/Apple Silicon DMG/ZIP files,
and Linux x64 AppImage/DEB/RPM packages,
and smoke-tests the native packaged app on each runner. Only after every job
passes does it create `ultra-tasks-v<package version>` and publish the GitHub
release with SHA-256 checksums and `build/desktop-release-notes.md`.

This workflow uses `electron-builder.desktop.yaml` for the independent Ultra
Tasks desktop identity. The initial packages are unsigned on Windows and ad-hoc
signed, without notarization, on macOS. Signing status must appear in the notes.
The package name (`ultra-tasks`) supplies the independent default data directory;
existing Super Productivity data is imported explicitly from a backup.

For signed Android downloads without a Play Console submission, manually dispatch
`build-android.yml` on the same reviewed commit. Manual runs use the package's
release version/code and skip Play distribution, including when dispatched on a
release tag. Automatic main pushes retain their development codes; automatic
stable-tag runs retain the inherited Play submission path. The workflow verifies
each APK's signature, `app.ultratasks` identity and package version before saving
the `sup-android-release` artifact. Attach the signed APKs to the matching GitHub
release and refresh its checksums. The Android release key remains in GitHub
secrets; desktop signing still requires separate Windows/Apple credentials.

The publish job deliberately uses `GITHUB_TOKEN`: GitHub does not trigger other
tag/release workflows for these events, so inherited store/deployment workflows
do not run. Do not push the tag manually or publish through a personal token for
this path. No npm version lifecycle is needed when package.json already has the
intended version. For a desktop-only version bump, use
`npm version 0.2.0 --no-git-tag-version --ignore-scripts` to update the root
package and lockfile without invoking mobile release tooling or creating a tag.
Update the version and release notes before a later dispatch;
an existing published tag must never be moved or overwritten.

The remaining sections describe the inherited multi-channel release path.

Releasing has two distinct boundaries:

1. **Push a `ultra-tasks-v*` tag:** builds artifacts and creates a draft GitHub release. A
   final tag (`ultra-tasks-vX.Y.Z`, with no prerelease suffix) also uploads and submits the iOS and Mac App
   Store builds for review with automatic release after Apple approval. Treat a
   final tag as production-affecting even while the GitHub release remains a draft.
2. **Publish the GitHub release:** triggers the release-event workflows that
   deploy the web app and publish or promote other distribution channels.

Do not publish the draft merely to test a build. Use a pre-release tag or a
workflow's manual dispatch where supported.

## Prepare a version

Start from a clean, current release commit and choose the appropriate semantic
version:

```bash
npm version patch
```

Use `minor`, `major`, or an explicit pre-release version when appropriate.
For the initial release, after committing the fork setup, use
`npm version 0.1.0 --allow-same-version`. For testing releases, use an explicit
version such as `npm version 0.2.0-beta.1`.
The `version` lifecycle updates the Android version, generates
`build/release-notes.md`, writes the versioned Google Play changelog, stages the
changes, and creates the npm version commit and tag.

### The release-notes base

Notes span from the **last published Ultra Tasks GitHub release** to `HEAD`, not from the
newest tag: a version whose draft release was abandoned, deleted, or left
unpublished still leaves its tag behind, and basing the notes on that tag drops
everything the unpublished versions contained. A final version bases on the last
published non-prerelease, a pre-release on the last published release of either
kind. The resolved base is written to `build/release-notes-base.txt` and
committed with the notes; `.github/workflows/build.yml` reads that file rather
than resolving again, so the release body's Full Changelog link and contributor
list cannot span a different range than the notes above them.

Resolution needs the GitHub releases API. When it is unreachable the generator
warns and falls back to the newest matching tag, which is the case that produces
short notes - if you see that warning, or `build/release-notes-base.txt` names a
version that never shipped, check the notes against the release users actually
received before pushing.

Before pushing anything:

1. Review the version commit and tag.
2. Read `build/release-notes.md` for accuracy and user-data/privacy leaks, and
   confirm the base in the `npm version` output is the version users last
   received.
3. For a final release, confirm the generated Android changelog exists under
   `android/fastlane/metadata/android/en-US/changelogs/`.
4. Run the relevant release-note tests:

   ```bash
   npm run release-notes:test
   ```

5. Confirm the working tree is clean.

If generated files are wrong, stop and repair the local version commit and tag
before pushing. Never move a release tag that has reached the remote.

Push the reviewed version commit and exactly the intended tag together. Replace
the placeholder with the tag created by `npm version`; do not use
`--follow-tags`, which can include other reachable annotated tags.

```bash
git push --atomic origin HEAD "ultra-tasks-vX.Y.Z"
```

## What the tag triggers

| Output                                                      | Workflow                                                      | Final tag                                       | Tag with prerelease suffix |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| Draft GitHub release and Linux/macOS/Windows desktop assets | `.github/workflows/build.yml`                                 | Build                                           | Build                      |
| Android APKs and Play AAB                                   | `.github/workflows/build-android.yml`                         | Upload AAB to Play `internal` and attach APK    | Build/attach only          |
| iOS App Store                                               | `.github/workflows/build-ios.yml`                             | Upload and submit for review                    | Upload only                |
| Mac App Store                                               | `.github/workflows/build-publish-to-mac-store-on-release.yml` | Upload and submit for review                    | Upload only                |
| Microsoft Store `.appx`                                     | `.github/workflows/build-create-windows-store-on-release.yml` | Build artifact for manual Partner Center upload | Numeric versions only      |

Apple's detailed submission behavior, API-key requirements, and recovery cases
are in [Apple release automation](apple-release-automation.md).

The Windows Store workflow builds unsigned x64 and ARM64 AppX artifacts for
manual upload. Configure its public Partner Center identity values first; see
[Microsoft Store publishing](microsoft-store-publishing.md). The Setup and Portable
direct-download release workflows remain separate.

For direct iPhone/iPad installation, manually dispatch `build-ios.yml` from
`main` with `distribution=ad-hoc` (the manual default). This exports a signed IPA
for registered devices without App Store upload. See
[registered-device testing setup](apple-release-automation.md#direct-installation-on-registered-iphone-and-ipad-devices).

Feature-branch builds for outside testers are separate from releases: applying
the `ios-test-flight` label to a same-repo PR creates an unsigned archive; a
protected publisher then signs and uploads it to the public TestFlight group
(`build-ios-testflight.yml` → `publish-ios-testflight.yml`). See
[Apple release automation](apple-release-automation.md#public-testflight-builds-label-triggered).

Desktop, Android and Apple workflows classify the version suffix using
`tools/release-version.js`, so hyphens in the product's tag prefix do not make
a stable release a prerelease. The tag version must match `package.json`.

## Verify before publishing the draft

Wait for every tag workflow to reach a terminal state. At minimum verify:

- the draft release body contains the intended notes;
- the expected Linux, macOS, signed Windows, Android, and Snap assets are present;
- Windows signatures passed verification;
- the Android final build reached the Play `internal` track;
- Apple upload/submission has the expected final-versus-pre-release behavior; and
- the Microsoft Store artifact and `WinStoreReleaseNotes` artifact exist if that
  channel is being updated.

Do not publish around a red required workflow. Diagnose or deliberately remove the
affected channel from the release scope first.

## What publishing the GitHub release triggers

For a non-prerelease release, publishing the draft starts:

| Channel     | Workflow                                                    | Result                                                          |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Google Play | `.github/workflows/auto-publish-google-play-on-release.yml` | Promote `internal` to `production`                              |
| Snap Store  | `.github/workflows/build-publish-to-snap-on-release.yml`    | Publish the release Snap to `edge` and `stable`                 |
| Web app     | `.github/workflows/build-update-web-app-on-release.yml`     | Build and deploy production web assets                          |
| Docker Hub  | `.github/workflows/publish-to-hub-docker.yml`               | Build and publish the application image                         |
| SuperSync   | `.github/workflows/supersync-docker.yml` (`release-image`)  | Build and publish `ghcr.io/super-productivity/supersync:vX.Y.Z` |

The Docker Hub workflow runs for any published GitHub release and does not contain
the prerelease guard used by the web, Play, and Snap workflows. Account for
that before publishing a pre-release.

The SuperSync release image skips pre-releases and never moves `latest`. Its tag
must look like `vX.Y.Z`; anything else fails the run. A release event runs the
workflow file at the tag, so a release tagged before `release-image` existed, or a
pre-release later promoted to a release (which fires `released`, not `published`),
gets no image automatically. Publish it by dispatching
`.github/workflows/supersync-docker.yml` from `master` with `release_tag: vX.Y.Z`.
Re-dispatching rebuilds and overwrites that tag.

The Microsoft Store upload remains manual: download the `WinStoreRelease` artifact
and use the generated release notes from the workflow summary/artifact in Partner
Center.

## Continuous channels

- The inherited `master` workflows build desktop artifacts and publish the branch
  Snap to `edge`.
- Android uses this fork's `main`. After configuring its signing secrets and
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, set repository variable
  `ANDROID_RELEASE_ENABLED=true` to enable builds and Play `internal` uploads on
  each `main` push. Until then, automatic `main` Android jobs skip. Manual and
  tag builds still require signing credentials. The APKs remain downloadable
  artifacts; Play receives `android/app/build/outputs/bundle/playRelease/*.aab`.
  `npm run assemble:android:prod` builds both APKs and the Play AAB. Both Android
  assemble scripts stamp `versionName` and `versionCode` from `package.json` via
  `tools/bump-android-version.js`; CI's per-push code overrides only the latter.
- A `master` push that changes SuperSync server inputs publishes
  `ghcr.io/super-productivity/supersync:latest` and `master-<sha>`. The prune keeps
  the 15 newest master images and excludes `v*`, so release tags stay available.
- Pre-release and manual Apple store uploads do not submit builds for
  App Review. Public TestFlight builds come only from the PR label workflow, see
  [Apple release automation](apple-release-automation.md#public-testflight-builds-label-triggered);
  `main` pushes do not build for TestFlight. Ad Hoc manual runs export only.

## Reproducible Android builds

The Angular service-worker builder emits `ngsw.json` (stamped with `Date.now()`,
plus a `hashTable` of per-file content hashes) and its worker scripts, and
`npx cap sync` copies them into the APK at `assets/public/`. That made the
Android build unverifiable against
[F-Droid's reproducible-build checks](https://verification.f-droid.org/) (#4155).

None of it is used on Android. `src/main.ts` gates both service-worker
registration paths on `!IS_NATIVE_PLATFORM && !IS_ELECTRON` and actively
_unregisters_ any existing worker on those platforms, so the files are dead
weight. `sync:android` therefore deletes them after `cap sync`, via
`tools/strip-service-worker-assets.js`. That retires the service worker as a
source of difference rather than pinning one field of it, and drops the bytes
from the APK. The Lighthouse CI job uses the same script on `dist/browser`, so
the file list lives in one place.

The hook point matters: F-Droid's recipe runs `buildFrontend:prodWeb` and
`sync:android` directly and never invokes `dist:android:prod`, so a step added
to the latter would not reach their build.

No failure to delete is fatal. Finding no files is legitimate — the service
worker can simply be disabled for a build — and an unlink that fails is reported
and skipped, because breaking the Android build (and with it F-Droid's prebuild)
over a cleanup would be the worse trade. (The script does exit non-zero if given
no target directory at all, but `strip:sw:android` hardcodes the path, so that
cannot fire from a build.)

A warning is not a safety net, though, so the outcome is asserted where it can be
checked: `build-android.yml` verifies on the packaged APK that no
`assets/public/` service-worker entry survived. That covers build, `cap sync`,
strip and package together rather than any single step. It never runs on a pull
request — push (`main`, `release/*`, `test/git-actions`, `ultra-tasks-v*` tags) and
`workflow_dispatch` only — so it gates the publish rather than the merge. No PR
workflow could host it: `android-tests.yml` does assemble an APK, but it
substitutes a stand-in smoke page for the Angular bundle, so the assertion would
be vacuous there.

Two things this deliberately does not do:

- **The web PWA and iOS are untouched.** The web app genuinely uses the service
  worker. `sync:ios` is a bare `npx cap sync ios` over the same `webDir`, so the
  iOS bundle receives the same dead files — but iOS is not a reproducibility
  target, so there is no benefit to buy by changing App Store bundle contents.
  If it is ever unified, `sync:ios` needs `ios/App/App/public`.
- **It does not prove the APK reproduces.** The Gradle/AAPT layer and toolchain
  pinning are untouched, so confirming byte-identity needs a diffoscope run
  against an F-Droid build. This removes the one _reported_ blocker — the
  diffoscope report in #4155 anchors on `assets-public-ngsw.json` — not
  necessarily the last.

## Credentials and signing

Never put secret values in documentation. The workflow reference is authoritative
for secret names. The main operational groups are:

- Android signing and Play:
  `DROID_KEYSTORE_PASSWORD`, `DROID_KEYSTORE_ALIAS`,
  `DROID_KEY_PASSWORD`, `DROID_KEYSTORE_BASE_64`, and
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- Apple signing and App Store Connect: see
  [Apple release automation](apple-release-automation.md),
  [Mac App Store signing](mac-app-store-code-signing-guide.md), and
  [certificate renewal](update-mac-certificates.md).
- Windows signing: `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID`; the
  project, signing-policy, and artifact-configuration slugs are fixed in
  `.github/workflows/build.yml`.
- Snap: `SNAPCRAFT_STORE_CREDENTIALS`; see
  [credential refresh](howto-refresh-snap-credentials.md).
- Web, Docker Hub, and Microsoft Store credentials are named at their exact
  use sites in the corresponding workflows.

## Store listing assets

Screenshots, descriptions, and other store-listing assets remain manual unless a
workflow explicitly says otherwise. Store requirements change; use the current
App Store Connect, Google Play Console, or Partner Center requirements rather than
copying old pixel dimensions from this repository. Scan release notes and assets
for development-only labels, secrets, and personal data before upload.

## Failure and rollback

- A failed Apple lane after upload may require a new build number or manual
  completion in App Store Connect. Follow
  [Apple release automation](apple-release-automation.md#caveats).
- The Play promotion workflow can be manually dispatched for an Android-only
  release after the intended build is already on `internal`.
- Snap publishing can be manually dispatched with an existing release tag.
- Publishing a GitHub release fans out quickly. If only one channel should move,
  use that channel's supported manual workflow instead of publishing a broad
  release.
- Record the release URL and any intentionally skipped or manually completed
  channel in the release discussion.
- A failing SignPath step prints only what the connector returns, which can be a
  bare `Invalid request to SignPath API.` with no detail (v18.20.0, run
  31883046355). The workflow log cannot say more: diagnose it in the SignPath
  web UI, where the signing request record carries the real reason. SignPath's
  byte allowance is an annual quota, not a per-request limit: splitting the same
  executables across requests does not save quota. The v18.20.0 request was
  rejected after the old pipeline submitted six executables (about 892 MB) and
  exhausted the allowance. The workflow now submits only the universal installer
  and portable (about 448 MB), after checking that both x64 and arm64 payloads are
  embedded. It creates the old architecture-specific download names only after
  signing, so those compatibility copies consume no signing quota.
- Reducing a new request does not restore quota already consumed. Check the
  SignPath organization page for the active quota period and remaining bytes;
  request an exception from SignPath or wait for the period reset if necessary.
  Also verify that `SIGNPATH_API_TOKEN` is valid, that the `super-productivity`
  project, `release-signing` policy, and `github-zip-pe` artifact configuration
  still exist under those exact slugs, and that the GitHub trusted build system
  is authorized for the organization. If those checks do not explain a rejection,
  report the run URL and submission timestamp to SignPath support so they can
  inspect the server-side request record.
- Windows signing runs only on a `ultra-tasks-v*` tag, so a signing fix can only be
  exercised by re-running `windows-bin` or by pushing a pre-release tag. Never
  move a released tag to retest.
