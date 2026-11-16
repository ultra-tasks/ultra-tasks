# Opt-in calendar publications

Implementation in progress for 0.4.0. The existing account page owns publication controls; this keeps authentication and revocation together without adding a new settings category. The hosted local-only app has no publication controls.

## Prior art

Vendor documentation checked November 2026:

| Product                                                                                         | Subscription and updates                             | Applied here                                                                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Todoist](https://www.todoist.com/help/todoist/integrations/add-a-todoist-calendar-feed-pAk3tk) | Account/project calendar feeds; one-way subscription | Selected project/tag or scheduled tasks, without promising two-way edits        |
| [Google Calendar](https://support.google.com/calendar/answer/37100?hl=en)                       | Add a calendar from a URL                            | A copyable subscription URL; no forced provider account connection              |
| [Apple Calendar](https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/mac)   | Subscribe by URL; subscriber chooses auto-refresh    | Explain polling and retained downloaded copies; no promise of immediate refresh |

Take: explicit subscription, stable event IDs, simple revocation. Deliberately do not add provider-specific sign-in, refresh notifications, or publish private notes.

## Data and compatibility

- A feed is an explicit plaintext publication outside end-to-end encryption. Busy-only is the default. Creating it requires a separate consent checkbox.
- Selection and publishing ownership stay in device-local storage, scoped to server and account. They never enter NgRx or the sync wire. Released clients ignore the feature; no schema-version bump or plugin API change is needed.
- The app publishes unfinished, scheduled task instances in a bounded window: 30 days past to 180 days ahead. It does not invent future recurrence identities or emit RRULE. Recurring instances already materialized by the app are included. Maintainer decision, 2026-11-15: 0.4.0 includes these existing instances only; future projections are a follow-up.
- Stable UIDs use task IDs. All-day events retain date-only values. Timed events use UTC. SEQUENCE increases with each publication update.
- The server permits ten feeds per account, each at most 1 MiB. Only token hashes are stored. Account deletion cascades to feeds. Full PostgreSQL backups include them.
- Compare-and-swap revisions reject stale uploads; URL rotation also changes a generation to fence already queued uploads. A second device can revoke a feed but cannot silently become its publisher.
- No public response can use an unvalidated cached body. Revoked tokens return 404, including conditional requests. Calendar apps can retain copies already downloaded.
- Automatic publication waits for app hydration and account sync to settle. Failure leaves task editing and encrypted sync available.

## Validation and release gaps

Real PostgreSQL-compatible route tests cover create/fetch/update/rotate/revoke, stale revisions/generations, consent, size/count limits, cross-account isolation and account deletion. App tests cover device-local metadata, busy-only generation and hydration gating. Browser acceptance runs the Angular client against real account routes.

Before enabling the server feature: apply the migration, set `ULTRA_CALENDAR_FEEDS_ENABLED=true`, update the operator privacy notice, and exclude `/cal/*` from proxy access logs and caches. Verify TLS and service-worker routing through the deployed proxy. Test subscriptions and polling in Google Calendar, Apple Calendar, Outlook and Thunderbird; these manual checks are not replaced by automated tests.

The clean production web bundle measures approximately 6.2515 MB with these additions. Production desktop/web initial-bundle limits increase from 6.25 to 6.26 MB (10 KB) for the calendar controls and translated privacy text; the warning limit stays unchanged. Calendar publishing resumes lazily for existing account profiles.
