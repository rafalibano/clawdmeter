# ClawdMeter

ClawdMeter is a menu bar app for macOS that shows, in one click, how much of Claude Code you have used and what is happening in your workday: consumption of the 5-hour and 7-day windows with a projection up to the reset, your open Claude Code sessions, your Pull Requests and the Reviews waiting for you. Everything runs on your computer, with no Mottu server in the middle.

![ClawdMeter Usage tab](docs/images/usage.png)

## What it shows

| Tab | What it shows |
|---|---|
| Usage | bars for the 5h and 7d consumption, with a mark at the projected % at the reset, and a history chart (1h, 6h, 1d, 7d, 30d or the weekly cycle) |
| Sessions | the open Claude Code sessions and the ones waiting for you |
| Pull Requests | your open PRs, grouped by repository, with CI, review, conflict and age |
| Reviews | PRs for you to review and the ones you already reviewed |

The **Skills** (run Claude Code skills) and **Agenda** (Outlook/Teams meetings) tabs are under maintenance and come turned off.

## Installation (macOS 14 or later)

1. Open the `ClawdMeter_0.1.0_aarch64.dmg` file and drag **ClawdMeter** into the **Applications** folder.
2. The app is not signed by Apple yet, so macOS blocks the first launch. Open **Terminal** and run:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/ClawdMeter.app"
   ```

3. Open ClawdMeter from the Applications folder. The mascot icon appears in the menu bar (the app does not appear in the Dock).
4. On first launch macOS asks whether ClawdMeter may use the Keychain to read the Claude Code credential. Click **Allow**.

The `.dmg` is for Macs with an Apple chip (M1 or newer). You need Claude Code installed and signed in.

## Getting started

- Click the mascot icon in the menu bar to open the panel. If the icon is hidden, use the **Ctrl + Option + D** shortcut.
- Click the gear (⚙) in the bottom right corner to open **Settings**: enabled tabs, connections, projection method, language, colors and light/dark theme. The app opens in English; pick Português (Brasil) or Español (México) under Settings > Language.
- To see Pull Requests and Reviews, connect GitHub in **Settings > Connections**. There are three ways: use the `gh` CLI that is already signed in on your Mac, sign in through the browser, or paste an access token.
- To quit the app, right-click the menu bar icon.

![ClawdMeter Settings](docs/images/settings.png)

## Updates

ClawdMeter updates itself from the Releases of its GitHub repository. For that you need:

- **Access to the repository** with your GitHub account (it is private).
- **GitHub connected** in **Settings > Connections** (gh CLI, browser or token). Without it, Settings > Updates shows "Connect GitHub to receive updates" and the app does not check.

The app checks when it opens and every 6 hours. When there is a new version, a "New version X · Update" bar appears at the top of the panel: click **Update**, wait for the download and choose **Restart** (or **Later**). Settings > Updates shows the current version, the last check and a **Check now** button. Every update is signed, and the app refuses a file whose signature does not match.

## Privacy and security

Everything stays on your computer. There is no ClawdMeter server, nothing is sent to Mottu and there is no telemetry.

What the app reads:

- **The Claude Code credential**, read-only, from the macOS Keychain. The app never refreshes it, never writes it anywhere else and it never leaves the app's native layer.
- **`~/.claude/sessions`**, to list your open Claude Code sessions.
- **The usage history**, which the app itself keeps in `~/Library/Application Support/com.mottu.clawdmeter`, along with your settings.

Who the app talks to over the internet, and only these:

- `api.anthropic.com`: your Claude consumption.
- `api.github.com`: your PRs and Reviews, and the app updates (the download itself comes from GitHub's file storage, `release-assets.githubusercontent.com`).
- `graph.microsoft.com`: the agenda (tab under maintenance).

The GitHub token, if you use one, is kept in the Keychain. Skills, when they come back, will only be able to run a closed list of read commands.

Technical details: [docs/SECURITY.md](docs/SECURITY.md).

## Uninstall

1. If you turned on **Settings > System > Launch at login**, turn it off before deleting the app. If the app is already gone, delete the login entry by hand:

   ```bash
   rm -f "$HOME/Library/LaunchAgents/ClawdMeter.plist"
   ```

   On Windows, delete the `ClawdMeter` value under `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` (Registry Editor, or `reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ClawdMeter /f`).
2. Quit the app (right-click the menu bar icon > Quit) and delete **ClawdMeter** from the Applications folder.
3. Delete the app folders:

   ```bash
   rm -rf "$HOME/Library/Application Support/com.mottu.clawdmeter" \
          "$HOME/Library/Logs/com.mottu.clawdmeter" \
          "$HOME/Library/Caches/com.mottu.clawdmeter"
   ```

4. Open the **Keychain Access** app, search for `com.mottu.clawdmeter` and delete the items found. The Claude Code credential does not belong to ClawdMeter and must stay.

## Common problems

- **"Anthropic rate limit" (error 429):** Anthropic limits how often usage can be queried. The app waits on its own and tries again, showing the latest data in the meantime. You do not need to do anything.
- **The panel does not show up over another full-screen app:** this is a known macOS limitation. If it happens, send the `~/Library/Logs/com.mottu.clawdmeter/popover.log` file to whoever maintains the app.
- **The icon disappeared from the menu bar:** on Macs with a notch, macOS may hide icons when the bar is full. Use the **Ctrl + Option + D** shortcut to open the panel.
- **"Sign in to Claude again":** the Claude Code login has expired. Run `claude /login` in Terminal (or use the app's own button).

## Windows

There is a Windows version in the code, but it has not been validated on a Windows computer yet. For now, official support is macOS only.

## For developers

Prerequisites, commands, folder structure and how to contribute: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Version history: [CHANGELOG.md](CHANGELOG.md).

## License and credits

Mottu internal use. The repository has no public license and must not be distributed outside the company.

- The usage chart behavior is based on ClaudeUsageBar (BSD-2-Clause license).
- The mascot belongs to Anthropic and is used internally only.
- Built with Tauri 2, Angular 19 and Apache ECharts; the remaining dependencies are listed in `package.json` and `src-tauri/Cargo.toml`.
