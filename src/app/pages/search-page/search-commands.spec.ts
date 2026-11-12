import {
  buildSearchCommands,
  filterSearchCommands,
  SearchCommandFeatures,
  SearchCommandHistory,
} from './search-commands';

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

    it('always lists Set up sync, the way in while the header button is hidden', () => {
      expect(ids(none)).toContain('sync');
      expect(ids(all)).toContain('sync');
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
      expect(result).toEqual(['today', 'settings', 'add-task']);
    });

    it('finds Set up sync by typing sync or configure, without matching Settings', () => {
      const labels = new Map([['PS.SYNC.SET_UP_SYNC', 'Set up sync']]);
      const labelled = (key: string): string => labels.get(key) ?? 'zzz';
      expect(filterSearchCommands(commands, 'sync', labelled).map((c) => c.id)).toEqual([
        'sync',
      ]);
      expect(filterSearchCommands(commands, 'config', labelled).map((c) => c.id)).toEqual(
        ['sync'],
      );
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
