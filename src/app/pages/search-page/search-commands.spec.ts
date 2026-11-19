import {
  buildSearchCommands,
  filterSearchCommands,
  SearchCommand,
  SearchCommandFeatures,
  SearchCommandHistory,
  SearchCommandSyncEngine,
} from './search-commands';
import { T } from '../../t.const';

describe('search commands', () => {
  const all: SearchCommandFeatures = {
    isPlannerEnabled: true,
    isSchedulerEnabled: true,
    isFocusModeEnabled: true,
  };
  const none: SearchCommandFeatures = {
    isPlannerEnabled: false,
    isSchedulerEnabled: false,
    isFocusModeEnabled: false,
  };
  const ids = (features: SearchCommandFeatures): string[] =>
    buildSearchCommands(features).map((c) => c.id);
  // A stand-in for translation: the label is the key's last segment.
  const labelOf = (key: string): string => key.split('.').pop() as string;

  describe('buildSearchCommands', () => {
    it('lists every place and action when all features are on', () => {
      expect(ids(all)).toEqual([
        'today',
        'inbox',
        'upcoming',
        'calendar',
        'integrations',
        'settings',
        'add-task',
        'focus',
        'sync',
        'shortcuts',
      ]);
    });

    it('leaves out Upcoming, Calendar and Focus when their features are off', () => {
      expect(ids(none)).toEqual([
        'today',
        'inbox',
        'integrations',
        'settings',
        'add-task',
        'sync',
        'shortcuts',
      ]);
    });

    it('always lists Integrations, whose navigation row appears only once connected', () => {
      expect(ids(none)).toContain('integrations');
    });

    it('always lists one sync command, the way in while the header button is hidden', () => {
      expect(ids(none)).toContain('sync');
      expect(ids(all)).toContain('sync');
    });

    describe('the sync commands follow the shared status', () => {
      const syncIds = (engine: SearchCommandSyncEngine): string[] =>
        buildSearchCommands(all, {}, { engine })
          .filter((c) => ['sync', 'account', 'sync-settings'].includes(c.id))
          .map((c) => c.id);
      const sync = (
        engine: SearchCommandSyncEngine,
        actionLabelKey?: string,
      ): SearchCommand | undefined =>
        buildSearchCommands(all, {}, { engine, actionLabelKey }).find(
          (c) => c.id === 'sync',
        );

      it('offers to sign in to the account when nothing is configured', () => {
        expect(syncIds(null)).toEqual(['sync']);
        expect(sync(null)?.labelKey).toBe(T.ACCOUNT_STATUS.COMMAND_SIGN_IN);
      });

      it('offers Sync now and the account page for a connected account, never "Set up sync"', () => {
        expect(syncIds('account')).toEqual(['sync', 'account']);
        expect(sync('account')?.labelKey).toBe(T.ACCOUNT_STATUS.ACTION_SYNC);
        const labels = buildSearchCommands(all, {}, { engine: 'account' }).map(
          (c) => c.labelKey,
        );
        expect(labels).toContain(T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT);
        expect(labels).not.toContain(T.ACCOUNT_STATUS.COMMAND_SIGN_IN);
        expect(labels).not.toContain(T.PS.SYNC.SET_UP_SYNC);
      });

      it('offers Sync now and its settings for a legacy provider, without a pointless account page', () => {
        expect(syncIds('provider')).toEqual(['sync', 'sync-settings']);
        expect(sync('provider')?.labelKey).toBe(T.ACCOUNT_STATUS.ACTION_SYNC);
      });

      it('names what a connected account needs now, instead of promising a sync it cannot start', () => {
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_UNLOCK)?.labelKey).toBe(
          T.ACCOUNT_STATUS.ACTION_UNLOCK,
        );
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA)?.labelKey).toBe(
          T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA,
        );
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_SYNC)?.labelKey).toBe(
          T.ACCOUNT_STATUS.ACTION_SYNC,
        );
        // Matching glyphs, and still found by typing "sync".
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_UNLOCK)?.icon).toBe('lock_open');
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA)?.icon).toBe('link');
        expect(sync('account', T.ACCOUNT_STATUS.ACTION_UNLOCK)?.aliases).toContain(
          'sync',
        );
      });

      it('keeps "Sync now" for a legacy provider whatever it needs', () => {
        expect(sync('provider', T.ACCOUNT_STATUS.ACTION_UNLOCK)?.labelKey).toBe(
          T.ACCOUNT_STATUS.ACTION_SYNC,
        );
      });

      it('keeps every sync command an action, with no route', () => {
        for (const engine of [null, 'account', 'provider'] as const) {
          for (const command of buildSearchCommands(all, {}, { engine })) {
            if (['sync', 'account', 'sync-settings'].includes(command.id)) {
              expect(command.kind).toBe('action');
              expect(command.route).toBeUndefined();
            }
          }
        }
      });
    });

    it('lists Undo and Redo only while there is something to undo or redo', () => {
      const idsWith = (history: SearchCommandHistory): string[] =>
        buildSearchCommands(none, history).map((c) => c.id);
      expect(idsWith({})).not.toContain('undo');
      expect(idsWith({})).not.toContain('redo');
      expect(idsWith({ undoLabelKey: 'U' })).toContain('undo');
      expect(idsWith({ undoLabelKey: 'U' })).not.toContain('redo');
      const both = buildSearchCommands(none, { undoLabelKey: 'U', redoLabelKey: 'R' });
      expect(both.map((c) => c.id)).toEqual(
        jasmine.arrayContaining(['undo', 'redo', 'shortcuts']),
      );
      expect(both.find((c) => c.id === 'undo')?.labelKey).toBe('U');
      expect(both.find((c) => c.id === 'redo')?.shortcut).toBe('redo');
    });

    it('gives each destination a route and no action one', () => {
      for (const command of buildSearchCommands(all)) {
        if (command.kind === 'destination') {
          expect(command.route).withContext(command.id).toBeTruthy();
        } else {
          expect(command.route).withContext(command.id).toBeUndefined();
        }
      }
    });
  });

  describe('filterSearchCommands', () => {
    const commands = buildSearchCommands(all);

    it('returns every command for an empty or blank query', () => {
      expect(filterSearchCommands(commands, '', labelOf).length).toBe(commands.length);
      expect(filterSearchCommands(commands, '   ', labelOf).length).toBe(commands.length);
    });

    it('matches case-insensitively on a part of the label', () => {
      const result = filterSearchCommands(commands, 'SETT', labelOf).map((c) => c.id);
      expect(result).toEqual(['settings']);
    });

    it('finds a command by an alias', () => {
      expect(filterSearchCommands(commands, 'planner', labelOf).map((c) => c.id)).toEqual(
        ['upcoming'],
      );
      expect(
        filterSearchCommands(commands, 'preferences', labelOf).map((c) => c.id),
      ).toEqual(['settings']);
    });

    it('puts label-prefix matches before looser matches', () => {
      // "t" starts Today and Settings' no; it is inside "Add new task"/"Settings".
      const labels = new Map([
        ['G.TODAY', 'Today'],
        ['MH.SETTINGS', 'Settings'],
        ['GCF.KEYBOARD.ADD_NEW_TASK', 'Add new task'],
      ]);
      const result = filterSearchCommands(
        commands,
        't',
        (key) => labels.get(key) ?? 'zzz',
      ).map((c) => c.id);
      // The sign-in command matches too: its aliases ("set up sync", "account") hold a "t".
      expect(result).toEqual(['today', 'settings', 'add-task', 'sync']);
    });

    it('finds the sign-in command by typing sync, set up or configure, without matching Settings', () => {
      const labels = new Map([
        [T.ACCOUNT_STATUS.COMMAND_SIGN_IN, 'Sign in to your Ultra Tasks account'],
      ]);
      const labelled = (key: string): string => labels.get(key) ?? 'zzz';
      for (const typed of ['sync', 'set up sync', 'config', 'sign in', 'account']) {
        expect(filterSearchCommands(commands, typed, labelled).map((c) => c.id))
          .withContext(typed)
          .toEqual(['sync']);
      }
    });

    it('finds Sync now by its label, and the account page by what people call it', () => {
      const connected = buildSearchCommands(all, {}, { engine: 'account' });
      const labels = new Map([
        [T.ACCOUNT_STATUS.ACTION_SYNC, 'Sync now'],
        [T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT, 'Open Ultra Tasks account'],
      ]);
      const labelled = (key: string): string => labels.get(key) ?? 'zzz';
      expect(filterSearchCommands(connected, 'sync', labelled).map((c) => c.id)).toEqual([
        'sync',
      ]);
      expect(
        filterSearchCommands(connected, 'account', labelled).map((c) => c.id),
      ).toEqual(['account']);
    });

    it('returns nothing when nothing matches', () => {
      expect(filterSearchCommands(commands, 'qqqq', labelOf)).toEqual([]);
    });

    it('does not mutate or reorder the source list', () => {
      const before = commands.map((c) => c.id);
      filterSearchCommands(commands, 'a', labelOf);
      expect(commands.map((c) => c.id)).toEqual(before);
    });
  });
});
