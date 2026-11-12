# Hosted web app and account origin

Status: Approved by the maintainer (2026-11-10); Phase 0 and the Phase 1 repository changes are written but nothing is deployed. The no-sync standalone build exists (commit `b9236a0342`). The service-worker exclusions, the release bundle workflow, the preview `noindex` header, and the server's Caddy split, bundle mount and install script are in the working trees awaiting commit. The Caddyfile was validated and exercised with Caddy 2.11 on 2026-11-11 (see Still unverified for what that did and did not cover).
Owner: Ultra Tasks maintainer.
Tracking: Maintainer request in this chat (2026-11-10).
Last verified against code: November 10, 2026. Client `b9236a0342` plus working-tree changes; server `ultra-tasks-server` `5129309` plus working-tree changes.
Completion condition: `https://app.ultratasks.app/` serves the web task application, `/account` serves the dashboard, both from one origin; the service worker never answers a server-owned path; and the rollout phases below pass their acceptance checks. Move enduring contracts into the two repositories' guides and retire this plan after Phase 2.

This reconciles the [server extraction plan](2026-11-07-server-extraction-and-v1-launch.md), the [0.3.0 release plan](2026-11-07-ultrasync-0.3.0-release.md), the [native collaboration plan](2026-11-05-native-encrypted-collaboration.md), the [OAuth-first connections plan](2026-11-10-oauth-first-connections.md), the [browser login contract](https://github.com/ultra-tasks/ultra-tasks-server/blob/main/docs/browser-login.md), and the website's account links. It does not change any wire format, sync protocol, or storage format.

## Sections

- [Decisions](#decisions)
- [Cross-origin: recommendation](#cross-origin-recommendation)
- [Path ownership](#path-ownership)
- [Hosting](#hosting)
- [Service worker and routing](#service-worker-and-routing)
- [Headers, storage, and trust](#headers-storage-and-trust)
- [Changes by repository](#changes-by-repository)
- [Rollout](#rollout)
- [Acceptance](#acceptance)
- [Documentation conflicts resolved](#documentation-conflicts-resolved)
- [Decisions on the open questions](#decisions-on-the-open-questions)
- [Still unverified](#still-unverified)

## Decisions

1. **One official origin: `https://app.ultratasks.app`.** The web task application is at `/`. The account dashboard is at `/account`. The API is under `/api/`. There is no `/app/` prefix. (Maintainer decision; the older `/app/` wording in the server extraction plan was wrong and is corrected.)
2. **Same-origin for the official service.** The dashboard, API and web application share the origin, as the server extraction plan already requires for the dashboard and API. No CORS, no cross-site cookies, no cross-origin SSO.
3. **Self-hosters get the same shape.** The server's Caddy serves the same bundle at their origin's root, so a self-hosted install is also same-origin.
4. **The web application is not part of app 0.3.0.** The website keeps "coming soon" for hosted web until Phase 1 ships.

## Cross-origin: recommendation

Do not use cross-origin resources for the official service. Cross-origin is a cost, not a feature:

| Concern                    | Same origin                                              | Cross origin (for example `api.ultratasks.app`)                                        |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| CORS and preflights        | None                                                     | Every API call is preflighted; allowlist to maintain                                   |
| Sessions                   | Bearer tokens, no browser-state coupling                 | Same, plus third-party-cookie rules if cookies are ever used                           |
| WebAuthn                   | `WEBAUTHN_ORIGIN` names the one origin; in-page ceremony | App origin needs its own allowed origin; RP ID choice becomes permanent                |
| Passkey path in the client | `native-sync.service.ts` runs the ceremony in page       | Falls to the browser-handoff branch whenever `location.origin` differs from the server |
| Failure modes              | One TLS name, one deploy                                 | Two names, two certificates, two places to misconfigure                                |

Where cross-origin is unavoidable, scope it narrowly:

- **Third-party integrations** (Jira, GitHub, WebDAV, Nextcloud, calendars) are cross-origin by nature. They need a broad `connect-src` for the app at `/`. This is already true of every web build and is the reason headers are per path.
- **Hosted app calling a custom or self-hosted server** is cross-origin. The collaboration plan already specifies the route: bearer tokens in headers, refresh token stored only inside the vault-encrypted credential record, explicit operator CORS. Treat it as **Phase 3, off by default**. The operator opts in with `CORS_ORIGINS=https://app.ultratasks.app`. The server's current CORS registration allows only `Authorization` and `Content-Type` and does not enable credentialed requests, which matches that design.
- **Local development** (`ng serve` on `localhost:4200` against a server on `localhost:1900`) is cross-origin. The existing `CORS_ORIGINS` environment variable covers it.

Separate the dashboard onto its own subdomain only if the shared-origin trust cost below is judged too high before sign-ups open. WebAuthn permits a registrable parent domain as the RP ID, so passkeys could still be shared, but the RP ID is fixed once credentials are enrolled. This is decided for now in [Decisions on the open questions](#decisions-on-the-open-questions).

## Path ownership

One origin means a routing table. Everything not listed is the web application.

| Path                           | Owner      | Notes                                                                                                    |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| `/account`, `/account/*`       | Server     | Dashboard. Its assets load from `/api/v2/accounts/*`. Verification and reset links stay here.            |
| `/api/*`                       | Server     | REST and the `/api/v2/accounts/sync/events` WebSocket. Never cached, never served by the service worker. |
| `/live`, `/health`             | Server     | Probes.                                                                                                  |
| `/privacy.html`, `/terms.html` | Server     | Legal pages or a redirect to the published policy.                                                       |
| `/oauth/callback/<provider>`   | Web bundle | An explicit file (not a router route) that strips the code from the URL first. See OAuth plan.           |
| `/` and every static asset     | Web bundle | Hash routing (`#/…`); no SPA fallback is needed or wanted.                                               |

Today the server answers `GET /` with a redirect to `/account` (`private-server.ts`). Caddy must send `/` to the bundle before the server sees it. A server image run without the bundle keeps the redirect, which is correct for installs that have no web client.

The in-app Account page is the hash route `#/account`. It is a different thing from the path `/account`. They never collide, but link copy should call the second one "account dashboard".

## Hosting

**Recommendation: the account server's Caddy serves the bundle; Cloudflare stays in front as the CDN.**

The server's production stack is already Caddy, the server, and PostgreSQL (`deploy/compose.yaml`). Its `Caddyfile` currently proxies everything to the server. Adding the bundle there keeps one origin, one TLS name and one place to set headers, and it matches the server plan: the bundle is built in the app repository and handed to hosting as a versioned artifact, so the server build never needs a client checkout.

Sketch (for the server repository; not applied):

```caddyfile
{$DOMAIN} {
    @server path /account /account/* /api/* /live /health /privacy.html /terms.html
    handle @server {
        reverse_proxy server:1900
    }
    handle {
        root * /srv/web/current
        header /index.html Cache-Control "no-cache"
        header /sw.js Cache-Control "no-cache"
        header /ngsw-worker.js Cache-Control "no-cache"
        header /ngsw.json Cache-Control "no-cache"
        header /manifest.json Cache-Control "no-cache"
        @hashed path_regexp -[A-Za-z0-9_]{8}.(js|css|woff2)$
        header @hashed Cache-Control "public, max-age=31536000, immutable"
        rewrite /oauth/callback/* /oauth-callback.html
        file_server
    }
}
```

Artifact delivery:

1. Release CI in this repository builds `buildFrontend:prodWebStandalone` (Phase 1) or the sync-enabled bundle (Phase 2) and attaches `ultra-tasks-web-<version>.tar.gz` plus a SHA-256 file to the release.
2. The VM unpacks into `/srv/web/<version>/` and switches a `current` symlink. A switch is atomic and a rollback is one symlink change.
3. Keep the previous release's hashed files for 30 days so a tab that has not reloaded can still fetch a lazy chunk. The Angular service worker prefetches the app group, which covers most cases; this covers browsers without a working worker.
4. Compatibility: web clients update on next visit and may lag a deploy. The server keeps honouring the [client version floor](../sync-and-op-log/client-version-floor.md) for web the same as for any other client.

**Alternatives considered.**

| Option                                                    | Why not the default                                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Pages for the bundle, VM for `/account`        | Pages cannot proxy to an external origin from `_redirects`; it needs a Worker or Pages Functions in front. Adds a second deploy path and routing layer. Unverified how a Worker route interacts with a Pages custom domain. |
| Cloudflare Worker with static assets, proxying the server | Works and keeps assets at the edge, but API and WebSocket traffic then counts against Worker quotas and the Worker is another component to secure.                                                                          |
| Separate `web.` or `api.` hostnames                       | See [cross-origin](#cross-origin-recommendation).                                                                                                                                                                           |

Pages remains the **preview** host (`ultra-tasks-preview.pages.dev`, `master-web-deploy.yml`). Browser storage is per origin: anything a person stores on the preview stays there. Do not link users to it. Add `X-Robots-Tag: noindex` through a `_headers` file in the preview output so it is not indexed.

## Service worker and routing

The Angular service worker (`sw.js`) is registered at the origin root and answers every navigation without a file extension with `index.html`. `ngsw-config.json` currently has no `navigationUrls`, so a returning visitor who follows `https://app.ultratasks.app/account?view=login` from the website, or an emailed verification link, would get the web application instead of the dashboard.

Required in `ngsw-config.json`:

```json
"navigationUrls": [
  "/**",
  "!/**/*.*",
  "!/**/*__*",
  "!/**/*__*/**",
  "!/account",
  "!/account/**",
  "!/api/**",
  "!/live",
  "!/health",
  "!/oauth/**"
]
```

(The first four entries are Angular's defaults, repeated because specifying `navigationUrls` replaces them.) Add an e2e check under `e2e/pwa/`: after the worker is active, a navigation to `/account` must reach the network, not `index.html`.

Other rules:

- Keep hash routing. A path router would need a server fallback that collides with `/account`.
- `/oauth/callback/<provider>` has no file extension, so the worker would answer it with `index.html`. Exclude `/oauth/**` from `navigationUrls` and have Caddy rewrite `/oauth/callback/*` to a single `oauth-callback.html` in the bundle. Test it with the worker active.
- API calls are not in any `dataGroups`, so the worker passes them through. Do not add the account origin to `dataGroups`.
- The standalone build already removes the app's `/account` and `/native-sync` hash routes and its sync engine (`IS_SYNC_AVAILABLE`), so Phase 1 cannot reach the server by accident.

## Headers, storage, and trust

The dashboard and the web application share an origin, so they share IndexedDB, `localStorage` and any cookie. The application's attack surface is much larger (plugins, rendered notes, issue-provider content, many third-party APIs). A cross-site-scripting flaw in the application could make same-origin requests to the dashboard API. This is the real cost of the same-origin choice and it is why the server extraction plan makes release integrity and XSS review part of the E2EE review.

Mitigations, none of which is complete on its own:

- **Per-path headers.** Dashboard and API keep the strict policy the server already sets (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`). The web bundle gets its own policy: `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`, `style-src 'self' 'unsafe-inline'` (confirm), and a `connect-src` that allows the account origin and the integrations the user enables. Validate against the real bundle before enforcing; start in report-only.
- **No third-party scripts and no analytics** on the origin, as the server extraction plan states.
- **`Referrer-Policy: no-referrer`** and `X-Content-Type-Options: nosniff` everywhere (the server and Caddy already set both).
- **Tokens never in URLs, broad cookies or local-storage handoffs.** The current design is bearer tokens in headers, so no cookie CSRF surface exists. Keep it so.
- **Vault keys stay in page memory.** Per the collaboration plan, the browser caches only the wrapped vault and asks for the password on a fresh launch. "Trusted device" convenience mode, if ever added, must explain its weaker boundary.
- **No iframing of the dashboard** (`frame-ancestors 'none'`) and no embedding the dashboard in the app.
- **Cache rules.** `/account`, `/api/*` and legal pages are `no-store`. `sw.js`, `ngsw.json`, `ngsw-worker.js`, `index.html`, `manifest.json` revalidate. Hashed assets are immutable.
- **Persistent storage.** The web application should request persistent storage (`navigator.storage.persist()`) and show a clear export prompt, because the standalone build's only copy of the data is the browser.

## Changes by repository

### `super-tasks` (this repository)

| Item                                                                                                                                                                                                                                                   | Phase |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `navigationUrls` in `ngsw-config.json` plus the PWA e2e navigation check                                                                                                                                                                               | 1     |
| `_headers` for the preview output (`X-Robots-Tag: noindex`)                                                                                                                                                                                            | 0     |
| Release workflow that builds the standalone bundle and attaches a tarball and checksum                                                                                                                                                                 | 1     |
| `build-update-web-app-on-release.yml` now builds the standalone bundle and attaches `ultra-tasks-web-<version>.tar.gz` plus `.sha256` to the release (workflow runs keep it as an artifact); the SSH deploy and its `WEB_*` secrets are no longer used | 1     |
| Persistent-storage request and first-run backup prompt for the web build                                                                                                                                                                               | 1     |
| `/oauth/callback/<provider>` page (when the OAuth plan ships web)                                                                                                                                                                                      | later |
| Browser session and vault storage; enable `syncAvailable` in the web build; default server URL = `location.origin` on the hosted origin                                                                                                                | 2     |
| Hosted app to custom server (bearer tokens, vault-encrypted refresh token)                                                                                                                                                                             | 3     |

### `ultra-tasks-server`

| Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `deploy/Caddyfile`: path split, a bundle volume, cache headers, per-path CSP for the bundle                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1     |
| CORS: the live entry point (`private-server.ts`) already pins CORS to the origin of `PUBLIC_URL` when `CORS_ORIGINS` is empty, and a test asserts the upstream origin gets no CORS header. The upstream default `https://app.super-productivity.com` survives only in the legacy entry point (`config.ts`, `legacy-index.js`), `apps/server/env.example`, its README and the Helm values. Leave it while legacy routes are disabled; remove it with the legacy retirement. `deploy/env.example` now ships `CORS_ORIGINS=` empty. | 1     |
| `GET /` redirect to `/account` stays, but document that the proxy serves `/` from the bundle when one is installed                                                                                                                                                                                                                                                                                                                                                                                                               | 1     |
| `PUBLIC_URL`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID` set to `https://app.ultratasks.app` / `app.ultratasks.app` for the official host                                                                                                                                                                                                                                                                                                                                                                                               | 1     |
| Backup and restore tooling: bundle directories are not user data; include only the retention rule                                                                                                                                                                                                                                                                                                                                                                                                                                | 1     |
| Document the optional `CORS_ORIGINS=https://app.ultratasks.app` opt-in for operators who want the hosted app against their server                                                                                                                                                                                                                                                                                                                                                                                                | 3     |

### `website-landing`

| Item                                                                                                                                          | Phase |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Keep `/account?view=login` links as they are (they stay correct)                                                                              | —     |
| When Phase 1 ships: update the platform card, FAQ, `operatingSystem` metadata and the privacy policy's platform list from "web once released" | 1     |

## Rollout

| Phase | What ships                                                         | Origin               | Acceptance                                                                                                                                     |
| ----- | ------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Standalone no-sync build on Cloudflare Pages                       | `*.pages.dev`        | Deploy succeeds; PWA e2e passes; no link from the website; indexed nowhere                                                                     |
| 1     | The same standalone bundle at the production root, served by Caddy | `app.ultratasks.app` | Path table holds; `/account` reaches the network with an active worker; headers per path; rollback by symlink; website copy updated            |
| 2     | Browser account sync enabled in the same bundle                    | `app.ultratasks.app` | Login, MFA, passkey in page, vault unlock, refresh single owner, offline edits, reconnect; independent security review of browser key handling |
| 3     | Optional: hosted app against an operator's custom server           | operator origin      | Operator CORS opt-in; second independent origin passes the browser-login matrix; no cookies                                                    |

Phase 1 is the first time anyone can create real local data on the production origin. From then on the origin must not change without an export and import path.

## Acceptance

- A returning visitor with an active worker who opens `/account`, an emailed link, or the website's sign-in link sees the dashboard, not the application.
- `/` serves the application; `/account`, `/api/*`, `/live` and `/health` are never answered by the worker or the bundle.
- `sw.js`, `ngsw.json` and `index.html` are revalidated; a new release is picked up on the next visit; a rollback restores the previous release without data loss (existing `e2e/pwa/update-activation.spec.ts` plus a rollback case).
- The bundle and the dashboard carry different, verified CSPs. The application works under its policy with the default features, and the dashboard policy is unchanged.
- No request from the Phase 1 bundle reaches `/api/` (the standalone build has no sync engine).
- `curl -I` of a hashed asset (for example `chunk-*.js`) shows `immutable`; of `/account` shows `no-store`; of `/oauth/callback/google` returns the callback page, with an active worker.
- The upstream CORS default is gone from the server and a cross-origin request from an unlisted origin is rejected.

## Documentation conflicts resolved

| Conflict                                                                                                                  | Resolution                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Server extraction plan reserved `/app/` for the web client; the 0.3.0 plan (November 8) and the maintainer chose the root | Server extraction plan now says root, no `/app/`, and points here                                                    |
| Server extraction plan said to keep SPA fallback away from `/api/` and "account recovery routes" without saying how       | Path ownership table and the `navigationUrls` rule above                                                             |
| 0.3.0 plan listed "the supported browser build" in release acceptance while the website treats hosted web as coming soon  | Acceptance now reads "the account website in supported browsers"; hosted task application is explicitly not in 0.3.0 |
| Website account-integration doc said the web app "can be served separately alongside the account dashboard"               | Now says root of the same origin                                                                                     |
| `docs/release-and-publishing.md` described the Pages deploy without saying it is preview-only                             | Now states Pages is preview-only and production is the root of `app.ultratasks.app` via Caddy                        |
| OAuth plan required the web callback outside `/account` but not who serves it                                             | Now: an explicit file in the web bundle                                                                              |

Consistent already and unchanged: the collaboration plan's statement that a self-hosted server can serve the client at the same origin and that a hosted app calling a custom server needs bearer tokens and explicit CORS.

## Decisions on the open questions

1. **Same origin for the dashboard and the web application, with per-path headers.** Revisit only if the independent XSS and key-handling review finds the shared origin unacceptable, and then before enrolment opens: the WebAuthn RP ID is fixed once passkeys exist.
2. **Hosted web ships as Phase 1 on its own schedule, after the Caddy split is accepted on the VM**, and independently of 0.3.0 and of browser sync. The website's "coming soon" copy changes when it ships. Nothing is announced from the `pages.dev` preview.
3. **Bundle delivery is a release-attached tarball installed by the operator** with `scripts/install-web.sh`. Automating the VM side is a later improvement.
4. **The Pages preview stays** as `ultra-tasks-preview.pages.dev` for checking builds, marked `noindex`, and is not linked from anywhere.

## Still unverified

- The `deploy/Caddyfile` passes `caddy validate` (Caddy 2.11) and was run in Docker against a stand-in server and a fake bundle. Verified: `/` and static files come from the bundle; `/account`, `/api/*`, `/live`, `/health`, `/privacy.html` and `/terms.html` reach the server and carry no web-app CSP; `/oauth/callback/*` returns the callback page; `/`, `sw.js` and `ngsw.json` are `no-cache`; hashed files are `immutable`; with no bundle installed, `/` reaches the server. Not verified: TLS, WebSocket upgrades through Caddy, real server responses, and behaviour behind Cloudflare.
- The report-only CSP for the web bundle has not been checked against real usage.
- The nginx fragment in the server README for the external-proxy mode is illustrative.
- Whether the production VM uses the bundled Caddy or an existing host proxy (`ULTRA_EXTERNAL_PROXY`) is not recorded in either repository.
