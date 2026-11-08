import { DEFAULT_TASK } from '../tasks/task.model';
import { Task } from '../tasks/task.model';
import {
  integrationForTask,
  configureIntegrationPolicy,
  integrationPullChanges,
  matchesIntegration,
  sameIntegrationLink,
  taskSyncPolicy,
  visibleIntegrationTask,
} from './integration.model';

const task = (extra: Partial<Task> = {}): Task => ({
  ...DEFAULT_TASK,
  projectId: 'project',
  id: 'local',
  issueId: '142',
  issueType: 'GITHUB',
  issueProviderId: 'connection',
  ...extra,
});
describe('Integration relationships', () => {
  it('adopts old issue links as Sync without mutating persisted data', () => {
    const original = task();
    expect(integrationForTask(original)?.mode).toBe('sync');
    expect(original.integration).toBeUndefined();
  });
  it('reserves snapshot identity after clearing the legacy link', () => {
    const snapshot = task({
      issueId: '',
      issueProviderId: '',
      integration: {
        providerId: 'connection',
        providerKey: 'GITHUB',
        remoteId: '142',
        mode: 'import',
        stopped: true,
      },
    });
    expect(matchesIntegration(snapshot, 'connection', 'GITHUB', '142')).toBeTrue();
    expect(matchesIntegration(snapshot, 'another-account', 'GITHUB', '142')).toBeFalse();
    expect(sameIntegrationLink(snapshot, task())).toBeFalse();
  });
  it('discards delayed refreshes and queued writes after detachment', () => {
    expect(
      sameIntegrationLink(task({ issueId: '', issueProviderId: '' }), task()),
    ).toBeFalse();
    expect(sameIntegrationLink(undefined, task())).toBeFalse();
    expect(sameIntegrationLink(task({ issueId: '143' }), task())).toBeFalse();
  });
  it('hides a parent and its children without changing the scheduled date', () => {
    const parent = task({
      dueDay: '2026-11-08',
      integration: {
        providerId: 'connection',
        providerKey: 'GITHUB',
        remoteId: '142',
        mode: 'sync',
        hidden: true,
      },
    });
    const child = task({ id: 'child', parentId: 'local' });
    expect(visibleIntegrationTask(parent, { local: parent })).toBeFalse();
    expect(visibleIntegrationTask(child, { local: parent })).toBeFalse();
    expect(parent.dueDay).toBe('2026-11-08');
  });
  it('item policy overrides connection policy and leaves unrelated fields alone', () => {
    const local = task({
      integration: {
        providerId: 'connection',
        providerKey: 'GITHUB',
        remoteId: '142',
        mode: 'sync',
        fieldPolicy: { title: 'off' },
      },
    });
    expect(
      taskSyncPolicy(local, { title: 'both', isDone: 'pullOnly' }, { title: 'pushOnly' }),
    ).toEqual({ title: 'off', isDone: 'pullOnly' });
    expect(
      integrationPullChanges(
        local,
        { title: 'remote', isDone: true },
        { isDone: 'pushOnly' },
      ),
    ).toEqual({});
  });
});

describe('Connection policy ownership', () => {
  it('uses the existing plugin configuration so later source settings are not shadowed', () => {
    const provider = configureIntegrationPolicy(
      {
        id: 'source',
        isEnabled: true,
        issueProviderKey: 'GITHUB',
        pluginId: 'github-issue-provider',
        pluginConfig: { repo: 'demo/app' },
      },
      { title: 'both' },
    );
    expect(provider.integrationFieldPolicy).toBeUndefined();
    expect('pluginConfig' in provider && provider.pluginConfig['twoWaySync']).toEqual({
      title: 'both',
    });
  });
});
