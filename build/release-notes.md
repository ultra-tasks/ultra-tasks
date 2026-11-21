# Ultra Tasks 0.4.0

This release improves account setup and sync recovery, adds opt-in calendar subscriptions, and expands issue integrations.

## Accounts and sync

- Sign in by email in the app or continue in your browser. The account page, Settings, search, and the header show the same sync status. Desktop sign-in persists across restarts using protected operating-system storage.
- A device with no tasks downloads your account data after sign-in. When both this device and the account already have tasks, you can choose which data to keep after reviewing the options. Sync recovery and retries preserve pending edits.
- New-device email verification is enabled by default on supported servers and can be managed from the account dashboard. An authenticator app or security key takes precedence when configured. Keep an exported backup and your recovery key before upgrading.

## Calendars and integrations

- Publish an opt-in calendar subscription from the account page when the server has feeds enabled. Feeds show busy time by default and can include titles if you choose. Anyone with the link can read the feed. You can rotate or revoke it from your account.
- Connect GitHub, GitLab, Linear, or Trello with guided sign-in in supported builds. Linked issues can write back selected fields where the provider supports them. New connections start in receive-only mode, and token entry remains available for supported configurations.

## Everyday work

- Copy, cut, and paste tasks with keyboard shortcuts. Undo and redo common actions such as completing a task, adding it to Today, or deleting it.
- Updated Focus, Search, Upcoming, and Calendar views make planning and switching between tasks easier.
- The hosted app works offline after the first load and stores task data in the browser. Account sync is available in supported installed apps. [Open Ultra Tasks](https://app.ultratasks.app/)

## Self-hosting

This client was tested against Ultra Tasks Server 0.1.0-beta.4. Server and app releases have separate version numbers. [Server release](https://github.com/ultra-tasks/ultra-tasks-server/releases/tag/server-v0.1.0-beta.4)

This release incorporates upstream changes from Super Productivity. [Upstream base 25cce3b3](https://github.com/super-productivity/super-productivity/commit/25cce3b318e0609cfd93f55236da70d0917c501b)
