# Mobile UI/UX audit

Status: the recommendations are implemented in the working tree on 2026-11-15 and
not committed: 28 of the 35 in full, 7 in part (H3, M1, A1, C1, PF3, PF4, PF5). What
differs from this note and what is left open is in
[Implementation status](#implementation-status); nothing was checked on a device.
Date: 2026-11-15.
Tracking: requested repository audit; no issue opened.
Audited: the working tree of `main` at `450095e680`, re-checked against `690537c6d9`
(the commits in between change CI, Electron signing and OAuth only; no UI file).
Line numbers below are from that tree and must be checked again before
implementation.

## Recommendation

The phone shell is structurally sound: its geometry holds at 320–430px, rows meet
the touch scale, the drawer's history handling and swipe-to-close work, and no
route scrolls horizontally. What feels clunky comes from five causes, none of which
needs a redesign of the shell:

1. **The header cannot fit its controls.** On a project page the title shrinks to
   its icon at 360px and to a clipped sliver at 390–412px; at 350px and below the
   project menu and the filter/sort/group button are removed with no other route.
2. **Menus are long, flat, cascading and not closed by Back.** The project menu is
   ten undivided rows, the task menu scrolls with Delete below the fold, and
   filter/sort/group opens three overlapping panels.
3. **Desktop features are hidden or missing on a phone with nothing in their place:**
   the Unscheduled panel, History and Metrics at 350px and below, the estimate at
   352px and below, habit names, Settings help, and every tooltip.
4. **From 600px up the desktop shell takes over.** Landscape phones, 7-inch tablets,
   unfolded foldables and split-screen windows get a 260px side nav; with a task
   open the list is 170–290px wide and card text wraps one character per line.
5. **Several screens and dialogs were never adapted:** Schedule, Habits, Boards,
   Finish day, Focus mode, the first-run welcome, and dialogs on short screens.

**Performance.** There is no single cause and no P0. Three things explain "sluggish at
times", measured as relative cost under a 4× CPU throttle (a stand-in for a mid-range
phone, not a phone): every list route change costs main-thread time in proportion to
the number of task rows (0.9–1.4s to enter a 91-row Today, 2.5–3.6s at 291 rows) plus a
190–250ms route animation; three live backdrop-blur surfaces run on the phone, and the
full-screen content sheet's is visually a no-op yet about half of the blur work; and
the cold start takes about 4s to the first rows after 5.9MB of eager JavaScript. The
1Hz tracking tick, the header fade mask, op-log writes and per-row shadows were tested
and are not causes. A zero-code test on a phone: Settings › General › Appearance ›
Glass off. If the app then feels smooth, blur is the main cost (PF1).

No new settings, dependencies, task fields or sync changes are needed. Every
recommendation reuses an existing component, token or pattern; where one moves a
control it leaves a clear route to the same action (the desktop audit's rule).
The [product principles](../../AGENTS.md#product-principles) hold: the persistent
"Add task" row (T1) is the existing inline row made reachable, not a new button.

Start with H1, L1, T1, T2, T3, D1, D4, A1 and PF1: each is small or contained, visible
in daily use, and independent of the others. Then the menus (M1–M3), the rest of H and
PF2, then the screens.

## Implementation status

Written after the implementation, which is in the working tree of `main` and not
committed. 28 recommendations are DONE, 7 are PARTIAL (the last column says what
is not done) and none is NOT DONE. Nothing was run on an Android device, and the
numbers are the implementers' own Chromium measurements (360×740, 4× CPU where
throttled, relative only), not re-run for this table. Where the code differs from
what this note recommends, see [Deviations from this note](#deviations-from-this-note).

| Ref | Status  | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Left open                                                                                                                                                                                                                                                                                                 |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | DONE    | One "Page options" ⋮ below 600px (`page-options-menu`: layouts, Sort/group/filter, then the work-context items; a dot when a customisation is on). The 350px special case and `isXxxs` are gone, and the title keeps an 8ch floor. A short project name now shows whole at 320–412px (0 to 14px of it before), and the ⋮ is back at 320px.                                                                                                                                                                                                                               | On the busiest seed (sync, Focus, three counters) the title box is about 108px, not 140, and the row still scrolls (12px at 360px, 52px at 320px; the sync button is clipped but reachable at 320px). A hard floor cannot hug a short name.                                                               |
| L1  | DONE    | `LayoutService.isCompactShell` (below 960px): the side nav is the 56px rail whatever the saved choice says (never overwritten), every right panel opens as a bottom sheet, and an open panel moves between sheet and column across 960px. At 600×960 the nav went 260 → 56px and the first card 138 → 512px wide.                                                                                                                                                                                                                                                        | The handover waits for a `popstate` (250ms fallback) and is covered by unit and e2e specs, not by a device. An unfolded foldable and a split-screen window are device checks.                                                                                                                             |
| H2  | DONE    | History, Metrics and Daily summary name themselves in the header, with their icon and the context as a muted suffix ("History · Work"); a plain heading, not a link; ⋮ stays.                                                                                                                                                                                                                                                                                                                                                                                            | At 360px on a busy header the context truncates at the title floor ("History · W…", "Daily sum…").                                                                                                                                                                                                        |
| H3  | PARTIAL | Play is named for its state and task ("Start tracking time", "Resume tracking: {task}", "Pause tracking: {task}") and is 48px on touch through the shared `.mat-mini-fab-touch`. The tracked task is a one-line chip on phones, the sort/group/filter button is named, plugin buttons have `aria-label`, and header hover rules sit under `(hover: hover)`.                                                                                                                                                                                                              | Focus "edit sessions" and counter editing keep only their long-press route, and the simple-counter hover rules are not gated. The chip can cover the first row at the right edge.                                                                                                                         |
| M1  | PARTIAL | Work-context menu: five groups with dividers, "Project settings"/"Tag settings", a distinct Duplicate glyph, Delete last and warn-coloured (10 undivided rows → 15 rows, 5 dividers). Task menu: grouped, "Tomorrow"/"Next week", no Focus entry on touch, "Select several tasks…" from 11th to 4th, Delete last, key hints hidden on touch. Sort, group and filter is one bottom sheet instead of three overlapping panels.                                                                                                                                             | The task menu is not a phone sheet (nested submenus, a script-positioned panel and the touch patch make that a rewrite of its navigation). The sheet's sub-views push no history entries, so Android Back closes the whole sheet. SuperSync specs that match "Settings" or "Delete project" were not run. |
| M2  | DONE    | `AndroidBackButtonService` step 2b closes the top menu, select, picker or sheet (Escape on `<body>`; the backdrop is looked up inside the overlay's host, where the Popover API layout puts it, and a spec opens a real CDK overlay) before the history steps; step 2c lets a create/edit dialog answer first; leaving the phone shell with the drawer open clears its history entry.                                                                                                                                                                                    | Unit-tested only: Android Back cannot be exercised in a desktop browser. Device check.                                                                                                                                                                                                                    |
| M3  | DONE    | A sticky drawer header (brand, Close) and footer (Help, Settings), each with its own safe-area inset; the 80px dead strip is gone; the row whose menu is open is marked; one first-use hint; the Ctrl+F chip and the keyboard tour are hidden on touch; the notes toggle reads "Notes" (still "Project Notes" on a project).                                                                                                                                                                                                                                             | None.                                                                                                                                                                                                                                                                                                     |
| T1  | DONE    | The inline "Add task" row is sticky above the nav below 600px (`.pin-above-nav`, `--z-pinned-add-row`), with a card surface while pinned; a sectioned list pins the bottom section's row; Search lists Actions first when empty. 60 tasks scrolled mid-list: the row is at 596px (it was 2,219px, off screen).                                                                                                                                                                                                                                                           | Without scroll-state queries the card surface is always on. The pinned row's label does not name its section.                                                                                                                                                                                             |
| T2  | DONE    | The estimate stays on every row (it was gone at 320px) with a 40px tap zone on touch; chips sit lower on phones (`--task-badge-offset`) and cover 25% of the glyph (was 42%); done rows use muted ink and a strike-through, no opacity (7.1:1 light, 6.2:1 dark; was 2.1 and 2.7); Upcoming day buttons are 40px boxes around the 36px circle.                                                                                                                                                                                                                           | The estimate zone narrows the title by about 35px at 320px. The done look changed on desktop too, and the subtask toggle's hairline ring shows at every width.                                                                                                                                            |
| T3  | DONE    | The task panel opens with Description folded when the task has no notes (a `linkedSignal` keyed on the task id) and creates the editor only when it opens; the Notes target, "Add description" and a tap on the header still open it. A task sheet without notes: 8 of 8 rows above the fold (was 4).                                                                                                                                                                                                                                                                    | A panel built before a new note reaches the store opens folded, and a sheet rebuilt by a resize can hit that. Fresh tasks have no editor until opened (the e2e specs use `expandTaskNotes`).                                                                                                              |
| S1  | DONE    | Below 600px of page width the toolbar is two rows and the view switch never shrinks (Month toggle 0 of 26px visible → 48px); on a phone a month cell is one tap target that opens the day, with up to three dots (hollow for a repeat); "Tap to add a task" under touch; event type on tokens.                                                                                                                                                                                                                                                                           | Dots follow the viewport and the toolbar follows the container: between 600px and about 860px with the sidebar open the toolbar is two rows and the month still shows chips. The phone toolbar is 44px taller.                                                                                            |
| S2  | DONE    | Below 600px a habit is two lines, icon and name then seven day cells (43×30 → 49×48px, circle 30 → 40px); the 17 literal font sizes and the colour, radius, shadow and transition literals are tokens; smallest text 9 → 13px; the drag preview is a card with both lines.                                                                                                                                                                                                                                                                                               | Weekday names use `--type-label` (uppercase), not `--type-meta`. Long-press reorder was checked with real touch events in Chromium, not on a device.                                                                                                                                                      |
| S3  | DONE    | Below 600px the panels stack and nothing scrolls inside them (a swipe in the last panel moves the page); the column count follows the page container; the "Schedule task" chip is 48×40px on touch.                                                                                                                                                                                                                                                                                                                                                                      | The optional collapse of panels behind headers was not done (it conflicts with `cdkDropListGroup` drag). Dragging across stacked panels needs a device.                                                                                                                                                   |
| S4  | DONE    | A labelled "Unscheduled" chip in the Upcoming strip opens the panel's rows in a bottom sheet on phones; Calendar's empty-week "Plan unscheduled tasks" opens the same sheet (it went to Upcoming with nothing open).                                                                                                                                                                                                                                                                                                                                                     | Drag to a day stays desktop-only; each sheet row has its own Schedule button.                                                                                                                                                                                                                             |
| S5  | DONE    | On a phone the Daily summary shows its figures as one three-column strip and the habits as a chip row, pins "Finish the day", wraps the composer's actions and shows review tables as two-line hairline cards (`data-label`); the Metrics table wraps its headers. At 360px the page is 2,403px (was 3,068).                                                                                                                                                                                                                                                             | The pinned bar covers about 64px of the review while scrolling. The `.material-table` phone rules apply to every such table (History and Metrics checked), and the composer's wrap reaches into `add-task-bar-actions` with `::ng-deep`.                                                                  |
| S6  | DONE    | The welcome dialog's footer is outside the scrolling part and the dialog is capped by the safe-area insets: Continue is visible at 360×740, 360×640 and 320×568 (it was 7, 107 and 195px below the fold). The "Tap Add task" tip shows only on task lists.                                                                                                                                                                                                                                                                                                               | The tip gate reads the URL (`/tasks`). The desktop dialog is about 8px taller.                                                                                                                                                                                                                            |
| S7  | DONE    | Under 500px of height the mode selector gets its own row (from 600px wide) and the close label is an icon; under 420px the edge rows and the play button are 56px; the finish check stays inside the row at 320px and "Countdown" stays on one line. At 740×360 the task button works (it hit Pomodoro).                                                                                                                                                                                                                                                                 | A 320px-tall landscape window still cannot fit. The 397px label rule and the 500px close-label rule also reach 360px phones and short desktop windows.                                                                                                                                                    |
| D1  | DONE    | On touch the "?" toggles a help card under the row (`aria-expanded`, no timer, a second tap closes it); mouse and keyboard keep the tooltip.                                                                                                                                                                                                                                                                                                                                                                                                                             | None.                                                                                                                                                                                                                                                                                                     |
| D2  | DONE    | Categories come from content (`getSettingsCategories`): no Keyboard shortcuts on touch-only phones or in the Android app, and an "About" category on phones (version to copy, changelog, update check, logs, privacy policy). The Idle handling section is hidden on mobile.                                                                                                                                                                                                                                                                                             | None.                                                                                                                                                                                                                                                                                                     |
| D3  | DONE    | A short touch window (`(max-height: 500px) and (pointer: coarse)`) gets the full-screen drill-down for Settings and Plugins (56px header, no footer, search in the header). Back returns from a category to the list through a history state. Plugins is titled "Plugins & integrations" with a one-row toolbar. 600px is now two-pane, like 601px.                                                                                                                                                                                                                      | System Back was not tried on a device.                                                                                                                                                                                                                                                                    |
| D4  | DONE    | The dialog pane's max-height is a length, the `form` and `.dialog-help-wrapper` chain is `display: contents`, dialog hosts no longer set `display`, title and actions pad less under 480px of height, and the windowed notes editor drops its toolbar under 400px. Action rows that fell 13–132px below the window are on screen.                                                                                                                                                                                                                                        | A dialog component must not set `:host { display }`.                                                                                                                                                                                                                                                      |
| D5  | DONE    | Form-row toggles switch from a tap anywhere on the row; `inputmode`, `autocapitalize`, `autocorrect`, `spellcheck` and `enterkeyhint` come from a formly extension and the prompt dialog; `useDiscardGuard` on Create project, Create tag, Repeat and Sync config, with hardware Back showing the same prompt (`dialog-back-handler.util.ts`, Back step 2c); one boolean control; "Project settings" title; the WebDAV warning is `info-panel--warning`.                                                                                                                 | Not run on a device: IME hints and Back with a dirty dialog. `enterkeyhint="done"` applies to every formly text input (a field before another sets `next`). Any toggle in a form field now has a whole-row hit area, which would cover a link inside its label (none today).                              |
| A1  | PARTIAL | The app now sets the bar style through `SystemBars.setStyle` and repaints the bar colours on `orientationchange`, `resize` and the colour-scheme change (`core/theme/android-system-bars.util.ts`); `values-v35/styles.xml` carries every item of `values/styles.xml`.                                                                                                                                                                                                                                                                                                   | Implemented and unit-tested, and shown on a simulated bridge only (3 bar calls at start and none after a rotation before, 5 and the full set again after); not confirmed on a device. 4–5 bridge calls per keyboard open or close.                                                                        |
| PF1 | DONE    | `.route-wrapper` keeps its tint and loses `backdrop-filter`; `contain: layout` keeps its containing block and stacking context. Pixel difference of the sheet at 360×740, dpr 3: at most 2/255 in light, 3/255 in dark; Glass off 0; desktop unchanged.                                                                                                                                                                                                                                                                                                                  | Step 2 (the overlay tier for the header and the pill) is not done, and the phone-GPU gain is not measured.                                                                                                                                                                                                |
| PF2 | DONE    | The route transition is skipped on a phone and for lists over 40 rows (`ROUTE_ANIMATION_MAX_ROWS`). 91-row Today at 4× CPU: Inbox → Today ready 2,994 → 2,252ms, Upcoming → Inbox 1,476 → 488ms.                                                                                                                                                                                                                                                                                                                                                                         | Relative numbers, not a phone.                                                                                                                                                                                                                                                                            |
| PF3 | PARTIAL | `content-visibility: auto` on a list's own rows with an intrinsic size of 54px (58px on touch), not while `.ng-animating`; the Markdown editor is created only when the Description opens; a search reveal stays centred while estimates are replaced. 291 rows, paired A/B: task sheet 584 → 319ms, Today 6,919 → 4,896ms.                                                                                                                                                                                                                                              | Progressive rendering is not done (a partial DOM touches drag indices, multi-select ranges, keyboard navigation and reveal). The scroll range is an estimate until a row has been drawn once; a list still animating in at start-up (40ms per row) is not covered.                                        |
| PF4 | PARTIAL | The icon font is requested by an inline script in `index.html` (`document.fonts.load`): icons after the shell 263 → 9ms at 4× CPU. Bundled plugin discovery fetches all 21 manifests and icons at once (at most 2 requests in flight → 41).                                                                                                                                                                                                                                                                                                                              | Issue providers, the plugin runtime and zod are not lazy (see Follow-ups). The first task row at cold start went 14.3 → 11.0s, but that gain is the whole tree's and noisy, not PF4's. `ng build -c development` "Initial total" is 16.63MB before and 16.70MB now; 9.92MB is the dev server's figure.    |
| T4  | DONE    | Capture bar: labelled pickers first, the issue-search toggle only with a provider, no shortcut text in the touch placeholder. The reschedule snack has an Undo (`TaskPlanUndoService`). The drag delay is `{ touch: DRAG_DELAY_FOR_TOUCH, mouse: 0 }` in the task list, work view and planner. Attachment edit, copy and delete are a 40px strip under `(hover: none)`. The summary row reads "~3h 5m left".                                                                                                                                                             | The delete confirm was kept (the delete snack's Undo is exact, so dropping the confirm on touch is a follow-up). Undo covers plain tasks only. Swipe-right against the OS back-gesture zone is a device check.                                                                                            |
| H4  | DONE    | Browse is marked on every page that is none of the three tabs (glyph `folder_open`, as in the drawer); re-tapping the open tab scrolls the page to the top (900 → 0px); "Upcoming" no longer clips at 320px.                                                                                                                                                                                                                                                                                                                                                             | None.                                                                                                                                                                                                                                                                                                     |
| S8  | DONE    | Upcoming strip: a 48px toggle row, and the expanded label is the date range. The overdue block is one "From previous days (N)" line with an "Add to Today" action (480 → 40px). Recurring shows the repeat glyph, the recurrence under the title and a muted "Paused". Archived has a Restore/Reopen text button on phones, 48px links and search above six projects only. Integrations drops its second title and shows one `.empty-state` with Connect until a provider exists. The Help › Contribute row is gone, and the Search page does not autofocus under touch. | The overdue action is "Add to Today", not "Reschedule" (no multi-task reschedule flow exists). The strip is 20px taller and its expanded label longer (not checked at 320px or in long locales). Of the five empty-state treatments only Integrations needed a change.                                    |
| A2  | DONE    | Five of the six bullets: the snackbar gap is 32px at every bottom inset (`--snack-pill-inset`), bottom sheets pad `--safe-area-bottom`, the windowed notes dialog no longer double-counts the insets, the add-task bar's top fallback adds `--safe-area-top`, and `.inset-scrim` covers the strip under the pill.                                                                                                                                                                                                                                                        | The legacy online shell (`FullscreenActivity.kt`) has no change, by design: it is reached only by an upgrade with legacy data or `LAUNCH_MODE=1`.                                                                                                                                                         |
| A3  | DONE    | `body.isKeyboardVisible` hides the nav and its scrim and sets `--shell-inset-bottom: 0` (the pill stayed and the inset was 80px at 440 and 300px of height).                                                                                                                                                                                                                                                                                                                                                                                                             | The iOS and Android apps set the class; Android Chrome never does, so there the nav stays.                                                                                                                                                                                                                |
| C1  | PARTIAL | Phone breakpoint literals go through `mq()` (the TypeScript constants live in `layout.service.ts`); `.isTouchOnly` and `.isNoTouchOnly` consumers moved to `.isTouchPrimary`, `.isMousePrimary`, `(hover: none)` or `(pointer: coarse)`; `vh` before `dvh`; `var()` media queries fixed; `@supports` fallbacks for the glass tokens; token drift fixed in the touched files.                                                                                                                                                                                             | The WebView floor was not raised (the owner's decision, see Follow-ups). Token drift outside the touched files remains (schedule week grid, Focus hero sizes), and the self-check grep still finds six non-phone sites.                                                                                   |
| C2  | DONE    | Shortcut chips and the cheat-sheet row on Search (8 → 0 visible on touch), the Ctrl+F chip, the task menu's key hints, the Schedule create hint, the capture note placeholder, the notes toolbar's keyboard button and the keyboard tour are hidden on touch.                                                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                                                                                                                                                     |
| PF5 | PARTIAL | The work-view debug payload no longer forces layout (`recordSearchNavDebug(event, () => payload)`), and the planner strip measures from a `ResizeObserver` callback (forced style and layout on Today → Upcoming at 4× CPU: median 357–572ms → 0).                                                                                                                                                                                                                                                                                                                       | Passive touch listeners in `pan.directive.ts` are NOT done and were reverted: a passive `touchmove` leaves Chrome's scroll gesture alive after a sideways pan, so the next tap produces no click. Root custom-property writes are helped only by `content-visibility`.                                    |

## Deviations from this note

- **PF1, `container-type`.** The note says step 1 keeps the wrapper's containing
  block through `container-type`. In Chromium 149 it does not make a containing
  block for `position: fixed` descendants; the removed filter did, and it made a
  stacking context too. `contain: layout` was added on that rule (glass on only),
  and the multi-select bar still centres on the content column.
- **L1.** The compact shell is a viewport rule, below 960px, not "when the main
  column would be under about 480px".
- **H1.** The title box is about 108px on the busiest seed, not 140: a floor cannot
  hug a short name, so "Work" leaves about 30px unfilled.
- **H3.** Play (disabling the feature) and Sync (its settings) have a route besides
  the long-press (Settings › App features; Settings › Sync and Search's "Set up
  sync"); Focus "edit sessions" and counter editing have none.
- **M1.** The task menu is regrouped, relabelled and capped to the screen, not a
  sheet. Sort, group and filter is a sheet whose sub-views push no history entry.
- **M2.** Step 2b skips dialogs (they keep their own step) and, while a
  history-backed panel is open, leaves a non-transparent backdrop to that panel.
  Step 2c, a dirty create or edit dialog answering Back itself, is an addition that
  came with the discard guard (D5).
- **T4.** The Undo on the reschedule snack comes from a new `TaskPlanUndoService`,
  not from `TaskUndoService.undo()` alone: that service records only plain
  unscheduled Today plans and any other action clears it, so tracked or
  already-planned tasks got no Undo. The delete confirm was kept.
- **S3.** The optional collapse of panels behind headers was not done.
- **S8.** The overdue block's action is "Add to Today", the expanded strip is
  labelled by its date range (not the first week), and the Help › Contribute row
  was removed: the Support us page has the same sentence and the same
  CONTRIBUTING.md button, and the "Support us page" feature toggle now controls
  the one way in (`T.MH.HM.CONTRIBUTE` is unused but left in `en.json`).
- **D2.** The Idle handling section is hidden whole on a phone or tablet, not
  reduced to one paragraph.
- **D5.** Form-row toggles get a label overlay over the field box, with the switch
  above it, not `display: flex; width: 100%` on `mat-slide-toggle`.
- **PF2.** A `skip` parameter in the `warpRoute` state binding instead of
  `[@.disabled]`, which would also stop the animations inside the page and the
  daily-summary warp.
- **PF3.** The intrinsic size is the one-line row less its borders (54px, 58px on
  touch) inside an `@supports`, not a plain `56px`. Rows that are animating are
  excluded: the list's enter animation starts every new row at `height: 0`, and a
  row skipped in that state remembers a 2px box for good (45 of 79 rows, a scroll
  range of 4.3k instead of 7k).
- **PF4.** No `<link rel="preload">` for the icon font: its URL carries a content
  hash in production builds, and a preload of the other URL would download the
  467KB file twice. An inline script calls `document.fonts.load()` as soon as the
  face is declared instead.
- **PF5.** The passive touch listeners were reverted (see the table).
- **C1.** The glass tokens got `@supports not (color: color-mix(...))` fallbacks
  and the WebView floors stay as they were (107 minimum, 110 recommended, and
  Chrome 107 in `.browserslistrc`).
- **A1.** The bars are also repainted on the colour-scheme change, because a
  system dark-mode flip fires neither `orientationchange` nor `resize`.

## Still to check on a device

In addition to [On-device checks](#on-device-checks), from the implementers' risks:

1. **A1:** the icon style and the strip colour after a rotation, a dark-mode flip
   and a hardware keyboard, with the five-minute check above; and the 4–5 bridge
   calls per keyboard open or close.
2. **M2 and D5:** Android Back with a menu, a select or a sheet open, in the
   customizer sheet (it closes the whole sheet), and with a dirty create or edit
   dialog over the Browse drawer (it must ask, not navigate).
3. **L1:** a task panel open across a rotation or an unfold (the sheet and column
   hand over on a `popstate`, with a 250ms fallback), at 600–959px.
4. **Boards, Habits and Upcoming:** dragging a task across stacked Boards panels,
   the Habits long-press reorder, and the planner strip's tap and drag on its new
   toggle row.
5. **D1–D5:** IME suggestion strips and `enterkeyhint` in dialogs and Settings, a
   WebView below Chrome 108 for the `vh` fallbacks, and system Back in the
   Settings drill-down.
6. **PF1 and PF3:** the GPU cost of the remaining blur layers on a mid-range GPU,
   a device without `backdrop-filter`, and the scroll range of a long list before
   every row has been drawn once.
7. **PF5:** scroll start with the blocking `touchstart` and `touchmove` listeners
   still in place on every row.
8. **T1:** a WebView without scroll-state queries (the pinned row keeps its card
   surface on), and the tracked-task chip and the pinned "Finish the day" bar
   against the content they cover.
9. **T4:** the first touch swipe after a mouse, pen or DeX move, the add-task bar's
   fallback position, and swipe-right-to-complete against the OS edge-back zone.
10. **C1:** a WebView 107–110 for the glass fallbacks.

## Follow-ups

- **Cold start (PF4):** `zod` is imported through the single `@sp/shared-schema`
  tsup bundle, which also exports constants that eager code needs, and the
  validators are a synchronous port of 12 functions: lazy-loading it needs a package
  build split and an async port, which is a sync and op-log API change. The issue
  providers are reached from `IssueService` (six `*CommonInterfacesService` injected
  at construction), from effects registered statically in `feature-stores.module`
  and from `issue.const` (form configs), about ten files in all. The plugin runtime
  has 8 static importers and 38 files outside `plugins/` import plugin modules.
  `src/assets/i18n/en.json` (259KB) is imported into the eager graph as the offline
  fallback and also fetched at boot, so it ships twice. `@codemirror/*` is about
  600KB eager in the development build.
- **WebView floor:** raising `MIN_CHROMIUM_VERSION`, `RECOMMENDED_CHROMIUM_VERSION`
  and `.browserslistrc` to 111 is the owner's decision. About 359 `color-mix()` uses
  in the production CSS and 106 in component styles have no fallback and are
  dropped below 111; only the three glass tokens have one.
- **Delete confirm on touch:** the delete snack's Undo is exact, so the "Are you
  sure?" could go on touch.
- **Focus session editing and counter editing** have only the long-press route
  (H3); the simple-counter hover rules are not gated.
- **Task menu as a phone sheet** (M1) and **Boards panel collapse** (S3).
- **Progressive list rendering** (PF3): a partial DOM touches drag indices,
  multi-select ranges, keyboard navigation and reveal.
- **Pointer-based pan:** an alternative to evaluate on a device if the blocking
  touch listeners show up in scroll start (PF5).
- **Month dots against the toolbar** (S1): both could follow the container.
- **Token drift** in files nobody touched (the schedule week grid, Focus hero
  sizes) and the rest of C1's list.
- **SuperSync specs** that open the project menu's "Settings" (now "Project
  settings") or its "Delete project" row were not run.
- **E2E on this Windows machine:** the e2e global setup sets Node's `TZ` but
  Chromium uses the OS zone, so in the evening some specs (Schedule day view,
  repeat inheritance) fail on a clean baseline too; run with
  `E2E_TZ=America/Bogota` (or your own zone).
- **Dev server:** a Karma run that deletes `dist/test-out` while `ng serve` watches
  without polling crashes the dev server (`chokidar` EPERM); start it with
  `ng serve --poll`.
- **Known limits of the Back chain** (from a review of the implementation; see the
  end of the Back section in
  [android-edge-to-edge-keyboard.md](../android-edge-to-edge-keyboard.md)): a
  `popstate` disposes a dirty dialog without the discard question when the drawer
  leaves the phone shell or the task panel changes between sheet and column; a plain
  dialog over a history-backed overlay closes together with it; the notes sheet
  leaves a stale history entry when dismissed by its backdrop; and a first colour
  pick does not arm the Create dialogs' discard question.
- **Device checks** above, then retire this note, as the order section says.

## The Android top bar

**What is known.** The web side of the inset chain is sound. Real
`env(safe-area-inset-*)` was emulated through Chromium (3 widths × status bar
0/24/32/48 × bottom 0/34) and the Capacitor-style injected variables were
emulated separately (120 cases): the header is always `56 + inset` tall at y=0
with its buttons below the inset, 15 routes clear it, and the bottom nav clears the
bottom inset. The `:root`/`body` token split is correct, and an inline change
re-flows in the same frame. The clipping, double-inset, action-row-fade and
sticky-row explanations were each tested and ruled out for the phone shell.

**What could still look "cut off", ranked** (likelihoods are the reviewers'
estimates; "T" = reproduced here, "D" = needs a device):

1. **T, about 25%: the page title is truncated** on project and tag pages (H1).
   At 360px with sync on it is an icon only; at 412px "Pers…". Independent of the
   device and of any inset.
2. **D, about 20%: status and navigation bar icons turn white on the light header
   after any configuration change** (A1): rotation, a system dark-mode flip, a
   hardware keyboard, a display-size change or folding. Verified in Capacitor's
   source; the effect itself is unconfirmed on a device.
3. **D, about 20%: the passthrough band** (WebView 140 or newer, which is nearly
   every current phone) puts the glass header under the status bar and relies on
   `--safe-area-top` being the bar's height. This band has never been checked on a
   device or in CI (`docs/android-edge-to-edge-keyboard.md` says so), and OEM
   passthrough reports exist upstream (capacitor#8622, #9462).
4. **D, about 15%: WebView older than 140** (AVD images, custom ROMs): the header
   sits below a flat strip with no glass behind the bar, and that strip's colour
   reverts to the system theme after a configuration change.
5. **At 600px or wider** (landscape, foldable, split-screen, freeform windows) the
   desktop header is used, placed by `body.isNativeMobile { padding-top }`
   (`src/styles.scss:63-75`), a different inset path from the phone shell (L1).
6. **Display size or font size "Largest"** shrinks the CSS width to about 320–340px
   (the 350px branch) and inflates text inside the fixed 56px band and 64px pill.
7. Smaller: cold start on API 35 shows a dark status bar until the plugin loads
   (A1), and the legacy online shell has no bar handling (A2).

**Do not change inset code before the check below.** This area has regressed
repeatedly (#8295, #8508, #9316); a blind web-side minimum inset is exactly the
pattern those issues recorded.

**Five-minute check on the phone.** Take a screenshot in portrait, rotate and
rotate back, take another (icons: item 2), and open a project whose name is longer
than six characters (title: item 1). On a debug build, open `chrome://inspect`,
attach to the WebView and paste:

```js
(() => {
  const c = getComputedStyle(document.documentElement);
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);height:0';
  document.body.append(p);
  const env = p.getBoundingClientRect().top;
  p.remove();
  const w = document.querySelector('main-header .wrapper').getBoundingClientRect();
  const t = document.querySelector('main-header page-title');
  const e =
    t &&
    [t, ...t.querySelectorAll('*')].find(
      (x) => getComputedStyle(x).textOverflow === 'ellipsis',
    );
  return JSON.stringify({
    wv: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    capacitor: !!window.Capacitor?.isNativePlatform?.(),
    dpr: devicePixelRatio,
    innerH: innerHeight,
    vvTop: visualViewport.offsetTop,
    env,
    injected: c.getPropertyValue('--safe-area-inset-top'),
    overlap: c.getPropertyValue('--android-status-bar-overlap'),
    safeTop: c.getPropertyValue('--safe-area-top'),
    hdrTop: w.top,
    hdrH: w.height,
    title: e && [e.clientWidth, e.scrollWidth],
  });
})();
```

For a release build `chrome://inspect` sees nothing; use the screenshots and these
`adb` lines instead (read the WebView line from `dumpsys`, not from Settings, which
can show an installed but disabled package):

```bash
adb shell getprop ro.build.version.sdk
adb shell dumpsys webviewupdate | grep -iE "Current WebView package|version"
adb shell settings get secure navigation_mode      # 0 three-button, 2 gesture
adb shell wm size; adb shell wm density
adb shell dumpsys window | grep -iE "type=statusBars"   # frame / density = bar dp
adb shell dumpsys activity activities | grep -i resumed
```

Reading the result:

- `capacitor: false` → the legacy online shell (A2).
- `safeTop` equals the bar height in dp, `hdrH` is `56 + safeTop`, `hdrTop` is 0 and
  the title pair is `[client, scroll]` with `client` less than `scroll` → the
  insets are right; the cause is the title (H1) and, after a rotation, the icons (A1).
- `safeTop` short while `injected` is empty or small and `innerH × dpr` is about the
  screen height → the passthrough band is not delivering the inset (item 3). Collect
  the WebView version and the SystemBars log before touching code.
- `injected` is `"0px"`, `safeTop` is 0 and `innerH × dpr` is below the screen
  height → the non-passthrough band (item 4); expected.
- `overlap` set and different from `injected` → the native shim and SystemBars
  disagree: `adb shell setprop log.tag.SUPKeyboard DEBUG` then
  `adb logcat -s SUPKeyboard`.

## Prioritized recommendations

P0 = looks broken or blocks a task on a common phone. P1 = clearly clunky,
confusing or inconsistent with the redesigned desktop. P2 = polish. Effort is
relative scope (S under an hour, M half a day, L days). Evidence: **V** reproduced
or measured in Chromium here; **V+D** reproduced here, confirm on a device;
**I** inferred from code, documentation or a JVM run.

| Ref | Pri | Where                                       | Recommendation                                                                    | Effort    | Evidence |
| --- | --- | ------------------------------------------- | --------------------------------------------------------------------------------- | --------- | -------- |
| H1  | P0  | Page header                                 | One "Page options" menu and a title that never collapses; keep it at every width. | M         | V        |
| L1  | P0  | Shell at 600px and up                       | Add a compact step: rail nav and bottom-sheet panels below 960px; one breakpoint. | M–L       | V        |
| H2  | P1  | History, Metrics, Daily summary             | Give these pages a name in the header.                                            | S         | V        |
| H3  | P1  | Header controls                             | Names that say what happens, 48px Play, tracked task visible, hover rules gated.  | S–M       | V        |
| M1  | P1  | Menus                                       | One pattern (popover or sheet); fix project, task and filter/sort/group menus.    | S–L       | V        |
| M2  | P1  | Back and rotation                           | Back closes the top menu; rotation clears drawer and keeps open panels.           | S         | V, I     |
| M3  | P1  | Browse drawer                               | Sticky Close and Help/Settings footer; long-press cue; hide desktop-only rows.    | S–M       | V        |
| T1  | P1  | Task lists                                  | Keep the inline "Add task" row reachable on long lists.                           | S–M       | V        |
| T2  | P1  | Task row                                    | Keep the estimate at 352px and below; un-clip chips; readable Done rows.          | S         | V        |
| T3  | P1  | Task sheet                                  | Open with Description collapsed when empty.                                       | S         | V        |
| S1  | P1  | Schedule                                    | Toolbar that fits; month cells that read.                                         | S–M       | V        |
| S2  | P1  | Habits                                      | Show habit names; real tap targets.                                               | M         | V        |
| S3  | P1  | Boards                                      | No scroll inside scroll; panels that collapse.                                    | S–M       | V        |
| S4  | P1  | Unscheduled tasks                           | A phone route to the panel, or remove the dead-end button.                        | S–M       | V        |
| S5  | P1  | Finish day, Daily summary, Metrics          | A compact summary; tables as cards; a reachable "Finish the day".                 | M         | V        |
| S6  | P1  | First-run welcome                           | Pin "Continue"; honour insets; show the hint only on the work view.               | S–M       | V, I     |
| S7  | P1  | Focus mode                                  | Reserve the selector row on short screens.                                        | S         | V        |
| D1  | P1  | Settings help                               | Make the "?" buttons work on touch.                                               | S–M       | V        |
| D2  | P1  | Settings categories                         | Derive the list from content; add an "About" row.                                 | S         | V        |
| D3  | P1  | Settings and Plugins windows                | Landscape and short-screen layout; real Back from a category.                     | M         | V, I     |
| D4  | P1  | Dialogs                                     | Keep actions on screen on short viewports and with the keyboard up.               | S–M       | V        |
| D5  | P1  | Toggles, forms                              | Whole-row toggles; mobile keyboard hints; guard against stray dismissal.          | S–M       | V        |
| A1  | P1  | Native status and navigation bars           | Keep the icon style after configuration changes; complete the API 35 theme.       | S         | I        |
| PF1 | P1  | Glass surfaces                              | Remove the blur from the content sheet (visually identical); try Glass off first. | S         | V, I     |
| PF2 | P1  | Route changes                               | Skip or shorten the route animation for big lists and on phones.                  | S–M       | V        |
| PF3 | P1  | Task lists                                  | `content-visibility` on rows now; progressive rendering later.                    | S, then L | V        |
| PF4 | P1  | Cold start                                  | Lazy-load zod, issue providers and the plugin runtime; preload the icon font.     | L         | V        |
| T4  | P2  | Capture, undo, drag, attachments            | Five small touch fixes.                                                           | S each    | V        |
| H4  | P2  | Bottom nav                                  | "You are here" on every route; re-tap scrolls to top; "Upcoming" fits at 320px.   | S         | V        |
| S8  | P2  | Planner strip, Upcoming, Recurring, Archive | Eight small screen fixes.                                                         | S each    | V        |
| A2  | P2  | Bottom insets and legacy shell              | Six places that double-count or ignore an inset.                                  | S each    | V, I     |
| A3  | P2  | Keyboard up                                 | Hide the floating nav while the keyboard is open.                                 | S         | V        |
| C1  | P2  | Breakpoints, touch detection, WebView floor | One breakpoint source; one touch classifier; WebView floor matches the CSS.       | S–M       | V, I     |
| C2  | P2  | Keyboard-only hints                         | Hide shortcut chips and Ctrl hints on touch.                                      | S         | V        |
| PF5 | P2  | Smaller costs                               | Passive swipe listeners, two forced layouts, a lazy editor, root-property writes. | S–M       | V, I     |

## H — Header and page identity

### H1. One page-options menu and a title that never collapses (P0)

**Observed:** On a project page at 360px with sync on, the title box is 0px wide
(icon only); at 390px about 30px ("P…"); at 412px "Pers…" or "Open…". Wider phones
show less than a 320px one because only 350px and below drops controls. The row
holds the icon, ⋮, a sort/filter button, Play, Focus, Sync and a bordered
Project-view button (48/48/40/48/48/42px); a counters tray adds 48px. The budget at
360px is 344px usable − 108 (⋮ and filter block) − 198 (the rest) ≈ 38px.
`--header-title-text-min` is `0px` below 600px (`main-header.component.scss:63`; the
6ch floor starts at 600, `:65-69`), the compact Project-view menu is mounted in the
row (`main-header.component.html:141-143`), and the title shrinks first
(`page-title.component.ts:216,250`). At 350px and below the title's own buttons are
removed (`page-title.component.ts:89`, a private `(max-width: 350px)` signal at
`:554`), so a 320px phone cannot open filter/sort/group or the project menu from the
header, and Today's History and Metrics have no other route (Today is `desktopOnly`
in the drawer and has no row menu). The title is also a no-op link on project and
tag pages. This is the most likely reading of "the top bar seemed cut off" that
needs no safe-area fault.

**Change:** Stopgap (S): a phone title floor of about 8ch. Proper (M): below 600px
fold ⋮, the sort/filter button and the Project-view button into one always-visible
"Page options" ⋮. Its menu leads with a View group (layout, sort, group, filter)
and continues with the existing work-context items; a dot on the ⋮ replaces the
filled state of the old filter button. Delete the 350px special case. The title then
gets about 140px at 360px.

**Preserve:** every action reachable on touch; the e2e selectors
`.project-settings-btn`, `.task-filter-btn` and `.project-view-trigger`; the
Plainspace button; the "customized" indicator; the #9480 rule that the action row
scrolls instead of losing a button. Re-measure at 320, 344, 360, 390 and 412px with
sync, Focus and three counters on.

### H2. Name the pages that have no name (P1)

**Observed:** History, Metrics and Daily summary show "Today ⋮" in the header and
start their body with "Time spent total: 20h 45m", "Metrics (all tasks)" or "Take a
moment to celebrate!"; tapping "Today" leaves the page. `_ROUTE_SECTIONS`
(`page-title.component.ts:452-466`) lacks the three routes, so they fall through to
the context link (`:67-74`). The styling guide says the shell header names the page,
and a phone has no sidebar to orient by.

**Change:** add the three route patterns with strings and icons; show the context as
a suffix ("History · Work"); keep ⋮.

**Preserve:** e2e `.page-title` selectors. Effort S.

### H3. Header controls say what they do and meet the touch size (P1)

**Observed:** Eight header controls are icon-only (⋮, filter, Play, Focus, Sync,
Project view, the counters tray and the counters) and a phone has no tooltips. Names
are generic or wrong: "More actions" (also on every drawer row), "Toggle
filter/group/sort panel" (it opens a menu), a static "Start/stop tracking time".
Plugin header buttons are tooltip-only with no accessible name
(`plugins/ui/plugin-header-btns.component.ts:13-19`). Four actions exist only as a
long-press: Play (disable the feature), Focus (edit sessions), Sync (settings) and
counters (edit). Play is a 40×40 mini-fab beside 48px buttons
(`play-button.component.ts:77`) and resumes the last tracked task without naming it;
while tracking, the tracked-task pill is `display: none` below 600px
(`tracked-task-pill.component.ts:194-196`), so on Inbox or Upcoming nothing says
which task runs and there is no jump to it. The header's `:hover` and
`:focus-within` rules are not gated: after closing the view menu, ⋮ and the filter
button stay black until a tap elsewhere (`page-title.component.ts:385-392`).

**Change:** Names that say what happens ("Page options", "Sort, group and filter",
Play named for its state and task); Play at `--ctl-lg` on coarse pointers through
the shared button layer (the guide forbids a local `.mat-*` override); show the
existing tracked-task pill as a one-line chip on phones while a task runs (a tap
already navigates); `aria-label` on plugin buttons; a visible route for each
long-press-only action; header hover rules under `(hover: hover)`.

**Preserve:** e2e aria-labels (search first); the header's glass height; the Play
ring and pulse, which are sized for 36–42px (`play-button.component.ts:46-63`). The
tracked-task pill is a recorded product decision; this changes where it appears,
not what it does. Effort S–M.

### H4. Bottom nav: orientation and labels (P2)

**Observed:** No tab is highlighted on eight routes (project, tag, Calendar,
Boards, Habits, Search, History, Metrics). Browse is "active" only while the drawer
is open, which covers the pill. Its glyph is a "menu" icon labelled "Browse";
re-tapping the active tab does nothing; switching tabs resets the list scroll
(Today 154→0). At 320px "Upcoming" ellipsizes to "Upcomi…" (59.6px of text in a
59px box).

**Change:** mark Browse active on every non-tab route (keep `aria-expanded`); pick a
glyph and label that agree; a re-tap scrolls the page scroller to the top; zero label
padding at 320px.

**Preserve:** `e2e-bottom-nav-*` and the `tour-navMenuBtn` tour anchor; test Android
Font size "Largest", where labels already have no slack. Effort S.

## L — Shell modes

### L1. A compact step between the phone shell and the desktop shell (P0)

**Observed:** The only phone switch is `(max-width: 599px)`
(`layout.service.ts:27,76-94`). Everything wider gets the desktop shell: a 260px
expanded side nav (`magic-nav-config.service.ts:374-379`) and an in-flow header.
That includes landscape phones (640–932px wide), 7-inch tablets in portrait,
unfolded foldables (about 670–690px) and Android split-screen windows. At 740×360
the page area is 480×304px. With a task or Notes open the right panel goes side by
side (`right-panel.component.ts:152,233-246`): the task column is 170–290px between
600px and 844px, the header title is hidden, and at 600–700px a task card wraps one
character per line (138×812px at 600×960). The Settings window is full screen at
exactly 600px and a two-pane dialog at 601px because six rules use an inclusive
`max-width: 600px` (`_settings.scss:81`, `config-page.component.scss:121`,
`plugin-management.component.scss:183`,
`dialog-edit-task-repeat-cfg.component.scss:12`, `integrations.scss:286`,
`plugin-side-panel-btns.component.ts:101`) while the shell switches at 599px.
Rotation is a live resize (the manifest handles `configChanges`), and an open task
sheet disappears when the screen rotates to a wide shape
(`right-panel.component.ts:239-243`, `:281-286`). There is no height or orientation
query anywhere except the iPad rule and schedule-month.

**Change:** Use the existing 960px token as a second step. (a) Collapse the side nav
to the 56px rail below 960px, reactively, with the user's saved expand/collapse
choice kept separate so an automatic collapse never overwrites it. (b) Send the
right panel down the existing bottom-sheet path when the main column would be under
about 480px (a `LayoutService.isCompactShell`). (c) One source for the phone
breakpoint: `mq(xs, max)` everywhere. (d) Keep an open panel across rotation. (e)
Hide the "Ctrl+F" hint under `(hover: none)`. Also see D3 for the Settings window
and C1 for the breakpoint literals.

**Preserve:** saved nav width and mode, and desktop behaviour at 960px and up;
every panel must stay reachable in a 600–959px desktop window (through the sheet);
drops onto the rail must still work; `task.component.ts:245` (`isSelected && !isXs`)
keys off the same flag. Effort M–L.

## M — Menus, drawer and Back

### M1. One menu pattern for phones, and the three worst menus (P1)

**Observed:** Pickers range from 112px to 300px wide, open above or below their
trigger, and touch different screen edges. The project/tag menu is ten undivided
rows (280×488px, flush to the right edge): "Copy task list" and "Duplicate" share
`content_copy`, "Settings" repeats the global Settings name and icon, and Delete
follows Duplicate (`work-context-menu.component.html:39-52,89-95,131-144`). The task
menu, opened only by swiping left (`task.component.html:8`), is a date row plus 13
rows, 681px tall in a 592px panel: "Won't do" and "Delete task" are below the fold,
"Select several tasks…" (the only touch route to multi-select) is item 10, "Start
focus session" is item 1 and duplicates the header button, five rows open submenus
over their parent, and on a Sunday "tomorrow" and "next week" both read "Mon".
Filter/sort/group is a three-level cascade of 158, 164 and 126px panels; the second
starts at x=0 and hides Sort and Group By, and Tag/Project filters hold a text field
inside a menu (`task-view-customizer-panel.component.html`).

**Change:** One rule: a popover for up to about seven rows and one level, a bottom
sheet (the existing `features/bottom-panel` chrome, 48px rows, in-sheet drill-down)
for anything longer. Immediately (S): dividers between groups (Rename, History,
Metrics | Add section, Copy, Share | Settings | Complete, Duplicate | Delete), a
warn-coloured Delete, "Project settings" and "Tag settings"
(`T.APP.CONTEXT_MENU.CHANGE_PROJECT_SETTINGS` exists), a distinct Duplicate glyph; a
task menu ordered by use (tracking, subtask, estimate, tags, notes, move first), no
Focus entry, Delete last, labelled Tomorrow and Next week (the guide asks for visible
labels); Sort and Group inline in the H1 menu as a stopgap for the cascade. Then
(M–L) the sheets for filter/sort/group and for the task menu.

**Preserve:** the touch guards (`mat-menu-touch-monkey-patch.ts`,
`menu-touch-fix.directive.ts`), multi-select, `closeActiveTaskContextMenu`, e2e menu
row indexes, saved sort state and the customized indicator.

### M2. Back and rotation close what is on top (P1)

**Observed:** `android-back-button.service.ts:47-113` closes the focus overlay, task
menus, history overlays, dialogs, the add-task bar, the issue panel and multi-select,
but not header, drawer-row, view, picker or customizer menus. Material menus set no
`disposeOnNavigation`: after navigating or `history.back()` with a menu open, one
panel and one backdrop stay mounted over the new page. Rotating with the Browse
drawer open leaves the `{ mobileSideNav: true }` history entry while the shell
becomes desktop, so the next Back is spent on nothing visible
(`magic-side-nav.component.ts:217-221`, `:422-423`). The Android consequence is
inferred; the Capacitor back event cannot be emulated.

**Change:** one generic step after the task-menu step: close the top CDK overlay that
has a backdrop (Escape on `body`) and return; clear the drawer overlay flag and its
history entry when leaving mobile as well as when entering it.

**Preserve:** the dialog and history-overlay steps; add a spec. Effort S.

### M3. Browse drawer: Close and Settings in reach, row menus discoverable (P1)

**Observed:** Close is `position: static` inside the scroller
(`magic-side-nav.component.html:51-87`, `.scss:104-132`): after about 105px of scroll
it is half off-screen and at 390px it is gone, with nothing else to dismiss the
drawer (swipe-right works but is undiscoverable). Brand and Close take 112px, 15% of
a 740px screen. Settings and Help are at the end of a 1,125px scroll at 360×740
(1,989px with ten projects and ten tags), followed by 80px of dead space reserved
for the pill the drawer already covers (`.scss:316-323`). Row menus are long-press
only, with an invisible, inert ⋮ (`nav-item.component.scss:112-129`); nothing says so
and the pressed row is not marked. Desktop leaks: the "Ctrl+F" chip on Search, Help ›
"How to: Keyboard navigation" (`magic-nav-config.service.ts:342-348`), and "Project
Notes" on Today and tags.

**Change:** one sticky row [logo, Close]; a sticky footer [Help, Settings], both
padded by `--safe-area-top` and `--safe-area-bottom`; drop the pill padding while the
drawer is open; highlight the pressed row (`.context-menu-highlight`) and show one
first-use hint; hide the chip and the keyboard tour on touch; label the row "Notes".

**Preserve:** `cdkFocusInitial`; no transform, filter or backdrop-filter on the
`magic-side-nav` host (styling guide); check 320×568 (a one-row footer) and insets.
Effort S–M.

## T — Tasks

### T1. Keep "Add task" in reach (P1)

**Observed:** The inline row is at y=449 with six tasks, and 1,025, 3,905 and
9,665px down (1.7, 6.5 and 16 screens) at 15, 60 and 150 tasks
(`work-view.component.html:277-297`). The only other path is Browse › Search ›
scroll the popup › "Add new task": three taps and a scroll. The styling guide
records that the header and bottom nav carry no global "+".

**Change:** at `mq(xs, max)` make that row `position: sticky; bottom: var(--s)` in
its list, on a card or glass surface above the nav. It pins only while its natural
place is off-screen, so short lists are unchanged; previewed with injected CSS on a
60-task list, where tapping it opens the existing bar. Keep one capture UI (no FAB).
In Search, list "Actions" first when the query is empty.

**Preserve:** short-list layout; `cdkDropList` geometry (it loses 48px at the end of a
long list); in the sectioned view pin only the last or active row. Effort S–M.

### T2. Task row: keep the estimate, un-clip the chips, make Done readable (P1)

**Observed:** `.time-wrapper` is `display: none` in a main column of 352px or less
(`src/app/features/tasks/task/_task-controls.scss:190-192`), so at 320px (also at
Android "Display size: large", and whenever a side panel narrows the column) no row
shows its estimate. The estimate hit zone is 25–31px wide. Date, deadline and
checklist badges cover 10px of their own 24px glyph (a deadline flag reads as a
bracket), adjacent chips touch, and clusters of four or more wrap
(`_task-controls.scss:549-576`, `_task-base.scss:192-195`). Done rows measure 2.1:1
(title), 1.6:1 (meta) and 1.9:1 (estimate) in light, 2.7, 1.8 and 2.2 in dark
(`--task-is-done-dim-opacity: 0.3`, `_css-variables.scss:458`) while every live text
role is at least 6.2:1. Upcoming day buttons are 36×36px.

**Change:** delete the 352px `display: none`, keep `timeWrapperMinimalStyles`, widen
the estimate hit zone to 40px; chip `margin-top` 14–15px on xs (previewed: the flag
becomes readable); keep the strike-through on done rows but use `--text-color-muted`
instead of opacity.

**Preserve:** row heights 56/60px and the hot-path rule (CSS only, no new template
calls); the title column is about 35px narrower at 320px. Effort S.

### T3. The task sheet opens on content, not an empty box (P1)

**Observed:** `isExpandedNotesPanel = signal(true)`
(`src/app/features/tasks/task-detail-panel/task-detail-panel.component.ts:339,473`)
opens a 258px empty Description editor at y=581 of a 444px sheet at 360×740 and
pushes Links & Files to y=839 and Tags and Created below it. Collapsing the box moves
Links to 596. This is also the desktop audit's recommendation 6.

**Change:** initialise and reset to `!!task.notes`; keep the forced expand for the
Notes target (`:564`, `:588`) and for "Add description". Effort S.

### T4. Capture, undo, drag and attachments on touch (P2)

- **Capture bar:** it starts with three icon-only toggles (issue search, note,
  add-to-bottom); Tags, Estimate and Repeat sit beyond the right edge (scroll width
  615px in 344px) with no cue; the note placeholder says "(Ctrl+Enter to add task)"
  (`en.json:1837`). Order labelled pickers first, hide the issue-search toggle unless
  a provider exists, drop shortcut text on touch.
- **Undo:** swiping a task done and the reschedule snack ("Task planned for …") have
  no Undo, and Ctrl+Z is keyboard-only; delete asks "Are you sure?" and then offers
  Undo. Add `actionStr: T.G.UNDO` to the reschedule snack and decide whether the
  confirm is still needed.
- **Drag:** `[cdkDragStartDelay]="dragDelayForTouch()"` reads a signal while input
  intent flips outside the zone, so on hybrid devices the first touch swipe after a
  mouse or pen move drags a row instead of scrolling it (`task-list.component.html:58`,
  `work-view.component.html:209`, the planner ×3, `app.constants.ts:64`). Use CDK's
  object form with a constant, `{ touch: DRAG_DELAY_FOR_TOUCH, mouse: 0 }`, which also
  removes a per-row signal read. Autoscroll fires only within 5% of the scroller's
  edges, which sit under the glass; "Reorder › Move to top/bottom" covers the ends.
- **Attachments:** edit, copy and delete are `visibility: hidden` until `:hover`
  (`task-attachment-list.component.scss:36-40`); a tap does not reveal them. Under
  `(hover: none)` show a permanent strip or a ⋮.
- **Small affordances:** the subtask toggle is a 24px FAB that cycles three states
  and is half covered by its "1/3" chip; the summary row "~3h 5m ⧖ 0m ⏱" is icon-only
  at xs and always shows "0m" (add a "left" label, hide worked-today at zero).

Device-only: swipe-right-to-complete starts 8–12px from the screen edge, inside the
OS back-gesture zone; test before changing anything.

## S — Screens

### S1. Schedule: a toolbar that fits and month cells that read (P1)

**Observed:** At 360px the Month toggle is half cut off (26 of 48px visible in Day
view, none at 320px; in Month view the selected segment is a sliver up to 480px) and
the title reads "No…", "W…" or "Novem…"; desktop shows "Week 46 · Nov 15 – 21" and
every segment. `.time-view-selector` has `overflow: hidden` and shrinks
(`src/app/features/schedule/schedule/schedule.component.scss:68-120`; title text in
`schedule.component.ts:294-330`). Month cells show "Re…" and "We…" chips; nothing
says that tapping creates a task, and the placeholder prints "Ctrl+1 to toggle day
planning" even under touch (`create-task-placeholder.component.html:41-47`); events
use 8–10px type (`schedule-event.component.scss:269,313,329`).

**Change:** below 600px, two rows (the title full width in `--type-body-strong`,
controls beneath) or one labelled view button with a menu; `.time-view-selector
{ flex: none }`; dots or counts in month cells that open the day; "Tap to add" under
touch intent.

**Preserve:** the desktop layout (scope to `mq(xs, max)`), `.e2e-day-view-btn`,
`aria-pressed`. Effort S–M.

### S2. Habits: show the names (P1)

**Observed:** `.habit-name { display: none }` below 600px
(`src/app/features/simple-counter/habit-tracker/habit-tracker.component.scss:275-283`),
so rows are a glyph (a letter when no icon is set) followed by seven circles; at
600px with the sidebar names shrink to one letter. At 360px the tap target is 43×30,
the title button 40×22, weekday type 10px and date and value type 9px.

**Change:** a two-line row on xs: icon and `--type-body-strong` name, then seven
circles at `repeat(7, 1fr)` with 48px targets; headers in `--type-meta`.

**Preserve:** the cdkDrag list, touch long-press reorder (`dragDelayForTouch`) and
long-press value entry; verify on a device. Effort M.

### S3. Boards: no scroll inside scroll (P1)

**Observed:** At 360px the board is four stacked 300px cards, each its own scroller
(`board.component.scss:2-14`, `board-panel.component.scss:12-18` and `:94-95`). The
Inbox card shows two and a half of its 17–20 rows; a swipe that starts on a task
scrolls the card first and the page only at its end (dragging up in the last panel
moved the list 0→165px while the page stayed); there is no way to jump columns. At
600, 740 and 768px the second column of the two-column grid is cut at the right
edge. "Schedule task" chips are 48×24px.

**Change:** on xs `board-panel { max-height: none; overflow: visible; min-height: 0 }`
and `.task-items { overflow: visible }`; optionally collapse panels behind headers
like Today's sections; drive the column count from the `main-content` container
width, not the viewport.

**Preserve:** `cdkDropListGroup` drag between panels needs both on screen. Effort S,
then M.

### S4. A phone route to Unscheduled tasks (P1)

**Observed:** The Unscheduled panel and its header toggle are desktop-only
(`planner.component.html:12`, `page-title.component.ts:76`). Schedule's empty-week
"Plan unscheduled tasks" button opens Upcoming and nothing happens
(`schedule.component.ts:428-431`; verified at 412px).

**Change:** reuse the panel's rows in the existing bottom-panel sheet, opened from a
labelled "Unscheduled" chip in the calendar strip; short term, hide the button on
xs.

**Preserve:** drag-to-day stays desktop-only; use each row's Schedule button. Effort
M (S for the hide).

### S5. Finish day, Daily summary and Metrics (P1)

**Observed:** Finish day is 2,783px tall at 412 and 430px (3,117px at 360px; the
two-up tile layout may fit on a device with overlay scrollbars), with the tabs at
880px and "Finish the day" at 2,639px. `.summary-point { flex-basis: 160px }`
(`src/app/pages/daily-summary/daily-summary.component.scss:93-97`). Review tables are
sideways scrollers (340 of 525px visible; three nested horizontal scrollers;
`src/styles/components/table.scss:27-30,46-52`) and
`task-summary-table.component.html:1` uses `mat-elevation-z1` against the guide's
"hairline cards, never shadowed". In "2. Plan" the composer's action row is cut off
(Repeat 12 of 86px visible at 360px, submit 38×19). The Metrics table is 349px wide
in a 302–322px card at 320–340px.

**Change:** one compact summary line; habits as a chip row; review tables as cards
(title, spent today, estimate) in `.material-table`; a reachable "Finish the day";
composer actions that wrap; wrapping or `overflow-x: auto` for the Metrics table.

**Preserve:** these components are shared with desktop and dialogs. Effort M.

### S6. First-run welcome (P1)

**Observed:** The welcome sheet is full height and scrolls; "Continue" is 7px below
the fold at 360×740, 107px at 360×640 and 195px at 320×568, and the sheet ignores
insets (`first-run-setup.service.ts:66-68` sets `calc(100dvh - 32px)` but the pane is
the full viewport on xs; with emulated 32/24px insets it moved 4px). The hint "Tap Add
task to add your first task" stays at the same screen position on Planner, Inbox,
Search, History, Recurring, Archived, Metrics, Support us and Integrations, covering
rows and the Connect button (`onboarding-hint.service.ts`). The device-inset effect is
inferred.

**Change:** pin the footer (Continue sticky, options scroll) or put Continue beside
Skip; honour `--safe-area-top` and `--safe-area-bottom`; show the hint only on the work
view.

**Preserve:** the first-run flags and the gate release. Effort S–M.

### S7. Focus mode on short screens (P1 in phone landscape, P2 at 320px)

**Observed:** At 740×360 and 640×360 the three mode buttons overlay the "Select task
to focus" button; its centre taps Pomodoro and only a 10px bottom strip works, so a
task cannot be chosen. At 320px the finish ✓ pokes 14px past the edge and
"Countdown" wraps. `focus-mode-layout.component.scss:22-27` reserves the row only
under `mq(xs, max)`; its own comment at `:36-47` says the selector "paints over the
task-row CTA" on short windows; the overlay is `main { height: 500px }`
(`focus-mode-overlay.component.scss:42`).

**Change:** reserve the selector row for `(max-height: 500px)` too; `--type-meta`
segment labels at 320px; keep the finish button inside the row.

**Preserve:** the same rules protect short desktop windows; test 1280×500. Effort S.

### S8. Smaller screen fixes (P2)

- **Planner calendar strip:** the expand control is a 32×4px, 30%-opacity bar that
  looks tappable but expands only by drag, and the expanded window is labelled by its
  middle week (`planner-calendar-nav.component.scss:117-130`). Make it a toggle with a
  chevron and a 48px target; label by the first week.
- **Upcoming** opens on a centred overdue block ("From previous days 1h 30m", three
  rows and a deadline block that repeats a task), pushing today's card below the first
  screen. Collapse it to one line with the count and a Reschedule action, as Today does.
- **Recurring:** the recurrence text is an edit button without its icon
  (`scheduled-list-page.component.scss:69-76`), long titles are squeezed (a 90-character
  title wraps to six lines), and paused configs look active (`isPaused` is unused).
  Keep the `repeat` glyph, stack the recurrence under the title, add a muted "Paused".
- **Archived projects:** icon-only restore, 32px rows, a search field with zero
  projects. Use a "Restore" text button on xs, `min-height: var(--ctl-lg)`, search only
  above about six projects.
- **Integrations:** a second title block ("Your connected work") and eight inert
  controls when empty (`integrations-page.component.html:7-10`). Drop the eyebrow and
  `h1`, show filters only with a provider, use `.empty-state`.
- **Support us** repeats Help › Contribute.
- **Empty states** are five different treatments with different wording; use
  `.empty-state` (styling guide).
- **Search page** autofocuses, so the keyboard opens at once.

## D — Settings, dialogs and forms

### D1. Settings help works on touch (P1)

**Observed:** All 114 "?" buttons in Settings do nothing on a tap.
`src/app/ui/setting-help/setting-help.component.ts:31-37` calls `tooltip.show()` and,
for touch pointers, `tooltip.hide(2500)` in the same tick; `MatTooltip.hide()`
detaches a tooltip that is not yet visible. A tap added and removed the tooltip
component about 13ms later; probes at 150, 500 and 1500ms found nothing. Help texts
have a median of 98 characters and a longest of 667, so a 2.5s timer is too short
even with the ordering fixed.

**Change:** on touch, toggle an inline help card under the row (the pattern dialogs
already use in `src/app/ui/help-section`) with `aria-expanded` and no timer; keep the
tooltip for mouse and keyboard. Minimal: defer `hide` by a tick and use
`max(4s, 60ms × length)`.

**Preserve:** desktop hover, focus and click, and the accessible name. Effort S
(minimal) to M (card).

### D2. Settings categories come from content; add "About" (P1)

**Observed:** The category list is fixed. On the Android app "Keyboard shortcuts" is
listed while its section is removed (`keyboard-form.const.ts:33`
`isHideForAndroidApp`): an empty page, with "Keyboard form section not found" logged
(`src/app/pages/config-page/config-page.component.ts:259-261,411,534`). On other
phones it is a 4,396px page of about 60 key-capture inputs a soft keyboard cannot
fill. The version footer is `display: none` at 600px and below
(`config-page.component.scss:139`), so the version, changelog, update check, logs
(`DialogLogsComponent` opens only from the footer) and privacy policy are
unreachable on a phone; "Report a problem" is a bare GitHub link
(`magic-nav-config.service.ts:290`). "Idle handling" on mobile web and iOS shows a
paragraph about a Chrome extension.

**Change:** derive visible categories from content; hide Keyboard when empty and on
touch-only phones; add an "About" row (version tap-to-copy, changelog, update check,
logs, privacy) reusing the footer's handlers; hide desktop-only paragraphs. Effort S.

### D3. Settings and Plugins windows on short screens; Back from a category (P1)

**Observed:** At 740×360 Settings opens as the 710×310 desktop dialog
(`settings-dialog.guard.ts:30`, `86dvh`) and leaves 131px for categories and content;
Plugins leaves 91px (40px in Discover) under a 155px pinned toolbar. Full screen and
drill-down key on width only (`src/styles/components/_settings.scss:81-91`). In a
category the pinned 64px header and 72px search take 136px (24% of a 568px screen)
while "← Settings" and the category title scroll away; the header X closes the whole
window, and so does Android Back instead of returning to the list. On the list,
"General" is drawn selected though nothing is open and a desktop divider runs down the
edge. The Plugins window is titled "Marketplace" but entered as "Plugins &
integrations", and "Choose plugin file" is a raised button.

**Change:** a `(max-height: 500px) and (pointer: coarse)` variant: full-screen
drill-down, no footer, search folded into the header; the header reads
"← <Category>" with a history state like other overlays; the selected style only in
the two-pane layout; the Plugins toolbar as one row or scrolling with its results.

**Preserve:** desktop two-pane layout; the Account window. Effort M.

### D4. Dialog actions stay on screen (P1)

**Observed:** Material's 65vh content cap plus about 125px of fixed chrome fits only
at 357px of viewport height or more. Twelve dialogs wrap title, content and actions
in a non-flex `<form>` or `.dialog-help-wrapper`. Verified: time estimate,
add-time-for-other-day, repeat, create project; from their templates: idle,
edit-issue-provider, track-time, focus-session-edit, simple-counter-edit (and its
settings), edit-attachment, tracking-reminder. At 360×300 (keyboard up) the actions
lose 20px; at 740×360 15px; the keyboard-shortcuts dialog loses 38px at 320×568 and
13px at 360×640 (its undo/redo hints sit inside `mat-dialog-actions`). Create-tag and
project-settings keep their parts as direct children and shrink correctly. The
fullscreen notes editor's toolbar is 885px wide in 346px, and at 360×300 the editor is
76px tall. The styling guide says the actions never leave the screen.

**Change:** in `src/styles/components/_overwrite-material.scss`:
`body .mat-mdc-dialog-content { max-height: none }`,
`.mat-mdc-dialog-surface { max-height: inherit }`,
`.mat-mdc-dialog-surface form:has(> .mat-mdc-dialog-content), .dialog-help-wrapper
{ display: contents }`, tighter title and actions padding under
`(max-height: 480px)`, and the editor's toolbar and title hidden under 400px of
height; move the shortcut dialog's hints into its content.

**Preserve:** the schedule and deadline hosts, which lift the cap themselves; the e2e
`DIALOG_SUBMIT` selector and form submission; re-run the dialog matrix below.
Effort S–M.

### D5. Whole-row toggles, mobile keyboard hints, no accidental discard (P1)

**Observed:** Toggle rows are 24px-tall hit areas inside 40px rows ("Upcoming":
272×40 row, 100×24 switch; a tap in the empty part leaves it unchanged); the Plugins
window has 21 toggles at 32×24px. Calendar day cells are 37×37 at 320px, colour
swatches 36×36, the estimate dials' inputs 91×21, mention rows 36px. There is no
`enterkeyhint` anywhere in `src/app`; the WebDAV fields (URL, user, password, folder)
have no `autocapitalize`, `autocorrect`, `spellcheck`, `inputmode` or `autocomplete`.
A tap on the backdrop discards a typed "Create project" dialog without a prompt.
Boolean controls differ: a checkbox in Create project, a toggle in Project settings,
a bare 13px native checkbox for "Glass appearance". Copy: Project settings is titled
just "Settings"; the complete-project dialog uses a second text button and wraps.

**Change:** stretch the toggle to the row (`mat-slide-toggle { display: flex;
width: 100%; min-height: var(--ctl-md) }`) in the shared formly layer and give plugin
toggles 48px targets; set `inputmode`, `autocapitalize`, `spellcheck` and
`enterkeyhint` in the formly input wrapper and the prompt dialog; `disableClose` while
a form is dirty with the Save/Discard pattern the guide defines; one boolean control.

**Preserve:** desktop density. Effort S–M.

## A — Android shell

### A1. Keep the status and navigation bar icon style after configuration changes (P1, inferred)

**Observed:** Capacitor's `SystemBars` keeps its own copy of the bar style (`DARK`,
from `capacitor.config.ts:46`) and on every configuration change re-runs `setStyle`
for both bars and overwrites the decor background with the theme window colour
(`node_modules/@capacitor/android/.../SystemBars.java:109-114` and `:283-301`). The
app sets the icon style only through `StatusBar.setStyle`
(`src/app/core/theme/global-theme.service.ts:672`), which `SystemBars` does not know.
Plugins are held in a `HashMap` and visited in its order on a configuration change
(`Bridge.java:148`, `:1326-1330`); a JVM run with the app's 16 plugin ids put
`StatusBar` before `SystemBars`, so `SystemBars` wins (the order changes with 12 or
fewer plugins, so it is a latent accident). Expected on a device: in the light theme,
after a rotation, system dark-mode flip, hardware keyboard, display-size change or fold
the clock and battery turn white on the near-white header, and on non-passthrough
bands the strip colour reverts to the system theme. Also `values-v35/styles.xml:4-6`
redefines `AppTheme` with only the opt-out, so API 35 loses `statusBarColor` at
launch and shows a dark bar until the plugin loads.

**Change:** from `_initMobileStatusBar`, also call Capacitor core
`SystemBars.setStyle({ style, bar: 'StatusBar' | 'NavigationBar' })`, guarded by
`isAndroid()`; re-apply `NavigationBar.setColor` and `setWebViewBackgroundColor` on
`orientationchange` and `resize`; complete the v35 theme (copy its items,
`statusBarColor` set to `@color/statusBar` or transparent). No inset code changes.

**Preserve / verify:** the mechanism is confirmed in source; the effect is not
confirmed on a device. Check light and dark app theme against light and dark system
theme, a rotation, a dark-mode toggle, a hardware keyboard, and an AVD with API 34 and
WebView 113 for the strip colour, with before and after screenshots. Effort S.

### A2. Bottom insets and the legacy shell (P2)

- **Snackbar** floats B px too high: the gap from the pill is 32, 56, 66 and 80px for
  bottom insets of 0, 24, 34 and 48px. `_overwrite-material.scss:277-280` pads every
  `.cdk-global-overlay-wrapper` by `--safe-area-bottom` on native, and `:926-932` adds
  `--bottom-nav-safe-area` again. Drop that term under `body.isNativeMobile`.
- **Bottom sheets** (task detail, notes, panels) have no bottom inset: `_bottom-panel.scss`
  has `bottom: 0` and nothing else; the detail sheet's last line is 10px behind a 34px
  bar and the last row is fully behind a 48px (three-button) bar. A 24px inset passes
  by coincidence. Add `padding-bottom: var(--safe-area-bottom)` to the sheet container.
- **Windowed fullscreen markdown dialog** double-counts both insets (about 32px blank
  above "Description" and 34px below Save): the `:host-context(body.isNativeMobile)`
  rule at `dialog-fullscreen-markdown.component.scss:37-42` outranks the windowed reset
  at `:25-33`.
- **Add-task bar** under hybrid input (Bluetooth mouse, S-Pen, DeX) opens at `top: 8px`,
  under the status bar (`add-task-bar.component.scss:6-12`): add `--safe-area-top`.
- **A transparent strip** of 8px plus the bottom inset under the floating pill lets the
  end of the list peek out behind the gesture bar; a `--bg` scrim over
  `--safe-area-bottom` fixes it. `global-progress-bar` also sits in that zone.
- **Legacy online shell** (`FullscreenActivity.kt`) has no status-bar, navigation-bar
  or inset handling; it is reached only by an upgrade with legacy data or
  `LAUNCH_MODE=1`. The service worker is disabled on native, so neither Android shell is held back by a
  cached build; the bundled assets are current, and online mode serves whatever is
  deployed at `app.ultratasks.app`.

Verify each with the CDP `setSafeAreaInsets` emulation at bottom insets of 0, 16, 24,
34 and 48px. Effort S each.

### A3. Hide the floating nav while the keyboard is open (P2)

**Observed:** With the keyboard up, the pill stays above it and, with the header,
takes 136px of a 440px visible area (31%; 38% at 360px). Nothing references
`isKeyboardVisible` for the nav (`styles.scss:73,90`, `app.component.scss:65` and the
iOS and markdown dialog rules are the only users).

**Change:** `body.isKeyboardVisible .mobile-bottom-nav { display: none }` and
`--shell-inset-bottom: 0` under the same selector.

**Preserve:** mobile web on Android Chrome never gets the class (C1). Effort S.

## C — Consistency and compatibility

### C1. One breakpoint, one touch classifier, a WebView floor that matches the CSS (P2)

- **Touch classifiers:** `(pointer: coarse)` drives density, `.isTouchPrimary`
  behaviour and `.isTouchOnly` legacy rules. `.isTouchOnly` is reliable only in the
  Capacitor build (`SUPAndroid` forces it). On Android Chrome or a PWA the library
  reports "hybrid", so it is never set and the keyboard-height tracker never runs
  (`global-theme.service.ts:450`; the add-task bar's own comment says so). Move the
  remaining consumers (`task-hover-controls.component.scss:23,41`,
  `work-view.component.scss:316`, `_overwrite-material.scss:246`,
  `task-detail-item.component.scss:91,101`, `scrollbars.scss:37`,
  `bottom-panel-container.component.ts:470`) to `.isTouchPrimary` or `(hover: none)`.
- **Breakpoint literals:** 599px is repeated in `_css-variables.scss:520`,
  `_glass.scss:140`, `page.scss:241`, `dialog-project-complete.component.scss:217`,
  `tracked-task-pill.component.ts:~190` and `page-title.component.ts:493`; `xxxs` is
  398px in the tokens, 397px in the unused `LayoutService.isXxxs` and 350px in the
  page title; three media queries put `var()` in the condition and never match
  (`input-duration-slider.component.scss:220`,
  `dialog-worklog-export.component.scss:1,12`). Route everything through `mq()` and add
  `rg -n "@media[^{]*(max|min)-width:\s*(var\(|[0-9]+px)" src --glob '*.scss'` to the
  styling guide's self-check.
- **WebView floor:** the app claims 107 (`WebViewCompatibilityChecker.kt:35-36`,
  `.browserslistrc:11`) but the CSS needs 111: `color-mix()` appears 359 times in the
  production CSS and 106 in component styles, and on 107–110 the glass backgrounds
  compute transparent while the blur stays (simulated). The realistic old WebViews in
  `docs/android-edge-to-edge-keyboard.md` (113, 124, 126) are fine. Raise the floors to
  111, or add `@supports not (color: color-mix(in srgb, red, red))` fallbacks for the
  three glass tokens. Give the unguarded `100dvh` (108+) a `vh` line before it
  (`_settings.scss:85-86`, `_overwrite-material.scss:452,1048`,
  `settings-dialog.guard.ts:30`, `open-fullscreen-markdown-dialog.ts:60`,
  `search-dialog.service.ts:27`, the schedule and deadline SCSS).
- **Token drift** (fold into the screen changes, not a sweep): the habit tracker (17
  literal font sizes), schedule grid and event, focus mode, `_task-controls.scss`
  (`:33`, `:422-423`, `:530-532`, `:617`, the guide's own anti-example),
  `_bottom-panel.scss`, `multi-btn-wrapper.scss`, `note.component.scss:179-181`
  (`--note-font-size` does not step up on touch), and raw `env()` reads at
  `_overwrite-material.scss:383,418` (no live divergence found). The shell files
  (`main-header`, `mobile-bottom-nav`, `magic-side-nav`, `app.component`, `_glass`)
  are clean.

Effort S–M.

### C2. Keyboard-only hints on touch (P2)

**Observed:** The Search row's "Ctrl+F" chip; eight `kbd` chips and a "Show keyboard
shortcut cheat sheet" row on the Search page (`search-page.component.html:69,98`,
`shortcutFor` has no touch gate at `search-page.component.ts:652-658`); the Schedule
placeholder; the task menu's A, T, G, Ctrl+D and Backspace hints; the capture note
placeholder; Help › "How to: Keyboard navigation"; the shortcuts dialog from Search
commands and the notes toolbar.

**Change:** one shared hidden-on-touch class under `(pointer: coarse)` or
`isTouchPrimary`; drop the keyboard tour on touch-only devices. Effort S.

## PF — Performance

Numbers below are relative. They come from the production build of 10 November in
desktop Chromium at 360×740, dpr 3, in touch intent, with the CPU throttled 4× (a
stand-in for a mid-range phone, not a phone); the development server on the current
tree agreed on navigation (a 91-row Inbox → Today took 860ms on dev against
920–1,391ms on production). Absolute milliseconds varied 20–40% between sessions on a
shared machine. GPU cost was measured as GPU-process CPU time per drawn frame in
software rendering, so only relative effects count. There is no P0.

### PF1. Remove the blur from the content sheet; test "Glass off" first (P1)

**Observed:** Three live `backdrop-filter` layers run on the phone: the header, the
full-screen `.route-wrapper` and the bottom nav (`_glass.scss:85-91` and `:133-136`;
the drawer and right panel have none at phone width). The `.route-wrapper` blur sits
over a backdrop that is already a 64×40 or 192px canvas stretched by CSS ("no live
filter", `glass-backdrop.component.ts`), so it is visually a no-op: the pixel
difference with and without it is at most 3/255 and 0% of pixels exceed 2 levels, in
light and dark. It is still about half of the GPU work in the software proxy. Relative
to all three layers: content sheet alone 70–74%, header alone 31%, pill alone 36%,
header plus pill 47–51%, none 1%. The cost is per surface, not per area (a blur
radius of 20, 12 and 8px made no difference), and the header's `mask-image` costs
nothing measurable (102% of baseline).

**Change:** Step 1 (S): delete `backdrop-filter` from `.route-wrapper` and keep its
tint; expect about half of the GPU work to go, with no visible change. Update the
Canvas row of the Glass table in the styling guide. Step 2, only if needed (S): give
the header and the pill the overlay tier (`--glass-overlay-bg`, no blur) on phones.
**A zero-code test on a phone first:** Settings › General › Appearance › Glass off
(`st-solid`, about 1% of the work). If the app feels smooth with it, blur is the cause.

**Preserve:** Step 1 must keep the wrapper's containing block and stacking context.
`container-type` does not: in Chromium 149 it makes no containing block for
`position: fixed` descendants (the removed filter did, and a stacking context too),
so the multi-select bar would have centred on the window. `contain: layout` on the
glass rule keeps both (found while implementing; see
[Implementation status](#implementation-status)).
Step 2 lets faint, crisp content show through the bars (at most 11/255 on at most 2%
of pixels in light, 7.5% on the pill in dark): raise the phone overlay alpha or keep
the pill blurred. Velvet and rainbow themes stack more blur and override separately.
The cost on a tile-based phone GPU and on old WebViews could not be measured here
and is likely higher.

### PF2. Cheaper route changes (P1)

**Observed:** Entering a list costs main-thread time in proportion to its rows:
Inbox → Today is ready in 227ms with six rows, 0.9–1.4s with 91 and 2.5–3.6s with 291;
Today → Upcoming takes 513ms, 1.2–1.4s and 2.1–3.5s (8–14ms per row to enter,
5–10ms to leave). Every switch also pays a route animation: 165ms out and 190ms in
of opacity and scale on a full-screen page inside the blurred wrapper
(`app.component.html:76-79`, `warp-route.ts:55-85`), not shortened for touch (the
Angular constants are not the CSS tokens at `styles.scss:42-49`). With animations off
each settle is 190–250ms faster, most on heavy pages: Upcoming → Inbox 829→309ms at
91 rows and 1,428→458ms at 291; closing Browse 260→81ms.

**Change:** bind `[@.disabled]` on `.route-wrapper`, reusing `isAnimationDisabled`,
when the entering or leaving list is over about 40 rows or on `isXs`; or use an
opacity-only CSS fade. Effort S–M.

**Preserve:** the 1.04 settle the styling guide describes stays for small pages.

### PF3. Task lists: `content-visibility` now, progressive rendering later (P1)

**Observed:** At 291 rows a Today entry is 5.3s of main-thread work at 4× throttle:
native style, layout and paint 37%, Angular animations 17% (forced `computeStyle`
layouts), native DOM 16%, Angular core 12%, app code about 8%. Each row is 35
elements, 60 comment nodes, about 40 listeners and one cdkDrag; the heap grows from
24MB to 43MB. Interactions scale too: tap → detail ready takes 189ms with six rows,
330–364ms with 91 and 367–638ms with 291; tapping the add-task row 240→579ms.

**Change:** Interim (S): `task { content-visibility: auto; contain-intrinsic-size:
auto 56px }` in `_ultra-tasks.scss`. In interleaved A/B runs creation was 8% faster at
91 rows and 32% at 291; with animations off the profile's busy time dropped 52%;
task tap went 264→176ms and long tasks 153→0ms at 291 rows. Later (L): progressive or
windowed rendering on phones (the first 25 rows or so, the rest in idle chunks). Also
create the markdown editor only when the notes tab is shown (CodeMirror takes about
140ms on first open) and look at `_setInitialHeight`
(`bottom-panel-container.component.ts:444`, 72ms).

**Preserve:** `content-visibility` drifted in the test: after `scrollIntoView` on the
add-task row the page moved 265px once real heights replaced the 56px estimate
(scroll height 24,165→18,894; the seed's real row pitch is about 83px), and the
implied paint containment could clip overflow (focus ring, mini-fab, drag preview;
unchecked). Set the intrinsic size from real heights, add a plain `56px` fallback
line, and verify drag, keyboard navigation and search-reveal. Task rows are a stated
hot path ([AGENTS.md](../../AGENTS.md)): CSS only, and test against a large list.

### PF4. Cold start (P1)

**Observed:** With data warm, a cold code cache, local assets and no network, first
paint, app shell and first task rows take 60, 633 and 1,063ms unthrottled, 307, 2,244
and 4,106ms at 4×, and 468, 3,761 and 7,800ms at 6×. At 4× there are six long tasks
totalling 3.4s (the longest 1.7s); module evaluation is about 0.9s and Angular core
0.6s. The eager graph is 203 modules and 5.88MB (1.6MB gzip): features/tasks 533KB,
op-log 468KB, zod 409KB, Material 364KB, plugins 280KB, issue providers 223KB, plus
346KB of CSS and a 467KB icon font with `font-display: block` (icons are hidden until
it loads, 0.1–0.45s after the shell). Boot makes 305 requests, 42 of them serial
plugin manifest and icon fetches (`plugin.service.ts:122-131`).

**Change:** lazy-load zod, issue providers and the plugin runtime; defer or
parallelise plugin discovery; preload the icon font. Effort L.

**Preserve:** only the bundled flavour was measured. If the build is the legacy online
flavour (the probe's `capacitor: false`; fresh installs of `app.ultratasks` take the
bundled flavour and upgrades with legacy data the remote one, `LaunchDecider.kt:12-41`),
the font and the 12.5MB service-worker prefetch go over the network (inferred).

### PF5. Smaller costs (P2)

- **Non-passive touch listeners:** `pan.directive.ts:65-68` registers four touch
  listeners per `swipe-block` without `{ passive: true }`: 91 blocking `touchstart`
  and 91 `touchmove` listeners at 91 rows, while the rest of the app uses passive
  ones (`task.component.ts:648`). Add `{ passive: true }` (`touch-action: pan-y` is
  already set) and check swipe-to-done and swipe-for-menu. The impact is inferred:
  headless Chromium cannot measure scroll-start blocking, so check with remote
  debugging on a device. **Tried and reverted:** a passive `touchmove` (with or
  without `touch-action: pan-y` on the row) leaves Chrome's scroll gesture running
  after a sideways pan, and the next tap then produces no click (reproduced; the
  e2e planner swipe menu failed). Only a non-passive `touchmove` that calls
  `preventDefault` avoids it, and the blocking region counts `touchstart` or
  `touchmove`, so passive `touchstart` and `touchend` alone gain nothing. The
  directive is as it was, with a comment saying so.
- **Forced layouts:** `work-view.component.ts:434-438` reads `clientHeight` and
  `scrollHeight` for a debug payload that production drops: 110–185ms of self time at
  4× on every Today and project creation. `planner-calendar-nav.component.ts:163-170`
  and `:187` force layout in `_layoutTop` while the leaving 291-row page is still in
  the DOM: 390–615ms. Guard the first; measure the second after the leave animation
  or with a `ResizeObserver`.
- **Root custom-property writes scale with rows:** at 291 rows a changed-value write
  plus forced style and layout costs 349ms (49ms with `content-visibility`); a
  same-value write costs 0ms. The writers are `--keyboard-height`
  (`global-theme.service.ts:580-583`) and Capacitor SystemBars'
  `--safe-area-inset-bottom`, which goes to 0px while the IME is up on WebView 140 or
  newer. Whether a given phone takes the changing-value path is unverified;
  `content-visibility` helps, or scope the writers to the overlay container as
  `ios-keyboard.service.ts` does.

**Not problems:** the 1Hz tracking tick (script time 8.0, 10.8 and 16.5ms per second
at 6, 91 and 291 rows, about 1.6% of the main thread at 4×, no long tasks, no
IndexedDB writes in 20s); op-log writes (0.4–0.7KB per action, none when idle); the
header `mask-image`; per-row shadows and filters (four `box-shadow`s and two
`will-change`s in the whole DOM); row hover controls (not rendered on touch,
`task.component.html:151`); infinite animations (only the sync spin); same-value
`--keyboard-height` writes; the body `MutationObserver` in
`mat-menu-touch-monkey-patch.ts` (about 1%); the main-thread cost of scrolling (no long
tasks over three swipes at 91 rows); and blur radius.

**Could not be separated here:** real phone-GPU cost (software rendering gives only
relative cost), scroll-start blocking from the passive-listener finding, startup over a
real Capacitor asset loader and network, and tracking while scrolling or opening menus.

## Keep what is already good

These were checked and are not recommendations:

- **Shell geometry:** the pill is 328×64px at 360px with four 77×56px labelled
  targets and `aria-current`; the header is `56 + inset` tall; the first row clears
  the header and the last row clears the nav on 14 routes at 320–430px; no route
  scrolls horizontally.
- **Drawer:** rows are 48px, headers 40px; long names ellipsize and nesting holds to
  depth four at 320px; history stays clean over repeated open/close; a fast swipe
  closes it and a slow, diagonal or vertical drag does not; long-press drag-reorder
  works after a 520ms hold.
- **Tasks:** rows are 60px (one meta line) or 84px (two) in touch and mouse intent; a
  137-character title wraps to four to six lines; the done ring is 48px; swipe
  threshold is 86px and a vertical swipe scrolls; the sheet opens in one tap, closes
  by backdrop, drag or Back, and keeps list scroll; multi-select bar clears the nav;
  short syntax (`#home 25m`, `@tomorrow 15m`) works; live text contrast is at least
  6.2:1.
- **Settings and dialogs:** 48px category rows, 16px inputs (no iOS focus zoom),
  options 48px on touch, titles are `h2`, widths clamp to 96vw, button order and
  treatment follow the guide, no horizontal overflow in any Settings category,
  settings search scrolls to its match.
- **Insets on the web side** (see above), the bar styling consistent with the palette
  ink, native service worker disabled, bundled Android assets current.
- **Input intent:** a real touch sequence sets touch intent; `isMousePrimary` after a
  tap in the first smoke run was the harness's own mouse move.

## Implementation order and validation

1. **Contained, visible fixes first** (one commit each, CSS or a few lines):
   H1's title floor, T2, T3, T1, D1 (minimal), D2, D4, D5's toggle rows, M3, A1, A3, PF1, PF2 and the `content-visibility` interim of PF3.
   A1 needs a device check before merging; the rest can be verified in Chromium.
2. **Then the structural header and menu work:** H1 (page options), H3, M1, M2, H2,
   H4, so that the header, the menus and Back change together.
3. **Then L1**, with D3 and the screen fixes that depend on the compact shell
   (S1–S3, S5, S7), followed by S2, S4, S6, S8, T4, A2, C1, C2, the progressive rendering of PF3, PF4 and PF5.

Validate each change at 320, 344, 360, 390, 412 and 430px, phone landscape (740×360),
600×960 and 768×1024, light and dark, glass on and off, reduced motion, enlarged
text, a short viewport (the keyboard open) and with insets of 0, 24, 32 and 48px top
and 0, 16, 34 and 48px bottom. The checks in this audit used the harness described
below; the dialog and header matrices are the ones to re-run. Task-row hot-path rules
hold for every task change (CSS only; verify against a large list). Keep the e2e
selectors named in the recommendations, update user-facing documentation where
behaviour changes, and retire this note once its recommendations are implemented,
declined or moved into tracked issues.

## On-device checks

A desktop browser cannot answer these. Do them before or with the fixes they gate:

1. The five-minute top-bar check above, on the phone where the problem was seen.
2. Status and navigation bar icons after a rotation and a dark-mode flip (A1).
3. The passthrough band: header against the status bar at WebView 140 or newer, in
   gesture and three-button navigation.
4. Bottom insets (A2): the snackbar gap, the bottom sheets and the pill strip, in
   both navigation modes.
5. Android "Font size" and "Display size" at Largest: the pill labels, the header,
   the 350px and 352px branches (H1, T2).
6. The IME: scroll-into-view of focused fields in dialogs and Settings, the add-task
   bar, and Samsung and Gboard suggestion strips (D4, A3).
7. Long-press behaviour: Play, Focus, Sync, counters (a long press may close its own
   menu on release in emulation) and drawer rows; a hold-and-release opening the task
   sheet.
8. Edge-back zones against swipe-right-to-complete (T4).
9. Hybrid input (Bluetooth mouse, S-Pen, DeX): first touch swipe after a mouse move,
   the add-task bar's fallback position (T4, A2).
10. Backdrop blur on a mid-range GPU, and a device without it (the pill would show a
    25% ghost of the content behind it).
11. An unfolded foldable and a split-screen window (L1).
12. Settings › General › Appearance › Glass off, as a zero-code A/B for blur (PF1).
13. Scroll start with and without passive swipe listeners, and the real GPU cost of
    the blur layers (PF1, PF5).
14. Which Android flavour runs: the probe's `capacitor` field (PF4).

## Evidence and limits

- **Method.** Seven read-only reviewers each took one lens (insets and the Android
  shell; navigation, header and menus; task flows; other screens against desktop;
  Settings, dialogs and forms; performance; the responsive system and WebView
  compatibility). They drove the Angular dev build of the working tree in headless
  Chromium with touch emulation at viewports from 320×568 to 768×1024, phone
  landscape and a 1280×800 desktop reference, with the repository's screenshot seed
  (15 tasks, four projects, six tags, notes, repeat configs) and richer seeds they
  built, real CDP touch gestures, real `env(safe-area-inset-*)` emulation through
  CDP, and a viewport shrink for the keyboard. Findings are heuristic, not a
  user study.
- **No Android device, emulator or `adb` was available.** The WebView, real system
  bars, the IME, gesture navigation, OEM skins, font scale, back-gesture zones and
  `contextmenu` synthesis could not be reproduced; every finding that depends on them
  is marked I or V+D and listed under on-device checks.
- **Performance numbers are relative.** They were taken in desktop Chromium with the
  CPU throttled 4× and 6× on a shared machine (absolute milliseconds varied 20–40%
  between sessions), and GPU cost was measured in software rendering. Only the ranking and the relative effects are meaningful; frame drops on a phone are inferred.
- **Two harness defects were found and corrected during the audit.** The
  screenshot helper moved the mouse and the seed import clicked with it, which put the
  app in mouse intent for every later shot (hover affordances, the add-task bar at the
  top); and the default headless launch did not render `backdrop-filter`, so glass
  surfaces showed unblurred content through them. All affected evidence was re-taken
  or retracted. Two early observations were withdrawn as artefacts: "the bottom nav is
  too translucent" and "touch intent does not stick after a tap".
- **Ruled out as causes of the cut-off top bar on the web side:** overflow clipping of
  the header, a double inset, the action row's fade mask, sticky rows riding under the
  glass, a header box shorter than its content, and IME pan in Chromium.
- **Ruled out elsewhere:** swipe-to-close against drag-reorder, short taps swallowed
  by `menuTouchFix`, the raw `env()` reads in dialog `max-height` (no live
  divergence), a document-level horizontal overflow on any route, and the touch drag of
  the duration dials.
- **Not exercised:** dark mode beyond the main screens and Settings, RTL, the
  remote-tracking pill, real plugins, the issue panel (no provider), dragging a
  Schedule event on touch, the Boards tab long-press, and dialogs reviewed from code
  only (sync-conflict, encryption, reminder, idle, add-note, project-complete
  celebration, worklog export; none broke the button-order or treatment rules).

### Prior art

Carried from public documentation and general knowledge; not re-tested. Todoist, Things
and Apple Reminders each keep a persistent add control on the main list; Todoist uses
swipe-right to complete and swipe-left to reschedule; Reminders puts actions on a
trailing swipe. The persistent add control is the gap here, while the swipe grammar,
the long-press drag and the detail sheet already match. The calm option is to make the
existing inline row persistent (T1), not to add a new button; this is consistent with
the [UX direction](../ultra-tasks-ux-direction.md) and the
[desktop audit](2026-11-05-main-interface-ui-ux-audit.md), which this note extends to
the phone.
