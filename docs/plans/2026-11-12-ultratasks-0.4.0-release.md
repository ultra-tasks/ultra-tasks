# Ultra Tasks 0.4.0 and server beta 3 release plan

Status: Proposed. Decision 6 (hosted web is Phase 1 only) is made; the other [decisions needed first](#decisions-needed-first) are open.
Owner: Ultra Tasks maintainer.
Tracking: Maintainer request in this chat, 2026-11-12.
Last verified against the code: 2026-11-12, client `main` at `e8df032522`, server `origin/main` at `877a4d6` and release `server-v0.1.0-beta.2`.
Completion condition: App 0.4.0 and a matching server release are published with the six capabilities below accepted, or this plan is cut down by an explicit maintainer decision and the removed items are recorded elsewhere.

No document defined 0.4.0 before this one. The scope below is the maintainer's list from the request plus what is already on `main` since `ultra-tasks-v0.3.0` (63 commits). Choosing the number does not waive the gates in the [server launch plan](2026-11-07-server-extraction-and-v1-launch.md). Server and SDK versions stay independent of the app version.

## Sections

- [Requested scope](#requested-scope)
- [What the other sessions have done](#what-the-other-sessions-have-done)
- [Decisions needed first](#decisions-needed-first)
- [Workstream A: green main and release hygiene](#workstream-a-green-main-and-release-hygiene)
- [Workstream B: public calendar subscription](#workstream-b-public-calendar-subscription)
- [Workstream C: two-way sync](#workstream-c-two-way-sync)
- [Workstream D: Android for Play and F-Droid](#workstream-d-android-for-play-and-f-droid)
- [Workstream E: signed and notarized Mac build](#workstream-e-signed-and-notarized-mac-build)
- [Workstream F: server release and hosting](#workstream-f-server-release-and-hosting)
- [Workstream G: hosted web app](#workstream-g-hosted-web-app)
- [Sequence and gates](#sequence-and-gates)
- [Maintainer-only actions](#maintainer-only-actions)
- [Acceptance for 0.4.0](#acceptance-for-040)
- [Unverified and risks](#unverified-and-risks)

## Requested scope

| #   | Capability                                                        | State on `main` today                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A public URL that third-party calendars subscribe to              | Nothing exists. The client can export an ICS snapshot file (`integration-calendar.ts`). The server has no feed route. The server cannot read task data, so this needs a design decision.                              |
| 2   | Fully working two-way sync                                        | Device sync (UltraSync) is two-way and fuzz-tested, with recorded gaps. Integration write-back exists for some providers and not others. This plan reads "two-way sync" as both. Correct me if you meant one.         |
| 3   | Integrations with Linear, Trello, GitLab and GitHub               | All four exist. GitHub and Trello write back in part, GitLab has provider-specific behavior only, Linear is receive-only. All four still use pasted tokens. No official OAuth registrations exist.                    |
| 4   | Android release on Google Play and F-Droid                        | Play: signed AAB pipeline and secrets exist, 0.3.0 went to the internal track path. F-Droid: an inherited `fdroid` build flavor exists, with no F-Droid listing or metadata for this app ID.                          |
| 5   | A signed Mac build using the maintainer's Apple Developer account | CI has Developer ID and notarization steps inherited from upstream, but none of the Apple secrets are set in this repository. The 0.3.0 Mac assets were ad-hoc signed and not notarized.                              |
| 6   | The hosted web version of the app at `https://app.ultratasks.app` | The no-sync standalone build exists, deploys to a `noindex` Pages preview and is attached to releases as a bundle. Nothing is served at the production origin yet. The server's Caddy split is written, not deployed. |

## What the other sessions have done

From commits since the 0.3.0 tag, branches, session titles and the plan documents, not from reading every transcript. Twelve of the listed local sessions belong to unrelated projects (Appify and HeliSlopTer) and are not covered.

| Work                                                | Where                                                                                                | Result                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone web build, hosting and origin plan       | This session                                                                                         | No-sync web build, Pages preview live and `noindex`, service-worker exclusions for `/account` and `/api`, release web bundle workflow, server Caddy split written. Nothing is served at `app.ultratasks.app` yet. See the [hosted web app plan](2026-11-10-hosted-web-app-and-account-origin.md). |
| Task clipboard, paste rules, undo/redo, sync fixes  | Local session "UltraTasks shortcut revamp status"                                                    | Copy, cut and paste rules, undo and redo for complete, add and delete, `plannedTask` on single-task plans, delete/restore no longer discards concurrent edits, done-order fixes. One known order-only gap is recorded in the [shortcuts handoff](2026-11-10-shortcuts-and-undo-handoff.md).       |
| Zen-inspired shell                                  | Claude web branch `stoic-franklin-q8fk98`                                                            | WP0–WP4 implemented (first run, Focus, nav, Upcoming panel, Search command bar, Calendar polish). WP5 is a paper prototype only. Header sync button hidden until sync is set up. Later validation and E2E timing fixes. The latest E2E fix (`e8df032`) was still running when checked.            |
| Account SDK 0.1.4, two-engine sync decision         | Claude web branch `server-collaboration-plan-4cl6x6`                                                 | SDK 0.1.4 with incremental downloads pinned. Decision 11 records that provider sync (WebDAV, OneDrive and others) gets fixes only and UltraSync is the collaboration engine. Google Drive dropped. Integration owner-device rule recorded.                                                        |
| Integrations workspace and OAuth audit              | Local sessions "Integration UI consolidation and OAuth" and "Integrations audit and OAuth migration" | Dedicated Integrations workspace, Marketplace split, snapshot and linked modes, ICS snapshot export, [unified integrations plan](2026-11-08-unified-integrations.md). The [OAuth-first plan](2026-11-10-oauth-first-connections.md) audits every connector and ships Sign in with Nextcloud.      |
| Server beta 2 and release workflows                 | `ultra-tasks-server`                                                                                 | `server-v0.1.0-beta.2` published on 2026-11-12: incremental downloads, replacement routes for provider switch, emailed registration codes, optional Turnstile, privacy URL. New release-draft and publish workflows. My web-bundle commit `c8b5b1f` is local and unpushed.                        |
| Deploy beta 2 to the VM                             | Local session, running                                                                               | Started from another session's request over SSH. When read, it had not found the installation directory on the VM and was waiting on the maintainer. This answers the open "bundled Caddy or host proxy" question once it finishes.                                                               |
| Mobile design audit, landing page, git housekeeping | Local sessions in this repository                                                                    | Audits and website work. Not release blockers.                                                                                                                                                                                                                                                    |

## Decisions needed first

1. **Integration credentials: owner device or every device.** The [OAuth-first plan](2026-11-10-oauth-first-connections.md) records "decided 2026-11-10: every device may sign in" (and calls it the largest step). The [unified integrations plan](2026-11-08-unified-integrations.md) records "decided 2026-11-11: one owner device". They contradict each other and write-back cannot be finished until one wins. Owner device is smaller and keeps tokens off other devices. Every device needs deterministic import IDs, receipts and conflict labels. Recommendation: owner device for 0.4.0, every device later.
2. **Calendar feed privacy model.** A calendar app can only read plain text, and the server only holds encrypted data. A public feed therefore means the app uploads a rendered copy of selected tasks to the server in readable form. See [Workstream B](#workstream-b-public-calendar-subscription). Recommendation: explicit opt-in per feed, "busy only" by default.
3. **Mac scope.** Developer ID signing plus notarization for the direct-download DMG is the requirement. Mac App Store is a separate pipeline with other certificates. Recommendation: Developer ID only for 0.4.0.
4. **Stage with pre-releases.** Recommendation: `0.4.0-beta.1`, `-beta.2`, then `0.4.0`. A suffixed tag builds and attaches Android and uploads iOS without publishing, while a final tag uploads to Play internal and submits the iOS and Mac App Store builds for review automatically. The web bundle workflow skips pre-releases, so a beta needs a manual run of that workflow to produce the bundle for the hosting test (see [Workstream G](#workstream-g-hosted-web-app)).
5. **F-Droid route.** Official F-Droid inclusion takes review time. IzzyOnDroid or an own F-Droid repository are quicker. Recommendation: own repository or IzzyOnDroid first, official inclusion in parallel.
6. **Decided 2026-11-12 (maintainer): Phase 1 only.** The hosted web version in 0.4.0 is the local-only build; browser account sync (Phase 2) is out of this release. What "hosted web version" means: Phase 1 of the [hosted web app plan](2026-11-10-hosted-web-app-and-account-origin.md) is the same local-only standalone build served at `https://app.ultratasks.app`: tasks stay in that browser, there is no account sign-in, no UltraSync and no calendar publishing there. Phase 2 adds browser account sync and needs that plan's independent review of browser key handling first. Phase 2 stays out so the release does not wait on that review.

## Workstream A: green main and release hygiene

- Scheduled E2E on `main` has failed on every run since before 2026-11-12. The failures seen were the estimate-undo and duplicated-attachments specs. `e8df032` waits for the dialog open animation. Confirm the next scheduled run is green before cutting any tag.
- Prefer a quiet window for pushes. Several sessions push from one checkout, and the pre-push hook (lint plus about 6,700 tests) takes minutes, so pushes race and get rejected.
- Version commit: `npm version` after choosing the number, then read `build/release-notes.md` and `build/release-notes-base.txt`, run `npm run release-notes:test`, and push the version commit and exactly that tag with `git push --atomic origin HEAD <tag>`.
- Replace the 0.3.0 text in `build/desktop-release-notes.md`. Mention the web bundle, the Zen shell, undo/redo, and each shipped capability in this plan only when it passes its acceptance.
- Update the website after each release (repository policy).

## Workstream B: public calendar subscription

**Goal.** A URL such as `https://app.ultratasks.app/cal/<token>.ics` (and `webcal://`) that Google Calendar, Apple Calendar, Outlook and Thunderbird can subscribe to.

**The constraint.** UltraSync is end-to-end encrypted, so the server cannot render a feed from synced data. Calendar apps cannot decrypt. Three ways out:

| Option                                                                                | What the server sees                                  | Verdict                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A. App uploads a rendered ICS for the selected tasks, server hosts it at a secret URL | The tasks the user chose to publish, in readable form | Recommended. Works for every calendar app, official and self-hosted. Needs consent and honest copy. |
| B. Feed hosted by the user (their WebDAV or Nextcloud public share)                   | Nothing                                               | Good fallback and the self-hoster default. Setup is manual. Add as a documented path.               |
| C. Server renders from decrypted data                                                 | Everything                                            | Rejected. Breaks the encryption claim.                                                              |

**Design for option A.**

- Client: Settings, Calendar, **Publish a calendar**. Choose which tasks (for example Today, a project, or a tag), what is shown (**Busy only** by default, or title and time, never notes), and a label. Show the exact URL once created, with a rotate and a stop-publishing action. Explain in the dialog that published items are readable by the server operator and anyone with the URL.
- Generator: extend the ICS code in `integration-calendar.ts`. It must produce stable `UID`s, `DTSTAMP`, `SEQUENCE`, proper `VTIMEZONE` or UTC, date-only all-day values (no invented midnight), and recurrence as expanded instances for a bounded window rather than `RRULE`, until recurrence identity is proven.
- Publishing: debounced upload after relevant local changes while signed in and online. Include a monotonic revision so two devices cannot overwrite a newer upload with an older one. Which device publishes follows the owner-device decision.
- Server (`ultra-tasks-server`): a `CalendarFeed` record per account (hashed token, label, privacy level, ICS body, revision, ETag, timestamps), authenticated create, update, rotate and delete routes under `/api/v2/accounts/`, and an unauthenticated `GET /cal/<token>.ics` with `ETag`, `Last-Modified`, `Cache-Control`, `X-Robots-Tag: noindex`, rate limit and size cap. Token is 256 bits, stored hashed, compared in constant time. Deleted with the account and included in backups. Dashboard lists feeds with rotate and revoke.
- Hosting: `/cal/*` is server-owned. Add it to the path table in the [hosted web app plan](2026-11-10-hosted-web-app-and-account-origin.md), the Caddy server matcher, and the service worker `navigationUrls` exclusions (`!/cal/**`). A returning visitor with an active worker must still reach the server.
- Documents: update the privacy notice and the server's security and recovery record to say published feeds are outside the end-to-end encryption claim.

**Acceptance.** Subscribe from Google Calendar, Apple Calendar, Outlook and Thunderbird; edit a task and see the change after each app's own refresh interval (set expectations in the UI: calendar apps poll on their own schedule, often hours); DST and all-day items correct; rotate and stop-publishing make the old URL return 404 within one request; an E2E test covers publish, fetch, rotate and revoke; a wrong or old token never reveals another account's data.

**Prior art to read before building** (not yet checked for this plan): Todoist calendar feeds, Google Calendar "From URL" refresh behavior, Apple Calendar subscription refresh settings.

## Workstream C: two-way sync

### C1. Device sync (UltraSync)

Already two-way. What remains for "fully working":

- Decide the recorded **project-list order gap** (a move beside a concurrent append leaves two orders). Options in `order-and-membership-options.md`: accept, or a derived membership. Record the decision in the release notes' known issues if accepted.
- Today's order can differ between devices (native replay prepends, a patch appends). Decide whether that is acceptable.
- Bulk plans, subtasks and some dispatchers still resolve by whole-task last-writer-wins. List them as known limits or add `plannedTask` to them.
- Run the server launch plan's real-path items against beta 3: interrupted write retry, offline reconnect, concurrent content preserved in both directions, account switch, downgrade protection.
- Physical Android and iOS acceptance (suspension, credential storage, reminders), deferred from 0.3.0, becomes a gate for a store release.
- Browser sync is **not** in 0.4.0. The standalone web build stays local-only ([hosted web app plan](2026-11-10-hosted-web-app-and-account-origin.md), Phase 2).

### C2. Integration write-back for the four providers

Targets, from the [provider audit](2026-11-08-unified-integrations.md#provider-capability-audit-and-quirks) and the [OAuth plan](2026-11-10-oauth-first-connections.md). "Two-way" means the user chooses per field which direction changes flow, and no write happens just by connecting.

| Provider | Today                                                                   | 0.4.0 target                                                                               | Work                                                                                                                                    | Sign-in                                                        |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| GitHub   | Receive; writes status, title, body; creates issues                     | Same, certified two-way, with repo-qualified identity and optional PR inclusion            | Real-path E2E with intercepted responses, loop suppression, private-repo access, label to tag mapping                                   | Device flow with an Ultra Tasks OAuth App (desktop and mobile) |
| GitLab   | Receive; provider-specific behavior, no generic two-way adapter         | Receive plus write status, title, description; create issues                               | Audit existing API behavior first, add write hooks through the capability facade, preserve weight as weight, instance and project scope | Public client on gitlab.com; token for self-managed            |
| Linear   | Receive only; the plugin has no update or create hooks                  | Receive plus write state, title, description; create issues                                | Add update and create hooks to the plugin, map completed versus cancelled, keep multi-project membership, team is not a project         | Public client with PKCE                                        |
| Trello   | Receive; writes title and completion (archives the card); creates cards | Same, plus an explicit "move to Done list" mapping with a preview, separate from archiving | Done-list mapping, board-scoped labels, preview step                                                                                    | Trello authorize page or OAuth 2.0 public client               |

Shared work for all four:

1. Generalize OAuth: one build-time `OFFICIAL_OAUTH_CLIENTS` map, per-connection token scoping beyond Google, store rotated refresh tokens, a device-code step for GitHub. A build without a registration hides the button and keeps the token path.
2. Credential storage follows [Decision 1](#decisions-needed-first). Today pasted tokens live in synced state, protected by UltraSync end-to-end encryption but not under WebDAV or OneDrive without encryption.
3. Acceptance for each provider and each field: two-client E2E with intercepted provider responses, no duplicate local tasks or remote creates, delayed responses, revoked permissions, queued-write cancellation, Hide and Stop tracking never delete remotely. These checks do not certify live accounts, so run each provider once against a real test account before release.

## Workstream D: Android for Play and F-Droid

**Google Play.**

- Signing and upload secrets exist (`DROID_KEYSTORE_*`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`) and recent commits prepared an encrypted Play signing export. Confirm in the Play Console which key is the upload key and that App Signing is enrolled.
- A final tag uploads the AAB to the `internal` track, and publishing the GitHub release promotes `internal` to `production`. A pre-release tag only builds. Because a mistaken final tag reaches production, use beta tags until the gates pass.
- Google requires newer personal developer accounts to complete a closed test with a minimum number of testers over a fixed period before production access. Verify the current rule and this account's status in the Play Console. If it applies, start the closed test with the first beta, since it sets the schedule.
- Needed: store listing, screenshots, data safety form, privacy policy URL, content rating, and a Google Calendar OAuth client for `app.ultratasks` with its release SHA-1 (the shipped client belongs to upstream).

**F-Droid.**

- The `fdroid` flavor exists and has no Play Services dependency in its flavor block. Prove it: build `fdroidRelease` from a clean checkout and check the dependency list for proprietary libraries.
- Official inclusion: a merge request to `fdroiddata` with metadata for `app.ultratasks`, built from the tag. F-Droid signs with its own key unless the build is reproducible and matches ours. The repository already has a reproducible-build section in the [release runbook](../release-and-publishing.md#reproducible-android-builds). Review takes time, so file early.
- Faster paths: IzzyOnDroid (picks up the signed APK from GitHub releases) and an own F-Droid repository. The signed APKs already attach to each release.
- Feature gaps to decide: Google Calendar sign-in is Play-flavor oriented, so state what the F-Droid build does without it.
- `android/fastlane/metadata/android/en-US` holds the changelogs. Keep the version code scheme in step with `tools/bump-android-version.js`.

## Workstream E: signed and notarized Mac build

Findings:

- `electron-builder.yaml` already sets hardened runtime, `notarize: true`, `type: distribution` and the entitlements. `electron-builder.ultra-tasks.cjs` overrides identity to ad-hoc (`-`) and turns notarization off, which is how the 0.3.0 Mac assets were produced.
- `.github/workflows/build.yml` job `mac-bin` already imports a certificate bundle, a provisioning profile and an App Store Connect API key, and also reads an Apple ID, app-specific password and team ID. None of `mac_certs`, `mac_certs_password`, `mac_api_key`, `mac_api_key_id`, `mac_api_key_issuer_id`, `dl_provision_profile` or the Apple ID secrets exist in this repository.
- The entitlements are only hardened-runtime exceptions (JIT, unsigned executable memory, library validation off, Apple Events). None of them requires a provisioning profile, so the `provisioningProfile` line and the profile step are probably unnecessary for Developer ID. Confirm with a test build before removing them.
- `zip` is commented out in the Mac targets. electron-updater's macOS updater uses the zip, so check whether in-app auto-update on Mac is in scope. If it is, enable the zip target.

Work:

1. **Maintainer:** in the Apple Developer account create a **Developer ID Application** certificate, export it with its private key as a `.p12`, and create an App Store Connect API key (or an app-specific password). [Update Mac certificates](../update-mac-certificates.md) describes the export steps, including an OpenSSL route if no Mac is available. Add the secrets in GitHub; do not paste them in chat.
2. Make `mac-bin` the release path: sign with Developer ID, notarize, staple, produce arm64, x64 and universal DMGs. Keep `electron-builder.ultra-tasks.cjs` for local ad-hoc builds only and rename the outputs so signed and ad-hoc files cannot be confused.
3. Verify on the artifact: `codesign --verify --deep --strict`, `spctl -a -vv`, `xcrun stapler validate`, and a first launch of a quarantined download on a clean Mac without any Gatekeeper override.
4. Test the app's Apple Events permission prompt (used by the auto-track plugin) under the hardened runtime.
5. Update the release notes: remove the "ad-hoc signed without notarization" sentence once this passes.

## Workstream F: server release and hosting

Client 0.4.0 works against `server-v0.1.0-beta.2`. A new server release is needed for the calendar feed and for hosting the web app.

1. Rebase `c8b5b1f` (web bundle served at the root, `install-web.sh`, Caddy split) onto `origin/main` (15 commits behind) and push.
2. Add the calendar feed routes and dashboard controls ([Workstream B](#workstream-b-public-calendar-subscription)) behind a feature flag, with migrations that run in the existing update script.
3. Add `/cal/*` to the Caddy server matcher and the proxy example, then re-run the Caddy behavior test.
4. Tag `server-v0.1.0-beta.3` through the new release-draft workflow and approve the draft after CI passes (fresh install, upgrade, backup and restore, published image, AMD64 and ARM64).
5. Deploy to the VM. Wait for the running deploy session to finish and record the installation path and proxy mode, then update, install the 0.4.0 web bundle with `scripts/install-web.sh`, and run the Phase 1 acceptance list from the hosted web plan: path ownership, `/account` reaches the network with an active worker, headers per path, rollback by symlink.
6. Still open from that plan: TLS and WebSocket through Caddy, behavior behind Cloudflare, the report-only CSP against real use, removing the legacy upstream CORS default. Update website copy when the hosted app ships.
7. Server `1.0.0` is separate. Its remaining gates (independent security review, Oracle and SMTP, capacity tests, migration inventory, limited beta recovery exercise) are not cleared by this release.

## Workstream G: hosted web app

**Goal.** Opening `https://app.ultratasks.app` runs the app, updates itself on the next visit after each release, and `/account` still reaches the account dashboard. This is Phase 1 of the [hosted web app plan](2026-11-10-hosted-web-app-and-account-origin.md); that plan owns the path table, headers and rollback rules, and this section only schedules it with 0.4.0.

**Already done.** Standalone build flag and gating, service-worker exclusions for `/account`, `/api`, `/live`, `/health` and `/oauth`, the PWA end-to-end test for server-owned paths, the release workflow that attaches `ultra-tasks-web-<version>.tar.gz` and a checksum, the Pages preview (`ultra-tasks-preview.pages.dev`, `noindex`), and the server's Caddy split with `scripts/install-web.sh`.

**Remaining.**

1. **Bundle source.** The first bundle comes from the 0.4.0 release (or a manual run of `build-update-web-app-on-release.yml` for a beta, because the workflow skips pre-releases). The release-event path has only been exercised through the manual-run branch so far, so the first real release is also its first test. Check that the tarball and its checksum attach and that `install-web.sh` accepts them.
2. **Server and VM.** Covered by [Workstream F](#workstream-f-server-release-and-hosting): push the Caddy commit, release beta 3, update the VM, install the bundle. Record whether the VM uses the bundled Caddy or a host proxy first, since the nginx fragment in the server README is untested.
3. **DNS and Cloudflare.** Point `app.ultratasks.app` at the VM with Cloudflare in front. Decide cache rules for `/` (no-cache), `sw.js`, `ngsw.json` and `index.html` so the CDN never serves a stale worker.
4. **Path rules verified through the real stack.** TLS, WebSocket upgrade through Caddy, headers per path (report-only security policy for the app, the dashboard's own policy unchanged), `/account` reaching the network with an active worker, and rollback by repointing `current` with no data loss. Add `/cal/*` to the server-owned paths ([Workstream B](#workstream-b-public-calendar-subscription)).
5. **OAuth callback page.** `https://app.ultratasks.app/oauth/callback/<provider>` is reserved but the file does not exist yet. It is only needed if a provider sign-in is offered on the web. Build it (an explicit file that strips the code from the URL first) or state that web has no OAuth sign-in in 0.4.0.
6. **Browser behavior of integrations.** In the browser the integration plugins call the provider with plain `fetch`, so each provider's CORS rules apply, and GitHub's device flow endpoints on github.com have no CORS. Test GitHub, GitLab, Linear and Trello with a pasted token in the hosted build and record which work. Do not offer "Sign in with ‹provider›" on web where it cannot work, and hide integrations that fail rather than showing a broken setup.
7. **Account features are off by design.** The hosted app has no account sign-in or UltraSync (Decision 6), so it cannot publish a calendar feed. Say so in the Settings text and on the website rather than showing disabled controls. First-run, Search and the header already omit the sync entries in this build.
8. **Local data lives per origin.** Anyone who tries the Pages preview keeps data there, not at the production origin. The preview stays `noindex` and unlinked. Make the hosted app's export and backup prominent on first run, because the origin must not change once users have data, and a clean export and import path is the only migration.
9. **Website and documents.** Replace the "coming soon" hosted-web copy only after acceptance passes. Update the release runbook, the web page of the wiki that compares web and desktop, and the server deployment guide to say what the hosted app is and is not.

**Acceptance.** `curl -I` shows hashed assets `immutable`, `/` and `sw.js` revalidating, `/account` `no-store`, `/oauth/callback/<provider>` returning the callback page if built, and `/cal/<token>.ics` answered by the server with an active worker. A browser that has run the app opens `/account` and an emailed link and sees the dashboard, not the app. A new release is picked up on the next visit and a rollback restores the previous release. A fresh profile can create, edit, export and import tasks, work offline after the first load, and reload without losing data. No request from the hosted app reaches `/api/`.

## Sequence and gates

Size: S is a day or less of focused work, M a few days, L a week or more. These are relative, not commitments.

| Phase | Work                                                                                                                                                                                                           | Size | Gate to leave the phase                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Answer the five open decisions. Start every maintainer-only action with a waiting time: Apple secrets, OAuth registrations, Play closed test and listing, F-Droid or IzzyOnDroid filing                        | S    | Decisions recorded in this plan; registrations submitted                                                                                                                   |
| 1     | Green `main`; push the server web-bundle commit; Mac signing in CI on a test tag; `fdroid` flavor clean build; record the VM proxy mode and test the web bundle workflow on a beta tag                         | M    | Signed notarized DMG passes the Gatekeeper check; scheduled E2E green; F-Droid build proves free of proprietary deps; web bundle attaches and installs in a test directory |
| 2     | Calendar feed (client generator and UI, server routes, Caddy, service worker); Linear and GitLab write hooks; GitHub device flow                                                                               | L    | Calendar apps subscribe and refresh; two-client E2E per provider passes                                                                                                    |
| 3     | Trello Done-list mapping; Linear, GitLab and Trello sign-in; credential storage per Decision 1; C1 known-gap decisions                                                                                         | M    | Each of the four providers certified against a real test account                                                                                                           |
| 4     | `0.4.0-beta.1` and `server-v0.1.0-beta.3`; VM deploy and web bundle install with DNS and Cloudflare; hosted-build integration checks; Play closed test starts; F-Droid filing; physical Android and iOS checks | M    | The hosted app, `/account`, feeds and each provider's browser behavior pass on `app.ultratasks.app`; no red required workflow                                              |
| 5     | Fix findings; `0.4.0-beta.2` if needed; final `0.4.0`; promote Play; publish release; website update                                                                                                           | M    | Acceptance list below complete                                                                                                                                             |

Critical path: Play closed-test duration (if it applies) and F-Droid review are outside our control, and Apple and OAuth registrations can take days. They start in Phase 0 even though their code is in Phase 1–3.

## Maintainer-only actions

- Apple Developer account: Developer ID Application certificate (`.p12` with private key), App Store Connect API key or app-specific password, team ID; add GitHub secrets.
- GitHub OAuth App with device flow; GitLab.com non-confidential application; Linear OAuth app with PKCE; Trello Power-Up key or OAuth 2.0 client. Redirects are listed in the [OAuth plan](2026-11-10-oauth-first-connections.md#registrations-the-maintainer-has-to-make).
- Google Cloud project for Calendar if Google Calendar sign-in stays on Android (own client, release SHA-1, brand verification).
- Play Console: listing, data safety, content rating, tester group, confirm the upload key.
- F-Droid: choose the route; IzzyOnDroid or `fdroiddata` filing needs a maintainer account.
- Decide the five open items under [Decisions needed first](#decisions-needed-first); approve each release draft.
- DNS for `app.ultratasks.app` and the Cloudflare proxy settings; VM access for the server deployment; official sign-ups stay closed until SMTP and the privacy notice are final.

## Acceptance for 0.4.0

- Scheduled E2E and required workflows are green on the release commit.
- A calendar app subscribed to a published feed shows the selected tasks and picks up a change; rotating or stopping the feed makes the old URL fail.
- Two devices stay in sync through offline concurrent edits in both directions, and the known gaps are either fixed or listed in the release notes.
- GitHub, GitLab, Linear and Trello each pass write-back and no-duplicate checks in two-client E2E and once against a real account, with sign-in that does not require pasting a token.
- Android: the Play build passes on a physical device from the closed or internal track; the F-Droid route has a published install source.
- The Mac DMG is signed, notarized and stapled, and opens on a clean Mac without Gatekeeper overrides.
- Server beta 3 is deployed and `https://app.ultratasks.app` serves the hosted app at `/` and the dashboard at `/account`. `/account`, `/cal/*` and `/api/*` are never answered by the service worker, a new release reaches a returning visitor on the next visit, a rollback loses no data, and the hosted app works offline after the first load.
- Each of GitHub, GitLab, Linear and Trello is recorded as working or hidden in the hosted build, and the website's hosted-web copy matches.
- Release notes, the account and self-hosting guides, the privacy notice and the website match what shipped.

## Unverified and risks

- The decisions above are open. The scope is large for one version, so the staged pre-releases are the main protection against shipping an unfinished capability by tag.
- No live provider account, Apple notarization, Play Console or F-Droid build was checked for this plan. Statements about them come from repository configuration and documents.
- The Play closed-test rule and calendar-app refresh intervals are from general knowledge and must be confirmed against current vendor documentation.
- Calendar feeds are a privacy change. Publishing is opt-in and limited, but the server operator can read published items. That must be stated everywhere the feature is described.
- The VM state is unknown until the running deploy session finishes.
- The hosted app is local-only, so a user who clears browser data loses tasks unless they exported. The origin cannot change once people have data, so confirm `app.ultratasks.app` is final before announcing it.
- Whether each integration provider works from a browser (CORS) is unchecked. Token paths are likely to work for some and device-flow sign-in cannot.
- Several sessions edit and push the same repository, so a release commit needs a deliberate quiet period.
