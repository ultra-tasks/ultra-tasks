# Unified integrations implementation plan

**Status:** Product and engineering design, 2026-11-08. The initial implementation is on `feat/unified-integrations`; the original wireframes remain illustrative. See implementation status below.

UltraTasks will give imported and synchronized work the same task experience: automatic source sections, source project and tag mappings, and individual or batch controls. Connections use a common setup flow, while a short capability explanation makes each platform's supported sync direction explicit.

The user request establishes demand for this design. Before implementation, check related open and closed integration issues for earlier decisions; this plan does not claim broader community demand. The [market target](../market/README.md) prioritizes developer integrations and daily planning while preserving privacy, offline use, and a calm interface. The [scorecard](../market/scorecard.md) is context, not a reason to expand scope into team project management.

## Prior art

Written before the design below. Sources are official vendor documentation read in November 2026, not hands-on product tests. Akiflow's source is a dated announcement, not a complete current capability reference.

| Product and source                                                                                                         | Connection and scope                                              | Relationship with local tasks                                                                                                                                                | Useful design precedent                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Todoist calendar integration](https://www.todoist.com/help/articles/use-the-calendar-integration-rCqwLCt3G)               | Account connection, calendar visibility, optional task export     | External events appear alongside tasks; supported edits to existing task-linked calendar events synchronize back. A new calendar event does not automatically become a task. | Separate calendar events, task time blocks, and supported sync operations; explain the relationship. |
| [Akiflow Jira announcement](https://akiflow.featurebase.app/en/changelog/boom-jira-software-cloud-2-ways-sync-integration) | Connect an account and configure automatic import scope           | Advertises two-way Jira integration and per-issue-type import configuration                                                                                                  | Make scope and synchronization choices part of setup.                                                |
| [Things automation commands](https://culturedcode.com/things/support/articles/2803573/)                                    | Commands can create and update tasks and projects, including tags | Capture and subsequent updates are explicit automation operations                                                                                                            | Preserve a useful one-time import path alongside ongoing sync.                                       |

**Take:** account authorization, scoped previews, explicit field directions, and one-time capture. **Deliberately do not take:** a mandatory hosted aggregation service, importing an entire organization by default, or a second task database that users must manage separately. Provenance belongs on ordinary UltraTasks tasks.

## Product decisions

### Import and Sync

The same two choices appear for every source. Capability differences change the explanation and available directions, not the task layout.

| Choice | Setup explanation                                                                                           | Subsequent behavior                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Import | “Bring in a copy of the selected items, projects, and tags. Future changes stay separate.”                  | A snapshot with a source link and Imported badge. No background refresh or remote writes. Re-running an import shows a preview and skips existing identities by default. |
| Sync   | “Keep selected items up to date. Choose which fields update here and which changes also update the source.” | An ongoing relationship. Sync can receive updates, send updates, or do both, depending on the connector and field permissions.                                           |

“Synced” is a relationship badge, not a claim that every field is current or writable. A second status says “Up to date,” “Updates from Linear,” “Pending,” “Paused,” or “Needs attention.” A read-only source still offers Sync with “Receive updates only”; unsupported two-way directions cannot be selected.

Import defaults to the selected snapshot. Sync defaults to receiving newly matching items in the selected scope. Users can turn off new-item discovery while continuing to sync existing items. New snapshots are never imported on a schedule under the Import label; ongoing ingestion belongs to Sync.

An item is represented once per connected source identity. Import to Sync upgrades the existing task after a comparison preview; it does not create another task. Sync to Import keeps the current local values and stops updates. Explicit “Create another copy” is a separate action outside the normal flow.

### Automatic sections and badges

Add **Integrations** to the main navigation. Its default view shows connection groups with automatic **Synced** and **Imported** sections. Each connection also has **Hidden** and **Stopped** views. The sidebar may expand a connection to show its mapped source projects.

Every managed task receives a system badge for Imported or Synced plus a source badge, such as GitHub. These are derived, filterable attributes with the same practical uses as tags; they are not editable user tags and are never exported as remote labels. Ordinary source labels become ordinary mapped UltraTasks tags.

These sections are views derived from task provenance, mode, and visibility. Do not create persisted duplicate task-id arrays or overwrite user-created sections. The same task remains available in its local project, Today, search, planner, and integration view. The global Integration view can filter by mode and source; a single connection can contain tasks in both modes.

Imported and synced tasks support the usual scheduling, subtasks, time tracking, completion, and local notes. A compact source row explains remote behavior. It must not add expensive per-row work to the task rendering hot path.

### Hide and Stop tracking

| Action                            | Local result                                                                                                                     | Remote result                                               | Discovery and restoration                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Hide                              | Removes the task from active task lists, Today, and planner; retains its dates and data in Hidden                                | Sync continues if active. Hide never changes remote status. | The same task can be shown again. Search hides it by default but offers Include hidden.                 |
| Show                              | Restores normal visibility without changing its original schedule                                                                | None                                                        | Show a review if restoring an overdue task.                                                             |
| Stop tracking                     | Keeps the local task and its source provenance, changes it to Imported with “Tracking stopped,” and halts refresh and write-back | No remote deletion or completion                            | An exclusion prevents rediscovery. Resume compares both versions before reconnecting the existing task. |
| Stop tracking on an Imported task | Records the exclusion and removes it from automatic integration grouping into Stopped; it remains a normal local task            | None                                                        | Makes the control meaningful for snapshots too; Resume offers Import or Sync.                           |
| Remove local copy                 | Uses the existing local delete/undo experience and retains an explicit discovery exclusion                                       | None by default                                             | Restoring recovers the original identity. “Allow import again” is explicit.                             |

Hide and tracking are independent. A hidden synced task continues syncing; a visible stopped task remains usable locally. Hidden wins over subsequent remote field updates. A background refresh cannot unhide it or change its tracking choice.

If a task being hidden is running, pause its timer as part of the same local transition. Preserve its schedule rather than clearing a mapped remote date. Hiding a parent hides its descendants in ordinary views; reopening it does not reveal children the user hid separately. The data transition design must specify these effective visibility rules before coding.

Support checkbox selection and Shift selection, with actions Hide, Show, Stop tracking, Resume, and Change mode. The selection bar states its scope (“12 selected,” “Select all 284 matching items”). Show a preflight count for mixed modes; skip inapplicable items with a result summary. Changes apply to the selected identities captured at invocation, not later search matches.

Stop tracking explains: “Keep these tasks in UltraTasks. Stop updates in both directions and prevent automatic re-import. Nothing is deleted at the source.” Supply Undo where the relationship can be restored safely. Resume never blindly pushes edits accumulated while stopped.

## Common connection flow

1. **Choose platform.** Show the same provider catalogue with one calm primary action.
2. **Connect account.** Prefer the platform's own authorization page. Offer host selection and an advanced token path where required. Separate account credentials from resource selection; existing single-resource configurations remain usable during migration.
3. **Choose source scope.** Discover accessible projects, repositories, boards, lists, or calendars. Filters include assigned-to-me where supported. Page and search results rather than fetching an entire organization.
4. **Choose Import or Sync.** State the effect in one sentence. For Sync, show a summarized direction and editable field policy. Import requires no write permissions.
5. **Map organization.** Preview projects and tags. Default to creating source-scoped local equivalents; allow mapping to existing local objects or skipping tags.
6. **Review and apply.** Show task/project/tag counts, existing items, excluded items, field directions, and any unsupported capabilities. Import performs one snapshot; Sync establishes the relationship and runs the first fetch.

Authentication never writes data. Review completes before background discovery is enabled. Source permissions are checked against the chosen operations, so a connected read-only account cannot accidentally appear writable. Request additional write authorization when the user enables a write capability.

### Project and tag equivalents

| Source concept                               | Default UltraTasks equivalent                    | Mapping rule                                                                                             |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Repository, project, board, or selected list | Project                                          | User chooses the useful level once in setup; retain the original path as provenance.                     |
| Label, tag, category                         | Tag                                              | Match by remote identity, not text. Duplicate names from different sources are namespaced in mapping UI. |
| Team, workspace, organization, space, folder | Source breadcrumb; optional local project folder | Do not flatten every organizational level into another project automatically.                            |
| Board list, stack, workflow status           | Source status and optional section mapping       | A column named Done is not necessarily a tag or a safe completion action.                                |
| Calendar                                     | Calendar source; optional task project           | Display-only events do not create projects, tags, or tasks unless requested.                             |

Import creates snapshots of selected source organization. Sync keeps task membership and supported project/tag metadata updated according to the mapping policy. Default organization updates are source to UltraTasks only; editing a local project/tag name does not rename it remotely. Remote organization writes are a later connector-specific capability.

An UltraTasks task has one project. If the remote object belongs to several projects/lists, choose one primary local project and retain other memberships as source attributes or explicitly mapped tags. Renames preserve identity. Moving an issue between selected scopes preserves the existing task and its timer/history; moving outside scope marks “Outside selected scope” rather than deleting it. Deleted or inaccessible source projects never cascade-delete local tasks.

Default tag synchronization replaces only the source-managed tag subset. It preserves local tags. A user who maps multiple sources to one tag sees the ownership policy before applying it. No global text-based merging or silent remote tag creation.

## Calendar design

Keep the agenda, planner, event actions, and time-block foundations. Put their connection settings through the same setup flow.

| Calendar operation | User explanation                                               | Capability requirement                                                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Import             | “Copy selected events into UltraTasks tasks.”                  | Any readable feed/API; snapshot only                                                          |
| Export             | “Send selected tasks to your calendar.”                        | Download an ICS snapshot for any calendar; direct event creation only on a writable connector |
| Sync               | “Keep linked events and tasks updated using the fields below.” | Reading supports receive-only sync; sending/two-way needs a writable API or CalDAV            |

Export means one-time output. ICS export never implies read-back or a live connection. Direct export records a provenance receipt to identify an existing event if the user later enables Sync. If the target import does not preserve identity, show that limitation before offering to link it.

Offer three independent scopes: **Calendars to display**, **Events to turn into tasks**, and **Calendar for task time blocks**. Keep ordinary meetings visible without forcing them into the task list. Auto time blocking is an ongoing send-only Sync preset. Label it “Task → calendar”; current generated time blocks do not gain reverse sync merely because the page says Sync.

### Fields without direct equivalents

Use a compact field policy table, with an advanced conversion editor only where needed. Each policy states direction, conversion, information loss, and example output.

| UltraTasks field                                          | Calendar equivalent                             | Proposed handling                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                                                     | Summary                                         | Direct mapping, configurable direction                                                                                                                                  |
| Planned start and estimated duration                      | Start and end                                   | Derive end = start + duration; keep personal planning separate from external deadlines                                                                                  |
| Date without time                                         | All-day date                                    | Use date-only values; do not invent midnight UTC                                                                                                                        |
| Done                                                      | No standard completion property                 | Default stays local. Optional title marker such as `[DONE]` or provider metadata for writable events. Explain that the title marker is visible to other calendar users. |
| Tags and project                                          | Categories, custom properties, or no equivalent | Keep local by default. Optional category mapping where supported; app metadata on app-owned events only.                                                                |
| Private notes                                             | Description                                     | Off by default; explicitly opt into replacing/appending remote text. Keep unmatched rich data in source details.                                                        |
| Attendees, organizer, meeting link, recurrence exceptions | No equivalent task fields                       | Preserve as source details; do not synthesize task tags or rewrite the meeting.                                                                                         |

Some conversions can only send data. A title marker can be parsed on receive only with an explicit reversible rule; it must not treat an ordinary title containing DONE as a completion signal. Do not offer “both” for a lossy or non-invertible conversion. Invalid or unsupported values retain the original source value and show a local explanation.

## Architecture and implementation boundaries

Reuse [IssueService](../../src/app/features/issue/issue.service.ts), [the provider registry](../../src/app/plugins/issue-provider/plugin-issue-provider-registry.service.ts), [the plugin sync adapter](../../src/app/plugins/issue-provider/plugin-sync-adapter.service.ts), [the two-way engine](../../src/app/features/issue/two-way-sync/issue-two-way-sync.effects.ts), [OAuth](../../src/app/plugins/oauth/plugin-oauth.service.ts), and [calendar time blocks](../../src/app/features/calendar-integration/time-block/time-block-sync.effects.ts). The standalone page replaces the tab browser's role; the quick “Add from integration” entry remains available.

### Capabilities and discovery

Create an internal capability description derived from actual connector hooks plus runtime permissions: authentication methods, readable fields, writable fields, creation/deletion, resource discovery, taxonomy discovery, worklogs, time blocks, and recurrence edit scopes. A badge or a config form alone is not proof of write support.

Prove the contract on GitHub and Google Calendar before publishing additive plugin API hooks. Likely hooks are paginated collection discovery and taxonomy discovery, with stable IDs, parent paths, remote versions, and normalized membership. Existing plugins without discovery still work with manual scope entry. Avoid a single giant provider interface and provider checks scattered through templates.

Separate an authorized account from its selected scopes logically. Initially share the existing connection/token infrastructure and expose several scopes through a facade; introduce a persisted account entity only if multi-scope credential ownership demonstrably needs it. Token material stays in existing credential stores, never in task provenance or synced project metadata. Connector configuration can sync across devices; credentials retain their established lifecycle.

### Data and identity

Persist only source facts and user choices; derive lists and badges. Candidate storage additions are optional task provenance and per-item overrides, plus connection configuration for scopes, mapping rules, and discovery exclusions. Exact names and placement require persisted-model review before implementation; these are not public API commitments.

- **Identity:** connector instance/account namespace + remote object kind + stable remote ID. Retain remote scope and permalink separately. Preserve existing task IDs when adopting links; do not regenerate them during migration.
- **Task facts:** Imported or Synced, source provenance, visibility, and explicit tracking override. Import provenance must survive without active legacy issue-link fields.
- **Mappings:** remote collection/tag IDs to local project/tag IDs, including ownership and collision choices. Store the remote reference on the mapped child entity or in one owner, then derive membership; never keep competing membership lists.
- **Exclusions:** one record per explicitly stopped/removed remote identity. They survive polling, reload, mode changes, and application-state sync. Reset only by explicit “Allow import again” or connection removal with a stated consequence.
- **Transient state:** connection progress, retry timing, last fetched pages, and detailed error text remain device-local. Store only compact sync baselines needed for field reconciliation, not historical remote payloads.

Growth is proportional to managed tasks, mapped collections/tags, and explicitly excluded identities: at most one current mapping/exclusion per identity, not a record per poll, edit, or day. Exclusions are a user-managed set; do not expire them silently, since that would re-import stopped work. Provide a review/forget flow stating that forgotten identities may be discovered again. Existing mapping/exclusion retention is removed only when the corresponding connection is explicitly forgotten.

### Relationship enforcement

Check mode and tracking before every refresh, push, create, delete, discovery import, calendar write, and worklog prompt. Also check immediately before sending queued writes. Stop tracking cancels pending writes for selected identities; already accepted remote writes cannot be undone by pretending they never happened. Report in-flight results and fetch a comparison on Resume.

Use a generation/version for pending work so a stale fetch cannot reactivate a stopped task. Hiding changes visibility only; it is not a sync gate. A provider uninstall, revoked permission, offline state, or failed request pauses the relationship without relabeling it Imported or discarding local edits.

For remote/local simultaneous edits, reuse sync baselines and existing conflict decisions. Conflicting scalar values require explicit ownership or a comparison; never silently choose the latest wall clock across different systems. Preview Stop/Resume and mode changes at item level, with clear batch results.

Keep one remote relationship per task in the first implementation, matching the current task model. Connecting Jira to GitHub through the same task is a separate multi-source synchronization problem and is outside this plan.

### Operation log and cross-device behavior

Follow the [contributor model](../sync-and-op-log/contributor-sync-model.md). Replayed UltraTasks state operations must not trigger new provider writes. Local outbound work uses `LOCAL_ACTIONS`; provider-originated updates need an explicit no-echo path. Atomic multi-entity transitions use declared shared actions/meta-reducers, not effect fan-out. Larger imports are resumable batches of independent transitions; do not make an entire remote workspace one unbounded operation.

Test one writer per connection across tabs/devices or prove idempotent writes plus single external creation. Deterministic identities prevent duplicate imports, but are not sufficient by themselves to prevent duplicate non-idempotent remote creates or repeated worklog entries. Use existing external IDs, provider idempotency/version support, and preflight reconciliation; define a durable retry/ownership strategy before enabling automatic creation across devices.

Use optional persisted fields with runtime defaults. Test old backups, old clients, remote replay, and disconnects. A new optional field does not stop an old client from following legacy behavior. Import and stopped items must clear active legacy issue-link fields while keeping provenance elsewhere, so older clients cannot poll or push them as linked tasks. Disable existing legacy auto-import flags on connections managed by the new scoped discovery path, otherwise old clients can rediscover excluded identities. Compatible sync fields continue to use existing policy shapes.

Mixed-version release tests must prove these claims for each connector, especially Plainspace and calendar automatic discovery. If a legacy path cannot be disabled safely, keep that connection on its existing behavior and explain the upgrade requirement before enabling the new modes. Do not rely on a schema bump or client-only hidden flag as a safety boundary. Existing rows are adopted as Synced with their current field policies; no migration silently enables write-back or turns polling links into snapshots.

## Provider capability audit and quirks

Based on repository code on 2026-11-08. “Receive” means ongoing readable updates, not a promise of identical refreshed fields. Project/tag discovery and organizational mappings are planned work across connectors, even where their APIs already expose the required data. These are not live account certification results.

| Provider                               | Current ongoing behavior                                                    | Source organization to map                                                 | Quirk or required work                                                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                                 | Receive; write status/title/body; create issues                             | Repository → project; labels → tags                                        | Repo-qualified issue numbers are not global IDs. GitHub Projects is distinct from repositories and needs separate discovery/permissions. Support issue moves, private-repo access, and optional PR inclusion. Official GitHub App/OAuth connection is new work. |
| GitLab                                 | Receive; existing provider-specific behavior, no generic two-way adapter    | Project → project; labels → tags                                           | Instance/project scope matters; group labels can be inherited. Preserve weight as weight, not a duration. Audit existing API behavior before advertising write-back.                                                                                            |
| Jira                                   | Receive; dedicated transitions and worklogs                                 | Project → project; labels → tags; components as optional attributes/tags   | Cloud and self-hosted auth differ. Status transitions depend on workflow, permissions, and required fields. Custom story-point fields differ per installation. Existing web path has cross-origin/extension constraints.                                        |
| Linear                                 | Receive only                                                                | Project or selected team scope → project; labels → tags                    | Current plugin has no update/create hooks. Team is not a project; preserve multi-project membership and completed/cancelled distinctions. Official OAuth and write-back need implementation.                                                                    |
| ClickUp                                | Receive only                                                                | Selected list → project; tags → tags; preserve workspace/space/folder path | Current search spans configured team/workspace IDs; partial search failures must be visible. Tasks can appear in multiple lists. Statuses and custom fields vary.                                                                                               |
| Gitea                                  | Receive only                                                                | Repository → project; labels → tags                                        | Self-hosted origins and token scopes vary. Preserve repository-qualified identity; current connector does not write changes.                                                                                                                                    |
| Trello                                 | Receive; write title/completion; create cards                               | Board → project; labels → tags; lists as source status                     | Current completion mapping archives a card. Moving to a Done list is a different operation and must be offered as a separate mapping with a preview. Label names/colors are board scoped.                                                                       |
| Azure DevOps                           | Receive only                                                                | Team project → project; tags → tags; iteration/area as source attributes   | Work-item types have different state machines and fields. WIQL/query scope and enterprise authorization need dedicated discovery; current connector has no write hooks.                                                                                         |
| Redmine                                | Receive; worklog submission                                                 | Project → project; categories/custom fields as explicit equivalents        | Current issue refresh is distinct from worklog writes; time-entry capability does not make status writable. Done states and custom fields vary by instance.                                                                                                     |
| OpenProject                            | Receive; dedicated transitions and time logging                             | Project → project; categories/types as optional equivalents                | Allowed transitions are resource-specific. Do not promise writable labels or generic two-way project metadata without an API audit.                                                                                                                             |
| Nextcloud Deck                         | Receive; write completion/description                                       | Board → project; labels → tags; stacks as status                           | Optional done-stack movement differs from done state. Card writes use read-modify-write PUT and must preserve fields changed by others. No current generic create hook.                                                                                         |
| Plainspace                             | Receive; write completion/title/schedule; create/delete                     | Shared space/project identity → project                                    | Current shared workflow can delete remotely on local task delete. Preserve legacy behavior until an explicit migration choice; new Remove local copy must use a no-remote-delete path. Repeating schedules and day-only planning have special semantics.        |
| CalDAV Todo                            | Receive; configurable completion/title/notes writes and creation paths      | Task calendar → project; categories → tags                                 | VTODO tasks are different from VEVENT events. Server capabilities, URL identity, ETags, and date/time semantics vary.                                                                                                                                           |
| iCal feeds, including Outlook 365 feed | Receive only                                                                | Calendar → optional project; categories only if present                    | A feed URL may contain a secret. No direct write-back; “Export ICS” is a snapshot. Moving an imported task cannot change the feed. Stable occurrence identity is required for recurrence.                                                                       |
| Google Calendar API                    | Receive; mapped event writes, creation/deletion; send-only auto time blocks | Calendars → optional projects; no universal task-tag equivalent            | Current OAuth is desktop/mobile, not web. Calendar permissions vary. Organizer/attendee rights, all-day dates, DST, recurrence exceptions and generated time-block identity need separate handling. Completion is not native.                                   |
| CalDAV Events                          | Receive; mapped event writes, creation/deletion; time blocks                | Calendar → optional project; categories when supported                     | Preserve VEVENT recurrence/VTIMEZONE and unknown properties; use server version checks. Completion remains an explicit conversion rather than a standard event field.                                                                                           |

## Delivery sequence and acceptance gates

No calendar rewrite is required. Each phase delivers a usable part of the common model; capability parity across all providers is a later expansion rather than a precondition for a consistent interface.

| Phase                             | Work                                                                                                                               | Exit condition                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Audit and contract             | Resolve legacy behavior, identity and mixed-version rules; capability facade; fixtures for all connector families                  | Capability UI cannot offer unsupported writes; each connector has a recorded mapping/discovery/auth gap and existing-user migration policy.                                       |
| 2. Workspace and task lifecycle   | Dedicated Integration route, derived sections/badges, selection, Hide/Show, Stop/Resume, snapshot Import                           | Single and batch actions persist correctly; hidden/stopped items do not return after polling or reload; normal tasks remain usable offline.                                       |
| 3. Setup and organization         | Connect → scope → mode → mapping → preview; prove GitHub repository/label and Google calendar discovery; then add other connectors | Stable mappings survive renames, duplicate tag names, partial permissions, paging, cancellation, and resumable imports. Import and Sync produce identical local task affordances. |
| 4. Ongoing field sync             | Reuse current adapters, add explicit read-only presentation and policy presets, upgrade missing write capabilities incrementally   | No duplicate local tasks or remote creates; concurrent changes, revoked permissions, delayed responses, and queued-write cancellation have real-path coverage.                    |
| 5. Calendar modes and conversions | Common Import/Export/Sync controls; ICS snapshot export; field conversion preview; retain current agenda/planner                   | All-day, DST, recurrence identity, read-only permissions, lossy conversions, and meeting vs task-block behavior are explicit and verified.                                        |
| 6. Migration and rollout          | Adopt existing connections without new writes; documentation, accessibility, mobile polish; retire old tab browser after parity    | Released-client and legacy-data tests pass; source views stay responsive with large imported datasets; old integration entry points lead to the new workspace.                    |

Authentication upgrades can run alongside phases 2–4; keep usable advanced-token flows while each official authorization path is completed. Effort estimates follow the phase 1 API audit rather than assuming all providers have the same cost.

## Validation plan

- **Mode contract:** Import never invokes refresh/push; Sync respects per-field permissions. Transitioning modes preserves IDs, history, notes, and local-only tags. Imported badge stays after source disconnection.
- **Lifecycle:** test one and many items, all-matching selection, hidden synced items, stopped snapshots, parent/child visibility, active timers, Undo, remote moves, and exclusion restoration. In-flight stale responses cannot override newer choices.
- **Organization:** same names in two accounts, renamed collections/tags, moved issues, multi-project tasks, partial discovery errors, inaccessible projects, and remote tag removal preserving local tags.
- **External effects:** loop suppression, idempotent retry, rate limiting, pagination, credentials revoked mid-operation, app restart mid-import, multiple tabs/devices, and no remote deletion from Hide/Stop/Remove local copy.
- **State compatibility:** historical frozen data, mixed released/new clients, local replay, concurrent remote edits, and deterministic source identity. Start each sync behavior change with a real-path failing E2E reproduction; mocks alone do not establish correctness.
- **Calendar:** date-only vs timed, DST/time zones, recurring series/occurrence identity, source ownership, generated-block exclusion, failed conversion, and ICS identity limitations.
- **UI:** keyboard-only setup, focus restoration, accessible selection and status labels, narrow layout, long project/tag names, empty/reconnect/error states, and large lists. No external write happens just by selecting a mode or connecting an account.

Run required file checks and focused tests for implementation. Update the integration and web/desktop comparison wiki pages alongside shipped behavior. Validate the built application in a browser as well as checking document links and rendering the wireframes.

## Wireframes

Open [the clickable wireframes](assets/unified-integrations/wireframes.html). They use fictional data and illustrate proposed behavior, not live connections. The gallery includes desktop workspace, setup, organization mapping, field policies, bulk controls, calendar modes, mobile layout, and sync attention states. The downloadable PDF is generated from the same frames for review.

The frames demonstrate one GitHub relationship, a read-only Linear relationship, a one-time Trello import, and calendar modes. Identical badges, task rows, selection, and lifecycle actions apply to every connector. Provider-specific terminology is confined to source selection, mappings, and capability explanations.

## Implementation status

The branch implements the dedicated workspace, shared setup using existing authorization methods, snapshot and linked modes, per-item field overrides, provider explanations, local source-project destinations, optional label copying, automatic source grouping and badges, batch Hide/Show/Stop/Resume/Refresh, stale-response checks, and ICS snapshot export. Existing calendar workflows remain intact.

The broader design still calls for account-level resource discovery across multiple projects, live source project/tag identity reconciliation, new official OAuth registrations for token-only issue connectors, an explicit field-conversion editor, a side-by-side resume conflict comparison, and cross-version certification for every provider. These are not represented as completed by the new UI. The setup uses each connector's existing scope controls; source tags are copied when adding items rather than continuously synchronized. Resume explains and applies the existing field policies after a fresh fetch. The existing quick-add side pane remains available alongside the new workspace.

The provider-quirk explanation is present in credential setup, the review stage, source browsing, and item field settings. Trello completion explicitly explains archiving, and users can choose a local completion policy. Existing connections are not migrated into more permissive write settings.

Validation of this initial implementation: the affected Angular suite passed 19,174 tests in Europe/Berlin and 6,516 in America/Los_Angeles. The final focused suite passed 132 tests, including provider registration after page hydration. Two browser tests exercise the actual setup, item policies, refresh, snapshot import, export, hide/stop persistence and duplicate exclusion with intercepted provider responses. Development build, spec type checking, changed-file formatting/lint, translation consistency and documentation-link checks passed. These checks do not certify live account authorization or every provider’s API behavior.
