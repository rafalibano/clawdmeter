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
