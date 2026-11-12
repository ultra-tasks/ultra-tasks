/**
 * A deleted-then-restored task whose snapshot did not change wrote nothing.
 *
 * A device that deletes a task and undoes it (snackbar undo, recently deleted)
 * emits a `deleteTask` and a `restoreTask`/`restoreDeletedTask` that carries
 * the whole task. Against a concurrent edit of the same task by another device,
 * timestamp LWW treats that round trip as the newer writer of every field, so
 * the unrelated edit is lost on all devices (or the edit wins only when it
 * happens to be newer). The round trip changed no field, so it must not beat a
 * side that did.
 *
 * No Angular, no I/O. Reads only which ops a side holds and compares the task
 * snapshots the delete and restore carry; it never builds an op from them.
 */

import { deepEqual, extractActionPayload } from '@sp/sync-core';
import type { LwwConflictResolutionPlan } from '@sp/sync-core';
import { ActionType, OpType } from '../core/operation.types';
import type { EntityConflict, Operation } from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fields that may differ between the snapshot a delete carries and the one its
 * restore carries without the round trip having changed the task: the child
 * list is rebuilt by the restore, and `modified` is a write stamp.
 */
const IGNORED_SNAPSHOT_FIELDS: readonly string[] = ['subTasks', 'modified'];

const taskSnapshot = (
  op: Operation,
  entityId: string,
): Record<string, unknown> | null => {
  const task = extractActionPayload(op.payload)?.['task'];
  if (!isRecord(task) || task['id'] !== entityId) return null;
  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(task)) {
    if (!IGNORED_SNAPSHOT_FIELDS.includes(key) && task[key] !== undefined) {
      snapshot[key] = task[key];
    }
  }
  return snapshot;
};

const isSingleEntityOp = (op: Operation, entityId: string): boolean => {
  const ids = getOpEntityIds(op);
  return op.entityType === 'TASK' && ids.length === 1 && ids[0] === entityId;
};

const isTaskDelete = (op: Operation, entityId: string): boolean =>
  op.actionType === ActionType.TASK_SHARED_DELETE &&
  op.opType === OpType.Delete &&
  isSingleEntityOp(op, entityId);

const isTaskRestore = (op: Operation, entityId: string): boolean =>
  (op.actionType === ActionType.TASK_SHARED_RESTORE ||
    op.actionType === ActionType.TASK_SHARED_RESTORE_DELETED) &&
  isSingleEntityOp(op, entityId);

/**
 * The ids of the ops that form delete→restore round trips of this task which
 * changed nothing: a delete directly followed (among that client's ops on the
 * task) by a restore carrying the snapshot the delete carried. A restore that
 * changes anything (e.g. to Today), a multi-entity op, or a client's other op
 * between the two keeps the pair out.
 */
export const inertRoundTripOpIds = (
  ops: readonly Operation[],
  entityId: string,
): Set<string> => {
  const inert = new Set<string>();
  const byClient = new Map<string, Operation[]>();
  for (const op of ops) {
    byClient.set(op.clientId, [...(byClient.get(op.clientId) ?? []), op]);
  }
  for (const clientOps of byClient.values()) {
    const sorted = [...clientOps].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [del, restore] = [sorted[i], sorted[i + 1]];
      if (!isTaskDelete(del, entityId) || !isTaskRestore(restore, entityId)) continue;
      const deleted = taskSnapshot(del, entityId);
      const restored = taskSnapshot(restore, entityId);
      if (deleted && restored && deepEqual(deleted, restored)) {
        inert.add(del.id);
        inert.add(restore.id);
        i++;
      }
    }
  }
  return inert;
};

const uniqueById = (ops: Operation[]): Operation[] => [
  ...new Map(ops.map((op) => [op.id, op])).values(),
];

/**
 * Lets a side that changed a field beat one made only of delete→restore round
 * trips that changed none, whatever the timestamps. Detection emits one
 * conflict per remote op, so round trips are found across all of the entity's
 * conflicts, then each plan's sides are judged on their own ops: a later
 * device's resolution snapshot beside the round trip does not hide it. Only
 * plans decided by timestamp are touched: archive and delete-wins plans keep
 * their precedence, and two inert sides (or none) keep LWW.
 */
export const demoteNetNoopRestorePlans = (
  plans: LwwConflictResolutionPlan<EntityConflict>[],
): LwwConflictResolutionPlan<EntityConflict>[] => {
  const opsByEntity = new Map<string, Operation[]>();
  const keyOf = ({ conflict }: LwwConflictResolutionPlan<EntityConflict>): string =>
    `${conflict.entityType}:${conflict.entityId}`;
  for (const plan of plans) {
    opsByEntity.set(keyOf(plan), [
      ...(opsByEntity.get(keyOf(plan)) ?? []),
      ...plan.conflict.localOps,
      ...plan.conflict.remoteOps,
    ]);
  }
  const inertByEntity = new Map<string, Set<string>>();
  return plans.map((plan) => {
    const { conflict } = plan;
    if (
      conflict.entityType !== 'TASK' ||
      (plan.reason !== 'local-timestamp' && plan.reason !== 'remote-timestamp-or-tie')
    ) {
      return plan;
    }
    const key = keyOf(plan);
    if (!inertByEntity.has(key)) {
      inertByEntity.set(
        key,
        inertRoundTripOpIds(uniqueById(opsByEntity.get(key) ?? []), conflict.entityId),
      );
    }
    const inert = inertByEntity.get(key)!;
    const isInertSide = (ops: Operation[]): boolean =>
      ops.length > 0 && ops.every((op) => inert.has(op.id));
    const localNoop = isInertSide(conflict.localOps);
    const remoteNoop = isInertSide(conflict.remoteOps);
    if (localNoop === remoteNoop) return plan;
    return localNoop
      ? {
          ...plan,
          winner: 'remote',
          reason: 'remote-timestamp-or-tie',
          localWinOperationKind: undefined,
        }
      : {
          ...plan,
          winner: 'local',
          reason: 'local-timestamp',
          localWinOperationKind: 'update',
        };
  });
};
