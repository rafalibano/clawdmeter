# Changelog

## Unreleased

- Sessions: each open Claude Code session now shows the model of its last reply and how much context it holds (`Context 412k / 1M · 41%`, in amber from 70% and red from 90%; only `412k` when the model's window is unknown). A chevron opens the session's details: input, cache read, cache write and output tokens summed over the session (no dollar values) and the running subagents with type, model and time alive. **Expand all** at the top opens or closes every session. The numbers come from the session transcript under `~/.claude/projects`, read by Rust only where it grew since the last poll; the message text never reaches the panel. A session without a readable transcript shows as before.

## 0.2.1

- Usage alerts reach macOS again: the app never asked macOS for the notification permission (the Tauri plugin's request does nothing on desktop), so ClawdMeter did not show up under System Settings > Notifications and every alert was dropped. The Notifications connection now shows **Connect** while the permission was never asked, and the first usage alert that is due asks for it by itself.
- The panel shows up again over a large window (for example a maximized Safari or Teams) on macOS. It opened on top but blank, because WebKit kept treating it as covered and only painted after the window behind it moved or was minimized. The popover log now always records where the panel opened and whether macOS sees it.
- Releases: the app version goes to 0.2.1. The 0.2.0 release was built with version 0.1.1, so its `latest.json` offered 0.1.1 and installed apps never updated. The release workflow now fails when the tag does not match the version in `package.json` and `src-tauri/Cargo.toml`.

## 0.2.0

- Claude accounts: ClawdMeter now signs in to Claude by itself (OAuth in the browser, with a **Paste code** alternative) instead of reading the Claude Code login. Add up to 5 named accounts in the new **Settings > Claude accounts** section, where you can also rename, remove, sign in again and choose **Use default client ID**: **Yes** (the default) uses the client ClawdMeter already ships with, and **No** asks for your own OAuth client ID (UUID); the change only applies to the next sign-ins. The tokens are kept and renewed only by the native layer. With two or more accounts the Usage tab shows a compact switch with the initials of the active account (the full names are in its tooltip and in the list it opens); each account has its own usage history, quartile alerts and tray icon state. Settings schema goes to 10.
- Upgrading: the Claude Code credential reading (Keychain and `~/.claude/.credentials.json`) was removed, so add your account once after updating; the existing usage history moves to the first account added. The Claude connection now says "add an account" or "sign in again" for the account, instead of the old Keychain and Claude Code states. Skills no longer require the Claude connection (they keep using Claude Code's own login).

- Usage alerts: notifications when the 5h or 7d consumption crosses 25%, 50%, 75% or 100%, configurable per window in the new **Usage alerts** section of Settings (50% on both by default; an empty list turns a window off). Each percentage is notified once per cycle, only the highest one when several are crossed at once, and nothing is notified for what was already crossed when the app opens. It needs the Notifications connection. Settings schema goes to 9.
- Settings has a new **System** section with a **Launch at login** switch (macOS and Windows; the section is hidden on other systems). It is off by default, reads the state from the system each time Settings opens and, if the system refuses the change, goes back to the real state and says so (a failed read has its own message, and the collapsed summary shows "Status unavailable"). On macOS it writes a LaunchAgent tied to the app's bundle identifier, refuses to turn on while the app runs from the disk image or from a temporary copy made by macOS (move it to Applications first) and, on each launch, points the agent at the current copy of the app. On Windows it writes only to the current user's `Run` key, so turning it off never needs administrator rights.

## 0.1.1

- The panel opens again over apps in full screen on macOS (for example Safari). It was not turned into a non-activating panel when macOS had already wrapped the window for key-value observing.

## 0.1.0

First internally distributed version.

- Automatic updates from the GitHub Releases of the app's repository: checks on launch and every 6 hours with the connected GitHub account, shows "New version X · Update" at the top of the panel, downloads with progress, verifies the signature, installs and asks before restarting. Settings has a new **Updates** section with the current version, the last check and **Check now**. Without GitHub connected the app does not check and says so.
- The release workflow signs the updater artifacts, publishes `latest.json` and no longer leaves the release as a draft; Windows also gets an NSIS installer.

- macOS menu bar icon with the mascot, which fills up as weekly consumption grows and shows the 5h and 7d bars; the Ctrl + Option + D shortcut opens the panel.
- Usage tab: 5h and 7d bars with projection up to the reset (Last 24h, Last 7 days, Last 14 days or Since reset; Last 7 days is the default, and a saved Last 14 days moves to it once), chart from 1h to 30d and weekly cycle, smooth curve, up to 30 days of history kept locally and a one-time import of the ClaudeUsageBar history.
- Sessions tab: open Claude Code sessions, with a warning for the ones waiting for input for a long time.
- Pull Requests and Reviews tabs: PRs by repository with CI, review decision, conflict and age (SLA), via GitHub.
- Connections to Claude Code (read-only credential), GitHub (gh CLI, browser or token) and Microsoft.
- Settings: tabs, connections, projection method, alert thresholds, language (English, pt-BR, es-MX; English by default, a saved choice is kept), accent color, consumption line colors and light, dark or system theme.
- Agenda tab (Outlook/Teams) and Skills tab (Claude Code runs with a tool allowlist) implemented and under maintenance.
- Automatic migration of the data from the old `com.mottu.devpulse` identifier.
- Unsigned `.dmg` installer for macOS 14 or later (Apple Silicon).
- Security hardening from the second Rust review (details in `docs/SECURITY.md`):
  - Skill runs (`claude -p`) no longer load the user's Claude settings, hooks or MCP servers; Rust passes an app-owned settings file. The Jira part of skills is off until the app has its own MCP config.
  - A skill's working folder must be a git project outside config, credential and app folders; reads of `~/.config`, `~/.kube`, `~/.docker`, `~/Library` and `~/AppData` are denied too.
  - When a run's main process exits, what it left running is killed; runs stop after 15 minutes, receive only an allowlisted environment, and their events are matched by a spawn id instead of the pid.
  - The old `com.mottu.devpulse` secrets are deleted after migration, a denied Keychain prompt is not shown again on every launch, and the migration markers are out of the webview's reach.
  - Tray clicks and the popover dismiss use a monotonic clock; the release log no longer records which apps were activated.
  - Windows: the popover stays inside the work area, risky characters in the program path are refused, and Rust 1.77.2 is the minimum version.
  - Smaller fixes: `Retry-After` capped at 1 hour, no redirects on the usage request, ClaudeUsageBar history size checked before reading, at most two OAuth listeners, and a weekly `cargo audit`/`cargo deny` run.
