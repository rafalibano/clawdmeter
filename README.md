# ClawdMeter

ClawdMeter is a menu bar app for macOS that shows, in one click, how much of your Claude plan you have used and what is happening in your workday: consumption of the 5-hour and 7-day windows with a projection up to the reset, your open Claude Code sessions, your Pull Requests and the Reviews waiting for you. Everything runs on your computer, with no Mottu server in the middle.

![ClawdMeter Usage tab](docs/images/usage.png)

## What it shows

| Tab | What it shows |
|---|---|
| Usage | bars for the 5h and 7d consumption of the selected Claude account, with a mark at the projected % at the reset, and a history chart (1h, 6h, 1d, 7d, 30d or the weekly cycle) |
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
4. Open **Settings > Claude accounts**, type a name for the account (for example "Personal") and click **Add account**. The browser opens on the Claude sign-in page; sign in and authorize, and the account shows up in the list. The Usage tab only shows data after this step.

The `.dmg` is for Macs with an Apple chip (M1 or newer). Claude usage no longer depends on Claude Code: ClawdMeter signs in to your Claude account by itself. Claude Code is only needed for the Sessions tab and for Skills.

> **Upgrading from 0.1.x:** the old versions read the Claude Code login from the Keychain. That reading was removed, so after the upgrade add your account once in **Settings > Claude accounts**. Your usage history is kept and moves to the first account you add.

## Getting started

- Click the mascot icon in the menu bar to open the panel. If the icon is hidden, use the **Ctrl + Option + D** shortcut.
- Click the gear (⚙) in the bottom right corner to open **Settings**: enabled tabs, connections, projection method, language, colors and light/dark theme. The app opens in English; pick Português (Brasil) or Español (México) under Settings > Language.
- **Claude accounts:** add up to 5 accounts in **Settings > Claude accounts**, each with its own name. With two or more, the Usage tab shows a compact selector to the right of the tabs (the initials of the active account) that lists the account names; each account keeps its own history and alerts. In the same section you can rename, remove or sign in again to an account. If the browser does not come back to the app after the sign-in, click **Paste code**, authorize on the page that opens and paste the code it shows.
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

- **Your Claude accounts' sign-in**, done by ClawdMeter itself in the browser. The tokens are kept in the macOS Keychain, renewed by the app's native layer and never leave it.
- **`~/.claude/sessions`**, to list your open Claude Code sessions.
- **The usage history**, one file per Claude account, which the app itself keeps in `~/Library/Application Support/com.mottu.clawdmeter`, along with your settings.

Who the app talks to over the internet, and only these:

- `claude.ai`, `platform.claude.com` and `api.anthropic.com`: the sign-in of your Claude accounts and their consumption.
- `api.github.com`: your PRs and Reviews, and the app updates (the download itself comes from GitHub's file storage, `release-assets.githubusercontent.com`).
- `graph.microsoft.com`: the agenda (tab under maintenance).

The GitHub token, if you use one, is kept in the Keychain. ClawdMeter signs in to Claude with the same public client used by ClaudeUsageBar (editable in Settings); Anthropic's terms do not foresee third-party apps doing this, so use it at your own risk (see [docs/SECURITY.md](docs/SECURITY.md)). Skills, when they come back, will only be able to run a closed list of read commands.

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

4. Open the **Keychain Access** app, search for `com.mottu.clawdmeter` and delete the items found (they include the Claude accounts' tokens; removing an account in Settings deletes its tokens too).

## Common problems

- **"Anthropic rate limit" (error 429):** Anthropic limits how often usage can be queried. The app waits on its own and tries again, showing the latest data in the meantime. You do not need to do anything.
- **The panel does not show up over another full-screen app:** this is a known macOS limitation. If it happens, send the `~/Library/Logs/com.mottu.clawdmeter/popover.log` file to whoever maintains the app.
- **The icon disappeared from the menu bar:** on Macs with a notch, macOS may hide icons when the bar is full. Use the **Ctrl + Option + D** shortcut to open the panel.
- **"Sign in again" on a Claude account:** the app could not renew that account's sign-in. Click **Sign in again** (on the Usage tab or in Settings > Claude accounts) and sign in in the browser.
- **"No Claude account yet":** add an account in **Settings > Claude accounts**.

## Windows

There is a Windows version in the code, but it has not been validated on a Windows computer yet. For now, official support is macOS only.

## For developers

Prerequisites, commands, folder structure and how to contribute: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Version history: [CHANGELOG.md](CHANGELOG.md).

## License and credits

Mottu internal use. The repository has no public license and must not be distributed outside the company.

- The usage chart behavior is based on ClaudeUsageBar (BSD-2-Clause license).
- The mascot belongs to Anthropic and is used internally only.
- Built with Tauri 2, Angular 19 and Apache ECharts; the remaining dependencies are listed in `package.json` and `src-tauri/Cargo.toml`.
