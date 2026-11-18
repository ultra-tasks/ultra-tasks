# Ultra Tasks account beta 2 audit and handoff

Status: audited and ready for implementation planning. No product changes, new
builds or deployments were made in this audit. The next client target is
`0.4.0-beta.2`; server and SDK versions remain independent. The maintainer asked
to document the work for another session, across client, server and website.

The first priority is making account sign-in lead clearly to synced tasks.
The reported iPhone problem was a missed data-source choice, subsequently
confirmed by the maintainer, rather than a demonstrated download failure.
The toolbar and Account settings also use the legacy provider state and omit
the new account state. Fix those paths before treating this as a visual refresh.

## Contents

- [Decisions and boundaries](#decisions-and-boundaries)
- [Evidence and current implementation](#evidence-and-current-implementation)
- [Prior art](#prior-art)
- [Work packages](#work-packages)
- [Required sync status behavior](#required-sync-status-behavior)
- [Compatibility and data safety](#compatibility-and-data-safety)
- [Acceptance and next beta delivery](#acceptance-and-next-beta-delivery)
- [Starting the next session](#starting-the-next-session)

## Decisions and boundaries

The maintainer requested these changes on November 18, 2026:

1. Remove username and display name from account creation and account UI.
   Registration asks for email and password; password confirmation, privacy
   consent, email verification and saving the vault recovery key remain safety
   steps, not additional profile fields.
2. Use a unique account ID for support, retrievable and copyable from settings.
   An existing ID should be reused. Future invitations may use email or account
   ID once collaboration works; invitation implementation is deferred.
3. Replace the customer-facing name **UltraSync** with **Ultra Tasks account**,
   including the landing page. Use consistent spacing, not “UltraTasks account”.
4. Promote free account registration more prominently on the landing page.
   Account creation is already open; this is a discoverability/copy change.
5. Audit and improve the online dashboard, in-app sign-in, Account settings,
   provider switching and account sync feedback as one coherent flow.
6. With **Official server** selected, hide the server URL input. Show and
   validate it only for **Custom server**; preserve the selected custom URL
   when switching back and forth.
7. Add default-on email verification for **new/unrecognized device sign-ins**,
   with an opt-out. This clarification was explicitly selected by the maintainer.
   Existing devices should keep syncing normally. Email must not bypass an
   enrolled authenticator or security key. See the security distinction below.
8. Investigate the repeated **Global Shortcut registration failed:
   Ctrl+Shift+X** message after manual account sync. Resolve its trigger and
   communicate shortcut conflicts separately from sync failures.
9. Provide glanceable sync status on desktop and mobile: signing in, waiting
   for a decision, downloading, uploading, applying data, success, offline or
   failure must be distinguishable.
10. Following the iPhone report, the maintainer confirmed: an empty local app
    should automatically download existing account data. Where a data-source
    decision is necessary, show a focused dialog immediately after sign-in,
    rather than leaving the choice below the signed-in card.
11. Following the overnight desktop report, keep trusted devices signed in
    persistently across sleep, wake and app restarts, with automatic renewal.
    Ordinary idle time must not silently disconnect an account. Explicit sign-out,
    device revocation and necessary security events remain effective; if user
    action is required, show a persistent actionable reconnect state rather than
    the generic new-user setup reminder.

This is private personal sync work. Do not add collaboration, new identity
systems, telemetry, a second sync engine, or browser account sync to satisfy it.
The hosted web task app remains local-only unless separately authorized.
This document supersedes older plans only for the decisions listed above.

## Evidence and current implementation

### Audit baseline

| Repository                       | Revision examined | Relevant delivery state                                                                                                                                  |
| -------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ultra-tasks/ultra-tasks`        | `6dbfed4677`      | Client beta.1 tag resolves to `8e85de4f4365df70795ba75b1ea81446ce3c1c5f`; the audited account/header/settings/shortcut source has no diff from that tag. |
| `ultra-tasks/ultra-tasks-server` | `ffaaa50`         | Live server beta.3 runtime is `aabcb2b2ad702ca54e8d6ee36634802040a897f1`; the later commit fixes Compose bundle packaging.                               |
| `ultra-tasks/website-landing`    | `8aa0436`         | Registration links are published; naming and promotion still need the requested pass.                                                                    |

Recheck revisions at implementation time. The server tag was absent from the
local tag list during this audit; use the release record/source SHA rather
than claiming a successful local tag-containment check there.

User screenshots show:

- **1:** Official server selected, but a large read-only URL field remains;
  sign-in is labelled “Email or username”.
- **2:** A global shortcut registration error for `Ctrl+Shift+X`.
- **3:** Account settings offers only “Set up sync” despite a connected account.
- **4:** The account page reports “Sync complete” and a live connection, followed
  by a large calendar publication form with native unstyled inputs/selects.

The screenshot account address is intentionally not repeated here. Original
images belong to the originating chat; the findings do not depend on retaining
temporary clipboard paths or publishing screenshots with personal data.

### Confirmed mobile first sign-in defect

The maintainer used the latest TestFlight **0.4.0 beta 1** on an iPhone, selected
the same account and server as desktop, dismissed the initial message and added
the account through Settings. No tasks appeared and the status read **Account
unlocked**. They subsequently found the account/local-data choice below it and
confirmed that was the issue. The local app had no personal data.

Code explains that state:

- [`native-sync.service.ts`](../../src/app/features/native-sync/native-sync.service.ts)
  sets `unlocked` and `NATIVE_SYNC.READY` during session opening. Automatic
  linking runs for a missing/incomplete personal scope, not an already populated
  account on an unlinked second device.
- `syncNow()` returns without syncing when `linked` is false. An existing unit
  test explicitly verifies “does not upload account changes until the user
  connects personal data”. Authentication success is therefore not sync success.
- [`native-sync.component.html`](../../src/app/features/native-sync/native-sync.component.html)
  renders **Connect personal data**, **Import this device’s data** and
  **Use the account’s existing data** as a separate section below the signed-in
  account controls. A user can miss it and remain at “Account unlocked”.

This incident is resolved as a diagnosis, not as a shipped fix. Do not describe
it as lost server data or claim the TestFlight onboarding is already repaired.

### Confirmed split between account and legacy sync UI

- [`main-header.component.ts`](../../src/app/core-ui/main-header/main-header.component.ts)
  `hasSyncConfigured` checks `syncCfg.isEnabled` and the legacy `syncProvider`.
  Its readiness, progress and confirmation signals come from
  [`SyncWrapperService`](../../src/app/imex/sync/sync-wrapper.service.ts).
  The header template gates its sync icon on those legacy values.
- [`config-page.component.ts`](../../src/app/pages/config-page/config-page.component.ts)
  `syncStatus` derives its provider from the same legacy sync settings.
  Its template shows “Set up sync” when that provider is absent; its manual
  trigger calls the legacy wrapper directly.
- [`NativeSyncService`](../../src/app/features/native-sync/native-sync.service.ts)
  separately owns `configured`, `unlocked`, `linked`, `busy`, `status`, `error`,
  `backgroundError` and `live`. Its account page displays a status string and
  disables the sync button while busy, but has no visible transfer/apply stages
  or last-success timestamp in this view.

Consequently a correctly connected account can look unconfigured elsewhere.
This is supported by screenshots and source, not merely a naming preference.

### Overnight desktop sign-in loss and misleading reminder

Follow-up report, November 18: the maintainer left the desktop app open, the
computer slept, no account security settings changed, and on return the app
asked them to connect an account and sign in again.

Read-only diagnosis found:

- At inspection, all five recent server sessions were **unrevoked and unexpired**.
  They were created on November 18 UTC; their absolute end dates were February
  16, 2027 and inactivity end dates December 18, 2026. Session metadata only was
  queried: no credentials, account addresses or task data were retrieved.
- `apps/server/src/ultra-account/security.ts` creates 90-day absolute / 30-day
  inactivity sessions. `routes.ts:/sessions/refresh` rotates refresh tokens and
  renews inactivity within that absolute bound. The SDK normally refreshes the
  10-minute access credential early. There is no ordinary overnight server expiry
  in that policy, and the inspected recent rows were still valid.
- The local desktop log records a window/app quit at **00:42:36**, followed by
  a new idle-monitor startup at **00:42:58** on November 18, America/Bogota.
  It later records sleep/wake and screen unlock. This is evidence of an app
  restart before the sleep period even though the user left it running; it does
  not establish who/what initiated the restart. No corresponding renderer crash
  or updater marker identified its cause in the inspected log.
- `NativeSyncService` initializes `unlocked=false`. It caches the refresh token
  sealed under the vault master key, but the unlocked key/account client remains
  in memory. It has no desktop current-session restore on startup. The Electron
  `account-login-store.ts` protects **pending browser-login proofs only**, expiring
  after five minutes; it is not a remembered unlocked account. The platform
  session owner in `NativeSyncPlatformService` supports Android/iOS, not desktop.
- `SyncSafetyBannerService.showReminderIfNeeded()` checks only legacy
  `GlobalConfigService.sync()` state. It never consults a configured native
  account. An account user with the old provider disabled can receive the
  “used for a while / set up sync” reminder whether or not their session expired.
  `AppComponent` requests that reminder after initial startup/data readiness,
  not as a result of an account-expiry event.

Conclusion: the generic reminder is a confirmed legacy-state bug. A valid server
session plus a recorded app restart and missing desktop unlock restoration
supports client-side sign-in-state loss as the cause of the re-login prompt;
normal server expiration is contradicted by the inspected metadata. The exact
restart initiator remains unknown. Do not describe the account itself as expired
or infer a sleep-specific refresh failure without a new reproduction.

Additional regression gap, not the observed cause: the server revokes a session
if a consumed single-use refresh token is reused. A lost refresh response during
network/sleep transitions needs controlled testing. All inspected recent
sessions were unrevoked, so do not weaken reuse detection based on this incident.

### Shortcut error path and remaining reproduction

The source-supported trigger chain is:

`NativeSyncService.sync` → `NativePersonalBridgeService.apply` →
`OperationLogSyncService.applyNativeSnapshot` →
`SyncHydrationService.hydrateFromRemoteSync` → `loadAllData` →
`GlobalConfigEffects.registerGlobalShortcutInitially$` → Electron registration.

Owners:
[`native-personal-bridge.service.ts`](../../src/app/features/native-sync/native-personal-bridge.service.ts),
[`sync-hydration.service.ts`](../../src/app/op-log/persistence/sync-hydration.service.ts),
[`global-config.effects.ts`](../../src/app/features/config/store/global-config.effects.ts),
[`global-shortcuts.ts`](../../electron/ipc-handlers/global-shortcuts.ts).

The Electron handler calls `globalShortcut.unregisterAll()` and registers every
configured global shortcut again, reporting an error to the renderer if one is
unavailable. `Ctrl+Shift+X` is the default `globalShowHide` binding. The desktop
inventory showed both Ultra Tasks and the older Super Tasks running; that is a
plausible conflict, but the owner of this shortcut was not established.

The error means an OS-wide keyboard shortcut could not be acquired. By itself
it does not establish a failed encrypted sync. The repeated manual-sync report
still needs a controlled Electron reproduction before selecting the fix.

### Account identity, dashboard and security

Server paths below are relative to `ultra-tasks-server`:

- `apps/server/src/ultra-account/routes.ts`: registration already uses
  `crypto.randomUUID()` for the account ID. `store.ts:publicAccount` returns it
  as `id`; it is the existing immutable account identity.
- `apps/account/public/ultra-account.html` and `apps/account/src/portal.ts` are
  the dashboard sources. The public registration form was inspected in a
  separate ChatGPT browser: username and display name are present, along with
  email, password confirmation, consent and a recovery-key step. Display name
  looks like another required question, although it is not HTML-required.
- The profile form exposes username/display name/email; the examined dashboard
  and app account screens have no labelled, copyable support account ID.
- `routes.ts:loginResult` checks enrolled factors; `store.ts:FactorRow` supports
  `totp` and `webauthn`. Email verification/recovery challenges exist, but a
  default new-device email sign-in challenge and trusted-device policy do not.
- `store.ts:accountByIdentifier` matches email or username, not account ID.
  `scope-routes.ts` shares this resolver for future invitation groundwork.
- `packages/account-crypto/src/account-client.ts` and `sync-client.ts` also
  expose username/display-name contracts; registration currently requires a
  `displayName` argument in the SDK type. Removing form controls alone is not
  a complete identity change.
- Dashboard assets under `apps/server/public/` and `account-public/` are
  installed by `npm run build:dashboard`; edit `apps/account/` and regenerate,
  rather than hand-editing the installed copies.

### Website findings

In `website-landing`, `index.html`, `download/index.html`, the privacy policy,
README and account integration guide still contain UltraSync branding. The
landing page already has **Create account** links, but they live inside the
sync/privacy card and FAQ; the hero emphasizes downloads and local browser use.
It promises a future always-free plan rather than clearly saying that account
registration is free now. The form links are handled by the existing
`data-account-link="signup"` build logic; reuse it.

## Prior art

Vendor documentation checked November 18, 2026. These are interaction references,
not a claim of feature parity or an independent security assessment.

| Product                                                                                                                                     | Relevant behavior                                                                                                                | Apply here                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Bitwarden sync](https://bitwarden.com/help/vault-sync/) and [login versus unlock](https://bitwarden.com/help/understand-log-in-vs-unlock/) | Distinguishes access to a local vault from signing in; a new installation fetches existing data on login and offers manual sync. | Separate authentication, local unlock and actual data synchronization; empty-device sign-in leads to data.   |
| [Todoist sync troubleshooting](https://www.todoist.com/help/todoist/troubleshooting/troubleshoot-syncing-issues-in-todoist-d6dDzzpF)        | Provides a manual sync path and warns against clearing local data before preserving unsynced changes.                            | Visible retry and non-destructive diagnosis; never make reset/reinstall the first response to missing tasks. |
| [Proton account 2FA](https://proton.me/support/two-factor-authentication-2fa)                                                               | Central account security with authenticator/security-key options and separate recovery codes.                                    | One understandable security area; retain stronger factors and distinguish recovery from normal sign-in.      |

Also relevant: [Bitwarden new-device verification](https://bitwarden.com/help/new-device-verification/)
uses email verification for new devices without enrolled stronger 2FA, with
an opt-out. Adopt the distinction, not its product-specific exemptions.

Take: predictable sign-in completion, calm persistent status, recoverable errors,
and a small number of clear account/security actions. Deliberately do not add
activity feeds, success toasts after every background sync, new configuration
categories for each internal service, or competing filled buttons. This directly
addresses reported friction in first run, mobile polish and sync reliability;
the [market target](../market/README.md#target) treats these as fundamentals.

## Work packages

### A. First sync and data-source selection

Priority: next-beta blocker. Client owns behavior; server/SDK must support the
existing complete-scope and replacement checks.

- After sign-in, discover the personal scope before making a data-source choice.
  For a demonstrably empty/pristine local app and an existing populated account,
  automatically choose the account copy, download, decrypt, validate and apply.
  Navigate to the actual task workspace once ready.
- Define pristine local data explicitly, including first-run example tasks,
  archives and drafts. A default example must not turn an empty new device into
  a destructive “import local” path. Real local changes must not be discarded.
- When both sides contain real data, show a focused immediate dialog describing
  the consequences. Prefer labels such as **Download account data** and
  **Replace account data with this device**. Replacement needs explicit
  confirmation and the existing recovery copy. Do not suggest it is a merge.
- Cancel means **Data connection not finished**, with a prominent resume action.
  Do not silently complete onboarding or show a success message. If discovery
  fails, retry discovery; do not interpret failure as an empty account.
- Preserve edit-during-choice and other-device-initialization safeguards. The
  app must not create a new empty account dataset while a scope fetch is pending.

### B. One account and sync presentation

Priority: next-beta blocker; client.

Use the same derived status and provider-aware manual sync action in the header,
mobile navigation, Account dialog, Settings, search commands and account page.
Extend existing view services or introduce only a small read-only presentation
facade; do not replace the engines. `NativeSyncService` already injects the
legacy wrapper, so injecting native sync back into that wrapper creates a cycle.

Account becomes the prominent signed-in identity and status surface. Move
OneDrive/WebDAV and existing deprecated providers under secondary **Other sync
options** without dropping configurations. Present connected, locked, offline
and reconnect-needed accounts as existing accounts, not “Set up sync”. Route
manual sync to the active engine; never run native and legacy sync in parallel.

Show a calm account/sync affordance at every screen size, with a readable
status on tap/hover and the full state in Account. Reconcile the existing
`isSyncIconEnabled` preference explicitly so a legacy icon gate cannot hide
account errors. Do not rely on color, rotation or an unlabeled cloud alone.

### C. Account and sign-in visual pass

Client plus server dashboard; reuse [styling tokens](../styling-guide.md).

- Hide the official URL input; **Custom server** alone reveals it. Validate the
  actual selected origin, preserve custom drafts, and show it in connection
  details where useful. Hiding the field must not change credential namespaces.
- Use email-only wording in the new sign-in UI; keep password managers, paste,
  autofill, keyboard submission, reveal-password and inline errors usable.
- Make browser sign-in/return, email verification, 2FA, recovery and initial data
  connection feel like successive steps, with a clear cancel/back destination.
  Avoid a success-looking status while a required step is still pending.
- Consolidate the website dashboard into understandable account, security and
  device areas. Replace the name-focused profile area with email and support ID;
  keep storage information quiet and destructive actions separated.
- Restyle the calendar publication controls using existing shared form patterns.
  Screenshot 4 shows bare white inputs/selects on the themed account page. Keep
  its full plaintext-export disclosure, opt-in consent, busy-only default and
  rotate/revoke controls. It should be secondary to account/sync status.
- Validate light/dark, theme variants, keyboard/screen reader, narrow/touch and
  short landscape layouts. Keep primary actions and source-choice decisions
  visible when the mobile keyboard is open. Honor reduced motion.

### D. Minimal account identity and support ID

Server/dashboard/SDK/client; additive compatibility first.

- Reuse `ultra_accounts.id`; expose **Account ID** with a copy button in the web
  dashboard and app settings. Pair it with server identity/origin for self-hosted
  support. Do not create a new sequential or guessable support identity.
- Remove username and display-name collection/editing and their visible labels.
  New SDK calls must work with email/password alone and a legacy default where
  needed. Do not generate placeholder personal names or random usernames.
- Retain existing nullable/defaulted storage and wire fields during the beta
  compatibility window. Removing columns or signed identity fields is a separate
  migration, not a UI cleanup. Existing sessions, vaults, records and references
  must retain their IDs. Keep legacy username sign-in compatibility server-side
  until an explicit retirement decision; stop promoting it in new UI.
- Future invitations use a dedicated email/account-ID resolver with server
  scope, authorization and enumeration controls. Do not broaden the shared login
  resolver to accept IDs or activate collaboration as a shortcut in beta.2.
- A support ID is an identifier, not a password or proof of account ownership.
  Do not send it automatically to analytics or log task content alongside it.

### E. Default new-device email verification

Server, SDK, dashboard, desktop and native mobile; requires security review.

The accepted behavior is default-on verification for unfamiliar devices with a
setting to disable it, without emailing during ordinary refresh, sync, local
unlock or already trusted-device use. Enrolled TOTP/security keys take precedence.
Call it **New-device email verification** in the UI rather than equating it with
stronger authenticator-based 2FA. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html#out-of-band)
does not accept email as an out-of-band authenticator; do not claim NIST MFA
assurance or phishing resistance for this feature.

- Design device recognition and revocation explicitly. A caller-provided device
  name, client ID, IP address or user agent is not proof of a trusted device.
  Use server-bound cryptographic recognition or a protected opaque credential;
  no fingerprinting. Bound retained device records and support revocation.
- Gate session issuance and account API access until the required challenge
  succeeds. A fresh browser-to-app approval must enforce the same policy.
  Do not weaken password-based vault encryption or put keys in mail/URLs.
- Use a separate short-lived, one-use, transactionally consumed sign-in
  challenge. Do not reuse signup's one-day verification lifetime. Specify expiry,
  bounded attempts, resend cooldown, abuse controls and generic account errors.
  Resending must not reset the attacker's attempt budget. Never log codes.
- Opt-out and trusted-device changes require recent authorization appropriate
  to the currently enrolled factor; a stolen refresh session must not disable
  protection. Email changes revoke old pending challenges and require verification.
- Preserve offline unlock and ongoing trusted sessions. Test SMTP delay/failure,
  expired/replayed/wrong codes, cancelled challenges, reinstall/revocation,
  account recovery and stronger-factor fallback. Recovery codes and vault recovery
  keys remain distinct concepts.
- New and existing accounts should receive the requested default unless an
  explicit opt-out is stored. Confirm migration/rollout details during security
  design. Add capability negotiation and a clear update-required result for
  clients that cannot handle the new challenge; never bypass it for beta.1.

### F. Global shortcut error on manual sync

Client Electron integration; investigate before changing behavior.

Reproduce on a disposable Windows profile with another process holding
`Ctrl+Shift+X`, then manual account sync and unchanged keyboard settings. Also
exercise an uncontested binding, a real keyboard config change, restart, and
duplicate mappings. Check whether snapshot application unnecessarily re-registers
unchanged global bindings, while preserving legitimate initial/imported config
changes. Mac layout normalization and Linux registration still need coverage.

Choose the smallest evidence-backed fix: avoid redundant registrations, preserve
working unrelated bindings, and give a specific shortcut-settings action for a
genuine conflict. A keyboard failure must not change account sync success or
produce the same error on every otherwise successful sync. Do not simply suppress
all shortcut failures or remove hydration/config application to hide the symptom.

### G. Naming and free account registration

Client, server UI/mail/docs and website.

Use **Ultra Tasks account** in current product copy, setup, menus, errors,
tooltips, help, email templates and the main website. Audit **UltraTasks** spacing
too. Update the generated translation constants through their owner script;
change English translations only except when adding interpolation placeholders.

Do not blindly rename packages, repositories, Docker images, API routes, local
storage namespaces, provider enum values, crypto contexts, existing anchors or
historical release notes. “SuperSync” still names the distinct upstream provider
where migration/compatibility documentation needs it.

On the landing page, add a prominent near-hero account message and a clear
**Create free account** action using the existing signup-link builder. Explain
private cross-device sync in installed apps and retain the no-account-needed
offline/local browser option. Avoid a second competing primary action or
implying browser account sync is live. Advertise free registration now without
inventing unlimited storage, finalized paid tiers or free hosting guarantees.
The maintainer's existing always-free-plan intention can remain, alongside
honest beta and pending independent-review language.

Update home, FAQ, comparison text, download page, metadata, privacy policy and
account guide together. Preserve calendar plaintext exceptions, optionality,
operator identity/contact and existing download redirects. Website publishing
remains a separate release step; this audit authorizes documentation only.

### H. Persistent sign-in and explicit reconnect state

Priority: next-beta blocker; client, desktop protected storage, SDK and server.

- Restore an existing trusted-device session and vault access after normal app
  restart, update and OS sleep/wake, without requesting the password again.
  Build on OS-protected storage and revocable device sessions; never store the
  account password, plain vault key or reusable credentials in renderer storage.
  The existing pending-browser-login store must not be mistaken for this feature.
- Keep local task access and unsent edits intact if protected storage/keychain
  is temporarily unavailable. Show **Unlock to resume sync** or a specific
  reconnect state, preserve the configured account, and offer a recovery action.
  Do not silently reset it to an unconfigured account or clear stored credentials.
- Short-lived access credentials should renew automatically. Implement the
  maintainer's persistent-login expectation as renewable, revocable trusted
  sessions, not an immortal access token. Revisit the current hard 90-day / idle
  30-day session limits so ordinary calendar age does not force a surprise login.
  Bound refresh receipts/device metadata even when a trusted login lasts years.
- Keep recent-auth requirements for security-sensitive operations separate from
  routine sync. Automatic renewal must not turn an old sign-in into a fresh
  authorization to remove 2FA, change credentials or delete an account.
- Resume sync once after wake/foreground/network recovery, serialize refresh,
  safely retry transient failures and distinguish them from explicit revocation
  or terminal authentication errors. Test response-loss ambiguity for single-use
  refresh credentials without simply replaying them or disabling reuse checks.
- Connect the safety reminder, header, Account settings and native account page
  to the shared presentation state. A configured account, including a locked,
  offline or reconnect-needed one, is not eligible for a new-user setup nudge.
  True reauthentication needs a visible, durable, actionable notification.
  Ordinary offline periods need calm status and automatic recovery, not repeated
  modal prompts or success/failure toasts on every background attempt.
- Reproduce quit/relaunch with a valid server session, overnight sleep with an
  expired access token, suspended requests, network unavailable at wake, keychain
  unavailable, explicit remote revocation, server restart and update. Prove the
  same configured account returns and pending edits sync once after recovery.
  Record what initiated an unexpected restart where reliable platform lifecycle
  events are available, without logging secrets or user content.

## Required sync status behavior

These are user-facing states, not a demand to persist another synced status model.
Derive them from actual engine events, pending work and confirmed local commits.

| Condition                                                     | At-a-glance status and next action                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No account/provider configured                                | Local only; optional **Sign in**.                                                              |
| Authentication in progress                                    | Signing in / verifying device; cancel or retry on failure.                                     |
| Vault accessible but source undecided                         | **Choose data to connect**; focused choice, no success badge.                                  |
| Existing account on empty device                              | **Downloading your tasks** then **Applying your tasks**; show bounded counts only if measured. |
| Upload/download running                                       | **Syncing changes** with stage if known; no fabricated percentage.                             |
| Initial apply and persistence finished, no pending/error work | **Up to date**, plus last successful sync in details. Only then leave first-sync loading.      |
| Account is genuinely empty after a successful complete fetch  | **Up to date — no tasks yet**; distinguish this from an incomplete fetch.                      |
| Offline with local edits                                      | **Offline — changes saved on this device**, with pending work available in details.            |
| Locked or expired/revoked session                             | **Unlock to sync** or **Sign in again**, retaining the configured identity.                    |
| Error/stalled work                                            | Specific failure and **Retry**; preserve local edits and keep the indicator visible.           |
| Live connection established                                   | Connection detail only; a socket being open is not proof that tasks have synced.               |

Clear stale success at the start of new work, show failure ahead of a prior
“Sync complete” label, and make an interrupted initial download resumable.
Use polite accessible status announcements at meaningful transitions, not per
record. Do not promise continuous iOS background sync; describe foreground,
unlocked and OS background limits accurately. Local editing must remain useful
offline and errors must not make a blank list look like a verified empty account.

## Compatibility and data safety

The identity API and new email challenge are long-lived contracts. Check older
SDK/client behavior, signed author/invitation data and native/browser login
handoff explicitly. The server owns `packages/account-crypto`; publish/update it
through that repository and update the client's consumed SDK. Do not edit
vendored/generated copies or add root dependencies.

The source-choice and sync-presentation work must preserve one intent/one op,
pending edits, archive contents, recovery points, account generations and
replacement guards. No schema-version bump is needed just for naming or visual
status. If implementation changes actual synced state/wire behavior, follow the
[contributor model](../sync-and-op-log/contributor-sync-model.md), write the exact
real-path failing E2E first, and prove preservation/convergence before shipping.
Do not reset the maintainer's account, upload an empty mobile dataset, clear app
storage or import a backup to reproduce a cosmetic problem.

## Acceptance and next beta delivery

### Mandatory scenario matrix

1. A desktop with existing tasks signs in and migrates; verify tasks, subtasks,
   projects, notes, time history, archives and later edits survive.
2. A fresh iPhone signs in to that populated account through Settings after
   dismissing initial setup. It automatically downloads the account copy, shows
   first-sync progress and displays tasks without hunting for another button.
   Repeat direct password and browser-return sign-in, including MFA cancellation.
3. Repeat on Android and desktop. Test truly empty local state, default examples,
   genuine local tasks, both-populated conflict, empty account and discovery
   timeout. A required choice is immediate, focused, accessible and resumable.
4. During slow/disconnected/failed download, malformed data/decryption failure,
   account revocation and offline edits, every surface shows the same truthful
   state. Failed/partial fetch must not initialize an empty personal scope.
5. Manual sync on header/Account/settings reaches the active engine once.
   Native account sync does not depend on the legacy provider-enabled flag.
   OneDrive/WebDAV and existing SuperSync settings and recovery remain usable.
6. Reproduce the shortcut conflict before fixing it, then prove successful sync
   remains successful and unchanged settings do not produce repeated keyboard
   errors. Test real initial registration and changed shortcuts still work.
7. New signup has no username/display-name questions; old accounts retain IDs,
   keys, encrypted data and working sessions. Copying support ID works on web,
   desktop, iOS and Android without exporting credentials.
8. Email device verification passes the security matrix in work package E,
   including beta.1 compatibility/refusal, opted-out accounts and stronger MFA.
9. Official/custom server switching, narrow screens, keyboard navigation,
   screen-reader status and the themed calendar section pass the visual matrix.
10. Website naming, **Create free account** visibility, correct signup/download
    links, honest browser capability and privacy disclosures match the release.
11. An account remains signed in through desktop quit/relaunch, update and
    overnight sleep/wake with automatic credential renewal. The account setup
    reminder never appears for a configured native account. Temporary failures
    recover automatically with visible status; terminal revocation shows a clear
    reconnect action and preserves local edits. Verify the chosen renewable
    lifetime policy with an advanced clock and bounded refresh/device storage.

### Tests and evidence from this audit

- Focused `native-sync.service.spec.ts`: **14 passed**, November 18, 2026.
  The first attempt could not create a temporary test assets directory; the
  rerun with appropriate local build access passed. This does not reproduce
  the physical iPhone UI or prove any proposed behavior has been implemented.
- Follow-up `sync-safety-banner.service.spec.ts`: **12 passed**. This existing
  suite covers legacy-provider eligibility; it does not model a connected native
  account and does not disprove or fix the reminder bug identified above.
- Static traces and beta.1 source comparison above; four maintainer screenshots
  and follow-up confirmation of the missed source-choice step.
- Follow-up desktop diagnosis used filtered lifecycle timestamps from the local
  app log and read-only aggregated server session expiry/revocation metadata.
  No personal account contents, tokens or password data were exported. The
  account/session investigation did not change or revoke any session.
- Read-only public sign-up review in an isolated ChatGPT browser confirmed
  the current extra identity fields. No account created, settings changed or
  personal browser profile used. The account dashboard after login was audited
  from its source and prior screenshots; no new authenticated visual trial.
- No new physical-device test, OS shortcut-owner test, mail-code implementation,
  full provider suite or specialist security audit is claimed by this document.

Useful existing tests/owners:

- Client: `native-sync.service.spec.ts`, `native-sync.component.spec.ts`,
  `native-personal-bridge.service.spec.ts`, header/config-page component specs,
  `global-config.effects.spec.ts`, Electron `*.test.cjs` patterns and
  `e2e/tests/sync/ultrasync-provider-migration.spec.ts` / late-edit / offline
  replacement cases. Read `e2e/AGENTS.md` before running provider suites.
- Server: `apps/server/tests/ultra-accounts.spec.ts`,
  `ultra-accounts.browser.spec.ts`, `better-auth.browser.spec.ts`,
  `browser-login.spec.ts`, `private.browser.spec.ts` and the SDK tests.
- Website: `npm run check`, `npm test`, `npm run build`;
  `npm run release:verify` once the complete next release assets exist.

### Release order and gates

Keep the next-beta work coordinated across all three repositories. Before
enabling a new sign-in requirement, agree the SDK/capability rollout so existing
clients cannot bypass it or receive an unexplained broken sign-in. Preserve
currently valid sessions and operator identity/secrets. Do not infer a server
release number from the client's version.

Release candidates must cover Windows x64/ARM64 installer and portable, signed
and notarized Mac artifacts, Linux packages, signed Android beta artifacts,
iOS TestFlight, and the standalone/hosted web bundle. Inspect current platform
workflow inputs, store state and credentials before dispatch. The Android store
submission hold remains in effect until the maintainer lifts it; “all platforms”
does not authorize silent store approval/promotion. This audit itself does not
authorize publishing any candidate.

Run focused checks while implementing, then required full release workflows,
provider migration/released-client compatibility, native device acceptance and
the new first-sync/shortcut reproductions. Keep observed failures attached to
the relevant package; skipped tests are not passes. Sync changes require the
repository's fresh-context review before they are ready.

Before server rollout take paired, encrypted, off-machine backups and verify
recovery. Deploy the accepted immutable image and migrations with operator
configuration preserved. Install the matching web bundle, verify account/API/
calendar/OAuth routes with an active worker and offline loading after prefetch.
Only update release download manifests after complete artifacts are published.
Prepare/review website changes and follow its deployment approval policy.
Keep physical calendar-client acceptance and independent crypto review visible
as separate beta follow-ups rather than silently declaring them completed.

## Starting the next session

1. Read this document, current `AGENTS.md` files and the three repositories'
   status/revisions. Check for concurrent work and do not overwrite it.
2. Start with a synthetic populated desktop account and pristine mobile client;
   turn the confirmed Settings sign-in/source-choice incident into a failing
   end-to-end regression. Do not reproduce against the maintainer's dataset.
3. Define one presentation state contract and implement the safe empty-device
   path, immediate choice dialog and shared header/Account/settings feedback.
4. Reproduce and fix shortcut re-registration separately. Then implement the
   persistent-sign-in/reconnect work, identity simplification, naming and
   dashboard/calendar polish. The safety reminder joins the shared status fix.
5. Design/review email new-device verification and its old-client rollout before
   switching on the default. Finish website promotion/copy and release checks.

Remaining implementation choices are the precise pristine-data predicate,
progress events/counts, trusted-device expiry/revocation design and exact next
server/SDK versions. The accepted user decisions above do not need to be asked
again. No answer about a choice dialog is missing: the maintainer confirmed the
missed prompt and explicitly requested automatic account download on an empty
device and a prominent immediate choice when needed.
