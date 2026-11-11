# Keyboard shortcuts and undo: handoff

This work implements the keyboard-shortcut pass and a limited task history. The
user asked to stop implementation, commit, push, and leave a handoff. The user
also stated that the app has no installs yet; they want clean, conflict-free
defaults and a proposal for a complete undo/redo design that remains safe with
sync.

## Implemented

- In-app shortcut defaults, help, visible hints and settings were updated.
  Search defaults to `Ctrl+F`, Calendar to `Shift+C`, task deadline to
  `Shift+S`, scheduling for Today to `Alt+T`, and Today navigation to
  `Shift+T`. Standard copy/cut/paste, duplicate, undo and redo keys are
  configurable. Mac equivalents are supported for the standard defaults.
- Missing keyboard settings load the current defaults; explicitly saved values
  remain intact. The settings page and shortcut guide flag conflicts and offer
  safe default replacements where possible. Tests check default bindings and
  aliases on macOS and Windows/Linux, including system-wide defaults.
- Task copy/cut/paste uses the system clipboard plus a session-local task
  marker. Cut supports placement within project lists, sections, backlog and
  Done, and can promote a subtask to its current project root. Completed project
  tasks have an optional per-task manual order, usable by paste, dragging and
  movement shortcuts without altering completion timestamps.
- `TaskUndoService` provides a bounded, session-only queue for eligible title,
  notes, priority and parent-task estimate changes, plus reordering one completed
  project task. The shortcut guide shows the available undo/redo action. Eligible
  read-only/stopped integration edits and linked-task priority are supported;
  local suppression prevents delayed writes to an external provider.

## Current paste behavior

In a project or Inbox, a same-project cut of a parent task goes after the
focused parent task; with no focused task, an unfinished task goes to the top
of the no-section list and a completed task goes to the top of Done. A copied
task is duplicated at the top of the destination regular list regardless of the
focused row. A parent task cut from another project is appended to the
destination's regular list, also ignoring the focused row. A cut subtask pasted
onto a parent becomes its child; pasted onto a subtask it goes after that
sibling. Placement depends on keyboard focus, not selection highlighting alone.

The user's proposed rule—after the focused item, otherwise at the top of the
no-section list—is therefore **not universal** yet. Direct cross-project
subtask promotion and direct section-to-backlog moves are also unsupported.

## Remaining undo and sync work

Completion/reopening, scheduling, deletion, general moves, bulk actions,
subtask estimates and writable external-field edits are history barriers. Other
persistent actions, incoming sync and reload clear the session queue. Do not
enable broader inverses until their sync and provider behavior is safe.

The existing sync path has reproducible data-loss or divergence cases:

- An offline **Add to Today** can lose a concurrent ordinary title, notes,
  priority or completed-order edit, or the plan itself. Matched controls show
  this without undo as well as after undo/redo.
- Both trash and snackbar restore can overwrite unseen concurrent title
  edits; a three-device control loses two successive edits.
- A project move concurrent with an independent addition can leave the project
  lists in different orders. Planning field patches can also leave
  `planner.days` stale.

The retained `undo-*-sync.integration.spec.ts` files include **negative
controls that intentionally assert current failures**. They are not evidence
that these problems are fixed. The tests use the real store, operation capture,
conflict resolution, replay and restart with a simulated transport, not a live
sync server. See [the undo design](2026-11-09-task-undo-redo-design.md),
especially its proposed architecture, for the recommended approach: atomic
intent commands, version-aware compensating operations, field-level causal
merge, deletion tombstones, deterministic placement and explicit provider
compensation. Prove convergence and content preservation before extending the
queue. The new `doneOrder` field and its old-client behavior also need real
released-client/protocol compatibility verification.

## Stage 1 findings (2026-11-10): Add to Today against a field edit

Reproduced through `SyncFuzzHarness` with a plain, unscheduled task: device A
edits the title, device B runs `planTasksForToday` for that task, both offline,
then two sync rounds each (no undo involved):

| Upload first | Plan  | Title on A / B      | `dueDay` on A / B | Outcome                        |
| ------------ | ----- | ------------------- | ----------------- | ------------------------------ |
| A            | older | edited / edited     | none / today      | **diverged** (plan lost on A)  |
| A            | newer | original / original | today / today     | title edit lost                |
| B            | older | edited / edited     | none / none       | plan lost                      |
| B            | newer | edited / original   | today / today     | **diverged** (title lost on B) |

Cause: `planTasksForToday` is an opaque op. `isFieldPatchEligible` and
`sideNonNoiseKeys` refuse any side holding one, so the conflict falls to
whole-task LWW (`lww-field-level-resolution.md`, Decision 6). The same path
explains the delete/restore and planner-staleness failures: the plan reducer
also removes the task from `planner.days`, and LWW patch rows do not (the LWW
reducer only reconciles `TODAY_TAG`).

Fix (committed 65090c5561; `sync-fuzz:compare` against the prior HEAD showed 0
newly failing and 120 of 120 seeds executing identical steps, but the fuzz
actions never pass `plannedTask`, so it does not exercise the new path): the single-task
plan keeps its action, effects and Today ordering but now also carries a
readable `{ id, changes }` (`declarePlanForToday` in `task-shared.actions.ts`,
passed as `plannedTask` by the four single-task dispatchers). The field-patch and
disjoint-merge paths read it like an `updateTask`, so the plan and an unrelated
edit both survive, in both upload orders and both timestamp winners. The LWW
reducer also reconciles `planner.days` when a patch or snapshot changes
`dueDay` (`syncPlannerDays`), which fixes the stale-planner failure.

Deliberately not declared, so these still fall back to whole-task LWW: bulk
plans, subtasks (the reducer skips one whose parent is in Today, which the
action cannot know), no-op plans, and the reminder dialogs, automatic plans
and other dispatchers that do not pass `plannedTask`. A plan that clears a
reminder or a time still loses to a concurrent write of that same field
(`REMINDER_FIELDS` keeps the overlap path whole-task by design). Today's
order can differ between devices (native replay prepends, a patch appends).

Delete/restore (fixed the same day): a snackbar or trash restore after a delete
carries the same task snapshot the delete carried, so the round trip changes no
field, yet timestamp LWW treated its newer snapshot as the writer of every field
and discarded an older concurrent edit (and, in the three-client case, both
edits). `demoteNetNoopRestorePlans` (`conflict-net-noop-restore.util.ts`, called
by `ConflictResolutionPlannerService`) now recognises a client's delete directly
followed by a restore with an identical snapshot (ignoring `subTasks` and
`modified`) as inert, and lets a side that wrote something beat a side made only
of such pairs, whatever the timestamps. Only timestamp-decided TASK plans are
touched; archive and delete-wins precedence, multi-entity (cascade) deletes,
restores that change a field (for example to Today) and two inert sides keep the
old behaviour. Nothing is added to the wire. `undo-delete-sync` (9 cases: trash
and snackbar restore, both upload orders, edit older and newer, plus the
three-client case) now asserts that the edit survives; 5 of them fail without
the change. Not covered: project-list order after a restore (the specs compare
the title only).

Project-list order (investigated, deliberately not fixed): moving a task into a
project while another device concurrently appends to that project leaves the
same members in opposite order (A: moved, other / B: other, moved). It persists
through four sync rounds and a restart, and it needs a single move, not undo.
Concurrent adds to the source project, and a move beside a title edit,
converge. `project.taskIds` is a stored order list that task reducers append
to, so the two appends replay in opposite orders. Fix intake excludes
order-only differences, and `order-and-membership-options.md` records
"do nothing" as a valid outcome for exactly this class; the only structural
option there is a derived membership with a deterministic read-side order, a
separate design decision with a visible effect on every list. The negative
control in `undo-project-move-sync` stays as the reproduction. Moves remain a
history barrier, so the current undo queue is unaffected; the question returns
if undo of a move is added.

Stage 1 is otherwise done.

## Validation completed

- The previous combined Karma run passed 323 tests for the queue, supported
  field replay, scheduling negative controls and shortcut conflict handling.
- The most recent focused Karma run passed 133 tests for shortcut defaults,
  configuration hydration, shortcut handling and the guide.
- Browser checks passed for fresh defaults and reload, actual Calendar/deadline
  and Today/schedule shortcuts, current paste placement, the completion-history
  barrier, linked-task undo, and the earlier clipboard placement suite.
- `npm run checkFile` passed for the changed TypeScript/SCSS files; translation
  checks and `git diff --check` passed. Full live-provider sync E2E was not run.

Main entry points are `src/app/features/tasks/task-undo.service.ts`,
`task-clipboard.service.ts`, `task-done-order.service.ts`,
`src/app/features/config/keyboard-shortcut-conflicts.ts`, and
`docs/wiki/3.03-Keyboard-Shortcuts.md`.
