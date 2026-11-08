import type { IssueProvider, IssueProviderKey } from '../issue/issue.model';
import type { Task } from '../tasks/task.model';
import type {
  FieldSyncConfig,
  SyncDirection,
} from '../issue/two-way-sync/issue-sync.model';

export type IntegrationMode = 'import' | 'sync';

/** Provenance survives detaching the active issue link. Optional on old tasks. */
export interface TaskIntegration {
  providerId: string;
  providerKey: IssueProviderKey;
  remoteId: string;
  mode: IntegrationMode;
  hidden?: boolean;
  stopped?: boolean;
  fieldPolicy?: FieldSyncConfig;
}

export const integrationForTask = (task: Task): TaskIntegration | undefined =>
  task.integration ??
  (task.issueProviderId && task.issueId && task.issueType
    ? {
        providerId: task.issueProviderId,
        providerKey: task.issueType,
        remoteId: task.issueId,
        mode: 'sync',
      }
    : undefined);

export const sameIntegrationLink = (task: Task | undefined, original: Task): boolean =>
  !!task &&
  !!task.issueId &&
  task.issueId === original.issueId &&
  task.issueProviderId === original.issueProviderId &&
  task.issueType === original.issueType &&
  task.integration?.mode !== 'import' &&
  !task.integration?.stopped;

export const taskSyncPolicy = (
  task: Task,
  policy: FieldSyncConfig,
  connection: FieldSyncConfig = {},
): FieldSyncConfig => ({ ...policy, ...connection, ...task.integration?.fieldPolicy });

export const canReceiveField = (direction: SyncDirection | undefined): boolean =>
  direction !== 'off' && direction !== 'pushOnly';

export const visibleIntegrationTask = (
  task: Task,
  entities: Record<string, Task | undefined>,
): boolean =>
  !task.integration?.hidden &&
  !(task.parentId && entities[task.parentId]?.integration?.hidden);

export const matchesIntegration = (
  task: Task,
  providerId: string,
  providerKey: IssueProviderKey,
  remoteId: string,
): boolean => {
  const link = integrationForTask(task);
  return (
    link?.providerId === providerId &&
    link.providerKey === providerKey &&
    link.remoteId === remoteId
  );
};

export const integrationPullChanges = (
  task: Task,
  changes: Partial<Task>,
  connection: FieldSyncConfig = {},
): Partial<Task> => {
  const filtered = { ...changes };
  for (const [field, direction] of Object.entries(taskSyncPolicy(task, {}, connection))) {
    if (!canReceiveField(direction)) delete filtered[field as keyof Task];
  }
  return filtered;
};

/** Undefined means an already-deleted task whose previous active block can be removed. */
export const allowsIntegrationWrites = (task: Task | undefined): boolean =>
  task?.integration?.mode !== 'import' && !task?.integration?.stopped;
export const canDeleteIntegrationTimeBlock = (task: Task): boolean =>
  !!task.dueWithTime && allowsIntegrationWrites(task);

/** Keep each connector's existing field-policy shape as its single source of truth. */
export const configureIntegrationPolicy = (
  provider: IssueProvider,
  policy: FieldSyncConfig,
): IssueProvider => {
  if ('pluginConfig' in provider)
    return {
      ...provider,
      integrationFieldPolicy: undefined,
      pluginConfig: { ...provider.pluginConfig, twoWaySync: policy },
    };
  if (provider.issueProviderKey === 'CALDAV')
    return {
      ...provider,
      integrationFieldPolicy: undefined,
      twoWaySync: { ...provider.twoWaySync, ...policy },
    };
  return { ...provider, integrationFieldPolicy: policy };
};
