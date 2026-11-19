import { KeyboardConfig } from '@sp/keyboard-config';
import { AppFeaturesConfig } from '../../features/config/global-config.model';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { NAV_SECTION_ICON } from '../../core-ui/magic-side-nav/nav-section-icons.const';
import { T } from '../../t.const';
import { IS_SYNC_AVAILABLE } from '../../app.constants';

export type SearchCommandId =
  | 'today'
  | 'inbox'
  | 'upcoming'
  | 'calendar'
  | 'integrations'
  | 'settings'
  | 'add-task'
  | 'focus'
  | 'sync'
  | 'account'
  | 'sync-settings'
  | 'undo'
  | 'redo'
  | 'shortcuts';

/** A destination opens a page; an action does something from where you are. */
export type SearchCommandKind = 'destination' | 'action';

export interface SearchCommand {
  id: SearchCommandId;
  kind: SearchCommandKind;
  /** Translation key of the label; the label is what is matched against. */
  labelKey: string;
  icon: string;
  /** The route a destination opens. */
  route?: string;
  /** The user's shortcut for it, shown beside the label. */
  shortcut?: keyof KeyboardConfig;
  /** Further words that find it, besides its label. */
  aliases?: readonly string[];
}

export type SearchCommandFeatures = Pick<
  AppFeaturesConfig,
  'isPlannerEnabled' | 'isSchedulerEnabled' | 'isFocusModeEnabled'
>;

/** Translation keys for Undo and Redo; a command is listed only when its key is set. */
export interface SearchCommandHistory {
  undoLabelKey?: string;
  redoLabelKey?: string;
}

/**
 * Which engine a manual sync reaches right now (see `AccountSyncStatus.engine`): the Ultra Tasks
 * account, a legacy provider, or `null` while nothing is configured.
 */
export type SearchCommandSyncEngine = 'account' | 'provider' | null;

/** What the sync commands follow: the active engine, and what an account's status asks for. */
export interface SearchCommandSync {
  engine: SearchCommandSyncEngine;
  /**
   * Label of what a connected account needs now (Unlock, Sign in, Finish connecting, Retry);
   * "Sync now" when it only has to sync. The command then says what it will do.
   */
  actionLabelKey?: string | null;
}

/** The glyph of what the account's command does; a sync glyph for anything that is a sync. */
const SYNC_COMMAND_ICON: Record<string, string> = {
  [T.ACCOUNT_STATUS.ACTION_UNLOCK]: 'lock_open',
  [T.ACCOUNT_STATUS.ACTION_SIGN_IN]: 'login',
  [T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA]: 'link',
};

/**
 * The sync commands follow the one shared status. Nothing configured: one way in, to sign in
 * (the provider dialog, as before). Configured: Sync now on the active engine (or what the
 * account needs instead), and the way to the account (or, for a legacy provider, to its
 * settings). Never "Set up sync" for something that is already set up.
 */
const syncCommands = ({ engine, actionLabelKey }: SearchCommandSync): SearchCommand[] => {
  if (!engine) {
    return [
      {
        // The header button only appears once sync is chosen, so this is the way in from
        // anywhere; it opens the same dialog, for first set-up and for changes.
        id: 'sync',
        kind: 'action',
        labelKey: T.ACCOUNT_STATUS.COMMAND_SIGN_IN,
        icon: 'cloud_sync',
        aliases: ['set up sync', 'configure sync', 'sync', 'account'],
      },
    ];
  }
  const labelKey =
    engine === 'account' && actionLabelKey
      ? actionLabelKey
      : T.ACCOUNT_STATUS.ACTION_SYNC;
  const syncNow: SearchCommand = {
    id: 'sync',
    kind: 'action',
    labelKey,
    icon: SYNC_COMMAND_ICON[labelKey] ?? 'sync',
    // Still found by typing "sync" when the label says what the account needs instead.
    aliases: ['sync', 'sync now'],
  };
  return engine === 'account'
    ? [
        syncNow,
        {
          id: 'account',
          kind: 'action',
          labelKey: T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT,
          icon: 'account_circle',
          aliases: ['account', 'sign in', 'account id'],
        },
      ]
    : [
        syncNow,
        {
          id: 'sync-settings',
          kind: 'action',
          labelKey: T.ACCOUNT_STATUS.ACTION_SYNC_SETTINGS,
          icon: 'tune',
          aliases: ['set up sync', 'configure sync', 'provider'],
        },
      ];
};

/**
 * The places and actions Search offers next to tasks. Only what the user can
 * reach is listed: Upcoming, Calendar and Focus follow their feature switches.
 * Integrations is always listed, because its navigation row appears only once
 * something is connected.
 */
export const buildSearchCommands = (
  features: SearchCommandFeatures,
  history: SearchCommandHistory = {},
  sync: SearchCommandSync = { engine: null },
): SearchCommand[] => [
  {
    id: 'today',
    kind: 'destination',
    labelKey: T.G.TODAY,
    icon: 'today',
    route: '/tag/TODAY/tasks',
    shortcut: 'goToTimeline',
  },
  {
    id: 'inbox',
    kind: 'destination',
    labelKey: T.G.INBOX_PROJECT_TITLE,
    icon: 'inbox',
    route: `/project/${INBOX_PROJECT.id}/tasks`,
  },
  ...(features.isPlannerEnabled
    ? [
        {
          id: 'upcoming',
          kind: 'destination',
          labelKey: T.MH.PLANNER,
          icon: NAV_SECTION_ICON.PLANNER,
          route: '/planner',
          shortcut: 'goToPlanner',
          aliases: ['planner'],
        } satisfies SearchCommand,
      ]
    : []),
  ...(features.isSchedulerEnabled
    ? [
        {
          id: 'calendar',
          kind: 'destination',
          labelKey: T.MH.SCHEDULE,
          icon: NAV_SECTION_ICON.SCHEDULE,
          route: '/schedule',
          shortcut: 'goToScheduledView',
          aliases: ['schedule'],
        } satisfies SearchCommand,
      ]
    : []),
  {
    id: 'integrations',
    kind: 'destination',
    labelKey: T.F.INTEGRATIONS.TITLE,
    icon: 'hub',
    route: '/integrations',
    shortcut: 'toggleIssuePanel',
  },
  {
    id: 'settings',
    kind: 'destination',
    labelKey: T.MH.SETTINGS,
    icon: NAV_SECTION_ICON.SETTINGS,
    route: '/config',
    shortcut: 'goToSettings',
    aliases: ['preferences'],
  },
  {
    id: 'add-task',
    kind: 'action',
    labelKey: T.GCF.KEYBOARD.ADD_NEW_TASK,
    icon: 'add',
    shortcut: 'addNewTask',
  },
  ...(features.isFocusModeEnabled
    ? [
        {
          id: 'focus',
          kind: 'action',
          labelKey: T.GCF.KEYBOARD.GO_TO_FOCUS_MODE,
          icon: 'center_focus_strong',
          shortcut: 'goToFocusMode',
        } satisfies SearchCommand,
      ]
    : []),
  // The standalone web build has no sync at all.
  ...(IS_SYNC_AVAILABLE ? syncCommands(sync) : []),
  // Undo and Redo are offered only while there is something to undo or redo, and
  // are named after what they would change.
  ...(history.undoLabelKey
    ? [
        {
          id: 'undo',
          kind: 'action',
          labelKey: history.undoLabelKey,
          icon: 'undo',
          shortcut: 'undo',
        } satisfies SearchCommand,
      ]
    : []),
  ...(history.redoLabelKey
    ? [
        {
          id: 'redo',
          kind: 'action',
          labelKey: history.redoLabelKey,
          icon: 'redo',
          shortcut: 'redo',
        } satisfies SearchCommand,
      ]
    : []),
  {
    id: 'shortcuts',
    kind: 'action',
    labelKey: T.GCF.KEYBOARD.SHOW_HELP,
    icon: 'keyboard',
    shortcut: 'showHelp',
  },
];

/**
 * The commands that match what was typed: all of them for an empty query,
 * otherwise those whose label (or alias) contains it, label-prefix matches
 * first. A short, fixed list, so this is safe to run on every keystroke.
 */
export const filterSearchCommands = (
  commands: readonly SearchCommand[],
  query: string,
  labelOf: (labelKey: string) => string,
): SearchCommand[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...commands];
  }
  const ranked: { command: SearchCommand; rank: number; order: number }[] = [];
  commands.forEach((command, order) => {
    const label = labelOf(command.labelKey).toLowerCase();
    const words = [label, ...(command.aliases ?? [])];
    let rank = -1;
    if (label.startsWith(q)) {
      rank = 0;
    } else if (words.some((word) => word.startsWith(q))) {
      rank = 1;
    } else if (words.some((word) => word.includes(q))) {
      rank = 2;
    }
    if (rank >= 0) {
      ranked.push({ command, rank, order });
    }
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((entry) => entry.command);
};
