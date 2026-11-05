# ClawdMeter architecture

Technical document for whoever maintains the app. To install and use it, see the [README](../README.md); to run and contribute, [DEVELOPMENT.md](DEVELOPMENT.md); for the process policy, secrets, capabilities and security backlog, [SECURITY.md](SECURITY.md).

Tray app for macOS and Windows, with experimental Linux (x86_64) support. On macOS it lives in the menu bar; on Windows, in the notification area; on Linux, in the system tray (StatusNotifierItem/AppIndicator). One click on the icon opens a popover with the enabled pages (Usage, Sessions, Pull Requests, Reviews, Agenda and Skills).

Stack: Tauri 2 (Rust only in the platform layer), TypeScript, Angular 19 (standalone + signals).

## Pages

| Page | Id | Polling | Connections | What it shows |
|---|---|---|---|---|
| Usage | `usage` | 5 min | Claude | bars for the 5 h and 7 d windows with a vertical mark at the % projected at reset, and a chart (1h, 6h, 1d, 7d, 30d or the weekly "Reset" cycle) with both series and the trend |
| Sessions | `sessions` | 5 s | none | open Claude Code sessions and the ones that need attention |
| Pull Requests | `prs` | 5 min | GitHub | my open PRs per repo |
| Reviews | `reviews` | 5 min | GitHub | PRs to review and reviewed ones (open and from the last 30 days) |
| Agenda | `teams` | 10 min | Microsoft | today's Outlook/Teams meetings, with **Join** |
| Skills | `skills` | no polling | Claude | runs Claude Code skills (`claude -p`) with streaming, cancel and history |

Each one can be turned on and off in Settings. A page only runs if the connections it requires (`requiredConnections`) are ok; otherwise it shows the fix button.

## Settings

The ⚙ button in the bottom right corner is the only way in. Pages (checkboxes generated from the registry), appearance (language, accent color and popover background from a preset palette or a typed hex; light/dark/system theme) and the Usage alert thresholds apply immediately through CSS custom properties and are saved to `settings.json` in the OS config folder (`appConfigDir`):

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.mottu.clawdmeter/settings.json` |
| Windows | `%APPDATA%\com.mottu.clawdmeter\settings.json` |
| Linux | `~/.config/com.mottu.clawdmeter/settings.json` (`$XDG_CONFIG_HOME` when set) |

The file has a `schemaVersion`; old versions are migrated and rewritten on read, and future versions are never rewritten at boot (no downgrade). Editing the file by hand while the app is open reloads the settings.

A `settings.json` with invalid JSON is never overwritten: the app uses the last valid state in memory (or the defaults, if the boot already found it broken) and only writes the defaults when the file does not exist. While the file is broken, changes made in the UI apply to the session but are not persisted; once the file is fixed, the app reloads the content from disk. A read or write failure shows up as a warning at the top of the popover.

**Language:** `settings.language` (`en` default, `pt-BR`, `es-MX`), in the Settings > Appearance selector; it applies immediately. A file without the field (older versions) now opens in `en` (`schemaVersion` 3 is unchanged, and there is no forced migration: whoever already saved a language keeps it). The typed dictionaries live in `src/ui/i18n/{en,pt-BR,es-MX}.ts`: `en.ts` defines the keys (`MessageKey`), and the other two are `Record<MessageKey, string>` (the compiler catches a missing key) and `i18n.spec.ts` checks key and placeholder parity. The `Localizer` (`ui/i18n/localizer.ts`) translates with `t(key, args)` and formats dates, times, durations, numbers and cost with `Intl` in the chosen language; the `I18n` service exposes the `Localizer` as a signal, so switching updates the screen without a reload. The `domain` has no UI text: connection problems (`ConnectionProblem`), fixes (`FixAction`/`ActionLabel`), status notes (`StatusNote`) and app errors (`CodedError`/`ErrorCode`) are codes that the UI maps to keys (`problem.*`, `action.*`, `note.*`, `error.*`). Notifications and the tray tooltip are built by the `Translator` port (`application/ports/translator.ts`, implemented by `LiveTranslator` and bound to the current language in `CurrentLanguage`); switching language re-reads Usage to update the tooltip. The demo opens in `en`, and `?lang=pt-BR` (or `es-MX`) saves the language before boot. The user-facing messages coming from infrastructure (network failure, GitHub Device Flow, GraphQL rate limit, untitled meeting in the agenda) are dictionary keys in all three languages. Technical error messages (Rust `CommandError`, exceptions) are in English and are not translated. Run errors already stored in `runs.json` keep whatever language they were saved in.

**Usage alert thresholds:** `settings.usageThresholds` (`warning` 70 and `critical` 90 by default), editable in Settings; `0 < warning < critical ≤ 100` must hold (an invalid value is ignored in the UI, in the patch and in the migration).

The native color picker (`<input type="color">`) is forbidden in the `ui`: it opens in a separate window and the popover closes because it loses focus. The architecture lint blocks its use.

## Theme and colors (Mottu DS)

The source of truth for colors is Mottu's external DS (`@mottu-ops/ds-core-external`, private GitHub Packages, **not** a dependency of the app). `src/ui/theme/mottu-tokens.scss` is a snapshot, with the same `--me-*` names, of only what the app uses (primary, warning, alert, info and neutral scales, `*-base/-dark/-alt/-light` aliases, `background-change`/`component-change`/`text-change`, radius 2/4/8/16/1000 and shadow 1/2/3). `mottu-tokens.ts` mirrors in hex what ECharts needs (canvas does not resolve `var()`), and `tools/theme-tokens.spec.ts` proves the two match. To update, copy the values from the package's `dist/mottu-ds.css`.

`theme.scss` defines the app vars (`--cm-*`) on top of the tokens via `var(--me-*)`. Components use only `--cm-*`; hex outside `src/ui/theme` and `domain` is blocked by a test.

| Theme | Popover | Cards | Text | Secondary text |
|---|---|---|---|---|
| Dark | `#1a1a1a` (between `neutral-10` and `neutral-20`) | `#202022` | `neutral-95` | `neutral-70` |
| Light | `neutral-99` | `neutral-100` | `neutral-10` | `neutral-40` |

Soft look: the Tauri window is `transparent: true` (on macOS it requires `app.macOSPrivateApi: true` and the `macos-private-api` feature of the `tauri` crate) and `.popover` draws 12 px corners (`--cm-radius-window`) with a 1 px translucent border (`--cm-edge`, 8% of the text) and the native window shadow (`shadow: true`; a CSS shadow would be clipped at the window edge). `html` and `body` are transparent and `color-scheme` is set on `cm-root`, never on `:root`, otherwise the browser paints the canvas and the corners go square again. Cards, controls and separators use translucent borders (`--cm-border` 6%, `--cm-control-border` 14% only on buttons and fields), a 12 px radius on cards (`--cm-radius-md`) and 8 px on controls; tabs and period selectors are pills with the active segment in green. A custom background recomputes these variables from the text color (`BACKGROUND_OVERRIDES` in `theme-style.ts`). The dark hex values (`soft-surfaces.ts`) sit between the DS `neutral-10` and `neutral-20`, and `tools/theme-tokens.spec.ts` checks that.

- **Accent = Mottu green** (`--cm-accent`, default `#00b131` = `primary-base`): active tab, primary buttons (the `me-button` recipe: radius 2px, `:active` in `primary-dark`), period selector, focus, checkbox, "now" and "next" in the agenda. Text and thin lines use `--cm-accent-text`: `primary-alt` (`#1bd60b`) in dark, `primary-50` in light. The text on top of the accent is chosen by WCAG contrast (dark `#121212` or white, whichever passes AA); on the base green it comes out dark. A custom accent color applies to all of this, charts included.
- **Semantic:** error = `alert`, warning = `warning`, info = `info`, success = `primary` (`--cm-danger`, `--cm-warning`, `--cm-info`, `--cm-ok`; the `*-text` variants use the DS step with contrast in each theme).
- **Usage:** by default 5h is `primary-alt` in dark and `primary-base` in light (or the chosen accent color) and 7d is gray (`--cm-series-five` and `--cm-series-seven`), in the bar and in the chart. In Settings, in the collapsible "Usage lines" section (closed by default; the header shows the current 5h and 7d colors), "5h" and "7d" (same preset selector + validated hex, with "Use default color") save `seriesColors: { fiveHour, sevenDay }` in `settings.json` (schema 7; `null` = theme default, so the default keeps following light/dark and the accent color). The chosen color applies to everything that draws the series: bar fill, projected mark, "Projected" dot, chart legend, actual line, area, dashed trend and tooltip dot. No text is painted with the series color (percentages, labels and tooltip use the theme text color), so a color that is too dark or too light for the background never makes text unreadable; the line keeps exactly the chosen color. The band colors (gray, yellow `#FFC700`, red `alert-base`) apply only to the 7d projection (dashed trend, vertical mark on the bar and the "Projected N%" legend), by the band of the projected % and the Settings thresholds; the 5h projection is green and turns red from 100%.
- **PR SLA (Pull Requests and Reviews):** age badge and a mark on the row's left border, by the age since opening of open PRs (`domain/pull-requests/sla.ts`): under 3 days neutral, 3 to 6d23h yellow `#FFC700` (Yellow 1 of the official palette; the external DS has no yellow) with dark text, 7 days or more `alert-base`. In Reviews the reference is also the opening: the PR model does not carry the review request date. Red on these pages only appears for failing CI and conflicts; "Changes requested" uses `info`.
- **Font:** `"Helvetica Neue", Helvetica, Arial, sans-serif` across the app (`--cm-font-family`) and in the ECharts `textStyle`. There is no other font.
- **Migration:** `schemaVersion` 2 swaps the old accent `#6366f1` (indigo, the old default) for `#00b131`. Whoever chose another color keeps theirs; whoever had chosen the indigo on purpose is also migrated, because the value equals the old default.

## Connections

Settings has a **Connections** section with the connections required by the enabled pages (`PageModule.requiredConnections`). Each one has a status and the fix button for the current state; every disconnectable connection has **Disconnect**.

| Situation (`ConnectionProblem`) | Button |
|---|---|
| `keychain-denied` | Redo permission |
| `claude-expired` (401 or expired token) | Sign in to Claude again (opens Terminal with `claude /login`) |
| `claude-code-missing` | Install Claude Code |
| `github-unauthorized` | Sign in to GitHub again |
| `github-missing-scope` | Redo permissions |
| `github-org-access` (pending SSO) | Authorize for the org (opens the SSO URL sent by GitHub in the `x-github-sso` header, only if it is https on github.com) |
| `github-not-member` | Open the org page |
| `microsoft-expired` | Sign in to Microsoft again |
| `microsoft-not-connected` | Connect |
| `notifications-blocked` (denied, or not yet allowed: `prompt` state on macOS) | Open system settings |
| `notifications-unverifiable` (OS has no way to tell) | Open system settings (the row shows "Cannot verify", never "Connected") |
| `unexpected` (network etc.) | Try again |

- **Claude:** reads the Claude Code credential (Keychain `Claude Code-credentials` on macOS; `~/.claude/.credentials.json` as a fallback and on Windows). The access token and the refresh token never leave Rust: the webview only receives `expiresAt` and the plan (`claude_credentials_status`) and the usage data (`claude_usage_fetch`); the app never refreshes. Disconnecting only stops using the credential, it does not delete anything from Claude Code.
- **GitHub:** `gh auth token` (the token is not copied; the port returns `{ token }` or `{ missing: 'not-installed' | 'not-logged-in' }` and the row shows the right button for each reason) → sign in with the browser (Device Flow) → pasted PAT (the last two are kept in the OS vault). Validation checks scopes (`repo`, `read:org`) and access to the `Mottu-ops` org.
- **Microsoft:** PKCE with a listener on `127.0.0.1` (ephemeral port); the refresh token is kept in the OS vault. Delegated scopes `Calendars.Read` + `offline_access`; no client secret.
- **Notifications:** the Tauri plugin always returns `granted` on desktop, so the state comes from the `notification_permission_state` command (macOS: `UNUserNotificationCenter`, only in the packaged app; Windows: `ToastNotifier.Setting`; anywhere else `unknown`). The app does not request the permission through the plugin: `denied` and `prompt` (never allowed) both lead to **Open system settings**. When a skill run ends, the app sends a local notification only if this connection is `connected`.
- **GitHub Device Flow:** has a Cancel button (`AbortSignal`, also passed to the polling `fetch`); opening "Paste token" also cancels. On start, the UI shows the code with a Copy button and the instruction to paste it on the page that was opened. A result that arrives after the cancellation is discarded before writing to the vault.
- Non-secret preferences (GitHub method, Microsoft account, Claude enabled) are kept in `connections.json` next to `settings.json`.

The GitHub OAuth App and Entra ID `client_id`s are placeholders in `src/infrastructure/config/auth-config.ts` (`REPLACE_WITH_…`); while they are placeholders, Device Flow and Microsoft login fail with an `unexpected` state explaining what is missing. A gateway 401 (e.g. Claude usage) marks the connection with `connections.report.execute(id, problem)`.

## Claude usage

`usage` page (5 min poll, requires the Claude connection). `LoadUsage` calls the `AnthropicUsageGateway`, which invokes the `claude_usage_fetch` command: Rust reads the Claude Code credential and does the `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`), so the token never reaches TypeScript; the response is limited to 256 KiB (`Content-Length` is checked first and the body is read in chunks, cutting off past the limit, even without `Content-Length`); the app never refreshes. An expired token or 401 becomes `claude-expired` on the Claude connection and the page shows "Sign in to Claude again". The fields read are `five_hour` and `seven_day` (`utilization`, `resets_at`); the parse ignores extra fields and windows without a valid `utilization`.

- **History:** `usage-history.json` next to `settings.json`. Raw points for 7 days; from day 8 to day 30, aggregated into 15 min buckets by the maximum; nothing goes past 30 days (`domain/usage/retention.ts`). It stays in memory after the first read and is written serially through a temporary file + `rename` (`fs:allow-rename` only in `$APPCONFIG`). An unreadable file becomes `usage-history.json.corrupt` and the history restarts empty, without overwriting the original.
- **ClaudeUsageBar history (one-time migration):** on the first successful load, `ImportExternalUsageHistory` reads `~/.config/claude-usage-bar/history.json` (`{"dataPoints":[{"timestamp","pct5h","pct7d"}]}`, fractions 0–1) through the `ExternalUsageHistorySource` port (adapter `TauriClaudeUsageBarHistorySource`; in the demo, an empty fake), merges it into the history before retention and writes the `claudeUsageBarImportedAt` marker in `usage-history.json` itself. After that the file is never read again: from then on the history belongs to ClaudeMeter itself. Anyone who already has any point with the `imported` mark in `usage-history.json` is treated as already migrated, without reading the file. A missing or unreadable file counts as an empty source and also completes the migration; only an unexpected failure of the source retries on the next load. On merge, a fraction becomes %, points within 1 min of an existing point (or of each other) are discarded and our point wins, nothing older than 30 days or in the future gets in, and normal retention (raw 7 d, 15 min buckets up to 30 d) applies to the imported ones. The imported point has no `resets_at`: it carries the `imported` mark (4th element of the point) and cycle detection ignores the `resets_at` comparison on pairs with an imported point. The capability gives the plugin-fs only `read-text-file` on `$HOME/.config/claude-usage-bar/history.json` (needed for whoever installs now and has the file; `tools/capabilities.spec.ts` checks the scope). There is no toggle in Settings.
- **Transient error:** if a refresh fails (network, 5xx), the page keeps the last data and shows the error banner on top, with "Showing the last loaded data."
- **Rate limit (429/5xx):** Anthropic returns 429 on `/api/oauth/usage`. Rust passes the `rate_limited` `kind` with an optional `retryAfterSecs` (a generic HTTP 429/5xx error also counts) and the gateway converts it into `RateLimitedError`. The `PollingScheduler` postpones the page's next poll to `max(Retry-After, 5 → 10 → 20 → 30 min)` (`domain/rate-limit.ts`), including the manual refresh, and goes back to the normal pace after a success. The banner says "Anthropic rate limit — trying again in 12 min", with no API path, keeping the last data.
- **Refresh:** the ↻ button in the footer (left of the gear) reloads the current page through `scheduler.refresh`; it spins while loading, has a 30 s cooldown and, during a rate limit backoff, shows the remaining time in the tooltip without calling Anthropic (`ui/shell/refresh-state.ts`).
- **Layout:** at the top, two bars (`5h` and `7d`) with the percentage on the right and "resets in 2h06" below; the value predicted at reset is a thin vertical line (2 px, a bit taller than the bar) at the projected % point, in the projection color (at the end of the bar and red if it goes past 100%, and the legend carries the real number, e.g. "Projected 132%"; no mark when there is no projection). Below, the `1h · 6h · 1d · 7d · 30d · Reset` selector (segmented control, default 6h; "Reset" shows the weekly cycle, from the 7d `resets_at` − 7 days to the next reset, with subtle marks at "now" and at the 5h resets in the interval, and is disabled without a known `resets_at`) and a single ECharts chart (via `ngx-echarts`, loaded on demand) with both series on the same axis (Y axis on the right, from 0 to 100% in steps of 25; when the drawn projection goes past 100%, the axis rises to the next multiple of 25 above the projected maximum, capped at 300% and in steps of 50 above 200%), smooth lines with a very light area, dashed grid, dashed vertical marks at "now" and at the resets that fit the axis, a solid subtle reference line at 100% (red with low alpha, only with the expanded axis, and a highlighted "100%" label on the axis) and a `● 5h ● 7d` legend. There are no forecast sentences or long titles.
- **Chart (smooth curve, like ClaudeUsageBar):** the visible period (from the start of the axis to now) is split into 120 buckets (`CHART_BUCKETS`); each bucket with a reading becomes a point with the average of the % and the average of the instant, and an empty bucket is discarded (`downsample` in `usage-chart-model.ts`). The points are joined by a smooth curve (`smooth: 0.5` in ECharts), with no steps and no special handling of gaps or resets. The tooltip for the past interpolates on the curve with Catmull-Rom (`curveValueAt`); after the last point it shows the last value. The dashed projection does not use the buckets: it starts from the last real reading.
- **Projection (a single rule, chosen in Settings > Projection):** `projectionMethod` in `settings.json` (added in schema 6; default `7d` since schema 8). Selector order: Last 24h, Last 7 days, Last 14 days, Since reset. `ProjectUsage` (`application/use-cases/usage`) computes ONCE per render `{ rate, valueAtReset, resetsAt, trend }` for 5h and 7d, and bars, dashed line (all periods and the Cycle), future tooltip and the "Projected N%" legend only read that result (`domain/usage/forecast.ts`); the chart-model recomputes nothing. 7d methods: `24h` (rate = sum of the positive 7d increments in the last 24 h ÷ hours covered, drops are resets and ignored; without 2 h of data it falls back to `since-reset`), `7d` (default: the sum of the positive 7d increments in the last 7 × 24 h ÷ 7 calendar days, so a gap without readings counts as zero consumption; with less than 1 day of data in the window it falls back to `since-reset`), `14d` (the same increments over the last 14 days ÷ the days actually covered, minimum of 1 day of data, otherwise `since-reset`) and `since-reset` (rate = current % ÷ time since the last reset, `resets_at` − window duration; with less than 30 min elapsed there is no projection). In all of them, projected = current + rate × time until reset. 5h always uses `since-reset`, whatever the choice (the option in Settings carries the help line). The line has the series color, dashed, from the current point to `resets_at` (cut at 100% outside the Cycle; the Cycle expands the axis, capped at 300%), with a "date + Projected N%" tooltip in the Cycle. The linear regression was removed. Migration 7 → 8 turns every saved `14d` into `7d`: the old default was written by migration 5 → 6, so a file cannot tell an explicit `14d` from the default, and whoever wants 14 days picks it again (a `14d` saved after schema 8 is kept). The tray shows only current usage (percentages and reset times), not projection.

## Usage icon in the tray

On every `LoadUsage` read (and on every failure) the `UsageIndicator` port updates the tray icon and tooltip through the `tray_set_usage` command; in the demo the adapter is a no-op.

- **macOS:** wide icon (template, only alpha counts) with the pixel mascot (12×8 grid in `usage_icon.rs`, eyes as holes) on the left and two `5h`/`7d` rows with a rounded bar: filled part opaque, empty at 35%. The mascot fills from bottom to top according to `7d` (0% all at 35%, 100% all opaque) and, when `5h` or `7d` reaches 100% (limit hit), the eyes turn into an X. `tray-icon` fixes the icon height at 18 pt, so the render is 128×36 px (@2x), pixel by pixel at that height.
- **Windows:** the tray icon is square, so the 32×32 variant (16×16 at @1x) goes with only the mascot (fills with `7d`, eyes as an X when a limit is hit; filled blue, empty gray, readable on light and dark bars). Bars and numbers stay in the tooltip: `5h: 24% · resets 14:09 | 7d: 51% · resets Mon 05:39` (`domain/usage/usage-tooltip.ts`).
- **Linux:** the same square mascot as Windows, drawn in a light monochrome ink (`render_usage_icon_square_light`, readable on dark panels) both as the initial icon and on every update. The tray library reports no click events on Linux, so the tray menu has **Open ClawdMeter** besides **Quit ClawdMeter**.
- **No data** (missing window, Claude disconnected, expired token or read error): mascot all at 35% with normal eyes and bars with a dashed outline (on Windows, only the translucent mascot); the tooltip becomes `ClawdMeter · usage unavailable`. Percentages outside 0–100 are clamped in Rust.
- **Before the first read** (and with the Usage page off) the app's default icon applies (`tray-template.png` on macOS, the window icon on Windows, the light mascot on Linux); the mascot render only shows up after a read attempt.
- The sources are in `src-tauri/src/usage_icon.rs` (mascot as a character matrix; embedded 4×6 bitmap font for `5`, `h`, `7`, `d`; no system fonts and no image dependency). `cargo run --example render_usage_preview` (in `src-tauri/`) rewrites the PNGs in `docs/tray-preview/`.

## Popover over full-screen apps (macOS)

With another app in full screen (its own Space), a regular window does not show up. In `platform.rs`, `prepare_popover` runs when the window is created and before every `show`: it calls `set_visible_on_all_workspaces(true)` and completes through the `NSWindow` with `collectionBehavior` = `CanJoinAllSpaces | FullScreenAuxiliary | Stationary | IgnoresCycle` (without `FullScreenPrimary`/`Transient`/`MoveToActiveSpace`, which conflict) and level `NSPopUpMenuWindowLevel`. The activation policy stays `Accessory`. On Windows there is no change: the popover is a borderless window with `alwaysOnTop`, and this was not validated on a Windows machine. Only the behavior and level computation has an automated test; the effect over a real full-screen app has to be checked by hand.

To behave as a non-activating panel, `popover::apply` swaps the window's class to `ClawdMeterPopoverPanel` (an `NSPanel` subclass) with `object_setClass`. The swap only happens when the class is exactly `TaoWindow` (and the instance sizes match); a KVO subclass (`NSKVONotifying_TaoWindow`) or any other class is left alone and logged as `panel-class failed class=…`. Known costs of the swap: `TaoWindow`'s overrides are bypassed (`set_focusable()` and dragging the window background stop working, neither is used by the popover), and tao's per-window state is leaked if the window is destroyed. Today the window lives as long as the app, so the leak is bounded to one window; `tauri-nspanel` is the alternative if that changes. A dismiss deferred to the main queue carries the epoch of the show that installed its monitors and is dropped (`dismiss-stale`) if a newer show happened in between. The reopen guard and the dismiss grace use a monotonic clock (an `Instant` taken once per process), so a wall-clock step does not block tray clicks.

`popover.log` lines are written by one background thread. In release builds it does not record the activated app (pid and bundle id), window frames or the `show+100ms` probe; those lines exist only in debug builds.

On Windows the popover is placed by `tauri-plugin-positioner` (`TrayCenter`, falling back to `BottomRight`) and then clamped to the monitor work area (`rcWork` from `MonitorFromWindow` + `GetMonitorInfoW`), so a taskbar on any edge does not cover it. A failed Ctrl+Alt+D registration (taken by another app, or AltGr on some layouts) is logged as `shortcut-register failed`.

## Linux popover and tray

- **Position** (`popover_cursor.rs`, pure and tested): most Linux desktops give no tray icon position, so the popover opens next to the mouse cursor (`window.cursor_position()` when the tray menu item or the shortcut fires), centered on it, below it in the upper half of the monitor and above it in the lower half, clamped to the monitor work area (`Monitor::work_area`, an 8 px margin). Without a cursor (Wayland often refuses it) or with the cursor outside the work area it goes to the top right corner. Wayland compositors may ignore `set_position`.
- **No tray host** (`tray_host.rs`): at startup the app asks the session bus whether `org.kde.StatusNotifierWatcher` has an owner. If it is known to have none (GNOME without the AppIndicator extension), the first run opens the popover and the `startup_notice` command returns `no-tray`, which the shell shows as a dismissible notice ("Your desktop has no tray. Install the AppIndicator extension or use Ctrl+Alt+D."); a marker in `$APPDATA/.migration` keeps later runs quiet and the global shortcut keeps working. An unanswered query counts as "has a tray".
- **Secret Service:** `keyring` uses `sync-secret-service` + `crypto-rust` on Linux. When the service is missing (no session bus, `org.freedesktop.secrets` not provided, no default collection) the command error is `keyring_unavailable`, the connection problem is `keyring-unavailable` ("System keyring unavailable — use the GitHub CLI") and its fix, `use-github-cli`, runs the normal GitHub CLI connection (a locked or dismissed keyring stays `keychain-denied`).
- **Terminal:** `terminal_run` launches the first of `x-terminal-emulator`, `gnome-terminal` and `konsole` found on `PATH` (or the usual bin dirs) with the program and its arguments as separate `argv` entries after `sh -c '"$@"; exec "${SHELL:-/bin/sh}"'`, so the session stays open and no shell line is built from them; the working directory goes through `current_dir` and the terminal's own flag. **Open system settings** runs `gnome-control-center notifications` or `systemsettings kcm_notifications`.
- **Processes:** `process_run/spawn` children also get `XDG_*_HOME`, `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, so `gh` can reach the Secret Service that holds its token.
- **Paths:** Tauri resolves the app folders through XDG (`~/.config`, `~/.local/share`, `~/.cache`); the old `com.mottu.devpulse` folder never existed on Linux, so the legacy migration finds nothing. `~/.claude/.credentials.json` is read for the Claude credential, as on Windows.

## Sessions

`sessions` page (5 s poll, no connection). `TauriSessionDirectory` reads `<home>/.claude/sessions/*.json` (Tauri's `homeDir()`: `~` on macOS, `%USERPROFILE%` on Windows) and `LoadSessions` keeps only the live pids (`process_is_alive`, the F2 Rust command). Each session shows name (or folder), short folder, status (`busy`/`idle`/`shell`) and how long it has been in it (`statusUpdatedAt`, otherwise `updatedAt`). A session that is `idle` for more than 5 min ("Waiting for input for X") or `busy` for more than 30 min ("Busy for X") is highlighted; the thresholds are in `DEFAULT_ATTENTION_CONFIG` (`domain/sessions/attention.ts`) and are injected into `LoadSessions` by the composition root.

The capability gives the plugin-fs only `exists` and `read-dir` on `$HOME/.claude/sessions` and `read-text-file` on `$HOME/.claude/sessions/*.json`; the plugin-http allowlist no longer includes `https://api.anthropic.com` (the usage call is made by Rust; the rest of the HTTP goes through the plugin, so the CSP `connect-src` does not list external hosts).

In demo mode both pages use fake data (30 days of history generated by a deterministic model, five sessions in different states and one dead). `?demo=claude:claude-expired` (and the other connection scenarios) shows the usage page error state with the fix button.

## Agenda page

Today's Outlook/Teams meetings, tied to the Microsoft connection, with a 5 min poll.

- Source: `GET https://graph.microsoft.com/v1.0/me/calendarView` (delegated permission) with the day's `startDateTime`/`endDateTime` in `America/Sao_Paulo`, header `Prefer: outlook.timezone="America/Sao_Paulo"`, `$select`, `$orderby=start/dateTime`, `$top=50` and pagination by `@odata.nextLink` (only follows links from `graph.microsoft.com` itself; at most 10 pages).
- Rules for day, time zone, "now" and "next" live in `src/domain/calendar` (tested: day rollover, daylight saving time, all-day, cancelled, a meeting that crosses midnight).
- Cancelled meetings show struck through and never count as "now" or "next"; all-day events go in their own list. A meeting without a subject shows as "(untitled)".
- **Join** opens `onlineMeeting.joinUrl` through `OpenUrl`, only if it is `https` on `teams.microsoft.com` or `teams.live.com` (validated in `teamsJoinUrl`, in the Graph mapping and again in the `JoinMeeting` use case).
- A Graph 401/403 or expired token becomes `microsoft-expired`: the page shows the warning and the "Sign in to Microsoft again" button; after the fix it reloads right away (`PollingScheduler.refresh`).
- The `plugin-http` allowlist includes `https://graph.microsoft.com`; the CSP `connect-src` does not list external hosts because all HTTP goes through the plugin.

## Pull Requests and Reviews

Two pages (`prs` and `reviews`, polling every 5 min), each with a single `POST https://api.github.com/graphql` request (several aliased searches, `first: 50` each) using the GitHub connection token (`GitHubTokenResolver`). Access goes through `tauri-plugin-http`; the capability already allows `https://api.github.com/*` and `tools/capabilities.spec.ts` guarantees `/graphql` is covered (the CSP `connect-src` does not come into play, the plugin does not use the WebView).

| Page | Searches |
|---|---|
| Pull Requests | `author:@me is:open is:pr` |
| Reviews: to review | `review-requested:@me is:open is:pr` |
| Reviews: reviewed | `reviewed-by:@me -author:@me` open + closed/merged in the last 30 days |

- Grouped by repo; `k8s` and `k8s-prod` form the **Deploy** group, collapsed by default. At the top of each page, the "Collapse all" / "Expand all" control (▾/▸) toggles all the groups, Deploy included; each group is still clickable. Each group's state is kept in memory during the session (`PullRequestGroupsState`, per page/section/group), without going to `settings.json`.
- All searches use `sort:updated-desc`. Badges per PR: draft, CI (`statusCheckRollup`), review decision, conflict and age. Clicking opens in the browser, and the `OpenGitHubUrl` use case only opens `https://github.com` (no port or credentials in the URL).
- Limit of 50 per search; when there are more, the section shows "Showing X of Y." and a link to the search on GitHub. In the reviewed block the link covers open and closed from the last 30 days (`(is:open OR closed:>=date)`).
- A GraphQL response with partial `data` uses the valid nodes; only scope or SAML become a connection problem, and `RATE_LIMITED` shows "GitHub rate limit reached".
- Errors become `ConnectionProblem` (401 → `github-unauthorized`; 403 with `x-github-sso` or a SAML error → `github-org-access`; `INSUFFICIENT_SCOPES` → `github-missing-scope`; GitHub not connected → `github-unauthorized`) and the page shows the connection's fix button (`FIX_FOR`) plus "Try again". The scheduler forwards the `problem` in the error `PageUpdate` and has `refresh(pageId)` to reload right after the fix.

## Skills (runs)

The `skills` page does not poll: it only runs on a click on **Run**. Skills come from `skills.json` next to `settings.json` (read-only; missing or invalid uses the default `/acabativa`):

```json
{
  "schemaVersion": 1,
  "skills": [
    {
      "id": "acabativa",
      "name": "Acabativa",
      "prompt": "/acabativa",
      "maxBudgetUsd": 2,
      "allowedTools": ["Read(./**)", "Bash(gh pr list:*)", "Bash(gh pr view:*)", "Bash(gh pr checks:*)", "Bash(gh pr diff:*)", "Bash(gh search prs:*)"],
      "cwd": null
    }
  ]
}
```

- Command: `claude -p "<prompt>" --output-format stream-json --verbose --max-budget-usd <value> --allowedTools "Read(./**),Bash(gh pr diff:*),…"` through `process_spawn` (no shell; the tool list is a single argument). `--verbose` is required by `stream-json` in `-p` mode. A prompt starting with `-` is rejected. `cwd` must be absolute and without `..`, and must be a project folder: inside the user's folder (not the folder itself), with a `.git` folder or file, and outside `~/Library`, `~/.config`, `~/.kube`, `~/.docker`, `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.claude`, `~/AppData` and the app's own folders; without `cwd` the run starts in `app_cache_dir()/skill-cwd` (on macOS `~/Library/Caches/com.mottu.clawdmeter/skill-cwd`), an empty app folder, and not in the user's folder. Rust appends its own flags (see [SECURITY.md](SECURITY.md#skills-policy-claude--p)): no user, project or local settings, no MCP servers, an app-owned settings file. Skills that read Jira through MCP (the `/acabativa` cards) run without Jira until the app ships its own MCP config.
- Events and `process_kill` use a per-spawn id returned by `process_spawn`, not the pid; when the main process exits, Rust kills whatever it left in its process group (Windows: a kill-on-close Job Object). A run is killed after 15 minutes.

- **Failure without `result` (round 3).** If the process ends without a `result` event, the run fails showing the stderr (last 2000 characters); when a line was truncated, the error is the truncation message followed by the stderr, on another line. Without stderr, the generic message with the exit code applies.
- The stream is read line by line (`process-output`/`process-exit`) and interpreted in `domain/skills` (`parseStreamLine` + `applyStreamEvent`): assistant messages, `result` with cost/duration and `session_id`.
- **Cancel** kills the process group (`process_kill`); cancelling before the process is attached is stored and applied on attach. The history (last 20 runs, without the live log) is kept in `runs.json` in `appConfigDir`, with serialized writes.
- When the run ends (success or failure, never cancelled) a local notification goes out with cost and duration, if the notifications connection is ok.
- **Continue in terminal** opens `claude --resume <session_id>` (the id must be a UUID) in the same folder as the run.
- Problems with a fix button: MCP with `needs-auth`, `pending` or `failed` in the `init` (`mcp_servers[].status`) → **Reconnect MCP** (Terminal with `claude /mcp`); Claude Code missing → **Install Claude Code**.

## Build and release

- `.github/workflows/ci.yml`: on push to `main` and on PR, runs lint, typecheck, Vitest, build, `cargo test`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` on `macos-latest`, `windows-latest` and `ubuntu-22.04` (which installs the WebKitGTK, AppIndicator, rsvg, OpenSSL, D-Bus and xdo development packages first); a `supply-chain` job (ubuntu) runs `cargo audit` and `cargo deny check` (`src-tauri/deny.toml`: permissive licenses, advisories and sources only from crates.io).
- `.github/workflows/release.yml`: on a `v*` tag, builds a universal `.dmg` (arm64 + x64, macOS 14+), an `.msi` (Windows 10+) and an `.AppImage` plus `.deb` (Linux x86_64, built on Ubuntu 22.04) with `tauri-apps/tauri-action` and attaches them to a draft release.
- **Permissions and pins.** `ci.yml` runs with `permissions: contents: read`; `release.yml` only has `contents: write` (it needs to create the draft release). Every `actions/checkout` uses `persist-credentials: false`, so the token is not stored in the jobs' `.git`. All actions are pinned by commit SHA, with the version in a `# vN` comment next to it: `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0, `swatinem/rust-cache` v2.9.3, `taiki-e/install-action` v2.90.1, `tauri-apps/tauri-action` v0.6.2 and `dtolnay/rust-toolchain` on the `stable` branch (the action derives the toolchain from the ref name, and a SHA does not carry that name, so `toolchain:` is explicit). Dependabot (`.github/dependabot.yml`) opens weekly PRs for `github-actions`, `cargo` (`/src-tauri`) and `npm`, and updates the SHA together with the comment. The SHAs were checked with `gh api repos/<org>/<repo>/commits/<sha>` and `…/tags`. A test (`tools/workflows.spec.ts`) fails if an action leaves the SHA pin, loses the version comment, or if a checkout loses `persist-credentials: false`.
- **Pinned Rust toolchain.** `rust-toolchain.toml` (root) pins `1.99.1`, the stable version installed on the development machine (`rustc 1.99.1`, 2026-10-13), with `clippy` and `rustfmt`; CI and release pass `toolchain: 1.99.1` to the action and the same test requires the values to match. To bump the version, change the `channel` and the `toolchain:` values together.

To publish: bump the version in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads the version from `package.json`), and create the tag.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

> The bundle `identifier` is `com.mottu.clawdmeter`, the same name as the Keychain / Credential Manager service and the app folders (config, cache and logs). See [Migration from the old identifier](#migration-from-the-old-identifier).

### Migration from the old identifier

Up to 0.1.0 the app used the identifier `com.mottu.devpulse`. On the first launch with `com.mottu.clawdmeter` (`legacy_migration.rs`, in the Tauri `setup`, before the log and before the webview reads any config):

- **Files:** if the new config folder (`~/Library/Application Support/com.mottu.clawdmeter` on macOS, `%APPDATA%\com.mottu.clawdmeter` on Windows) does not exist or is empty and the old one (`…/com.mottu.devpulse`) exists, the top-level files of the old one (`settings.json`, `usage-history.json`, `connections.json`, `runs.json`, `skills.json` and the like; ignores `*.tmp`, hidden files and subfolders) are **copied** to a temporary folder `com.mottu.clawdmeter.migrating`, which is renamed to the new folder in one go; only then is the `.legacy-config-migrated` marker written. The old folder is not deleted. With the marker present (or the old marker inside the config folder, from earlier builds), or with the new folder already in use, nothing happens.
- **Secrets:** on the first call of `secret_get/set/delete`, each key of `ALLOWED_SECRET_KEYS` that does not exist in the `com.mottu.clawdmeter` service and exists in `com.mottu.devpulse` is read (reassembling the `dp-chunked:v1:` slices), written to the new service and then **deleted** from the old one (best effort). The `.legacy-secrets-migrated` marker prevents a second copy (a logout is not undone on the next launch). The marker is written on success and also when the Keychain refuses the read (`keychain_denied`), so a denied prompt is not shown again on every launch; any other Keychain error is retried on the next launch. An install that migrated with an older build (marker in the config folder) only gets the stale old items deleted, once. The Claude Code credential is not the app's and is not touched.
- **Markers:** both markers live in `app_data_dir()/.migration/` (on macOS the same folder as `$APPCONFIG`). A global `fs:scope` deny on `$APPDATA/.migration` and `$APPDATA/.migration/**` in `capabilities/default.json` keeps every webview `fs` command away from them, so the webview cannot rename a marker to trigger a re-import (checked by a Rust test and `tools/capabilities.spec.ts`).
- **Logs:** `popover.log` is now written to the new `app_log_dir()` (`~/Library/Logs/com.mottu.clawdmeter` on macOS); the result of the two migrations is recorded in it (`legacy-config …`, `legacy-secrets …`).
- The `dp-chunked:v1:` header of the sliced secrets is a persisted format and keeps the old name.

## Backlog

- **Automatic update.** Create the repository on GitHub (Mottu-ops), publish each version as a Release through `release.yml` (.dmg and .msi) and have the app query the latest Release with the GitHub login it already has. On detecting a newer version, show a "New version X · Update" block that downloads, checks the signature (`tauri-plugin-updater` with its own key) and installs.
