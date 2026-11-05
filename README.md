# ClawdMeter

ClawdMeter is a menu bar app for macOS (with experimental Linux support, see [Linux](#linux-experimental)) that shows, in one click, how much of Claude Code you have used and what is happening in your workday: consumption of the 5-hour and 7-day windows with a projection up to the reset, your open Claude Code sessions, your Pull Requests and the Reviews waiting for you. Everything runs on your computer, with no Mottu server in the middle.

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

## Installation (Linux, experimental)

Requirements: Linux x86_64 on Ubuntu 22.04 / Debian 12 or newer (or an equivalent distribution), WebKitGTK 4.1, Claude Code installed and signed in, and a desktop with a system tray (see below).

- **AppImage:** download `ClawdMeter_0.1.0_amd64.AppImage`, then `chmod +x ClawdMeter_0.1.0_amd64.AppImage` and run it.
- **Debian/Ubuntu (.deb):** `sudo apt install ./ClawdMeter_0.1.0_amd64.deb` (apt installs WebKitGTK and the AppIndicator library for you).

The builds are not signed. Run `ClawdMeter` from the application menu; the mascot icon appears in the system tray.

## Getting started

- Click the mascot icon in the menu bar to open the panel. If the icon is hidden, use the **Ctrl + Option + D** shortcut.
- Click the gear (⚙) in the bottom right corner to open **Settings**: enabled tabs, connections, projection method, language, colors and light/dark theme. The app opens in English; pick Português (Brasil) or Español (México) under Settings > Language.
- To see Pull Requests and Reviews, connect GitHub in **Settings > Connections**. There are three ways: use the `gh` CLI that is already signed in on your Mac, sign in through the browser, or paste an access token.
- To quit the app, right-click the menu bar icon. On Linux the tray icon has no click event: open its menu and choose **Open ClawdMeter** (or use **Ctrl + Alt + D**) and **Quit ClawdMeter**.

![ClawdMeter Settings](docs/images/settings.png)

## Privacy and security

Everything stays on your computer. There is no ClawdMeter server, nothing is sent to Mottu and there is no telemetry.

What the app reads:

- **The Claude Code credential**, read-only, from the macOS Keychain (on Windows and Linux, from `~/.claude/.credentials.json`). The app never refreshes it, never writes it anywhere else and it never leaves the app's native layer.
- **`~/.claude/sessions`**, to list your open Claude Code sessions.
- **The usage history**, which the app itself keeps in `~/Library/Application Support/com.mottu.clawdmeter`, along with your settings.

Who the app talks to over the internet, and only these:

- `api.anthropic.com`: your Claude consumption.
- `api.github.com`: your PRs and Reviews.
- `graph.microsoft.com`: the agenda (tab under maintenance).

The GitHub token, if you use one, is kept in the Keychain (on Linux, in the Secret Service of your desktop, for example GNOME Keyring or KWallet). Skills, when they come back, will only be able to run a closed list of read commands.

Technical details: [docs/SECURITY.md](docs/SECURITY.md).

## Uninstall

1. Quit the app (right-click the menu bar icon > Quit) and delete **ClawdMeter** from the Applications folder.
2. Delete the app folders:

   ```bash
   rm -rf "$HOME/Library/Application Support/com.mottu.clawdmeter" \
          "$HOME/Library/Logs/com.mottu.clawdmeter" \
          "$HOME/Library/Caches/com.mottu.clawdmeter"
   ```

3. Open the **Keychain Access** app, search for `com.mottu.clawdmeter` and delete the items found. The Claude Code credential does not belong to ClawdMeter and must stay.

On Linux the folders are `~/.config/com.mottu.clawdmeter` (settings and history), `~/.local/share/com.mottu.clawdmeter` (logs, in `logs/`) and `~/.cache/com.mottu.clawdmeter`; to remove the app and its data:

```bash
sudo apt remove clawdmeter   # or delete the AppImage
rm -rf ~/.config/com.mottu.clawdmeter ~/.local/share/com.mottu.clawdmeter ~/.cache/com.mottu.clawdmeter
secret-tool clear service com.mottu.clawdmeter   # only if you saved a GitHub token
```

## Common problems

- **"Anthropic rate limit" (error 429):** Anthropic limits how often usage can be queried. The app waits on its own and tries again, showing the latest data in the meantime. You do not need to do anything.
- **The panel does not show up over another full-screen app:** this is a known macOS limitation. If it happens, send the `~/Library/Logs/com.mottu.clawdmeter/popover.log` file to whoever maintains the app.
- **The icon disappeared from the menu bar:** on Macs with a notch, macOS may hide icons when the bar is full. Use the **Ctrl + Option + D** shortcut to open the panel.
- **"Sign in to Claude again":** the Claude Code login has expired. Run `claude /login` in Terminal (or use the app's own button).

## Linux (experimental)

Linux x86_64 builds, runs its tests and lints in CI on Ubuntu 22.04, and ships as `.AppImage` and `.deb`, but it has had little use on real desktops yet. What to expect:

- **Tray:** needs a StatusNotifierItem/AppIndicator host: KDE Plasma, XFCE, Cinnamon and MATE have one; GNOME needs the *AppIndicator and KStatusNotifierItem Support* extension. If your desktop has no tray, the app opens its window on the first run with a notice, and **Ctrl + Alt + D** keeps working. The tray icon is a light monochrome mascot, drawn for dark panels.
- **Panel position:** the panel opens near the mouse cursor, inside the monitor work area, and falls back to the top right corner. Wayland compositors may ignore window positions and global shortcuts; on GNOME/Wayland run the app with `GDK_BACKEND=x11` if the shortcut or the position does not work.
- **GitHub token:** the app stores it in the Secret Service. Without one (no GNOME Keyring or KWallet running), the connection shows *System keyring unavailable — use the GitHub CLI*, and the **Use the GitHub CLI** button connects through `gh`.
- **Terminal buttons** (sign in to Claude, `gh auth login`) open `x-terminal-emulator`, `gnome-terminal` or `konsole`, the first one found.
- **Notifications:** the system does not tell the app whether they are allowed, so the Notifications connection shows *Cannot verify*; **Open system settings** opens GNOME or KDE settings when available.

## Windows

There is a Windows version in the code, but it has not been validated on a Windows computer yet. For now, official support is macOS, with Linux in an experimental state.

## For developers

Prerequisites, commands, folder structure and how to contribute: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Version history: [CHANGELOG.md](CHANGELOG.md).

## License and credits

Mottu internal use. The repository has no public license and must not be distributed outside the company.

- The usage chart behavior is based on ClaudeUsageBar (BSD-2-Clause license).
- The mascot belongs to Anthropic and is used internally only.
- Built with Tauri 2, Angular 19 and Apache ECharts; the remaining dependencies are listed in `package.json` and `src-tauri/Cargo.toml`.
