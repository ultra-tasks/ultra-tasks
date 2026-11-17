For all current downloads, package links, and platform-specific notes: [check the releases](https://github.com/ac9492/ultra-tasks/releases).

Upstream base: [Super Productivity 25cce3b3](https://github.com/super-productivity/super-productivity/commit/25cce3b318e0609cfd93f55236da70d0917c501b).

### Features

- **release:** consolidate worktrees for 0.4.0-beta.1
- **integrations:** complete four-provider sign-in and write-back
- **calendar:** publish opt-in account calendar subscriptions
- **oauth:** add a native redirect URI and an allowlisted https hand-off redirect
- **undo:** undo and redo deleting one ordinary task
- **undo:** undo and redo adding an unscheduled task to Today
- **undo:** undo and redo completing or reopening one ordinary task
- **web:** keep server-owned paths away from the service worker
- **shortcuts:** one paste placement rule, subtask promotion and Undo/Redo entry
- **sync:** add Sign in with Nextcloud and plan OAuth-first connections
- **web:** add standalone no-sync web build
- **onboarding:** offer a sync path on first run, and open Settings by name
- **ui:** hide the header sync button until sync is set up
- **ui:** implement Zen shell WP3-WP4 (search command bar, Calendar polish)
- **ui:** implement Zen shell WP0-WP2 (first run, Focus, nav, Upcoming panel)
- **sync:** present UltraSync as the UltraTasks Account in the UI
- **integrations:** separate the Marketplace catalog from the Integrations workspace
- **shortcuts:** add task clipboard and guarded undo
- refine core productivity views
- **sync:** switch providers with recovery points

### Fixes

- **integrations:** load enabled connectors received through sync
- **integrations:** wait for connectors before refreshing
- **calendar:** keep publication moving during tracking and reconnect
- **issue:** point token help links at this repo and add the missing ones
- integrate upstream reliability fixes and optional schedule tray
- **clipboard:** act on the review of the task clipboard commit
- **ui:** act on the validation pass over the changed screens
- **sync:** keep a concurrent edit across a delete and its restore
- **sync:** keep Add to Today and concurrent edits of the same task
- **tasks:** keep a manual done order across a reload
- **web:** hide the first-run sync option and Search sync command without sync
- **electron:** always create the macOS window with vibrancy
- **sync:** warn before unloading pending local writes
- **sync:** guard provider setup and repair CI checks
- **sync:** preserve provider setup when switching
- **e2ee:** harden Android storage and bridge, fix token handling, auth before body parse
- **ios:** convert stored session tokens for the Capacitor bridge
- **ci:** run Keychain smoke on the stable iOS simulator
- **ci:** sign and open the iOS simulator smoke app locally
