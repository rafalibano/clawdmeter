# Changelog

## 0.1.0

First internally distributed version.

- macOS menu bar icon with the mascot, which fills up as weekly consumption grows and shows the 5h and 7d bars; the Ctrl + Option + D shortcut opens the panel.
- Usage tab: 5h and 7d bars with projection up to the reset, chart from 1h to 30d and weekly cycle, smooth curve, up to 30 days of history kept locally and a one-time import of the ClaudeUsageBar history.
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
