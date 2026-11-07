# Repository presentation

The README follows the [Ultra Tasks website](https://ultratasks.app): a calm everyday planner, with capture, planning, focus, and organization shown before technical details. Only advertise features and platforms that are available, and keep the relationship to Super Productivity explicit.

## GitHub About panel

Use this description:

> A calm, free and open-source desktop to-do list, daily planner and time tracker. Local-first, offline, private. Based on Super Productivity.

Website: `https://ultratasks.app`

Topics: `productivity`, `task-manager`, `todo`, `daily-planner`, `time-tracking`, `local-first`, `offline-first`, `privacy`, `open-source`, `desktop-app`, `windows`, `macos`, `linux`.

These are GitHub repository settings; committing this document does not apply them. With an authenticated GitHub CLI that has repository administration access, apply the description, website, and topics with:

```sh
gh repo edit ultra-tasks/ultra-tasks \
  --description 'A calm, free and open-source desktop to-do list, daily planner and time tracker. Local-first, offline, private. Based on Super Productivity.' \
  --homepage https://ultratasks.app \
  --add-topic productivity,task-manager,todo,daily-planner,time-tracking,local-first,offline-first,privacy,open-source,desktop-app,windows,macos,linux
```

The command adds topics and preserves any existing ones. No repository visibility, branch, security, or fork-network setting needs to change for this presentation refresh.

## Social preview

Upload [brand/social-preview.png](brand/social-preview.png) under **Repository Settings → General → Social preview**. It is a 1280 × 640 PNG with the current logo, website message, and a real app screenshot. A file in the repository alone does not set GitHub's link preview.

## Keep it current

For each desktop release:

1. Update the README's version, release link, platform table, and versioned download URLs against the assets actually attached to that release. Keep the main “latest release” link stable.
2. Keep [installation and compatibility notes](ultra-tasks-builds.md) accurate, including signing, updates, and sync limitations.
3. Refresh screenshots after substantial interface changes with the command in [brand/README.md](brand/README.md). Use sample tasks and visually inspect every capture.
4. Check README image and documentation links. Leave release availability separate from development-build screenshots.
5. Coordinate platform and release copy with the separate [website repository](https://github.com/ultra-tasks/website-landing).
