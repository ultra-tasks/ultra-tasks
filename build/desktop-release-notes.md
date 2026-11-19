# Ultra Tasks 0.4.0-beta.2

Second testing release of Ultra Tasks 0.4.0, focused on signing in to and syncing with your Ultra Tasks account. Export a backup before upgrading and keep your account recovery key.

## What's new

- One clear Ultra Tasks account experience. The name is the same everywhere, sign-in asks for your email, the Official server hides its address field, and browser sign-in stays available.
- A new device with no tasks downloads your account's data automatically after sign-in. If both this device and the account already hold real data, a dialog lets you download the account data, replace it with this device after a confirmation, or decide later. "Data connection not finished" stays visible until you finish.
- The header icon, Settings, the Account window, search commands and the account page show the same sync status. A connected account never shows "Set up sync", and failures, "Unlock" and "Sign in again" stay visible.
- Desktop stays signed in across restarts, sleep and updates using the operating system's protected storage, and renews automatically. If you must sign in again, the app says so and keeps your edits.
- New-device email verification, on by default and switchable in the account dashboard's Security area. It needs a server updated for beta 2. An authenticator app or security key always takes precedence, and an emailed code is not a replacement for them.
- Copy your Account ID for support from the account page, Settings and the dashboard. New accounts no longer ask for a username or display name.
- The account dashboard is organised into Account, Security and Devices, and published-calendar controls match the app's form style.
- The repeated "Global Shortcut registration failed" message after each sync is gone. A real conflict is reported once with a button to change the shortcut.
- The "set up sync" reminder no longer appears when an account is connected.

## Beta limits and testing

- Servers without beta 2 support keep working without email verification. An updated server refuses sign-ins on a new device from beta 1 apps with an "update required" message; devices already signed in keep syncing.
- Android and iOS keep their existing sign-in behaviour. Restoring the session after an app restart is implemented on desktop only, and physical-device acceptance is still pending.
- A lost network reply while a session renews can end that session; the app then asks you to sign in again and keeps your edits.
- The hosted web build is local-only. Browser account sync and calendar publishing from that build are outside this beta.
- Independent security review of the account system and calendar-client acceptance are not certified by this testing release.

## Distribution

Same platforms and conditions as 0.4.0-beta.1: Windows unsigned Setup and Portable (x64 and ARM64), macOS signed and notarized DMGs and ZIPs, Linux x64 AppImage, DEB and RPM, signed Android APKs without Play submission, a standalone web bundle, and iOS through TestFlight once the Apple pipeline uploads. SHA256SUMS.txt covers the direct-download files.

Ultra Tasks remains AGPL-3.0-only, with preserved upstream and third-party rights. This beta does not change the license or declare the server production ready.
