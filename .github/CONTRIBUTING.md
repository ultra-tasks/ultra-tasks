# Thank you for considering to contribute!

Ultra Tasks is independently maintained and published by Adrian Chase ([@ac9492](https://github.com/ac9492)). Please bring fork-specific questions, bug reports, and ideas to the [Ultra Tasks issue tracker](https://github.com/ultra-tasks/ultra-tasks/issues). For private vulnerability reports, follow the [security policy](../SECURITY.md).

## Licensing contributions

Ultra Tasks' combined distribution is **AGPL-3.0-only**, preserving upstream MIT rights. Contributors retain copyright but are asked to affirmatively accept the non-exclusive, sublicensable and relicensable inbound grant in our [Contributor License Agreement](../CONTRIBUTOR_LICENSE_AGREEMENT.md) using the dedicated PR checkbox (or equivalent explicit PR comment). Read [LICENSING.md](../LICENSING.md), disclose third-party intellectual property and retain notices. The project should not merge original contributions without recorded assent.

## Things that would help

### Feedback

- What do you like and what not?
- What should be improved?
- What essential features are missing?
- If you don't, why won't you use the app?
- Reporting bugs

### Design & UX

Design and accessibility feedback is welcome.

- Are the general concepts working? What should be improved?
- Providing better icons

### Features/Coding

- Improving existing issue provider integrations (Jira, GitHub, GitLab, Gitea, OpenProject, Linear, ClickUp, Azure DevOps, etc.)
- Improved data syncing
- Bug fixes and performance improvements

### Translations

- See our [translation guide](../docs/TRANSLATING.md) for how to contribute translations

### Documentation/[Wiki](https://github.com/ultra-tasks/ultra-tasks/tree/main/docs/wiki)

- Flagging outdated or incorrect documentation (or correcting via Pull Requests) is greatly appreciated.
- Creating [guides and workflow examples](../docs/wiki/1.00-Quickstarts.md) with short videos or screenshots would be welcomed.

## Commit Message Format

We use the Angular commit message format: `type(scope): description`

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

**Examples:**

- `feat(tasks): add recurring task support`
- `fix(sync): handle network timeout gracefully`
- `test(e2e): fix flaky sync tests`

**Note:** Use `test:` (not `fix(test):`) for test-related changes. The `fix` type is reserved for actual code/bug fixes.

Include the issue number in your commit message if fixing a particular issue (e.g.: `feat: add nice feature #31`).
