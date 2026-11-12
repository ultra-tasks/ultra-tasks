import type { LwwConflictResolutionPlan } from '@sp/sync-core';
import { ActionType, OpType } from '../core/operation.types';
import type { EntityConflict, Operation } from '../core/operation.types';
import {
  demoteNetNoopRestorePlans,
  inertRoundTripOpIds,
} from './conflict-net-noop-restore.util';

const TASK_ID = 't1';

const task = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: TASK_ID,
  title: 'Original',
  projectId: 'P',
  subTasks: [],
  modified: 1,
  ...overrides,
});

let nextId = 0;
const op = (
  actionType: ActionType,
  opType: OpType,
  clientId: string,
  timestamp: number,
  payload: unknown = {},
  entityIds?: string[],
): Operation =>
  ({
    id: `op-${nextId++}`,
    actionType,
    opType,
    entityType: 'TASK',
    entityId: TASK_ID,
    ...(entityIds ? { entityIds } : {}),
    clientId,
    timestamp,
    vectorClock: {},
    payload: { actionPayload: payload, entityChanges: [] },
  }) as unknown as Operation;

const del = (
  clientId: string,
  timestamp: number,
  t = task(),
  ids?: string[],
): Operation =>
  op(ActionType.TASK_SHARED_DELETE, OpType.Delete, clientId, timestamp, { task: t }, ids);
const restore = (
  clientId: string,
  timestamp: number,
  t = task(),
  type = ActionType.TASK_SHARED_RESTORE,
): Operation => op(type, OpType.Update, clientId, timestamp, { task: t, subTasks: [] });
const edit = (clientId: string, timestamp: number, title: string): Operation =>
  op(ActionType.TASK_SHARED_UPDATE, OpType.Update, clientId, timestamp, {
    task: { id: TASK_ID, changes: { title } },
  });

describe('inertRoundTripOpIds', () => {
  it('marks a delete directly followed by a restore of the same snapshot', () => {
    const d = del('A', 2);
    const r = restore('A', 3);

    expect(inertRoundTripOpIds([r, d], TASK_ID)).toEqual(new Set([d.id, r.id]));
  });

  it('accepts the snackbar restore action too', () => {
    const d = del('A', 2);
    const r = restore('A', 3, task(), ActionType.TASK_SHARED_RESTORE_DELETED);

    expect(inertRoundTripOpIds([d, r], TASK_ID).size).toBe(2);
  });

  it('ignores the child list and write stamp when comparing snapshots', () => {
    const d = del('A', 2, task({ subTasks: [{ id: 'x' }], modified: 5 }));
    const r = restore('A', 3, task({ subTasks: [], modified: 9 }));

    expect(inertRoundTripOpIds([d, r], TASK_ID).size).toBe(2);
  });

  it('refuses a restore that changes a field, such as restoring to Today', () => {
    const d = del('A', 2);
    const r = restore('A', 3, task({ dueDay: '2026-11-10' }));

    expect(inertRoundTripOpIds([d, r], TASK_ID).size).toBe(0);
  });

  it('refuses when the same client wrote something between delete and restore', () => {
    const ops = [del('A', 2), edit('A', 3, 'Changed'), restore('A', 4)];

    expect(inertRoundTripOpIds(ops, TASK_ID).size).toBe(0);
  });

  it('does not pair a delete with another client restore', () => {
    expect(inertRoundTripOpIds([del('A', 2), restore('B', 3)], TASK_ID).size).toBe(0);
  });

  it('refuses a multi-entity delete (cascade), which stays on the existing paths', () => {
    const ops = [del('A', 2, task(), [TASK_ID, 'sub']), restore('A', 3)];

    expect(inertRoundTripOpIds(ops, TASK_ID).size).toBe(0);
  });

  it('refuses a delete without a restore', () => {
    expect(inertRoundTripOpIds([del('A', 2)], TASK_ID).size).toBe(0);
  });

  it('finds several round trips of one client', () => {
    const ops = [del('A', 2), restore('A', 3), del('A', 4), restore('A', 5)];

    expect(inertRoundTripOpIds(ops, TASK_ID).size).toBe(4);
  });
});

describe('demoteNetNoopRestorePlans', () => {
  const plan = (
    localOps: Operation[],
    remoteOps: Operation[],
    winner: 'local' | 'remote',
    reason: LwwConflictResolutionPlan['reason'] = winner === 'local'
      ? 'local-timestamp'
      : 'remote-timestamp-or-tie',
    entityType = 'TASK',
  ): LwwConflictResolutionPlan<EntityConflict> => ({
    conflict: {
      entityType,
      entityId: TASK_ID,
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    } as unknown as EntityConflict,
    winner,
    reason,
    ...(winner === 'local' ? { localWinOperationKind: 'update' as const } : {}),
  });

  it('lets a remote edit beat a newer local round trip', () => {
    const [result] = demoteNetNoopRestorePlans([
      plan([del('A', 2), restore('A', 3)], [edit('B', 1, 'Edited')], 'local'),
    ]);

    expect(result.winner).toBe('remote');
    expect(result.reason).toBe('remote-timestamp-or-tie');
    expect(result.localWinOperationKind).toBeUndefined();
  });

  it('lets a local edit beat a newer remote round trip, judged across its conflicts', () => {
    const d = del('A', 2);
    const r = restore('A', 3);
    const local = [edit('B', 1, 'Edited')];

    // Detection emits one conflict per remote op: neither holds the whole pair.
    const results = demoteNetNoopRestorePlans([
      plan(local, [d], 'remote'),
      plan(local, [r], 'remote'),
    ]);

    expect(results.map((p) => p.winner)).toEqual(['local', 'local']);
    expect(results.every((p) => p.localWinOperationKind === 'update')).toBeTrue();
  });

  it('still sees the round trip beside a later device resolution op', () => {
    const d = del('A', 2);
    const r = restore('A', 3);
    const resolution = edit('B', 1, 'Edited');
    const local = [edit('C', 4, 'Later')];

    const results = demoteNetNoopRestorePlans([
      plan(local, [d], 'remote'),
      plan(local, [r], 'remote'),
      plan(local, [resolution], 'local'),
    ]);

    expect(results.map((p) => p.winner)).toEqual(['local', 'local', 'local']);
  });

  it('lets a real delete beat a round trip', () => {
    const [result] = demoteNetNoopRestorePlans([
      plan([del('A', 2), restore('A', 3)], [del('B', 1)], 'local'),
    ]);

    expect(result.winner).toBe('remote');
  });

  it('keeps timestamp LWW when both sides are round trips or neither is', () => {
    const both = plan(
      [del('A', 2), restore('A', 3)],
      [del('B', 4), restore('B', 5)],
      'remote',
    );
    const neither = plan([edit('A', 2, 'a')], [edit('B', 1, 'b')], 'local');

    expect(demoteNetNoopRestorePlans([both])).toEqual([both]);
    expect(demoteNetNoopRestorePlans([neither])).toEqual([neither]);
  });

  it('keeps a restore that changed something as a writer', () => {
    const changed = plan(
      [del('A', 2), restore('A', 3, task({ dueDay: '2026-11-10' }))],
      [edit('B', 1, 'Edited')],
      'local',
    );

    expect(demoteNetNoopRestorePlans([changed])).toEqual([changed]);
  });

  it('leaves archive and delete-wins plans and other entity types alone', () => {
    const roundTrip = [del('A', 2), restore('A', 3)];
    const remote = [edit('B', 1, 'Edited')];
    const archive = plan(roundTrip, remote, 'remote', 'remote-archive');
    const deleteWins = plan(roundTrip, remote, 'local', 'local-delete-wins');
    const project = plan(roundTrip, remote, 'local', 'local-timestamp', 'PROJECT');

    expect(demoteNetNoopRestorePlans([archive, deleteWins, project])).toEqual([
      archive,
      deleteWins,
      project,
    ]);
  });
});
