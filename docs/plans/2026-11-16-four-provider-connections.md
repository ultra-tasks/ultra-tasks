# Four-provider connections for 0.4.0

Status: implementation and local acceptance complete; two-client CI and live-account acceptance remain open.

Scope: [release checklist C2](2026-11-12-ultratasks-0.4.0-release.md#c2-integration-write-back-for-the-four-providers). Existing integration setup, field policies, serialized external writes and local credential stores are reused. No root or runtime dependency, operation kind, entity membership list or schema version is introduced. GitHub/Linear test packages explicitly declare the Vitest version already used in the plugin workspace.

## Implementation

- Official public client registrations are supplied by `OAUTH_<PROVIDER>_CLIENT_ID` repository variables and mapped to `<PROVIDER>_OAUTH_CLIENT_ID` build environment variables. The shared map hides unavailable registrations and keeps token entry. No client secret is shipped.
- GitHub uses device authorization on desktop/mobile. GitLab.com, Linear and Trello use PKCE; Trello token requests use JSON. Rotated refresh tokens are persisted. GitHub's non-expiring device token can be restored without a refresh token.
- Pasted credentials on new connections are local. A previously synced credential is retained for released-client compatibility; replacements stay local. OAuth and pasted credentials are scoped to the connection and source origin. Official GitHub/GitLab grants never authenticate custom/self-managed hosts.
- New official connections store optional `integrationOwnerId` and `integrationOwnerLabel`. Missing ownership preserves legacy behavior. Only the owner contacts the source. Peer edits remain ordinary task edits; a source refresh on the owner drains pending values after applying source changes. No effect subscribes to remote actions. Explicit Move requires local authentication and Save; requests already in flight may finish.
- GitLab adds explicit completion/title/description write directions and opt-in creation. Existing completion behavior remains unchanged until field policies are saved. Weight stays weight. Writes validate the instance/project scope, including numeric project configuration.
- Linear updates only requested title/description/completion fields. Completion selects the issue team's completed workflow state; cancellation and other states are retained unless completion changes. Creation selects a team and optionally a separate project.
- Trello keeps archival completion as the default, with an explicit alternative that moves to a Done list on the configured board. Reopening moves to the default list and unarchives. Both lists are checked before writing.
- GitHub preserves released numeric issue IDs, with identity scoped by connection, API instance and repository. Changing to a repository-qualified wire ID would break released plugins and import deduplication. PR inclusion remains optional. Label/tag mapping is off by default, scoped to the connection, preserves local tags, and assigns only repository labels that already exist.
- Full source details seed an imported task's baseline through the common import path, including task search and automatic backlog imports. The new browser reproduction failed on all three plugin providers when search summaries were used: the decorated summary title differed from the source title, so the first edit was skipped. Source actions wait for connector registration after reload.

## Registration callbacks

These are required by the implementation; unauthenticated probes do not prove that every callback is configured correctly in the provider consoles.

| Platform                       | Callback                                                    |
| ------------------------------ | ----------------------------------------------------------- |
| Desktop GitLab, Linear, Trello | `http://127.0.0.1:18194/plugin-oauth-callback`              |
| Browser GitLab, Linear, Trello | `<app origin>/assets/oauth-callback.html`                   |
| Native GitLab, Linear          | `app.ultratasks:/plugin-oauth-callback`                     |
| Native Trello                  | `https://ultratasks.app/oauth-callback/` (then app handoff) |
| GitHub                         | Device flow must be enabled; no redirect callback is used.  |

## Compatibility and maintenance

Ownership and the GitLab creation option are optional persisted fields with runtime defaults; frozen-state compatibility is checked without altering the frozen fixture. Existing generic single-entity provider/task updates carry ownership and baselines. Reordering preserves the new metadata. There is no new sync conflict route or whole-dataset stop. The internal field-mapping context gains optional local tag-scope information; the published plugin API is unchanged.

Older clients ignore ownership metadata. New connections contain no synced credential, preventing authenticated writes there, but ownership UI and contact gating require 0.4.0 on connected clients. Existing synced credentials are not silently removed. Reauthenticating on another device does not copy a credential through task sync.

Creation remains off by default. Its existing serialized local-action path rereads task identity before creating/linking; no automatic retry after an uncertain create is added. Multi-device sign-in, deterministic creation receipts and projected recurring calendar instances remain outside 0.4.0.

## Acceptance

Local evidence: 484 focused Angular tests in the clean review checkout, covering frozen data, reordering, ownership, credentials, pending writes, GitLab, adapters and bridge. Final dialog/GitLab checks pass 24 tests; reconnect-dialog/form checks pass 43; common import and legacy-provider regressions pass 59. Provider checks pass 31 tests and all three package type checks. The combined browser run passes 22 cases: four-provider field round-trips, creation, permission recovery, delayed writes/Stop, Trello Done lists, three PKCE flows with persisted grants, and existing integration-workspace regressions. The four field round-trips also pass after moving baseline normalization into the shared import path. Counts overlap between focused Angular runs and are not additive.

The clean production web and standalone builds pass the unchanged budget. The web build is 6.08 MB initial. The settings dialog is loaded on demand from the calendar reconnect action instead of being included in startup. `test:affected --list` requires the full suite because `package.json` changed; the existing full-local-test exception remains unresolved and is not counted as a pass. Two-client SuperSync acceptance must run on GitHub because Docker is unavailable on this Windows host. Keep C2 open until live-account acceptance is recorded.

The [full GitHub validation run](https://github.com/ultra-tasks/ultra-tasks/actions/runs/43844851972) passes its unit and lint jobs. The first [focused scheduled run](https://github.com/ultra-tasks/ultra-tasks/actions/runs/43843676663) exposed a missing committed refresh-button readiness binding after reload and an incompatible dynamic `file-saver` export. The button now waits for connector registration; calendar export reuses the existing cross-platform download helper. The corrected standalone release build passes five UI-only browser cases, including three PKCE sign-ins with restored grants and the calendar export lifecycle. Its initial bundle is 6.06 MB, within the unchanged budget. These mocked-network tests disable service workers so offline caching cannot bypass their provider routes; development-only store assertions are not run against release builds.

All four initial two-client cases stopped before provider setup because a sync-button tooltip covered Connect. The integration navigation helper now moves the pointer off the old page before navigating. The corrected two-client run is still required; these initial failures are not evidence of successful handoff.

The [next focused run](https://github.com/ultra-tasks/ultra-tasks/actions/runs/43848245836) passes all 22 regular cases and GitLab's two-device case. GitHub, Linear and Trello reproduce a fresh-device runtime gap: enabled plugin metadata received after discovery did not activate the bundled connector, so the pending-owner UI had no adapter. A separate runtime reconciler now starts connected bundled providers after replay using existing enabled metadata, without emitting another metadata action. Uploaded plugins and native-execution plugins are excluded. The task status observes registry registration changes. The two-device reproduction must pass before this fix is accepted.

The [full CI baseline](https://github.com/ultra-tasks/ultra-tasks/actions/runs/43848251792) is green, including both unit-test time zones, provider package checks, lint, all regular browser shards, WebKit smoke and PWA checks. This run predates the final runtime reconciler. Follow-up fresh-context review reproduced three disable-during-load failures and two later-disable failures before their fixes. Eleven runtime tests now pass: settled disabled metadata unloads only the trusted bundled connector class, and completion rereads settled metadata after an in-flight activation. Missing metadata and transient replay values do not unload a runtime. Neither path emits another synced metadata action.

## Review

Fresh-context review fixed four findings: new pasted GitHub/GitLab credentials now bind to the source origin; queued pending requests are cancelled after Stop or relinking; legacy GitHub label mapping preserves local tags; and normally registered plugin adapters enforce ownership, including deletion. The relink/Stop/tag tests reproduced three failures before their fixes. Review validation passes 484 Angular and 31 provider tests; the bridge remains at its previous physical line count.

The numeric GitHub identity tradeoff was reviewed separately. Saved GitHub repositories/API servers and GitLab servers are fixed in settings; Duplicate creates a fresh identity, clears copied credentials/ownership, and turns creation off. GitLab project, Trello board and Linear team/project remain editable because their remote IDs do not alias in the same way. No review finding was deferred in the implemented scope; real-account registration and acceptance remain unverified gates.

The browser OAuth tests intercept authorization and token endpoints while using the actual callback page, PKCE verifier, credential persistence and provider bridge. They certify the app flow, not provider registration or real consent. The scheduled E2E artifact uses public registration IDs or fixture fallback IDs; it is not a release artifact.

Real-account acceptance needs authorized disposable repositories/projects/boards and interactive consent. Public IDs are configured for all four providers. Unauthenticated registration probes reached each authorization service, and GitHub device flow is enabled; these probes do not certify redirects, granted permissions or writes.

## Provider contracts

- [GitHub authorization and device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitLab OAuth](https://docs.gitlab.com/api/oauth2/) and [issues](https://docs.gitlab.com/api/issues/)
- [Linear OAuth, targeted issue scope and PKCE](https://linear.app/developers/oauth-2-0-authentication) and [GraphQL](https://linear.app/developers/graphql)
- [Trello public-client configuration](https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-client-configuration/)
