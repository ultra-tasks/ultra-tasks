# Native account sync release checklist

This checklist is for Ultra Tasks account sync. SuperSync and WebDAV have separate suites; passing those does not establish account convergence.

## Automated acceptance

- Run **Native account acceptance (sync)** and **Native account acceptance (verification)** on the exact app candidate. The disposable loopback server comes from the pinned revision in tools/sync-server-source.json. The fixture must report ready, and the JUnit result must contain tests and no skipped cases.
- Record the app commit, SDK version/integrity, and the runtime server image digest. A green build or package upload is not a sync test. Run the native iOS Keychain smoke separately; it uses a fixture, not the product frontend.
- Before account-sync releases, make those CI results and the signed hardware checklist below required in release review. Record failures and rerun against the final candidate; do not treat a skipped gate as success.

## Signed hardware acceptance

Use an isolated synthetic account. Do not use a production user workspace. Use signed iOS and Windows clients, plus a clean third instance, and repeat the core test on Android. Run on a fresh install and a previous-version install upgraded with existing local work.

1. Check that all devices use the same provider, server, and account. Confirm warm resume, cold unlock, expired access-token refresh, rejected refresh, offline recovery, callback return and safe cancellation.
2. Complete a task on one device while a stale offline peer renames it; reconnect both, sync twice, and pull into the clean instance. Both changes must survive. Repeat with directions swapped, an edit while apply is in progress, a genuine same-field conflict, and quit/relaunch after a local edit. Check the recovered draft and the final checkbox, not just the status icon.
3. Verify that the UI distinguishes pending, locked, offline, error and verified sync. Check the last-good checkpoint and queue, including during an upload quota failure with unrelated incoming edits.
4. Exercise parent/subtask moves, archive and undo, completed/date/time values, ordering, and deletes. Compare independent pulls and verify a no-edit observer generates no compensating operation.
5. Rehearse an interrupted transfer, mature/large encrypted workspace bootstrap, an old/pruned cursor, and an explicit replacement/recovery off a verified copy. Never use a device's only good copy for a destructive test. Record untested scenarios alongside the candidate.

The status indicators are evidence about the active device's last verified round. They cannot know about unpublished changes on another device.
