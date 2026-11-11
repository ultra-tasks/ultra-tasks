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

## Paste behavior

One rule covers copies, cut parent tasks and cut parents from another project:
the task goes after the focused parent task, or after the parent of a focused
subtask, and with nothing focused it goes to the top of the no-section list (a
completed task to the top of Done). Several copies keep their order. A cut
subtask pasted onto a parent becomes its child; pasted onto a subtask it goes
after that sibling; with nothing focused it is promoted to a task at the top of
the project being viewed, including from another project (a subtask of a
repeating task keeps the refusal, because moving it could need the
recurring-task confirmation after it was already promoted). Placement lives in
`TaskClipboardService._placeInProject`; a copy or cross-project move whose
placement is not possible stays where it was created or moved, without an error.
Copy and cut work from a focused Upcoming or Boards card; paste there asks the
user to open a project or focus a task, because those cards have no list
position. Undo and Redo are also offered in the search page's suggested actions
while one is available.

Deliberately unchanged: direct section-to-backlog moves stay unsupported, as
dragging rejects the same crossing; making paste more permissive than drag would
create a second set of rules.

Verification note: the E2E test `reorders completed project tasks without
changing completion time` fails after a page reload on this Windows machine
both with and without these changes (checked 2026-11-11 by running it against
the old clipboard service); the in-session paste, undo and redo steps pass.

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
queue. The `doneOrder` field's released-client compatibility was verified on
2026-11-11; see below.

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

## `doneOrder` compatibility (verified 2026-11-11)

**Verdict: compatible; the only effect on a released client is that it ignores
the manual order.** `git tag --contains 8ac83b6519` prints nothing: none of
v0.1.0, v0.2.0 or v0.3.0 contains the field, so those are the clients to protect.

- **Released client receiving the field.** A throwaway worktree of
  `ultra-tasks-v0.3.0` (shared `node_modules`; `package-lock.json` is identical)
  ran five `SyncFuzzHarness` specs, with one device writing `doneOrder` and one
  device running v0.3.0 code: the update replays, the field is kept, the v0.3.0
  typia validator accepts the state, and it survives a restart; a concurrent
  title edit resolves with both kept in either upload order; a concurrent
  reopen of the task converges in either upload order. No validation, stop,
  dev-error or retry event was recorded. The spec was not kept in the tree
  (it exercises v0.3.0 code); to repeat it, add a worktree of the tag and a
  spec that dispatches `updateTask` with `changes: { doneOrder }`.
- **New client receiving a released client's data.** A task without the key
  orders by completion time (`done-task-order.spec.ts`, new case). A released
  client that completes the task again changes `doneOn`, and the stored order
  is then ignored because its `doneOn` no longer matches (existing case). A
  malformed value from any client is treated as no manual order and never throws
  (new case, eight shapes).
- **Whole-task snapshots.** A released client's opaque ops (for example Add to
  Today, which does not declare its fields) resolve by whole-task LWW and its
  snapshot has no `doneOrder`, so receivers clear it and the order falls back to
  completion time. `OPTIONAL_TASK_FIELDS_AFTER_V19_2` already lists the field so
  such snapshots are accepted. This is the same pre-existing opaque-op gap that
  applies to every field, not a new class of loss.
- **Model rules.** The field is optional (`?`, nullable), no schema version is
  bumped, and `frozen-state.spec.ts` passes. Android reads named fields from the
  op JSON, so an extra key is ignored; the Android fixture lists the key and is
  pinned by a TypeScript spec, but I did not run the Gradle tests here.
- **Not verified.** The SuperSync server is not in this repository, so any
  server-side payload validation of task fields is unchecked. This repo's shared
  schema package has migrations only and never mentions the field.

## Stage 3: completion in the undo queue (2026-11-11)

Completing or reopening one ordinary task now enters the queue
(`TaskUndoService.updateDone`). The gesture sites record it:
`TaskService.toggleDoneWithAnimation` takes an optional `record` callback (the
service sits exactly at its line cap, so the change is line-neutral) used by the
task row and the planner card, and the context menu calls the queue directly.
Widget taps, bulk completion, carry-over and drag into Done keep the barrier.
Eligible: a local, non-repeating task with no reminder, won't-do mark or
integration link, and not a timed task while an enabled integration can write
calendar blocks. A completion whose effects dispatch another persistent action
(reminder dismissal, a parent completing with its last subtask) clears the
history instead of being recorded. Redo stamps a new completion time.

Evidence: `undo-completion-scheduling-sync` (8 cases) now asserts that a
concurrent Add to Today and a complete, undo or redo both survive in either
upload and timestamp order, and fails without the plan declaration (6 of 8);
`undo-completion-sync` (11 cases) covers a concurrent title edit and a concurrent
completion in both upload orders, with restart; 9 new unit cases cover the
eligibility rules; `undo-completion.spec.ts` (browser) completes, undoes the
completion and then the earlier rename, and redoes both.

Found on the way and fixed: the completing device stamps `doneOn` in the reducer,
but every other device derives it from the operation timestamp, so one completion
carries `doneOn` values a few milliseconds apart (reproduced with a single plain
completion). `hasManualDoneTaskOrder` compared them exactly, so a manual
completed order written on one device was silently ignored on the other. The
guard now ties an order to its completion within 10 seconds
(`SAME_COMPLETION_WINDOW_MS` in `done-task-order.ts`); a test fails without it.
The millisecond drift itself is unchanged and cosmetic.

## Stage 3b: Add to Today in the undo queue (2026-11-11)

`TaskUndoService.addToToday` records adding one task to Today, from the task row
(hover button, shortcut) and the context menu. It is eligible only for an
unfinished root task with no day, reminder or time, no repeat configuration and no
integration link: the plan also clears a reminder and a time for another day, which
an inverse could not restore, and an earlier planner day would come back at the end
of its list. Undo dispatches `updateTask { dueDay: null }`; the reducer removes the
task from the Today list and `planner.days`, and an LWW patch reconciles both
the same way (`syncPlannerDays`). Redo dispatches the original plan with its
field declaration, and only on the same logical day (`DateService.todayStr()` must
equal the stored day), so it can never schedule a day the user did not pick.
Undo still works after the day changed.

Evidence: `undo-today-sync` (11 cases) runs the exact actions the queue dispatches
against a concurrent title edit (newer and older, both upload orders, with and
without redo) and a concurrent completion, and checks the task, the Today list and
`planner.days` on both devices and after a restart; 8 of the 11 fail without the
plan's declaration. 8 unit cases cover eligibility, the actions dispatched, the
same-day rule and staleness. `undo-add-to-today.spec.ts` (browser) presses Alt+T,
undoes and redoes it and watches the Remove from My Day button.

Still barriers: every other scheduling action (dialog date or time, Tomorrow and
later, unscheduling, deadlines), a task that already has a day, reminder or time,
and an Add to Today that does not declare its fields (subtask, bulk, reminder
dialog). Position within the Today list after redo follows the plan (top), as the
original did.

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
