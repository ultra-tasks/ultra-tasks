# Ultra Tasks identity

The production mark is **Faceted**: a white octagonal comet head with three straight geometric trails on a solid deep-teal (`#075b5e`) rounded square. The editable source is [logo.svg](../../src/assets/ultra-tasks/logo.svg). Its raster export is [logo.png](../../src/assets/ultra-tasks/logo.png); desktop packaging uses the matching [512px PNG](../../build/ultra-tasks.png).

Keep the approved proportions, sharp trail edges, flat white fill, and transparent outer padding when exporting. The rounded-square background is shared across platforms; monochrome tray and notification assets use the comet silhouette.

Run `npm run generate:icons` after editing the master to regenerate desktop, web, Android, iOS, store, tray, and notification assets. Platform details and validation are documented in [app-icons.md](../app-icons.md).

[generated-concept.png](generated-concept.png) archives an earlier identity exploration.

## README screenshots and social preview

The README uses real browser captures of the current app with disposable sample data, imported through the normal backup flow. The captures show Today in light and dark themes, Upcoming, a project board, and a running Focus session. No marketing overlays are added to the app screenshots, and sync state is not simulated. Background downloads are disabled.

```sh
npm run quiet -- screenshots:readme
```

The command starts the development server on port 4242, captures `screenshots/*.png`, and creates `social-preview.png` (1280 × 640) from the light Today capture and the approved logo. It uses the existing Playwright dependency and seed builder. Install Playwright Chromium if needed, or select an installed browser with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (for example `/usr/bin/chromium` on Linux). An already running app can be selected with `E2E_BASE_URL`.

The dataset clock is pinned to 4 November 2026. Review the output before committing it; screenshot files should contain sample tasks only. [Repository presentation](../repository-presentation.md) records GitHub description, topics, and social-preview upload instructions.
