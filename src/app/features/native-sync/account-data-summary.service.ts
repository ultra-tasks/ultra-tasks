import { inject, Injectable } from '@angular/core';
import { restorePersonal, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { SyncLocalStateService } from '../../op-log/sync/sync-local-state.service';
import { hasRecoverableData } from '../../op-log/backup/has-recoverable-data.util';
import { hasAnyUserData } from '../../op-log/validation/has-meaningful-state-data.util';
import { isExampleTaskCreateOp } from '../../op-log/validation/is-example-task-op.util';
import { DEFAULT_BOARDS } from '../boards/boards.const';
import { INBOX_PROJECT } from '../project/project.const';
import type { AccountDataSummary } from './account-sync.types';

const DEFAULT_BOARD_IDS: ReadonlySet<string> = new Set(
  DEFAULT_BOARDS.map((board) => board.id),
);

const entityIds = (value: unknown): string[] => {
  const ids = (value as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
};

const archivedTaskCount = (archive: unknown): number =>
  entityIds((archive as { task?: unknown } | undefined)?.task).length;

/** A board the person created or renamed away from the shipped set. */
const hasCustomBoards = (boards: unknown): boolean => {
  const cfgs = (boards as { boardCfgs?: unknown } | undefined)?.boardCfgs;
  return (
    Array.isArray(cfgs) &&
    cfgs.some((board) => !DEFAULT_BOARD_IDS.has((board as { id?: string })?.id ?? ''))
  );
};

/** The same state without the first-run example tasks. Never mutates the snapshot. */
const withoutExampleTasks = (
  state: Record<string, unknown>,
  exampleTaskIds: ReadonlySet<string>,
): Record<string, unknown> => {
  const task = state['task'] as { ids?: string[] } | undefined;
  if (!exampleTaskIds.size || !Array.isArray(task?.ids)) return state;
  return {
    ...state,
    task: { ...task, ids: task.ids.filter((id) => !exampleTaskIds.has(id)) },
  };
};

/**
 * Bounded counts plus the verdict "does this hold real work?". Pure, so the same rule
 * measures this device and the account's downloaded dataset.
 *
 * Real work is everything {@link hasAnyUserData} and {@link hasRecoverableData} already
 * protect (tasks and subtasks, archived work, non-default projects and tags, notes,
 * recurring configs, tracked time, issue providers, metrics, plugin data, counters that
 * differ from the shipped ones) plus boards that are not the shipped ones.
 *
 * It is NOT real work: the first-run example task (`exampleTaskIds`), the Inbox project,
 * the system tags, the shipped counters and boards, and settings. Drafts (unsent text in
 * the add-task bar) are local UI state outside every synced model and are never touched
 * by a download, so they do not count either.
 */
export const summarizeAccountData = (
  state: unknown,
  exampleTaskIds: ReadonlySet<string> = new Set(),
): AccountDataSummary => {
  const source = (state && typeof state === 'object' ? state : {}) as Record<
    string,
    unknown
  >;
  const real = withoutExampleTasks(source, exampleTaskIds);
  return {
    tasks: entityIds(real['task']).length,
    projects: entityIds(real['project']).filter((id) => id !== INBOX_PROJECT.id).length,
    notes: entityIds(real['note']).length,
    archived:
      archivedTaskCount(real['archiveYoung']) + archivedTaskCount(real['archiveOld']),
    hasUserData:
      hasAnyUserData(real) || hasRecoverableData(real) || hasCustomBoards(real['boards']),
  };
};

/**
 * Measures what a dataset holds so a device can tell "empty" from "has real work". It
 * decides whether the account's data may be downloaded without asking: only a device
 * that returns `hasUserData: false` here is allowed to be overwritten silently.
 */
@Injectable({ providedIn: 'root' })
export class AccountDataSummaryService {
  private readonly snapshots = inject(StateSnapshotService);
  private readonly opStore = inject(OperationLogStoreService);
  private readonly localState = inject(SyncLocalStateService);

  /**
   * Tasks the first-run welcome created. The marker exists only on the create op's payload
   * (never on the entity), and only local pending ops are read, so no remote data can claim
   * "I am an example" to bypass the choice (see `isExampleTaskCreateOp`).
   */
  private async exampleTaskIds(): Promise<ReadonlySet<string>> {
    const pending = await this.opStore.getUnsynced();
    return new Set(
      pending
        .filter(isExampleTaskCreateOp)
        .map((entry) => entry.op.entityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
  }

  /** This device, archives included. Fails closed: an unreadable snapshot is "has data". */
  async local(): Promise<AccountDataSummary> {
    const exampleTaskIds = await this.exampleTaskIds();
    let summary: AccountDataSummary;
    try {
      summary = summarizeAccountData(
        await this.snapshots.getStateSnapshotAsync(),
        exampleTaskIds,
      );
    } catch {
      return { tasks: 0, projects: 0, notes: 0, archived: 0, hasUserData: true };
    }
    // Never less careful than the fresh-client gate the legacy providers use.
    if (
      !summary.hasUserData &&
      (await this.localState.hasMeaningfulStoreData(exampleTaskIds))
    )
      summary.hasUserData = true;
    return summary;
  }

  /** The account's personal dataset as downloaded into the encrypted local sync state. */
  fromRecords(client: SyncClient, scopeId: string): AccountDataSummary {
    return summarizeAccountData(restorePersonal(client.records(scopeId)));
  }
}
