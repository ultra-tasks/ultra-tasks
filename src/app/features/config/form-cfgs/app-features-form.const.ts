import { ConfigFormSection, AppFeaturesConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { IS_DONATION_UI_RESTRICTED } from '../../../app.constants';

export const APP_FEATURES_FORM_CFG: ConfigFormSection<AppFeaturesConfig> = {
  title: T.GCF.APP_FEATURES.TITLE,
  key: 'appFeatures',
  help: T.GCF.APP_FEATURES.HELP,
  items: [
    {
      key: 'isPlannerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PLANNER,
        description: T.GCF.APP_FEATURES.PLANNER_HINT,
        icon: 'edit_calendar',
      },
    },
    {
      key: 'isSchedulerEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SCHEDULE,
        description: T.GCF.APP_FEATURES.SCHEDULE_HINT,
        icon: 'calendar_view_week',
      },
    },
    {
      key: 'isBoardsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.BOARDS,
        description: T.GCF.APP_FEATURES.BOARDS_HINT,
        icon: 'view_kanban',
      },
    },
    {
      key: 'isHabitsEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.HABITS,
        description: T.GCF.APP_FEATURES.HABITS_HINT,
        icon: 'event_repeat',
      },
    },
    {
      key: 'isTimeTrackingEnabled',
      type: 'slide-toggle',
      props: {
        label: T.GCF.APP_FEATURES.TIME_TRACKING,
        description: T.GCF.APP_FEATURES.TIME_TRACKING_HINT,
        icon: 'timer',
      },
    },
    {
      key: 'isFocusModeEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.FOCUS_MODE,
        description: T.GCF.APP_FEATURES.FOCUS_MODE_HINT,
        icon: 'center_focus_strong',
      },
    },
    {
      key: 'isFinishDayEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.FINISH_DAY,
        description: T.GCF.APP_FEATURES.FINISH_DAY_HINT,
        icon: 'done_all',
      },
    },
    {
      key: 'isProjectNotesEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.PROJECT_NOTES,
        description: T.GCF.APP_FEATURES.PROJECT_NOTES_HINT,
        icon: 'description',
      },
    },
    {
      key: 'isSyncIconEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SYNC_BUTTON,
        description: T.GCF.APP_FEATURES.SYNC_BUTTON_HINT,
        icon: 'sync',
      },
    },
    {
      key: 'isSearchEnabled',
      type: 'slide-toggle',
      templateOptions: {
        label: T.GCF.APP_FEATURES.SEARCH,
        description: T.GCF.APP_FEATURES.SEARCH_HINT,
        icon: 'search',
      },
    },
    {
      key: 'isDonatePageEnabled',
      type: 'slide-toggle',
      // Donations are fully hidden on native iOS and macOS desktop builds, so
      // this toggle would be inert there — hide it to avoid a dead control.
      hideExpression: () => IS_DONATION_UI_RESTRICTED,
      templateOptions: {
        label: T.GCF.APP_FEATURES.DONATE_PAGE,
        description: T.GCF.APP_FEATURES.DONATE_PAGE_HINT,
        icon: 'volunteer_activism',
      },
    },
  ],
};
