# Microsoft To Do import plugin

This bundled, one-time importer adds open Microsoft To Do data to Ultra
Tasks. It is additive: it never replaces existing app data and is not a
live Microsoft To Do integration.

## Data and privacy boundary

- Signing in uses Authorization Code with PKCE and the Microsoft Graph delegated permission `Tasks.Read` only. No client secret, `offline_access` or refresh token is needed.
- The host keeps the bearer token in memory and passes only the Graph response to the importer iframe. The host reads `graph.microsoft.com` over HTTPS and blocks redirects. The importer follows pagination only on that origin.
- The importer is hidden when the registration is missing, on native Android/iOS, and on unregistered web origins. It does not affect the existing file importers.
- Link the [import privacy statement and consent revocation instructions](../../../docs/wiki/2.27-Import-from-Microsoft-To-Do.md#privacy) from the Entra app's public privacy policy URL. The same notice is reachable from the importer.
- The import is list-by-list and is not transactional. A failure can leave the
  current project partial; the result tells the user which project to delete
  before retrying.

## Configure a build

1. Register a public Ultra Tasks application in Microsoft Entra ID, with personal Microsoft accounts enabled (and work/school accounts if wanted). Configure delegated Microsoft Graph `Tasks.Read`; do not create or supply a client secret.
2. For desktop (Linux, macOS and Windows), register the public loopback address `http://127.0.0.1` on the Mobile and desktop platform. The host picks the local port.
3. For hosted web, if releasing the importer there, register the exact browser callback `https://app.ultratasks.app/assets/oauth-callback.html` on the Single-page application platform. The importer reuses the current plugin OAuth asset, not the account or planned per-provider OAuth route. Verify that the final deployment serves that exact static file and a real Microsoft personal account can sign in before enabling it. Do not register arbitrary preview origins.
4. Set `ULTRA_MS_TODO_OAUTH_CLIENT_ID` to the public application (client) ID when building. Set `ULTRA_MS_TODO_WEB_ORIGIN` to the registered origin (e.g. `https://app.ultratasks.app`) only for a build that will support hosted web. The build embeds those public values via `npm run env`; no application secret belongs in client builds.

Publisher verification may be required by some work/school tenants. Native mobile does not show the importer; users can import from a configured desktop or browser and then use their existing sync setup.

## Mapping and deliberate losses

Each list becomes a project (the default list is renamed
"`<name>` (Microsoft To Do)", duplicate names get a ` (2)` suffix). Open tasks
become tasks; steps become sub-tasks, checked steps done. Notes (HTML reduced
to text), due days, categories (as tags) and, on opt-in, an `important` tag for
starred tasks carry over. The flagged-email list is unselected by default.

Repeats (`src/parse/map-recurrence.ts`) map to repeat configs when Ultra
Tasks can express them: daily/weekly/monthly/yearly intervals, weekday
sets, monthly on the due day, yearly on the due date, first–fourth weekday of
the month, and an end date. Anything else — a monthly day other than the due
day, "last weekday", a fixed number of occurrences, or a repeat the app rejects
— keeps the next due date and the rule text in the notes.

Reminders, file attachments, completed tasks, My Day and linked emails/files
are not imported; the preview lists the counts. Collision detection sees
active projects only, so an archived prior import may not be recognized.

## Batch invariants

`src/map/plan-import.ts` and `src/map/run-import.ts` deliberately:

- send at most 50 operations per awaited `batchUpdateForProject` call;
- create parents before children;
- use `temp-`-prefixed IDs for unresolved parents; and
- replace parent temp IDs with returned real IDs before a later batch call.

Changing any of these can orphan and delete imported subtasks or collapse many
dispatches into one event-loop turn. The batch result is not authoritative, so
the importer re-reads tasks and compares landed counts with the plan.

Due dates, tags and repeats are follow-up `updateTask` calls because
the batch-create contract does not carry them. `TODAY` is virtual and must never
be written to `task.tagIds`.

## Attribution

Adapted from [Super Productivity #11893](https://github.com/super-productivity/super-productivity/pull/11893) and its [Graph retry and reporting follow-up](https://github.com/super-productivity/super-productivity/commit/c48be5c6a598cbf6f36706c2854d0bd3a3d4440f), made available under the [upstream MIT license](../../../LICENSES/MIT-UPSTREAM.txt). The notice is also included in the built importer UI.

## Development

```bash
cd packages/plugin-dev/ms-todo-import
npm test
npm run build
```

Pure parsing, mapping, lossy-summary, localization, and executor behavior are
covered by colocated Jest specs. Also run `npm run plugins:build` from the
repository root after packaging changes.

The mocked browser test exercises the disabled state on an ordinary build. To exercise sign-in, token exchange, and Graph import with **only** the Playwright Microsoft fixtures, from the repo root:

```sh
npm run plugins:build
ULTRA_MS_TODO_OAUTH_CLIENT_ID=00000000-0000-4000-8000-000000000001 \
ULTRA_MS_TODO_WEB_ORIGIN=http://localhost:4242 E2E_WORKERS=1 \
npm run e2e:file e2e/tests/import-export/ms-todo-import.spec.ts -- --retries=0
```
