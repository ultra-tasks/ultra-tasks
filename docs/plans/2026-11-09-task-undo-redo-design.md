# Task undo and redo: design for implementation

Status: a limited session queue is implemented for eligible single-task estimates,
priority, notes, ordinary title edits, and a single completed-task reorder. The
app does not have general task undo. Expand coverage only after each action is
safe end-to-end.

## Goal and prior art

Give a user a predictable way to reverse their last supported task action and
reapply it, without overwriting a later local or remote edit. Keep the existing
editor history separate. A history that skips an unsupported later action and
reverses an older one would be surprising and is not acceptable.

The repository records requests for general undo in the
[recently deleted design](2026-10-18-recently-deleted-tasks.md). Undo also
supports organization and daily planning, where the market target is to close
the gap and lead respectively; sync reliability and offline ownership must not
regress.

| Reference, checked 2026-11                                                                                                                             | Undo / redo                    | Scope and useful constraint                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Todoist keyboard help](https://www.todoist.com/help/articles/introduction-to-keyboard-shortcuts-Wyovn2)                                               | Cmd/Ctrl+Z                     | Its task undo only works while the confirmation message is visible, including after drag-and-drop. A visible time limit is preferable to an implied general history. |
| [Apple Mac keyboard shortcuts](https://support.apple.com/en-us/102650)                                                                                 | Cmd+Z; Shift+Cmd+Z             | The previous command is undone; some apps support multiple commands. Use the Mac conventions and leave focused editors in charge of their own history.               |
| [Microsoft Windows keyboard shortcuts](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) | Ctrl+Z; Ctrl+Y in text editing | Keep the Windows/Linux convention, plus Ctrl+Shift+Z as a redo alternative. The page describes text editing; it does not establish task-history semantics.           |

Take the familiar keys and explicit availability. Do not add a history browser,
server-side history, persistent content snapshots, or a setting merely to avoid
choosing a default. A bounded in-memory queue fits the offline-first product;
history is lost on reload and is not synced.

## Interaction contract

- When a text input, editor, or dialog owns focus, its native/editor undo and
  redo take precedence. A task-list command acts on the last eligible _user
  intent_, not the task currently focused. Show Undo/Redo in an accessible menu
  with current availability and the actual platform key. Unavailable actions
  are disabled, with a reason when feasible.
- Undo uses Ctrl+Z / Cmd+Z; redo uses Ctrl+Y or Ctrl+Shift+Z on Windows/Linux
  and Cmd+Shift+Z on Mac. Do not consume keys in contexts not handled by the
  app. A successful new user edit clears redo. Auto-repeat must not run multiple
  destructive transitions by holding a key.
- Maintain at most 50 entries per running app instance; drop the oldest first.
  Do not persist task content or write titles to logs. Close/reload and a full
  data replacement clear both stacks. Notify the user when a requested entry is
  no longer safe; never silently skip it to execute an older entry.
- Any local state-changing user intent outside the supported command set is a
  history barrier: clear both stacks and explain unavailable history in the
  menu. This conservative rule is essential until all relevant operations are
  explicitly classified. Navigation and focus changes are not barriers.
- Existing narrow Undo notifications retain their own behavior. A future
  integration must ensure invoking a notification and invoking the queue cannot
  restore the same change twice. Do not capture remote/replayed actions as new
  local history.

## Command boundary and initial support

Capture an explicit user intent at the service boundary, not every NgRx
`updateTask`. One intent may emit follow-on actions, update multiple entities,
or trigger provider effects. Record a command only after it is confirmed
successful, with the before and after values needed to construct a supported
inverse. The inverse and redo must dispatch existing persistent actions or a
reviewed replay-compatible atomic action, not mutate NgRx state or replay the
original UI event. Each transition is one durable operation per atomic intent.

The supported slice comprises single-task edits on local tasks, priority on
linked tasks (priority is not pushed to issue providers), and ordinary field edits
of read-only or stopped integrations. Estimates are restricted to root tasks and
to changes without time-spent updates;
notes, priority, and ordinary titles also support subtasks of eligible,
non-repeating parents. Estimates and titles on timed tasks are excluded when an
automatic calendar-block provider is enabled and the task allows external writes,
because their update effects can write to that provider; notes and priority do not
trigger that effect. Provider availability and link identity are checked again
before undo and redo. A local-only weak-reference marker also prevents an edit
made while an integration was read-only from entering a delayed provider write
if the integration becomes writable before the effect runs; it does not alter
the persisted operation format. Ordinary field edits on
repeating root instances affect the instance, not its recurrence configuration.
A title uses the usual short-syntax pipeline and is recorded only after parsing
confirms no derived changes; syntax that changes tags, scheduling,
projects, attachments or another field is a barrier. History is temporarily
unavailable while parsing is pending and is cleared if parsing does not finish.

Completion and reopening are history barriers. A two-device replay control
showed that completing an initially unscheduled task can race with another
device adding it to Today: a newer completion can lose the plan, and a newer
plan can lose the redone completion. Some upload orders leave the devices with
different results. Ordinary completion keeps its existing behavior; adding it
to this queue requires a compatible fix for the underlying conflict path.

The same existing whole-task conflict also affects title, notes, priority and
completed-task ordering when Add to Today races on another device. Matched
two-device controls show the loss both for an ordinary single edit and for an
edit followed by undo and redo, in both upload orders. A newer plan can discard
the field edit, while a newer edit can discard the plan. The completed-task
case is reachable through the context menu's Today quick action even though
the keyboard Add to Today command skips completed tasks. The remaining queue
entries inherit this existing sync limitation; they do not guarantee unrelated
edits survive an offline conflict with an opaque scheduling action.

Each supported command checks the fields and parent identity it reverses;
unknown changes are barriers. A command stores no unrelated task snapshot and
never records automatic or provider-originated updates.

Add to Today remains a barrier. Even for a previously unscheduled task, a
date-field update as an inverse can leave stale Today ordering when replayed on
a later logical day. The existing unschedule action removes that ordering, but
also triggers calendar-block deletion. More fundamentally, plan and unschedule
actions are opaque to the field-level conflict path and fall back to whole-task
last-write-wins: an offline concurrent edit can lose unrelated task content.
A safe expansion needs a generic conflict-resolution path and two-client tests
in both directions, as well as reminder, ordering and provider coverage.

A narrower prototype used only `updateTask` field patches for planning,
undo and redo. Eight two-device tests ran through the real operation capture,
conflict resolution, remote apply and restart paths. Five passed; three left
`planner.days` stale despite converged task fields: plan/undo/redo against an
unrelated title edit when the title uploaded first, and two combinations of
concurrent plans with opposite upload and timestamp winners. LWW field patches
do not maintain planner ordering. Updating only the new client's reducer would
leave older clients inconsistent; any fix must also preserve released-client
replay and concurrent ordering before this prototype can be enabled.

Deleting and restoring a task is also unsafe to add to the queue as-is. Real
two-device replay tests cover both the trash restore and the snackbar restore,
both upload orders, and both timestamp winners. If the concurrent title edit
predates the restore, each restore's whole-task snapshot currently wins over
that unseen edit; the task reappears with the old title on both devices and
after restart. A three-client control also loses both concurrent edits when
their timestamps precede the restore. Simply copying a title into a new
snapshot at the restore's timestamp would incorrectly outrank a third device's
intervening edit. A safe
fix needs a structural restoration that retains the original field-write
timestamps, preserves archive and ordering effects, and remains compatible with
released clients before queue deletion is enabled.

Project moves have a separate order problem. A prototype using single-task
field updates preserved an unrelated concurrent title in both upload orders,
but when another device independently appended a task to the destination
project, the project task lists ended up in opposite orders after repeated
sync. The lists are updated by task reducers while conflicts are tracked per
task. A reversible move must preserve the original list and section placement
and make concurrent ordering converge before it can enter the queue.

Bulk priority currently uses independent per-task operations. Grouping their
inverses in the queue would create another multi-operation transition that may
be partially replayed. The existing multi-task update is not generally safe to
merge with concurrent task updates, so an atomic, compatible bulk representation
is needed before adding grouped history.

| Action                                                               | Queue status                                  | Requirement before adding more coverage                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Estimate, priority, notes, ordinary title                            | Supported for eligible single-task edits      | Support other inputs only after accounting for short syntax, recurrence, parent recalculation and provider side effects. |
| Completion or reopen                                                 | Barrier                                       | Preserve concurrent scheduling and model reminders, tracking, recurrence, parent/child effects and ordering.             |
| Completed-task reorder                                               | Supported for a single root task in a project | Multi-task moves and other list ordering need an atomic inverse.                                                         |
| Scheduling, tags, project moves, tracking                            | Barrier                                       | Model the full intent, related entities and side effects; prove a safe inverse.                                          |
| Single delete and restore                                            | Existing time-limited snackbar only           | Coordinate one-shot capture, trash, provider deletion grace, and queue ownership.                                        |
| Bulk actions, including delete                                       | Barrier initially                             | Atomic inverse for all affected entities and ordering; bulk delete currently has no undo.                                |
| Linked-task priority and fields on read-only or stopped integrations | Supported as local field edits                | Provider push ignores priority, and read-only/stopped tasks do not make provider requests.                               |
| Other linked or externally controlled changes                        | Barrier                                       | Explicit provider semantics; never promise to reverse a remote external side effect.                                     |

The candidate must be visible and useful enough to justify release. If the
history would routinely be cleared during ordinary workflows, continue building
the command coverage before exposing a global Undo action.

## Staleness, sync and concurrency

Each command records the expected post-state of every field/entity it will
reverse. Immediately before undo, compare against current authoritative state;
if any expected value, existence, parent, ordering, or relevant provider state
differs, refuse the command and invalidate the affected history. Redo performs
the corresponding comparison against the expected pre-state. Rechecking and
dispatching must be synchronous at the store boundary, but this is not a
distributed compare-and-set: an offline concurrent remote edit may arrive later.
The action's existing conflict-resolution path must be demonstrated to preserve
the intended edits and converge in both delivery orders before support ships.
Where that cannot be established, the action stays unsupported.

Clear history at hydration, full backup/sync import, data replacement, and
account or data-space change. On incremental remote application conservatively
invalidate entries touched by the remote change and any dependent later entries;
until touched entities and dependencies are reliably known, clear the queue.
Remote operations must never trigger new queue entries or undo effects. The queue
observes the unfiltered action stream solely to invalidate in-memory history,
including remote data replacement; it creates entries only at explicit local user
intent boundaries. Respect `bulkApplyOperations`, the sync-epoch fence, and the
one-intent/one-operation rule in the contributor sync model. Verify that rejected
reducers never commit queue entries and that undo does not re-trigger short syntax
or other unintended local side effects.

## Proposed architecture for complete undo

This section is a proposal; the current queue and sync protocol do not yet
provide these guarantees. The shortcut can remain familiar, but undo must be a
new, syncable command rather than deletion of an older operation or restoration
of a whole-task snapshot.

### Local history and command boundaries

- Route each user intent through a command handler. The handler validates the
  current state and commits one atomic operation containing its complete field,
  relationship and ordering changes. Completion with dependent subtasks,
  moving between projects or sections, and a bulk edit are each one command.
- Keep a bounded history per device, separate from the shared task state. Store
  the command identity, user-visible label, before/after values or references,
  affected entities, and the versions needed to reverse it. A new command
  clears redo; a failed, stale, or unsupported command must never cause Undo to
  skip backwards to a different action. Decide separately whether this local
  history survives app restarts; durable sync operations must not depend on the
  local queue remaining available.
- Undo emits a compensating command that refers to the command it reverses;
  redo emits a new command referring to that undo. Both go through normal
  validation, persistence and sync. Focused editors retain their own history.

### Conflict and deletion semantics

- Merge independent fields independently, including changes from planning and
  bulk commands. Keep the original operation identity and causal version of
  each write; never restamp unrelated fields by copying a full task snapshot.
  Vector-clock/operation ordering and deterministic tie-breakers, not device
  wall clocks alone, decide concurrent writes.
- An inverse carries the versions it expects and the identity of the command it
  reverses. Reconcile those preconditions against concurrent operations during
  replay, not just against the originating device's current state. If another
  operation changed an affected field or relationship, preserve that change and
  reject the inverse as a whole; do not leave half of a move or bulk command
  undone. All devices must make the same decision regardless of upload order,
  including when the conflicting operation arrives after a local undo was
  displayed. In that case, reconcile the visible state and tell the user the
  undo could not be applied. Changes to unrelated fields must survive.
- Represent deletion with a causal tombstone and retain the task's field
  histories or equivalent versioned state. Undo restores existence and
  placement without making an old snapshot a new write to every field. Retain
  tombstones and command dependencies until the relevant devices acknowledge
  them or an explicit device-expiry/full-resync policy applies. A fixed-size
  local queue alone is not sufficient to bound shared history safely.

### Placement, scheduling and integrations

- Keep a task's project, parent and section relationship authoritative in one
  place and use stable, deterministic order identifiers for each relevant list.
  Derive parent/project membership from those facts. Concurrent inserts and moves
  need a defined order and a tie-breaker, rather than independent rewrites of
  parent arrays. Undo records the prior relationship and position as one atomic
  transition. The same model must cover the no-section list, backlog, Done and
  subtask lists.
- Treat the task's schedule as the source of truth for date membership. Preserve
  explicit per-day ordering without allowing `planner.days` or Today ordering to
  drift from the task after a merge. Planning, unplanning, completion and their
  inverses must use the same field-aware reconciliation.
- Treat provider calls as explicit side effects with stable identities,
  idempotent retries and visible failure states. Undo may issue a compensating
  provider operation only when that provider supports it; otherwise the UI must
  identify the action as non-reversible rather than promise a complete undo.
  Remote replay must not trigger the original local effects again.

### Delivery and proof

The app has no installs yet, so a coherent protocol/model change can be made
before release instead of preserving accidental behavior. Version the protocol
and define migration or an explicit full-resync path for any development data
and any devices running different versions; a schema number alone does not
make an incompatible operation safe.

First reproduce and repair the existing Today-plan/field-edit, delete/restore
and concurrent project-order failures. Then add command families in stages:
single-field edits; completion and scheduling; create/delete/restore; placement
and list operations; bulk commands; and supported integration side effects.
Each stage needs real multi-client sync tests in both upload orders, with offline
edits, replay/restart, same- and different-field conflicts, at least one
three-device case, list ordering, and failure/retry checks. Include browser
tests for the visible Undo/Redo and clipboard workflows, and compare final data,
not just the actions dispatched.

## Implementation and verification stages

1. Trace the first eligible command from UI gesture through reducers, local
   effects, op capture and provider effects. Specify its before/after fields,
   inverse action, atomicity, stale checks, history barriers and interaction
   with old clients. Reject the candidate if any effect cannot be reversed.
2. Build a bounded, session-local queue that owns command state and exposes
   availability and reasons. Integrate at the intent boundary, then add
   platform shortcuts and a visible action together. Do not wire a generic
   dispatch observer that guesses the meaning of store actions.
3. Test real store paths: undo/redo and redo invalidation; multiple entries and
   bounds; unsupported-action barrier; input/editor focus; held keys; stale or
   missing task; rejected action; reload/import; remote update before undo;
   undo and concurrent remote update delivered in both orders, offline/restart
   and actual sync replay; provider effects and existing snackbar interactions.
   Assert that one undo produces the intended durable operation and never
   overwrites unrelated fields. Include meaningful browser E2E coverage for the
   user flow and multi-client sync E2E for each new conflict path.
4. Extend one explicit action family at a time with the same evidence, adding
   documentation and accessible availability labels when each becomes usable.

Key code entry points: `task.service.ts`, `task-shared.actions.ts`,
`short-syntax.effects.ts`, `undo-task-delete.meta-reducer.ts`,
`task-ui.effects.ts`, `bulk-hydration.action.ts`, and
`docs/sync-and-op-log/contributor-sync-model.md`.
