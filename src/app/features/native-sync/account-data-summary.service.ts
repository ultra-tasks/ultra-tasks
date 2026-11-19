import { inject, Injectable } from '@angular/core';
import { deepEqual } from '@sp/sync-core';
import { restorePersonal, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { SyncLocalStateService } from '../../op-log/sync/sync-local-state.service';
import { hasRecoverableData } from '../../op-log/backup/has-recoverable-data.util';
import { hasAnyUserData } from '../../op-log/validation/has-meaningful-state-data.util';
import { isExampleTaskCreateOp } from '../../op-log/validation/is-example-task-op.util';
import { MODEL_CONFIGS } from '../../op-log/model/model-config';
import { MenuTreeKind } from '../menu-tree/store/menu-tree.model';
import { INBOX_PROJECT } from '../project/project.const';
import type { AccountDataSummary } from './account-sync.types';

/** The shipped value of a model, as a saved copy of it reads back (no `undefined` members). */
const shipped = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const SHIPPED_BOARDS = shipped(MODEL_CONFIGS.boards.defaultData!.boardCfgs);
const SHIPPED_SETTINGS = shipped(MODEL_CONFIGS.globalConfig.defaultData);

const entityIds = (value: unknown): string[] => {
  const ids = (value as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
};

const archivedTaskCount = (archive: unknown): number =>
  entityIds((archive as { task?: unknown } | undefined)?.task).length;

/** Anything but the shipped boards: a board of their own, or an edit to (or loss of) a shipped one. */
const hasEditedBoards = (boards: unknown): boolean => {
  const cfgs = (boards as { boardCfgs?: unknown } | undefined)?.boardCfgs;
  return Array.isArray(cfgs) && !deepEqual(shipped(cfgs), SHIPPED_BOARDS);
};

/** A folder anywhere in the project or tag tree (the projects and tags in it count as such). */
const hasMenuFolders = (menuTree: unknown): boolean => {
  const inTree = (nodes: unknown): boolean =>
    Array.isArray(nodes) &&
    nodes.some(
      (node: { k?: string; children?: unknown } | null) =>
        node?.k === MenuTreeKind.FOLDER || inTree(node?.children),
    );
  const { projectTree, tagTree } = (menuTree ?? {}) as Record<string, unknown>;
  return inTree(projectTree) || inTree(tagTree);
};

const hasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * What {@link hasAnyUserData} and {@link hasRecoverableData} do not look at: sections (of a
 * project or a tag), folders of the menu, boards, plugin settings and scheduled reminders.
 * Each is the person's own arrangement, and a download would erase it.
 */
const hasOtherUserData = (state: Record<string, unknown>): boolean =>
  entityIds(state['section']).length > 0 ||
  hasMenuFolders(state['menuTree']) ||
  hasEditedBoards(state['boards']) ||
  hasEntries(state['pluginMetadata']) ||
  hasEntries(state['reminders']);

/** Settings that differ from the shipped ones. */
const hasCustomSettings = (settings: unknown): boolean =>
  settings !== undefined &&
  settings !== null &&
  !deepEqual(shipped(settings), SHIPPED_SETTINGS);

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
 * differ from the shipped ones) plus sections, menu folders, any edit to the shipped
 * boards, plugin settings and reminders.
 *
 * It is NOT real work: the first-run example task (`exampleTaskIds`), the Inbox project,
 * the system tags and the shipped counters and boards. Drafts (unsent text in the
 * add-task bar) are local UI state outside every synced model and never touched by a
 * download, so they do not count either.
 *
 * Settings count on one side only (`options.settings`): this DEVICE may be overwritten
 * when it holds nothing but settings (a recovery copy is saved first), but an ACCOUNT that
 * holds customised settings is never silently replaced, so it reads as "has data".
 */
export const summarizeAccountData = (
  state: unknown,
  exampleTaskIds: ReadonlySet<string> = new Set(),
  options: { settings?: boolean } = {},
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
      hasAnyUserData(real) ||
      hasRecoverableData(real) ||
      hasOtherUserData(real) ||
      (!!options.settings && hasCustomSettings(real['globalConfig'])),
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
    const touchedSince = new Set(
      pending
        .filter((entry) => !isExampleTaskCreateOp(entry))
        .flatMap((entry) => [entry.op.entityId, ...(entry.op.entityIds ?? [])]),
    );
    return new Set(
      pending
        .filter(isExampleTaskCreateOp)
        .map((entry) => entry.op.entityId)
        // Renamed, ticked off, written in: the person has made it their own work.
        .filter(
          (id): id is string =>
            typeof id === 'string' && id.length > 0 && !touchedSince.has(id),
        ),
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
    return summarizeAccountData(restorePersonal(client.records(scopeId)), new Set(), {
      settings: true,
    });
  }
}
