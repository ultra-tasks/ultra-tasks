# Styling Guide

One calm design language for every surface. This guide describes the scale in
`src/styles/_css-variables.scss`, how Angular Material is mapped onto it in
`src/styles/components/_overwrite-material.scss`, and the rules every component
follows. Colour roles come from the palette normaliser; see
[theming-contract.md](theming-contract.md).

## Conventions at a glance

Read this first. Every UI change, by a person or an agent, follows it, so the
app can grow without drifting. The sections below are the detail.

### Which token for what

| I need…                                 | Use                                                                                              | Never                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Space between or inside things          | `--s-half` 4, `--s` 8, `--s1-5` 12, `--s2` 16, `--s3` 24 (the 4/8 grid)                          | `px`, `rem`, `calc(var(--s) * 1.5)`                    |
| Rounded corners                         | By role: `--r-sm` inline, `--r-md` controls and cards, `--r-lg` floating, `--r-full`             | `4px`, `12px`, `50%`, a radius picked by height        |
| A box that holds content                | A card: `--card-bg`, 1px `--palette-border`, `--r-md`, no shadow                                 | A shadow on something that rests                       |
| A box that floats (menu, dialog, sheet) | `--elev-1` (menus, popovers) or `--elev-2` (dialogs, sheets), `--r-lg`                           | Your own `box-shadow`, an extra border                 |
| Any text                                | One type role: `font: var(--type-title)`, `-heading`, `-body`, `-body-strong`, `-label`, `-meta` | `font-size`, `font-weight`, `line-height` on their own |
| An icon                                 | `--icon-sm` 16, `--icon-md` 20, `--icon-lg` 24; the glyph equals its box                         | 13, 15.75 or 18px                                      |
| Something clickable                     | `--ctl-sm` 32 (40 on touch), `--ctl-md` 40, `--ctl-lg` 48 for touch surfaces                     | A hit area under 40px on touch                         |
| A colour                                | A palette role through a token (`--text-color`, `--card-bg`, `--palette-*`)                      | A hex, `rgb()`, `red`, `rgba(255, 152, 0, …)`          |
| Hover, selected, pressed                | `--palette-hover`, `--palette-selected` (+ `-ink`), `--state-hover`, `--state-pressed`           | A new tint                                             |
| The one primary action                  | Filled accent: `--palette-accent` with `--palette-accent-ink`                                    | Two filled accents on one surface                      |
| Keyboard focus                          | `--focus-ring` via `.focus-ring` or the outline pattern in [Focus Ring](#focus-ring)             | `outline: none` with no replacement                    |
| Motion                                  | `--transition-*` and `--ani-*-timing`; honour reduced motion                                     | `300ms`, `ease-in-out` literals                        |
| Stacking                                | `--z-*` tokens                                                                                   | `z-index: 9999`                                        |
| A message box                           | `.callout` (see [Callouts](#callouts-info--warning--danger--success))                            | A local `.warning-box`                                 |
| A dialog                                | `useDialogSize()` / `dialogSize()` and the anatomy in [Dialogs](#dialogs)                        | `width` or `max-width` on a dialog                     |

### Highlights and accents

The accent is scarce on purpose.

- **Selected** is one role (`--palette-selected`, tonal): the active nav row, the open settings category, a pressed segment, the task in the detail panel.
- **Primary** is one filled accent per surface: the add-task bar's submit, a dialog's confirm. A second competing filled button is a design bug.
- **Hover** and **pressed** are `--state-hover` and `--state-pressed` overlays, never a different hue.
- **Semantic colours** (danger, warning, success, upcoming) mean what they say and never follow the accent; overdue dates and destructive actions stay red.
- **Muted text** (`--text-color-muted`) is for secondary information only. Titles, values and anything the user must act on stay in the body ink.

### Keeping it consistent as the app scales

1. **Reuse before you create.** Look in `src/app/ui/` and `src/styles/components/` first. A near-fit is a reason to add a variant there, not a local copy.
2. **A new page** uses the page wrappers and gutter ([Page layout](#page-layout)); **a new list** uses the task-row or flat-row pattern; **a new setting** uses the settings row; **a new empty state** uses `.empty-state`.
3. **A new token or pattern is added once**, in `_css-variables.scss` or the shared layer, and documented in this file in the same change. Do not add a one-off value "for now".
4. **Check the matrix** before calling a UI change done: light and dark, glass on and off (and reduced transparency), a window under 600px, a touch pointer (`(pointer: coarse)`), reduced motion, and a long title or a large list.
5. **Task rows are a hot path.** Row heights are exactly 48px (title only) and 56px (with a meta line), and 56 and 60 on touch ([Touch scale](#touch-scale)); no template function calls in `task.component.*`.
6. **Copy matters as much as spacing.** Labels are sentence case, buttons name their action ("Save", "Discard"), and every user-facing string goes through `en.json`.

### What is enforced and what is not

| Check                                               | Catches                                                         |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `npm run lint:css-vars` (`tools/check-css-vars.js`) | A `var(--x)` whose `--x` can't reach the rule                   |
| `npm run lint:scss` (stylelint, recommended-scss)   | SCSS syntax and basic errors; **not** hardcoded values          |
| Review and the self-check below                     | Literal colours, spacing, radii, font sizes, durations, z-index |

Nothing automated stops a hardcoded `16px` or `#fff`, so check your own diff:

```bash
git diff -U0 -- '*.scss' '*.html' | rg '^\+.*(#[0-9a-fA-F]{3,8}\b|\b[0-9.]+(px|rem|ms)\b|z-index:\s*[0-9])'
```

Every hit needs a token, or a comment saying why it is a deliberate layout
dimension (a 1px hairline, a fixed illustration size). Positioning and layout
(flexbox, grid, `position`, widths) may stay plain CSS.

## Rules

- **All visual styling uses tokens** from `src/styles/_css-variables.scss`: spacing, radius, elevation, type, icon sizes, control heights, colours, transitions and z-index. Never hardcode them.
- **Positioning/layout is fine as plain CSS** — flexbox, grid, display, position, dimensions.
- **Check `src/app/ui/` first** before creating new styled elements — 40+ reusable components exist.
- **Component SCSS should be minimal** — shared styles belong in `src/styles/components/` or as a mixin.
- **Angular Material is mapped once, in the shared layer.** `_overwrite-material.scss` sets Material's public `--mat-*` tokens for typography, shape, elevation and height. Never restyle Material or shared `src/app/ui/` components for a one-off (local `.mat-*`, `.mdc-*`, `button[mat-*]` or component-internal overrides). If a surface needs a variant, make it reusable in the shared layer (for example `.mat-button-compact`).
- **Material overlay components** (menus, dialogs, tooltips, snackbars) render outside component scope — style them in `src/styles/components/` and add a comment in the component pointing there.
- **Only reference custom properties that can reach the rule** — a `var(--x)` whose `--x` is undeclared, or declared only inside some component's `:host`, silently voids the whole declaration. Enforced across SCSS, theme CSS and inline `styles:`/`[ngStyle]` by `npm run lint:css-vars` (`tools/check-css-vars.js`), which explains the fix when it fails.

## Anti-Patterns

| Avoid                                       | Do Instead                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Hardcoded colors (`#fff`, `red`)            | Colour tokens (`--text-color`, `--card-bg`, `--palette-*` roles)       |
| Hardcoded spacing (`16px`, `1rem`)          | Spacing tokens (`--s2`, `--s1-5`, `--s-half`)                          |
| Ad-hoc radii (`4px`, `12px`, `50%`)         | Radius by role (`--r-sm`, `--r-md`, `--r-lg`, `--r-full`)              |
| Hardcoded or resting shadows                | `--elev-1` / `--elev-2`, on floating surfaces only                     |
| Ad-hoc font sizes, weights and line heights | A type role (`font: var(--type-body)`)                                 |
| Icons at 13, 15.75 or 18px                  | `--icon-sm` / `--icon-md` / `--icon-lg`, glyph equal to its box        |
| Hardcoded transitions/durations             | Transition tokens (`--transition-standard`, `--transition-duration-*`) |
| Custom z-index values                       | Z-index tokens (`--z-main-header`, `--z-backdrop`, etc.)               |
| New styled elements without checking        | Check `src/app/ui/` for existing reusable components first             |

## Scale

All tokens live on `:root` in `src/styles/_css-variables.scss`. Older names stay
as aliases (see [Legacy aliases](#legacy-aliases)) so existing rules keep working;
new code uses the scale names.

### Spacing (4/8 grid)

| Token         | Value | Token  | Value |
| ------------- | ----- | ------ | ----- |
| `--s-quarter` | 2px   | `--s4` | 32px  |
| `--s-half`    | 4px   | `--s5` | 40px  |
| `--s`         | 8px   | `--s6` | 48px  |
| `--s1-5`      | 12px  | `--s7` | 56px  |
| `--s2`        | 16px  | `--s8` | 64px  |
| `--s3`        | 24px  | `--s9` | 72px  |

`--s1-5` is the icon-to-label gap in rows and the inset of menu items; it replaces
`calc(var(--s) * 1.5)` and ad-hoc 12px values.

```scss
// ✅ Good
padding: var(--s2) var(--s3);
gap: var(--s-half);

// ❌ Bad
padding: 16px 24px;
gap: 4px;
```

### Radius

Radius follows the role of a shape, not its height.

| Token      | Value  | Role                                                                                   |
| ---------- | ------ | -------------------------------------------------------------------------------------- |
| `--r-sm`   | 6px    | Inline: tooltip, kbd, checkbox, inline edit field, hover-control group, select options |
| `--r-md`   | 10px   | Controls and list items: buttons, fields, nav rows, task and note cards, menu items    |
| `--r-lg`   | 14px   | Floating surfaces: dialogs, menus, snackbars, date picker, add-task bar, sheets        |
| `--r-full` | 9999px | Icon buttons, the phone's floating nav pill, chips, badges, counts, toggles            |

A nested shape is never rounder than its parent. An inner shape inset by _p_
inside radius _R_ uses _R − p_: a menu (14) with 4px inner padding has 10px
items; a select panel (10) with 4px padding has 6px options.

### Elevation

Resting UI has no shadow. Only floating surfaces are elevated:

| Token      | Use                                                                    |
| ---------- | ---------------------------------------------------------------------- |
| `--elev-1` | Menus, popovers, select and autocomplete panels, date picker, snackbar |
| `--elev-2` | Dialogs, the add-task bar, sheets, drag previews                       |

Each level carries its own hairline: a 1px `--palette-separator` ring is part of
the `box-shadow`, so the edge stays visible where shadows vanish (dark palettes,
glass, a busy background image) and the ring never changes layout. Don't add a
border to an elevated surface. Cards are not elevated: they are a surface with a
hairline border and no shadow.

### Type roles

Every text style is one of six roles. Each is a `font` shorthand with a
whole-pixel line height on the 4px grid; `font` does not set tracking, so title
and label pair with a tracking token and the others track at 0.

| Token                | Value       | Tracking        | Use                                                        |
| -------------------- | ----------- | --------------- | ---------------------------------------------------------- |
| `--type-title`       | 600 18/24px | `--track-title` | Page, dialog and settings-window titles                    |
| `--type-heading`     | 600 16/24px | 0               | Panel and section headings, detail task title, empty state |
| `--type-body`        | 400 14/20px | 0               | Default UI text: nav, fields, menus, rows                  |
| `--type-body-strong` | 500 14/20px | 0               | Task titles, button labels, values                         |
| `--type-label`       | 600 12/16px | `--track-label` | Section and group labels (chrome around content)           |
| `--type-meta`        | 400 12/16px | 0               | Tags, counts, hints, summary labels, badges                |

```scss
.section-title {
  font: var(--type-heading);
}
```

- **Base text** is the body role: `html`, `body` and `.mat-typography` (on `body`) set `font: var(--type-body)` and tracking 0 (`src/styles/page.scss`), which also stops Material's M2 body tracking (0.25px) from reaching every text node.
- **Form controls** inherit the app font: `:where(button, input, textarea, select) { font-family: inherit }`. Without it, Chromium's UA Arial reaches custom buttons and badges.
- **Global heading ramp** (`page.scss`) types `h1`–`h6` that have no rule of their own: 28/36, 22/28, 18/24, 16/24, 14/20, 12/16, all 600. It replaces Material's M2 hierarchy (`.mat-typography h1 { font: 400 24px/32px }`) at that hierarchy's specificity (0,1,1), placed after it, so every component heading rule wins over it. Material dialog and card titles keep their mapped typography.
- **Material's M2 typography classes** (`.mat-h1`, `.mat-headline-5`, `.mat-h3`, `.mat-caption`, …) are mapped onto the roles in `_overwrite-material.scss`. Prefer the role tokens in new code.
- **Text-entry fields** use the body size, and 16/24 under `(pointer: coarse)`: iOS zooms into a focused field below 16px (see [Angular Material](#angular-material)). Bare inputs outside a `mat-form-field` use the `noIosFocusZoom*` mixins in `src/styles/mixins/_ios-focus-zoom.scss`.
- **Numbers** that change in place (times, counts) use `.tabular-nums`.
- **Size primitives** `--font-size-xs` (11) … `--font-size-3xl` (28), `--font-weight-*`, `--line-height-*` and `--letter-spacing-*` stay for the roles, the heading ramp and legacy rules. Snap an off-scale size to the nearest role instead of adding a primitive.

Deliberately proportional `em` sizes that track their parent (`font-size: 1em`
on an inline icon) are the one exception.

### Icons

| Token         | Value | Use                                                         |
| ------------- | ----- | ----------------------------------------------------------- |
| `--icon-sm`   | 16px  | Inline with 12–14px text: meta rows, chips, compact buttons |
| `--icon-md`   | 20px  | Every control: buttons, menus, nav, header, field rows      |
| `--icon-lg`   | 24px  | Touch-first surfaces: bottom nav, empty state               |
| `--icon-slot` | 24px  | Leading icons centre in this slot                           |

- The glyph equals its box: set `font-size`, `width` and `height` together, or the glyph decentres. Icon boxes that are deliberately off this scale (a 48px empty-state illustration) keep a matched set.
- One icon font: Material Symbols Outlined, `FILL` 0. `FILL` 1 means "on" (active nav, pressed toggle, playing).
- No icon goes below 16px.

### Control heights

| Token      | Value | Use                                                              |
| ---------- | ----- | ---------------------------------------------------------------- |
| `--ctl-sm` | 32px  | Compact: add-bar actions, in-row buttons, section headers        |
| `--ctl-md` | 40px  | Default: buttons, icon buttons, nav rows, fields, menu items     |
| `--ctl-lg` | 48px  | Touch surfaces: bottom nav, drawer rows, sheet rows, touch menus |

Under `(pointer: coarse)` `--ctl-sm` becomes 40px, so no hit area on a touch
device is below 40px. See [Touch scale](#touch-scale) for everything else that
steps up on a phone or tablet.

### Touch scale

One `(pointer: coarse)` block in `_css-variables.scss` (plus the button and field
tokens in `_overwrite-material.scss`) re-points the scale for touch devices, so
components inherit it without their own media queries. Pointer devices keep the
values in the tables above.

| Token                                                   | Pointer       | Touch                                                |
| ------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| `--font-size-md` (body, body-strong, task text, labels) | 14/20         | 16/24                                                |
| `--font-size-sm` (meta, label)                          | 12/16         | 13/16                                                |
| `--icon-md` (every control glyph)                       | 20            | 24                                                   |
| `--icon-btn-size` (round icon buttons)                  | 40 (`ctl-md`) | 48 (`ctl-lg`)                                        |
| Material buttons and button toggles                     | 40, 14px      | 48, 16px (`mat-button-compact` stays 40)             |
| `--task-first-line-min-height`, `--task-icon-size`      | 40            | 48 (a title-only row is 56, one with a meta line 60) |
| `--task-title-line-height`, `--done-toggle-glyph-size`  | 20, 22        | 24, 24                                               |
| `--planner-*` (Upcoming rows, chips, icons)             | 14/11, 20, 42 | 16/13, 24, 48                                        |

Rules that follow from this:

- A hit area on touch is at least 40px, and 48px for anything the thumb reaches often: header actions, task rows and their done toggle, bottom nav, field rows in the task detail sheet, settings categories.
- Write row heights, icon sizes and text through the tokens above. A literal `40px` or `20px` in component SCSS does not scale; it silently keeps the pointer size on a phone.
- Rows that sit in the task column (the add-task row, repeat rows) derive their indent from `--task-icon-size`, so the "+" and the label stay on the cards' columns when the slot grows.
- Text-entry fields were already 16/24 on touch; the rest of the UI now matches them, so a focused field no longer looks larger than the text around it.
- The planner's week strip keeps its 40px row (`ROW_HEIGHT` is shared with the drag-to-expand math), but its month, weekday and day labels use the touch type sizes.

### Layout

| Token                                       | Value                                | Notes                                                                      |
| ------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `--page-gutter`                             | 8px, 16px ≥ 600, 24px ≥ 960          | Page content's one left edge                                               |
| `--component-max-width`                     | `clamp(800px, 65vw, 960px)`          | 900–1000px on iPad (`body.isIPad`)                                         |
| `--bar-height-large`                        | 56px                                 | Header band and brand row                                                  |
| `--side-nav-width`                          | 260px                                | Side nav panel, expanded                                                   |
| `--bottom-nav-pill-height`                  | 64px                                 | The phone's floating nav pill (four 56px destinations, 4px inside it)      |
| `--bottom-nav-height`                       | 80px                                 | The strip the pill occupies: pill plus 8px above and below                 |
| `--shell-inset-top`, `--shell-inset-bottom` | 0; 56 and 80 + safe area below 600px | How far a page's scroller pads itself clear of the floating header and nav |
| `--dialog-gutter`                           | 16px, 24px ≥ 600                     | Dialog title, content and actions inset                                    |
| `--dialog-w-s/m/l`                          | 440 / 560 / 720px                    | Dialog widths, see [Dialogs](#dialogs)                                     |

### Legacy aliases

These names keep working and point at the scale:

| Legacy name                                                                   | Now                    |
| ----------------------------------------------------------------------------- | ---------------------- |
| `--radius-xs`, `--radius-sm`                                                  | `--r-sm`               |
| `--st-radius`, `--radius-md`, `--card-border-radius`, `--input-border-radius` | `--r-md`               |
| `--radius-lg`, `--radius-xl`                                                  | `--r-lg`               |
| `--radius-pill`                                                               | `--r-full`             |
| `--md-sys-level1` … `--md-sys-level2`, `--whiteframe-shadow-1dp` … `4dp`      | `--elev-1`             |
| `--md-sys-level3` … `--md-sys-level5`, `--whiteframe-shadow-6dp` … `24dp`     | `--elev-2`             |
| `--bar-height`, `--bar-height-small`                                          | `--ctl-lg`, `--ctl-md` |
| `--task-first-line-min-height`, `--task-icon-size`                            | `--ctl-md`             |

## Angular Material

Material is mapped onto the scale in `src/styles/components/_overwrite-material.scss`,
through its public `--mat-*` tokens. The M2 theme declares its tokens on `html`;
the mapping sets them on `:root`, which outranks it. Tokens Material declares on
a component element (chips, tabs, slide toggles, form fields) are set on that
element. Structural rules are kept to what Material does not expose as tokens,
each commented in place.

- **Typography:** dialog titles use the title role (18/24, 600) and dialog text the body role. Fields, selects, options, menu items, checkbox, radio and toggle labels are 14px; hints and tooltips 12/16; snackbars 14/20; date-picker headers 12px. Material's 0.25–1.25px tracking is 0 everywhere (titles keep `--track-title`).
- **Shapes:** dialogs, menus, snackbars and the date picker `--r-lg`; buttons, button toggles, fields, expansion panels, cards and select/autocomplete panels `--r-md`; options `--r-sm`; tooltips `--r-sm`; chips `--r-full`.
- **Elevation:** dialogs `--elev-2`; menus, select and autocomplete panels, the date picker and snackbars `--elev-1`. Raised buttons have no shadow.
- **Buttons:** text, filled, outlined, raised and tonal buttons are 40px (`--ctl-md`). Add `class="mat-button-compact"` to a button, or to the row that holds them, for 32px buttons (40px on touch). Icon buttons are 40px round.
- **Button toggles** (segmented controls) are 40px with `--r-md`.
- **Menus:** the panel has 4px inner padding; items are 40px (48px under `(pointer: coarse)`), `--r-md`, with 12px insets and 20px icons. Dividers use `--palette-separator` with 4px above and below. Item rules are scoped to `.mat-mdc-menu-panel` because side-nav links also carry `.mat-mdc-menu-item`. Opt into a 320px panel with `class="mat-menu-wide"`.
- **Select and autocomplete panels:** 4px inner padding, 40px options (48px on touch).
- **Tooltips:** 12/16 type, `--r-sm`, and the inverse colour pair `--palette-tooltip-bg` / `--palette-tooltip-ink` (mapped in `_palette-theme.scss`), so a tooltip reads on any surface.

### Fields

One field look for both appearances:

- A `--r-md` box with a 1px `--input-border-color` edge, which is the palette's `--palette-outline` role (3:1 against its surface, WCAG 1.4.11). Hover strengthens the edge (`--input-border-color-hover`); focus is a 2px ink edge (`--input-border-color-focus`); invalid uses `--input-border-color-invalid`. Material's grey hover and focus wash is off.
- `appearance="outline"` renders the same box through the outline tokens (colour, width, shape). Prefer the default fill appearance in new templates.
- A labelled field is 56px plus its edge. A field without a label (search, filter, toolbar select) is 40px, like a button.
- Field text is 14/20 on pointer devices and 16/24 under `(pointer: coarse)`. The floating label rests at the text size and floats at 12px.
- Toggle fields keep their edge on focus and show the focus ring instead.

### Dialogs

- **Anatomy:** one `--dialog-gutter` (24px, 16px below 600px) insets title, content and actions. The title box is `24 24 12` around one 24px line (Material's 40px baseline strut is hidden); content is `24 24 16`; actions are `8 24 24`, with buttons 8px apart through the row's gap (also when they wrap). Title, `mat-dialog-content` and `mat-dialog-actions` are siblings: no dialog nests its actions in its content.
- **Height:** the content scrolls between the pinned title and actions, so the actions never leave the screen. Material caps the content at 65vh, which is enough for most dialogs. One that needs the whole viewport (schedule, deadline) lifts that cap with `max-height: none` on `mat-dialog-content` and makes its host a flex column no taller than the viewport; the pane's own max-height does not reach the content.
- **Markdown editors:** use `live-markdown-editor` with `[fillHeight]="true"` inside a bounded flex pane. CodeMirror then owns the text scrollbar; keep the formatting toolbar and dialog actions outside that scrolling area.
- **Title:** every dialog has a visible `h2 mat-dialog-title` in the title role. It is also the dialog's accessible name. (`h1` belongs to the page.) A leading 20px icon is allowed only when it names the object type (repeat, sync). `dialog-confirm` shows `data.title`, or "Confirm"; `dialog-prompt` shows its plain `message` or the field's label.
- **Help:** a dialog that needs help puts `<help-section>` in its content. Its button is a plain 40px icon button at the end of the title row, never a floating button over the corner.
- **Widths:** S 440px (the default: a dialog without a size is at least this wide) for confirm, prompt, estimate, schedule, deadline and reminder; M 560px for entity forms (project, tag, habit, repeat, sync, import, board); L 720px for reference content (keyboard help, logs, conflict details); `window` 1040px for the Settings and Plugins windows. A dialog that always has the same size declares it itself, `private readonly _size = useDialogSize('m')`, so every call site opens it at that size; a single call site spreads `dialogSize('m')` into `MatDialog.open()`. Both live in `src/app/ui/dialog-size.util.ts`. The pane's max-width (`--mat-dialog-container-max-width`, 94vw below 600px) keeps every size on screen.
- Don't set `width`, `min-width`, `max-width` or `width: max-content` on a dialog (config, component or content); pick a size.

## UI icon vocabulary

Use the existing Material Symbols Outlined family at weight 400 and `FILL=0` for
built-in UI actions. Keep native platform symbols and provider/brand marks where
they identify their actual source. Preserve user-selected icons and emoji.

Today uses `today`; generic dates use `calendar_month`; time-of-day uses
`schedule`; tracked duration uses `timer`; estimates use `hourglass_empty`.
Keep `alarm` for actual reminders, `flag` for deadlines, `repeat` for recurrence,
and `event_busy` for removing a planned date. Notes use `description`, not chat
bubbles. Use `delete` for recoverable deletion and `delete_forever` only for
permanent deletion. Imports/uploads, downloads/exports and clipboard copies
must follow the actual action direction.

Every icon-only action needs a translated accessible name on its button. Keep
visible labels when the icon alone cannot distinguish the meaning, such as
Tomorrow, next week, energy levels, and timer controls with different scopes.
Match repeated navigation icons through `NAV_SECTION_ICON`; use pure display
resolvers for known legacy built-in defaults instead of rewriting saved icons.

## Dialog action buttons

One treatment per role so dialogs feel consistent. Classify by **function, not label** ("Close" that dismisses a read-only view is secondary; "Close" that commits is primary).

| Role                             | Treatment                         | Notes                                                            |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Primary / confirming             | `mat-flat-button color="primary"` | Save, OK, Submit, Create, Schedule — the main affirmative action |
| Cancel / dismiss / secondary     | `mat-button` (no `color`)         | De-emphasized text button                                        |
| Destructive                      | `color="warn"` (keep the variant) | Delete, Remove, Unschedule — never folded into primary           |
| Genuine alternative (not cancel) | `mat-stroked-button`              | e.g. "Skip instance", "Configure" next to a primary action       |

Rules:

- **Order:** `[start-edge actions] … [Cancel] [Primary]`. Cancel sits directly before the primary action, at the end edge; the primary action is the last button in the DOM (the e2e `DIALOG_SUBMIT` selector). A secondary destructive or alternative action (Delete, Remove, Unschedule, Duplicate, Test connection) goes first, at the start edge, as `mat-stroked-button` (`color="warn"` when it destroys) with `class="dialog-action-start"` on the last button of that group. Dialogs align their actions with `align="end"`.
- **Icons:** drop generic `check`/`close`/`save` icons on OK/Cancel/Save/Submit — they add nothing. Keep icons that carry meaning or tell side-by-side actions apart (`alarm`/`today`/`event_busy` in scheduling, `flag`, `content_copy`, `online_prediction`, `cloud_upload`, `delete_forever`). A destructive action's label already says what it does.
- **No raised buttons** in dialogs: a primary action is `mat-flat-button`.
- **No `color` on cancel/close** — leftover `color="primary"` on a Cancel just tints it; remove it.
- **Reactive appearance** — when a button's appearance must change at runtime, bind it on a single element (`[matButton]="cond ? 'filled' : 'outlined'"`) instead of swapping two buttons in an `@if`/`@else`. The attribute form is fixed at construction, and the swap re-creates the node, dropping focus and any click that lands mid-flip. See `finish-day-btn.component.html`.
- **No dead classes** — the legacy Bootstrap `btn btn-primary` classes are gone; don't reintroduce them. `submit-button` is only styled inside `dialog-create-tag`.
- **Symmetric choice dialogs** (e.g. sync "use remote" vs "use local") may use two matched `mat-stroked-button`s — there is no single primary.

## Forms and disclosures

- **One field look** (see [Fields](#fields)). New templates use the default appearance; there is no `appearance="outline"`.
- **One disclosure.** "More options", Sound, the repeat dialog's Options, native `<details>` ("Customize colors", a plugin's details) are one pattern: a 40px row, a 20px chevron leading the label (14/500, the `--type-body-strong` role), on the content's own left edge; the chevron turns 180° when open. `collapsible` and `formly-collapsible` get it from `src/app/ui/_collapsible-shared.scss`, `<details>` from `src/styles/components/_disclosure.scss`. Give `collapsible` `[isIconBefore]="true"`. A section's "More options" is named for assistive tech with its section (`aria-label`: "More options – Language & region").
- **Boolean rows** are a field-height bordered row, control first, label after it, hint below. A toggle outside formly sits in a `mat-form-field` with a hidden input, as `formly-slide-toggle` does.
- **View switchers** (Plugins Installed/Discover, Appearance Dark mode) are a `mat-button-toggle-group`: 40px, `--r-md`, the chosen segment is the tonal "selected" role. A toggle button's role is `radio`.
- **Selection** is one role: the active side-nav row, the open settings category, a pressed segment, the chosen customizer entry and the task open in the detail panel share `--palette-selected` / `--palette-selected-ink`. Filled accent (`--palette-accent` with `--palette-accent-ink`) is for the single primary action of a surface.

## Phone shell

Below 600px the shell is two floating glass surfaces over a full-height page, as
on iOS: the header and the bottom nav hover over the content, and what scrolls
behind them is blurred.

- **Header:** an overlay (`position: absolute` in `app.component.scss`), the same frosted frame as on desktop (`--glass-panel-bg`, `--glass-blur`), 56px tall.
- **Bottom nav:** a floating pill, `--r-full`, `--elev-2`, `--s` above the safe area and `--s2` from each side (at most 576px wide, centred). Exactly four labelled destinations: **Today, Upcoming, Inbox, Browse**. Each is a 24px icon over a one-line meta label in a 56px pill-shaped hit area; the open destination is the tonal "selected" role with a filled glyph. It has no add button and no per-user slot: **Browse** opens the side nav as the drawer, which also lists the right-panel toggles (Project Notes, Issue Provider Panel, plugin panels) that the header carries from 600px up. Upcoming is hidden when the Planner is switched off. Glass off gives the same pill with an opaque `--bottom-nav-bg`.
- **Content:** a page's scroller pads itself by `--shell-inset-top` and `--shell-inset-bottom` so its first and last rows rest clear of both surfaces while the rest scrolls behind them. A page that is the scroller (secondary pages) gets this from `.route-wrapper > router-outlet + *` in `app.component.scss`; a page that scrolls an inner element pads that element and is excluded there (the work-view `.today`, the planner's `planner-plan-view`, the search page's results). A new page either is its own scroller or pads its inner one; it never adds its own bottom space for the nav.
- **Browse drawer:** full screen (`width: 100%`, sliding in from the right, closed with its Close button or a swipe right), solid by design. The destinations the bar and Settings already reach are not repeated in it. It leaves out Today, Inbox and Upcoming (bar), Plugins & integrations and Account (rows at the end of Settings' category list) and Support us (an entry in Help); it adds the right-panel toggles. A nav item flagged `desktopOnly` is skipped on a phone, one flagged `mobileOnly` is skipped above it; `MagicSideNavComponent.navigationItems` applies both, also to a menu's children, and drops any separator the hiding leaves first, last or doubled. The Projects and Tags headers keep only their "+" on a phone and put the other tools (show/hide, new folder) behind a ⋯ menu.
- **Header:** the sync icon shows on a phone once sync is set up (so an error stays visible); setting it up lives under Account (a row at the end of Settings on a phone).
- **Today:** the time summary row appears only when time has been worked or tasks are planned for today, never for overdue tasks' estimates alone.
- Both insets are 0 from 600px up, so the same rules are inert on desktop.
- The header's banner row stays inside the header, so a banner covers the first rows while it is shown.

## Page layout

Secondary pages (Habits, Recurring tasks, Archived projects, Metrics, Worklog and History, Daily summary, Support us) are one column:

- **Secondary-page column:** `.page-wrapper` puts the content at the page gutter (`--page-gutter`, the header title's left edge), 16px from the top and 72px from the bottom (16px on a phone, where the scroller already pads clear of the floating nav). `.component-wrapper` caps it at `--component-max-width` and stays aligned to the page gutter.
- **Task lists:** `.task-list-wrapper` centres the bounded task column within its available pane, with equal inline margins. The summary, sections, task cards, add row and Finish Day align inside that column. Opening a side panel recentres the column within the remaining workspace; narrow screens keep the normal page gutters. Subtasks retain their indentation.
- **Canvas pages** (Planner, Schedule, Boards) span the width and use the same gutter: day columns, the schedule toolbar and the board tabs and panels start at `--page-gutter`.
- **No second page title.** The shell header names the page. Sections inside a report use the title role (`--type-title`), then the heading role (`--type-heading`); no centred headings. Report tables are `--r-md` hairline cards (`.material-table`), never shadowed.
- **Empty states** are one layout, `.empty-state` (`src/styles/components/_empty-state.scss`): on the column's start edge, an optional 24px muted icon, one line of muted body text (a heading line may lead it) and at most one action. `<p class="empty-state">text</p>` is the text-only form.

## Callouts (info / warning / danger / success)

Tinted message boxes inside dialogs and config panes use the global `.callout`
class from `src/styles/components/_callout.scss` — never a local `.warning-box`
clone with its own `rgba(255, 152, 0, …)`, which ignores the palette and dark mode.

```html
<div class="callout callout--warning">
  <mat-icon aria-hidden="true">warning</mat-icon>
  <p>If you lose this password your synced data cannot be recovered.</p>
</div>
```

| Modifier          | Tone token        | Use for                                   |
| ----------------- | ----------------- | ----------------------------------------- |
| _(none)_/`--info` | `--c-primary`     | Neutral context, "what will happen" notes |
| `--success`       | `--color-success` | Confirmation, savings, "nothing to do"    |
| `--warning`       | `--color-warning` | Irreversible-but-intended actions         |
| `--danger`        | `--color-danger`  | Destructive actions, failures             |

One tone token (`--callout-c`) drives icon color, border and fill, the latter two
via `color-mix()` — so every tone is theme-aware and a new tone is one
declaration. Outer spacing stays with the consumer
(`.callout { margin-bottom: var(--s2); }` in the dialog's own SCSS), the
primitive owns no margin.

The icon is optional, but the copy must be a single child element — one `<p>`, or
a `<div>` wrapping several. `.callout` is a flex row, so putting the class on a
`<p>` and leaving the text bare turns every inline child into its own flex item:
`<strong>Note:</strong> …` renders as two columns with a gap and a hanging indent
on the wrap.

Sibling: `.info-panel` (`_info-panel.scss`) is the same idea for
formly-generated markup, where no icon element can be added and the glyph has to
come from a `::before`.

## Key Files

| File                                             | Purpose                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `src/styles/_css-variables.scss`                 | Design tokens: the scale, layout, z-index, colour aliases         |
| `src/styles/components/_overwrite-material.scss` | Angular Material on the scale (tokens + the few structural rules) |
| `src/styles/components/_palette-theme.scss`      | Maps the palette roles onto the shared tokens and containers      |
| `src/styles/components/_ultra-tasks.scss`        | Ultra Tasks workspace: card task rows, shell panels, nav          |
| `src/styles/components/_glass.scss`              | Glass shell panels                                                |
| `src/styles/page.scss`                           | Base text, control font reset, heading ramp, page wrappers        |
| `src/styles/themes.scss`                         | Material theme setup + utility classes                            |
| `src/styles/util.scss`                           | Utility classes                                                   |
| `src/styles/components/`                         | Global component styles (Material overrides, shared patterns)     |
| `src/styles/mixins/`                             | Reusable SCSS mixins                                              |
| `src/app/ui/`                                    | 40+ reusable Angular UI components                                |

## Settings layout

Settings opens in a centered dialog over a dimmed, blurred workspace on desktop.
Use labeled category navigation on the left: 40px rows, the open category in the
tonal "selected" role like the side nav's active row. On small screens, show the
category list first and provide a Back action within the selected category.

The window header is 64px: the title role, a 40px close button, a hairline below.
Everything in the content starts at one left edge: the category title (title
role), section headings (heading role, a 40px row that also holds the help
button), fields and disclosures. Sections are `--s4` apart, a category title is
`--s3` above its first section. The footer is meta text; its links are plain
until hovered.

Use `--s` (8px) between related elements, `--s2` (16px) inside sections,
`--s3` (24px) between groups, and `--s4` (32px) between major sections.
Group controls with headings and whitespace. Reserve bordered surfaces for
self-contained information such as sync status.

Each option has a separate question-mark button at the trailing edge of its row.
Use the shared `setting-help` component for generated and custom controls. Help
opens on hover, keyboard focus, or click and fades away when the pointer leaves.
The button must have its own hit area and an accessible name identifying the
option. Tooltips explain the effect of a choice. Required formats, validation
errors, and destructive consequences stay visible alongside the control.

Place less-used options in a local disclosure within their group. Search must
open that disclosure and locate the matching option without enabling a feature.
Use the existing setting keys and save behavior when regrouping fields.

The Plugins & integrations window separates Installed from Discover. Keep search,
type filters, and page navigation outside the scrolling results. Use compact rows
for installed items, with secondary metadata in Details, and a responsive grid for
discovery. Render at most 24 results per page; reset to page one after a search or
filter changes. Empty results must offer a way to clear filters.

## Glass surfaces

With Glass appearance on (Settings → General → Appearance) the window reads as one
pane of glass in three tiers. All values come from `_glass.scss` and the palette
normaliser, never from component SCSS.

| Tier    | Surfaces                                                  | Tint alpha (design) | Blur                      |
| ------- | --------------------------------------------------------- | ------------------- | ------------------------- |
| Frame   | Side nav, header, right panels, the phone's floating nav  | 75%                 | `--glass-blur` (20px)     |
| Canvas  | The content sheet behind the task list (`.route-wrapper`) | 84%                 | same, on the wrapper only |
| Overlay | Full-width phone right panel (the phone drawer is solid)  | 95%                 | none                      |

- The canvas sits one step denser than the frame around it, so the focus area stands out while the frame stays see-through.
- **Opaque on purpose:** task cards, dialogs, menus, popovers and the add-task bar. Content the user reads and edits never sits on a translucent fill.
- **Alpha is `max(design value, contrast floor)`.** The floor keeps body and muted text readable over a worst-case backdrop (the ink colour pulled 35% toward the background; see [theming-contract.md](theming-contract.md#glass-roles)). Do not lower an alpha in a component; change the design value and re-run `palette-normalize.util.spec.ts`.
- **Blur never animates.** Put `backdrop-filter` on the static wrapper, not on a routed page, a drawer or anything inside a route transition, and never on the `magic-side-nav` host (see the `magic-side-nav` rule near the end of this guide).
- **Fallbacks:** reduced transparency, forced colours and `st-solid` make every tier opaque; a browser without `backdrop-filter` gets the overlay alpha.
- **Windows window controls** are drawn by the OS over the top-right corner and can't show CSS. The renderer sends the frame tint and alpha to the main process (`updateTitleBarDarkMode(isDark, overlayColor)`), and the control band is `WCO_HEIGHT` (56px, the header height) so the glyphs share the header's centre line. Keep both in step with the header if either changes.

## Colour

Colours come from the device-local three-colour palette (background, cards and
panels, accent) per mode. `PaletteThemeService` normalises it into roles and
writes them on the root element; `_palette-theme.scss` maps the roles onto the
shared tokens and painted containers. [theming-contract.md](theming-contract.md)
lists every role, its contrast guarantee and the aliases it feeds. New colours go
through these roles, never a hex value.

| Use case    | Tokens                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text        | `--text-color`, `--text-color-muted` (the `--palette-ink-muted` tier), `--text-color-most-intense`                                                       |
| Surfaces    | `--bg`, `--card-bg`, overlays on `--palette-surface-raised`                                                                                              |
| Interaction | `--palette-hover`, `--palette-selected` (+ `-ink`), `--state-hover` / `--state-pressed` overlays                                                         |
| Lines       | `--separator` (`--palette-separator`) for hairlines, `--input-border-color` (`--palette-outline`) for field edges                                        |
| Focus       | `--focus-ring` (`--palette-focus-ring`)                                                                                                                  |
| Semantic    | `--c-warn` / `--color-danger`, `--color-warning`, `--color-success`, `--scheduled-date-*` (the normaliser's danger, warning, success and upcoming roles) |
| Tooltips    | `--palette-tooltip-bg`, `--palette-tooltip-ink`                                                                                                          |

Each painted container sets the ink that contrasts with its own colour, so text
inherits a readable colour from its container. `color="warn"` buttons, overdue
dates and destructive actions stay red and never follow the accent. Links use the
text ink; links inside running text (`p`, table cells, hints, markdown) are
underlined, while anchors that are controls or rows (Material buttons, nav and
footer links, card titles) keep the look they declare.

### Theme-Specific Overrides in Components

```scss
@include darkTheme() {
  /* dark-only styles */
}
@include lightTheme() {
  /* light-only styles */
}
```

Mixins are in `src/styles/mixins/_theming.scss`.

## Popups, search and descriptions

- **Popups over the page** (global search, the description editor) are Material dialogs: opaque surface, `--r-lg`, `--elev-2`, one of the dialog sizes. The search popup uses the Settings window's surface (`.search-popup`, `settings-backdrop`), `dialogSize('l')` and sits near the top; Escape closes it and so does picking a result. The search page is shared with the phone route, so it takes an `isPopup` input rather than a second copy.
- **Save / Discard dialogs** write nothing until Save. Discard, Escape and the backdrop leave the data as it was; Save is the single filled button, disabled until something changed.
- **Task description** is the task's `notes` field. On the row it is one muted `--type-meta` line after the last tag, cut with an ellipsis where the row runs out; the full text is in a multi-line tooltip (`matTooltipClass="task-description-tooltip"`, defined once in `_overwrite-material.scss`). It adds no height: the row stays 56px.
- **Add actions** live where the thing is added: the inline "Add task" row in each list or section. The header has no global "+" and neither has the phone's bottom nav; quick capture is Shift+A.
- **One list, many destinations:** a picker that can target a project or a section lists projects in tree order with their sections indented beneath, led by a dash. The current location is shown and disabled.

## Task rows (cards vs flat)

`src/index.html` always sets `body.ultra-tasks`, and `_ultra-tasks.scss` turns every
top-level `task` row into a card: a full `--st-line-width` border in
`--task-border-color` (the palette's quiet `--palette-border` role), the `--card-bg`
surface, `--st-radius` (`--r-md`) corners and a `--s-half` gap between rows, with no
separator. A row is exactly 48px tall with a title only and exactly 56px with a meta
line, on every palette. The inherited tokens in `_css-variables.scss` still describe flat,
hairline-separated rows, and planner, board and issue-panel items keep that flat
default:

| Token                  | Inherited default (flat)           | Ultra Tasks `task` rows               |
| ---------------------- | ---------------------------------- | ------------------------------------- |
| `--task-separator`     | `1px solid var(--separator-color)` | `none`                                |
| `--task-border-color`  | `var(--divider-color)`             | `var(--palette-border)`               |
| `--task-border-radius` | `0`                                | `var(--st-radius)`                    |
| `--task-list-row-gap`  | `0`                                | `var(--s-half)`                       |
| Row border and surface | none / `--task-c-bg: transparent`  | `--st-line-width` border, `--card-bg` |

Cards or separators, never both and never nested: a **subtask is a row inside its
parent's card**, with no border, radius or fill of its own, divided from its
siblings by a hairline in `--task-border-color` (none above the first). It is
indented so its toggle sits under the parent's title.

Change the row look in these tokens and in `_ultra-tasks.scss` only — never
hardcode a border or surface on a row in component styles. Rows that draw their own
box (planner, board and issue-panel items) take their top/bottom edge from
`--task-row-edge`, so the separator and the box border never cancel each other out
on one element. Bare `task` hosts use `--task-separator`. Task rows are a
performance hot path: CSS only, and no per-row shadow, filter or blur.

Row states each have one channel:

| State                      | Look                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Open in the detail panel   | `--task-c-selected-bg` (`--palette-selected`) tint with the selected ink (`--palette-selected-ink`, muted tier `-selected-ink-muted`) |
| Tracked (the current task) | an accent edge: the card border becomes `--palette-accent-text`; no tint, no shadow. A subtask shows only its play indicator          |
| Multi-selected             | `--task-c-multi-selected-bg` tint plus a 1px accent outline                                                                           |
| Keyboard focus             | a `--focus-ring-width` (2px) `--focus-ring` outline, no tint                                                                          |

A tracked task is deliberately not tinted, so it never looks like the one open in
the panel. The planner marks its tracked row the same way.

Section headings in task lists (`collapsible.task-section`, including user-made
sections) are a 32px (`--ctl-sm`) type-only row in `--type-label` with
`--track-label`, muted, and **no rule** under it. The chevron sits in the same 24px
leading slot as the cards' done toggles and the title on the cards' text column.
Board panel titles follow the same label type. Task text stays at the body role, so
the two never read alike. No `text-transform: uppercase` — these labels are often
long and user-authored, where caps only add width. Meta counts follow the same
label style and are omitted entirely when zero rather than shown as `-` or `0`.

Multi-selection is a tint plus an outline because `background` on a task row is
contested (the `isSelected` `!important` rule wins over it), and author
backgrounds are dropped in forced-colors mode while outlines survive. The tint is
what separates it from keyboard focus — a 1px vs 2px line in one color is not
readable as two states — but it is the weaker channel, so the outline stays. Never
make a row state depend on `background` alone.

Focus rings on rows and other focusable containers (anything carrying a `tabindex`,
as opposed to a button or control — those keep the `.focus-ring` utility from the Focus
Ring section below) pair `:host-context(.isMousePrimary):focus` with `:focus-visible`.
Never a bare `:focus`: rows carry `tabindex="0"`, so a tap focuses them and the ring
then stays on the tapped row for the rest of the session. The two halves split the
work — the mouse-intent one covers clicks plus the scripted navigation and focus
restoration that follow them, and `:focus-visible` covers keyboards, including on a
touch device, where only a pen otherwise sets mouse intent. `.isNoTouchOnly` is not a
usable guard here: it only excludes pure touch devices, so iPads and touchscreen
laptops (`hybrid` for detect-it) still get the stuck ring.

Known edge of the mouse-intent half: on a hybrid device, a row that was tapped and left
focused picks up its ring once the user moves the mouse and intent flips back. Dropping
to `:focus-visible` alone removes that, at the cost of no ring on plain mouse clicks —
the ring on click is the deliberate choice here. Where a cue must show regardless of
input, use a class instead (see `highlight-searched-task`).

## Transitions & Animations

Motion is quick and settles softly: an element decelerates into place like a
physical object, and leaves without a hard cut-off. Durations are about 15% under
the Material defaults. The CSS tokens in `_css-variables.scss` and the Angular
constants in `src/app/ui/animations/animation.const.ts` mirror each other; change
both together.

| Type       | Variables                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Shorthands | `--transition-fast`, `--transition-standard`, `--transition-enter`, `--transition-leave`                                                    |
| Durations  | `--transition-duration-xs` (80ms), `-s` (130ms), `-m` (190ms), `-l` (320ms)                                                                 |
| Additional | `--transition-duration-enter` (190ms), `--transition-duration-leave` (165ms), `--page-transition-duration` (190ms)                          |
| Timing     | `--ani-standard-timing` (.25, .8, .25, 1), `--ani-enter-timing` (.16, 1, .3, 1), `--ani-leave-timing` (.4, 0, .9, .5), `--ani-sharp-timing` |

- When migrating hardcoded durations, pick the nearest bucket; up to ~15% drift is acceptable.
- Under touch intent (`body.isTouchPrimary`) the `-s` and `-m` durations are shorter.
- **Ordinary view switches** fade and scale slightly (the new page settles in from 1.04, the old one leaves toward 1.02). The large "warp" is for the daily summary only.
- **Reduced motion:** animations are off when the in-app "Disable all animations" setting is on or the OS asks for reduced motion (`isAnimationDisabled`). The app follows the OS setting; it does not override it. New CSS animations need no extra work (`body.isDisableAnimations` zeroes them); JS timers that wait for an animation must use the same flag.
- Code that waits on a duration (the side nav's width collapse, the header's reveal pin) must be at least as long as the token it waits for; check those constants when you change a duration.

## Focus Ring

One ring everywhere: 2px in `--focus-ring`, which resolves to the palette's
`--palette-focus-ring` (the accent as text, at least 4.5:1 on every layer).
Material components keep their own focus treatment; use these tokens for
non-Material buttons, cards, rows and custom controls.

| Variable              | Value                                               |
| --------------------- | --------------------------------------------------- |
| `--focus-ring-width`  | 2px                                                 |
| `--focus-ring-offset` | 2px (outside on controls; inset on full-bleed rows) |
| `--focus-ring`        | `--palette-focus-ring`                              |
| `--focus-ring-color`  | `var(--focus-ring)`, the name existing rules use    |

Change the ring through `--focus-ring`. Quickest adoption — add the `.focus-ring`
utility class from `util.scss`, which applies an `outline` on `:focus-visible` only
(so it doesn't fire on mouse clicks).

```scss
// opt-in per-element
.my-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
```

## Z-Index Layers

| Variable                | Value | Purpose                   |
| ----------------------- | ----- | ------------------------- |
| `--z-check-done`        | 11    | Task done checkbox        |
| `--z-main-header`       | 12    | Main header               |
| `--z-task-title-focus`  | 32    | Focused task title        |
| `--z-multi-select-bar`  | 45    | Multi-select action bar   |
| `--z-mobile-bottom-nav` | 50    | Phone floating navigation |
| `--z-side-nav`          | 60    | Side navigation           |
| `--z-backdrop`          | 222   | Backdrop overlay          |
| `--z-onboarding-hint`   | 998   | First-run hints           |
| `--z-add-task-bar`      | 999   | Add task bar              |
| `--z-search-bar`        | 999   | Search bar                |
| `--z-tour`              | 1001  | Tour overlay              |

Menus and dialogs (the CDK overlay container, 1000) cover the onboarding hint and
the add-task bar.

## Responsive Breakpoints

Available as CSS vars (`--layout-xxxs` through `--layout-xl`) and as SCSS variables and mixins in `src/styles/mixins/_media-queries.scss`:

| Breakpoint | Value  |
| ---------- | ------ |
| `xxxs`     | 398px  |
| `xxs`      | 440px  |
| `xs`       | 600px  |
| `sm`       | 960px  |
| `md`       | 1280px |
| `lg`       | 1920px |
| `xl`       | 2000px |

Device input is a separate axis: use `(pointer: coarse)` for touch hit areas and
field sizes (the scale does), and the `isTouchPrimary` / `isMousePrimary` body
classes for behaviour that follows the current input intent.

## Utility Classes

Defined in `src/styles/util.scss` and `src/styles/themes.scss`:

- Layout: `.center-wrapper`, `.mw` (max-width container)
- Responsive: `.hide-xs`, `.hide-xxs`, `.hide-gt-sm`
- Input: `.show-only-on-touch-primary`, `.show-only-on-mouse-primary`
- Theme: `.show-dark-only`, `.show-light-only`
- Color: `.bg-primary`, `.bgc-accent`, `.color-primary`, `.bg-success`, `.bg-warning`, `.bg-danger`
- Focus: `.focus-ring`
- Type: `.tabular-nums`

## Palette theme

There are no CSS themes: the app does not load theme files or user CSS. Colors come
from the three-color palette described in [theming-contract.md](theming-contract.md)
and § Colour above; new colors go through those roles.

## Side nav: never apply CB-creating properties to the `magic-side-nav` host

The mobile drawer (`.nav-sidenav`) and its overlay (`.nav-backdrop-mobile`) are `position: fixed` children of the `magic-side-nav` host. On mobile the host shrinks to `width: 0` (`hostWidthSignal` in `magic-side-nav.component.ts`).

Any property that establishes a [new containing block for fixed-position descendants](https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block) — `backdrop-filter`, `filter`, `transform`, `perspective`, `contain: paint|layout|strict`, or a matching `will-change` — re-anchors the drawer and backdrop to the 0-wide host. The drawer never appears when the user taps the menu.

Apply blur or tint to the inner `.nav-sidenav` instead, as `_glass.scss` does for its shell panels:

```css
/* ❌ Bad — collapses the mobile drawer */
body.ultra-tasks magic-side-nav {
  background: var(--my-pane);
  backdrop-filter: blur(var(--glass-blur));
}

/* ✅ Good — host stays visually inert */
body.ultra-tasks magic-side-nav .nav-sidenav {
  background: var(--my-pane);
  backdrop-filter: blur(var(--glass-blur));
}
```

Properties that do NOT create a containing block — `background`, `border`, `box-shadow`, `margin` — are safe on the host.

## Global Component Styles

Located in `src/styles/components/`, these are needed for elements that render outside component scope:

- `_overwrite-material.scss` — Angular Material on the scale (see [Angular Material](#angular-material))
- `_settings.scss` — Settings and Plugins windows
- `_customizer-menu.scss`, `backdrop.scss`, `_bottom-panel.scss`
- `markdown.scss`, `mentions.scss`, `table.scss`
- `fab-wrapper.scss`, `wrap-buttons.scss`, `multi-btn-wrapper.scss`
- `planner-shared.scss`, `formly-rows.scss`, `scrollbars.scss`
