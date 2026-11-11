# OAuth-first connections: integration audit and setup model

**Status:** Audit and plan, 2026-11-10. One step shipped: **Sign in with Nextcloud** in sync setup (see [Shipped in this pass](#shipped-in-this-pass)). Everything else is a proposal for the maintainer.
**Builds on:** [unified integrations](2026-11-08-unified-integrations.md) (setup flow, Import/Sync modes) and the [0.3.0 sign-in contract](2026-11-07-ultrasync-0.3.0-release.md#sign-in-contract).
**Coordinated with:** the server collaboration planning session. Its reply is `docs/coordination/2026-11-10-integrations-oauth.md` on branch `claude/server-collaboration-plan-4cl6x6` of [ultra-tasks-server](https://github.com/ultra-tasks/ultra-tasks-server). The [shared model](#the-shared-model-integrations-and-collaboration) below takes its constraints.

Goal: a user connects an integration or a sync target by signing in on the provider's own page. Pasting a token becomes the fallback for self-hosted instances and providers without a usable OAuth client.

## Sections

- [Audit findings](#audit-findings)
- [Per-provider inventory and target](#per-provider-inventory-and-target)
- [Auth methods in preference order](#auth-methods-in-preference-order)
- [The shared model: integrations and collaboration](#the-shared-model-integrations-and-collaboration)
- [Registrations the maintainer has to make](#registrations-the-maintainer-has-to-make)
- [Delivery sequence](#delivery-sequence)
- [Shipped in this pass](#shipped-in-this-pass)
- [Decisions for the maintainer](#decisions-for-the-maintainer)
- [Prior art and sources](#prior-art-and-sources)

## Audit findings

Code read on 2026-11-10. No live provider accounts were used, so provider-side rules below come from vendor documentation and are flagged where unconfirmed.

1. **Only three connections use OAuth.** The Google Calendar plugin (`packages/plugin-dev/google-calendar-provider/src/plugin.ts:405-422`) and the Dropbox and OneDrive sync providers. Every other integration asks for a pasted token, API key or password.
2. **Pasted credentials sync to every device.** Built-in providers (Jira, GitLab, OpenProject, Plainspace, CalDAV Todo) keep them in the `issueProvider` slice. Plugin providers keep them in `IssueProvider.pluginConfig` (GitHub, Gitea, Linear, ClickUp, Trello, Azure DevOps, Redmine, Nextcloud Deck, CalDAV Calendar). Both are synced state. Under UltraSync they travel inside the E2EE personal scope. Under WebDAV or OneDrive they are protected only if the user enabled encryption. Known since [secure-storage.md](../long-term-plans/secure-storage.md). Plugin OAuth tokens (`sup-plugin-oauth`) and sync-provider credentials (`sup-sync`) are per device.
3. **The shipped OAuth registrations belong to upstream Super Productivity.** The Google client ids (`637968426975-…`) and the Dropbox app key (`dropbox.const.ts:3`) are identical on `upstream/master`. Consent screens therefore name the upstream project. Google's Android client is bound to the upstream package name and signing key, so it cannot match `app.ultratasks` (`android/app/build.gradle:19`). Google Calendar sign-in on the Ultra Tasks Android build needs its own registration. Not tested on a device.
4. **Mobile sync OAuth is paste-the-code.** Dropbox has no redirect on any platform (`dropbox.ts:318-330`). OneDrive captures the callback automatically only on Electron (`onedrive.ts:639-644`). `DialogGetAndEnterAuthCodeComponent` hardcodes `isNativePlatform = false` (`:66-70`).
5. **Nextcloud asked for a hand-made app password.** That covers the deprecated Nextcloud sync provider, WebDAV on Nextcloud, Nextcloud Deck and CalDAV on Nextcloud. Nextcloud's Login Flow v2 removes that step and needs no client registration. This pass ships it for sync setup.
6. **OAuth plumbing is Google-shaped.** Per-connection token scoping is hardcoded to the Google plugin id (`plugin-oauth-token-key.util.ts:1-18`). The refresh token is never replaced after a refresh (`plugin-oauth.service.ts:366-370`), which breaks providers that rotate refresh tokens. The manifest `oauth` permission is declared but not enforced (`plugin-security.ts:275-288`).
7. **There is no device-code (RFC 8628) and no broker path.** The only flow is Authorization Code + PKCE with a redirect. Providers that need a confidential client cannot use OAuth today.
8. **Dead file.** `src/assets/android-oauth-callback.html` deep-links to the old `com.super-productivity.app://` scheme. Nothing references it.

## Per-provider inventory and target

"Public client" means PKCE with no secret, shippable in the app. "Broker" means a confidential client whose secret lives on a server (see [auth methods](#auth-methods-in-preference-order)). "Per instance" means every self-hosted server needs its own registration, so the token path stays primary there.

| Connection                 | Today                                  | Best available sign-in                                                   | Needs                                                                        | Notes                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                     | Optional PAT                           | **Device flow** (no secret, no redirect)                                 | Ultra Tasks OAuth App or GitHub App with device flow enabled                 | GitHub documents `client_secret` as required for the web-flow code exchange even with PKCE, so a public web flow is unconfirmed. Device flow polling takes `client_id` + `device_code` only. github.com has no CORS on those endpoints, so this is desktop and mobile only. GitHub Enterprise Server is per instance. |
| GitLab.com                 | PAT                                    | Public client (non-confidential app)                                     | Ultra Tasks app on gitlab.com                                                | GitLab docs show the token exchange without a secret when PKCE is used. Self-managed GitLab is per instance.                                                                                                                                                                                                          |
| Linear                     | API key                                | Public client                                                            | Ultra Tasks Linear OAuth app                                                 | Linear's PKCE section marks `client_secret` optional. Fits `OAuthFlowConfig` including `webClientId`. Verify with a real exchange.                                                                                                                                                                                    |
| Jira Cloud                 | API token (Basic)                      | Broker                                                                   | Atlassian 3LO app + broker                                                   | Cloud 3LO uses a secret; PKCE for Cloud is an open Atlassian request (ECO-283). Jira Data Center supports PKCE public clients, but per instance.                                                                                                                                                                      |
| Trello                     | API key + token pasted                 | Public client, or the existing Trello authorize page                     | Ultra Tasks Power-Up key / OAuth 2.0 app                                     | Trello OAuth 2.0 (announced 2026-09-15) offers public or confidential clients; the old flow remains supported. Even without OAuth 2.0, the authorize page can return the token, so nobody has to copy it by hand.                                                                                                     |
| ClickUp                    | API key                                | Broker                                                                   | ClickUp app + broker                                                         | ClickUp's token exchange requires a secret.                                                                                                                                                                                                                                                                           |
| Azure DevOps               | PAT                                    | Public client via Microsoft Entra ID                                     | Entra app registration (the OneDrive one can be extended)                    | Azure DevOps OAuth takes no new registrations and is being retired; Entra is Microsoft's replacement. Scope id and PKCE behavior still to be confirmed.                                                                                                                                                               |
| Gitea / Forgejo            | Token                                  | Public client, per instance                                              | Each server's admin                                                          | Keep token primary; offer "use my server's OAuth app" in Advanced.                                                                                                                                                                                                                                                    |
| Redmine                    | API key                                | Token (OAuth provider exists in newer versions, per instance)            | —                                                                            | Keep token.                                                                                                                                                                                                                                                                                                           |
| OpenProject                | API key                                | Token, or per-instance OAuth app                                         | —                                                                            | Keep token.                                                                                                                                                                                                                                                                                                           |
| Nextcloud Deck             | Username + password                    | **Login Flow v2**                                                        | Nothing                                                                      | Needs a host-side sign-in for plugins; see [step 3](#delivery-sequence).                                                                                                                                                                                                                                              |
| CalDAV (Todo and Calendar) | Username + password                    | Login Flow v2 when the server is Nextcloud; app password otherwise       | Nothing                                                                      | iCloud and Fastmail need app-specific passwords; link to them instead of asking for the account password.                                                                                                                                                                                                             |
| Plainspace                 | Personal token                         | Browser hand-off via the existing `ultratasks://plainspace-connect` link | Plainspace-side change                                                       | Today the link only focuses the window.                                                                                                                                                                                                                                                                               |
| iCal feeds                 | Secret URL                             | —                                                                        | —                                                                            | Not an account. For Outlook/M365, a Microsoft Graph calendar connector would replace the feed, but that is new scope and needs demand first.                                                                                                                                                                          |
| Google Calendar            | OAuth (upstream registration)          | OAuth (own registration)                                                 | Ultra Tasks Google Cloud project, brand verification for the calendar scope  | Web needs a confidential client, so web stays off unless the broker exists.                                                                                                                                                                                                                                           |
| Dropbox sync               | OAuth, paste code (upstream app key)   | OAuth with redirect                                                      | Ultra Tasks Dropbox app with `ultratasks://` and `app.ultratasks:` redirects | Deprecated for new setup; only needed if it stays offered.                                                                                                                                                                                                                                                            |
| OneDrive sync              | OAuth (env client id); paste on mobile | OAuth with automatic mobile callback                                     | `app.ultratasks://oauth-callback` registered on the Entra app                |                                                                                                                                                                                                                                                                                                                       |
| WebDAV / Nextcloud sync    | Username + app password                | **Login Flow v2** for Nextcloud servers, shipped                         | Nothing                                                                      | Other WebDAV servers keep username/password.                                                                                                                                                                                                                                                                          |
| UltraSync                  | Account sign-in                        | —                                                                        | —                                                                            | Separate by contract: integration OAuth never reuses account sessions or callback routes.                                                                                                                                                                                                                             |

## Auth methods in preference order

Setup offers the first method that works for the provider, the platform and this build. Lower methods stay available under "Use a token instead".

1. **Public client in the app.** Authorization Code + PKCE (existing plumbing), or the device flow where the provider has no public redirect flow (GitHub). No server is involved. The client ids come from build configuration, like `ONEDRIVE_CLIENT_ID` today (`onedrive-auth-mode.const.ts`). A build without a registration hides the button instead of showing a broken one.
2. **Browser app-password flows** that need no registration: Nextcloud Login Flow v2. Same user experience as OAuth.
3. **Broker**, only for providers that require a confidential client (Jira Cloud, ClickUp, Google on web). Per the server session this is **not server v1**. It is a post-1.0.0 module, off unless the operator configures registrations, and advertised by a capability flag (for example `oauthBroker: ["atlassian", "clickup"]`). The UI must say plainly that tokens pass through the Ultra Tasks server in transit; this is a policy promise, not covered by the E2EE claims. A self-hosted server never falls back to the official broker automatically; at most it is an explicit, labeled choice. Users without an account keep the token path.
4. **Advanced token.** Always available. It is the primary path for self-hosted instances (GitLab self-managed, Gitea, Redmine, OpenProject, Jira Data Center), where no single registration can exist.

## The shared model: integrations and collaboration

The server session reports that the maintainer leans toward **local-only integrations**: the device holding a connection talks to the provider, and sync carries only the resulting tasks. The two sessions propose this model, pending the maintainer's decision:

**Connections (personal)**

- **A connection definition syncs, but its credentials do not.** Provider, scope, mode, field policy, mappings and the owner device all sync. Tokens, app passwords and OAuth grants stay in per-device stores (`sup-plugin-oauth`, `sup-sync`, `setSecret`).
- **One owner device per connection**, recorded in the synced definition. Only the owner polls and writes back. Other devices show "Connected on ‹device›" with **Move to this device** (one sign-in). This answers the unified plan's open "one writer per connection" gate.
- **Edits made elsewhere reach the provider on the owner's next poll.** The owner compares current task state with the stored provider baseline. Replayed or remote ops never trigger provider writes (contributor sync model, rule "one user intent = one op").
- **Optional later: "Carry my sign-ins to my devices".** An E2EE personal-scope record, off by default, available only with account sync, and only for providers whose refresh tokens do not rotate. It must be excluded from file-provider sync. It changes who can sign in quickly, not who writes: ownership still moves explicitly. Before building it, check whether Android's background `nativeScopeCredentials` can decrypt the personal scope. Server cost is negligible (a record under 1 KiB). Deleted ciphertext stays in manifest history for up to 30 days, still encrypted.
- **Moving today's synced credentials out of `issueProvider` / `pluginConfig`** is a persisted-model change. Older clients keep syncing and polling with the old fields until they upgrade, so migrate by copying into the local store on upgrade and clearing the synced field only after the connection is owned, with an E2E across a released client.

**Shared projects (after server 1.0.0)**

- **Credentials never enter shared scopes, provenance, synced project metadata, logs or URLs.**
- **A shared task may carry a link:** provider kind, public permalink and remote id, plus the **writer member id**. Only the writer pushes to the provider. Changing the writer is an explicit claim. If the writer leaves, is removed or becomes a viewer, the link turns read-only until someone claims it.
- **Show what members will see before linking**, because a permalink can reveal a private repository or organization name.
- **Provider updates pulled by the writer are ordinary shared edits** through the normal revision and merge path. Personal fields (due dates, time, notes) stay in each member's private overlay and are never pushed on the project's behalf.
- **Blocking constraint:** `validateSharedRecord` (server `packages/account-crypto/src/shared-project.ts`) fails closed on unknown fields and record types. Define the link record, or make unknown fields degrade gracefully, **before** sharing ships. It is cheap now and permanent later.
- **Dependency:** shared tasks are not yet visible to IssueService, plugins, REST or MCP. Links wait for scope-aware references.

## Registrations the maintainer has to make

Only the maintainer can do these; the code cannot ship them. Each is under the Ultra Tasks name, with redirects `http://127.0.0.1` (loopback, any port), `ultratasks://…` (desktop) and `app.ultratasks:/…` (mobile), plus `https://app.ultratasks.app/oauth/callback/<provider>` for web once that page exists. The web callback path must stay outside `/account`, with no secrets on the page, the code removed from the address bar first, and `Referrer-Policy: no-referrer`.

1. Google Cloud project: desktop, Android (`app.ultratasks` + release SHA-1), iOS clients; brand verification for `calendar.events` (sensitive scope) and a privacy policy.
2. Microsoft Entra app: extend the OneDrive registration with Azure DevOps delegated permission and mobile redirects.
3. GitHub OAuth App or GitHub App with device flow enabled.
4. GitLab.com non-confidential application.
5. Linear OAuth app (PKCE).
6. Dropbox app, only if Dropbox stays offered beyond the migration window.
7. Trello OAuth 2.0 public client, or a Power-Up key for the authorize page.
8. Broker-only, post server 1.0.0: Atlassian 3LO and ClickUp apps.

## Delivery sequence

Each step is independent and keeps the token path working.

1. **Done: Sign in with Nextcloud for sync** (WebDAV and the deprecated Nextcloud provider).
2. **Generalize build-time registrations.** One `OFFICIAL_OAUTH_CLIENTS` map from env (pattern of `ONEDRIVE_CLIENT_ID`), injected host-side into plugin `oauthButton` configs so bundled plugins don't hardcode ids. Generalize `shouldScopePluginOAuth` beyond Google. Store a rotated refresh token when the provider returns one.
3. **A host-side "browser sign-in" field for plugins** (Nextcloud Deck, CalDAV on Nextcloud), reusing the Login Flow helper. This adds to the plugin API (a new field type or flow kind), which is permanent: review it under [long-term cost](../feature-review-guide.md#long-term-cost-of-a-change). Keep the shape generic (`browserSignIn: 'nextcloud-login-v2'` writing named config keys), not Nextcloud-specific API.
4. **Linear, then GitLab.com** with public clients, after the registrations exist. Both fit the existing `OAuthFlowConfig`.
5. **GitHub device flow**: a small code-display step in the setup dialog plus polling. Desktop and mobile only.
6. **Mobile callbacks for OneDrive** and, if kept, Dropbox: register the `app.ultratasks:` redirects and route them through `OAuthCallbackHandlerService`, which already handles plugin callbacks.
7. **Owner device and credential migration**, after the maintainer confirms the model. This is the largest step and the only one touching synced state; it needs the two-client E2E reproduction the sync rules require.
8. **Broker** (Jira Cloud, ClickUp), as a capability-gated server module after server 1.0.0.

Setup UI, across all steps: the integration picker shows **Sign in with ‹provider›** as the primary action. "Use a token instead" sits below it, together with the existing help links. No new settings and no notifications.

## Shipped in this pass

**Sign in with Nextcloud** (Nextcloud Login Flow v2) in sync setup, for both the WebDAV form and the deprecated Nextcloud form:

- `packages/sync-providers/src/file-based/webdav/nextcloud-login-flow.ts`: start, poll, URL normalization, DAV URL builder. The poll token and the returned credentials are refused if they name a different host than the one entered, or downgrade https to http. Polling stops on abort, after 20 minutes, or on any error other than "not yet approved" (404).
- `src/app/op-log/sync-providers/file-based/webdav/nextcloud-login-flow.ts`: opens the login page in the system browser (Electron, Capacitor or web), waits, then reuses `discoverNextcloudUserId` for the canonical WebDAV user id.
- `dialog-sync-cfg.component.ts`: the button sits right after the server or base URL field and fills the form for review; nothing is saved automatically. Polling is cancelled when the dialog closes.
- Wiki: [Configure Sync Backend](../wiki/2.09-Configure-Sync-Backend.md).

Tested with unit tests against scripted HTTP responses, not against a live Nextcloud server. In the web build, Nextcloud must allow CORS, the same limitation the existing WebDAV form already describes.

## Decisions for the maintainer

1. **Owner device per connection (local-only integrations)** versus the earlier "any device with a credential fetches". Step 7 depends on this.
2. **Register Ultra Tasks' own OAuth apps**, starting with Google (the current Android client cannot match this app) and the providers in step 4.
3. **The broker** as a post-1.0.0 server module, or never: never would mean token-only for Jira Cloud and ClickUp.

## Prior art and sources

Vendor documentation, checked November 2026; no hands-on product tests.

| Product                                                                                                                            | What it does                                                                                                                                                                                                                                               | Take / don't                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [GitHub CLI](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)                                | Device flow: shows a code, user approves on github.com                                                                                                                                                                                                     | Take for GitHub; no secret, no redirect.    |
| [Nextcloud desktop and mobile clients](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html) | Login Flow v2: browser sign-in, per-device app password                                                                                                                                                                                                    | Take; shipped for sync.                     |
| Linear, GitLab, Trello                                                                                                             | PKCE public clients ([Linear](https://linear.app/developers/oauth-2-0-authentication), [GitLab](https://docs.gitlab.com/api/oauth2/), [Trello announcement](https://community.developer.atlassian.com/t/oauth-2-0-3lo-is-now-available-for-trello/102691)) | Take, after registration.                   |
| Atlassian Cloud 3LO                                                                                                                | Confidential client; PKCE request [ECO-283](https://jira.atlassian.com/browse/ECO-283) open                                                                                                                                                                | Broker or token; don't embed a secret.      |
| [Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth)                          | Legacy OAuth retired; Entra ID instead                                                                                                                                                                                                                     | Take Entra; don't build on the legacy flow. |

Other sources: [GitHub PKCE changelog, 2025-07-14](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/); [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html); [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628).
