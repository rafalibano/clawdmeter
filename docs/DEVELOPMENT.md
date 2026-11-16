# Development

Guide for those who want to run, change and package ClawdMeter. To install and use it, see the [README](../README.md). Technical details in [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Prerequisites

- macOS 14 or later
- Node 22 and Yarn 1
- Rust 1.99.1 via [rustup](https://rustup.rs): the `rust-toolchain.toml` at the root pins the version, and rustup installs it on its own the first time `cargo` runs
- Xcode Command Line Tools: `xcode-select --install`

On Linux (x86_64, Ubuntu 22.04 or later, or an equivalent distribution) instead of macOS and Xcode, install the Tauri 2 system libraries plus D-Bus (for the Secret Service keyring) and xdo (for the global shortcut), the same list CI installs:

```bash
sudo apt-get install -y build-essential pkg-config file patchelf libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev
```

Running it needs a Secret Service (GNOME Keyring or KWallet) on the session bus and a tray with AppIndicator support (on GNOME, the AppIndicator extension); see the Linux section of the README. The tray only opens a menu there: use **Open panel** or Ctrl+Alt+D (X11).

## Commands

| Command | What it does |
|---|---|
| `yarn install` | installs the dependencies |
| `yarn dev:web` | Angular only, in the browser (http://127.0.0.1:4200), without Tauri, with fake adapters and `?demo=` scenarios |
| `yarn tauri dev` (or `yarn dev`) | the full app |
| `yarn lint` | ESLint, including the layer rules |
| `yarn typecheck` | `tsc` on the app and on the tests |
| `yarn test` | Vitest (domain, application, infrastructure, ui and the architecture lint) |
| `yarn build` | Angular production build in `dist/clawdmeter/browser` (required before `cargo test`) |
| `yarn build:demo` | demo mode build (`fileReplacements` to `composition-root.demo.ts`) |
| `yarn test:rust` | `cargo test` in `src-tauri` |
| `cargo clippy --all-targets -- -D warnings` | Rust lint (run in `src-tauri/`) |
| `cargo fmt --check` | Rust formatting (run in `src-tauri/`) |
| `cargo deny check` | licenses, advisories and sources of the dependencies (`src-tauri/deny.toml`) |
| `CI=true yarn tauri build --bundles app,dmg` | generates the `.dmg` in `src-tauri/target/release/bundle/dmg/` (needs the signing key, see [Local build](#local-build-with-updater-artifacts)) |

ClawdMeter runs a single instance per app identifier, and the dev build uses the same identifier as the installed app: quit the installed ClawdMeter (tray icon > **Quit ClawdMeter**) before `yarn tauri dev`, and quit the dev build before opening the installed app. Otherwise the new process only opens the popover of the one already running and exits (`second-instance` in `popover.log`).

Demo mode swaps `composition-root.ts` for `composition-root.demo.ts` through Angular's `fileReplacements` (the `demo` configuration). The popover has a fixed width of 380 px in both modes.

## Demo mode: connection scenarios

`yarn dev:web` opens the app with fake adapters. The `demo` query param picks the initial state of each connection (`id:value`, comma-separated); clicking the fix buttons changes the state as in the real app. The demo opens in English; `?lang=pt-BR` or `?lang=es-MX` switches the language before boot.

```
http://127.0.0.1:4200/?demo=claude:claude-signin-required,github:github-org-access
http://127.0.0.1:4200/?demo=errors
```

The demo agenda uses only generic titles (Team daily, 1:1, Planning) anchored to the current time; `microsoft:microsoft-expired` and `microsoft:unexpected` exercise the page's error states.

Values: `ok` (default for Claude and notifications), `disconnected`, any `ConnectionProblem` from the table, and `github:ok` / `microsoft:ok`. The demo starts with two Claude accounts (Personal and Work), so the account switch shows up on Usage; `claude:claude-signin-required` makes the first one ask for a new sign-in and `claude:claude-no-account` starts without accounts (add one in Settings > Claude accounts: the demo browser sign-in completes by itself after 2.5 s). `errors` turns on an error in each connection. In the demo, the `ghp_…` token is accepted as a valid PAT.

Disconnected GitHub states: `?demo=github:gh-not-installed` (GitHub CLI not found: **Install GitHub CLI**, **Sign in through the browser** and the **Paste token** link) and `?demo=github:gh-not-logged-in` (gh installed without login: **Connect GitHub CLI**, which opens Terminal with `gh auth login -h github.com -w`, then **Check again**). Without the parameter the demo starts from `gh-not-logged-in`. Under **Paste token**, the **Create token on GitHub** link opens the new token page with the `repo` and `read:org` scopes.

PRs and Reviews in the demo need GitHub connected: use `?demo=github:ok` (the repos are generic, `acme/*`). The GitHub problems (`github:github-unauthorized`, `github:github-missing-scope`, `github:github-org-access`) also show up on both pages, and the fix button resolves them. The Skills page runs a simulated run with a stream; `?demo=skills:mcp-needs-auth` and `?demo=skills:claude-code-missing` show the run problems with **Reconnect MCP** and **Install Claude Code**. Usage and Sessions show fake data (a 30-day history from a deterministic model and five sessions); `?demo=claude:claude-signin-required` shows the usage page error with the fix button, and `?demo=notifications:disconnected` shows the `prompt` state of notifications (it leads to the system settings).

## Structure and layers

Clean architecture. Dependencies point inward; the difference between operating systems stays in the infrastructure only.

```
ui (Angular)  ─►  application  ─►  domain
                       ▲
infrastructure ────────┘   (implements the application ports)
       │
       └─► Tauri (plugins and commands in src-tauri/)
```

```
src/
├─ domain/            pure TS: models and rules (settings, connections, usage, sessions, pull-requests, skills, calendar, ...)
├─ application/
│  ├─ ports/          interfaces that the infrastructure implements (SettingsStore, Clock, SecretStore, ...)
│  ├─ use-cases/      one file per use case, one execute() method (connections/ has the connection ones)
│  ├─ connections/    ConnectionMonitor, ConnectionRunner and createConnections (wires use cases and adapters)
│  ├─ pull-requests/  createPullRequests, GitHubSession and the data of the PRs/Reviews pages
│  ├─ skills/         createSkills and SkillRunBoard (live runs and history)
│  ├─ updates/        Updates: update check every 6 h, download with progress, install and restart
│  ├─ daily-usage/    DailyUsageHistory: state and slow timer of the Usage tab's Last days block
│  ├─ pages/          PageModule (contract) and PageRegistry
│  ├─ scheduler/      PollingScheduler: only schedules enabled pages
│  └─ testing/        fakes of the ports, used only in tests
├─ infrastructure/
│  ├─ persistence/    JsonSettingsStore, JsonConnectionPrefsStore, JsonUsageHistoryStores (one history file per Claude account), LocalStorageJsonFile
│  ├─ platform/       Tauri adapters (invoke, plugins): vault, Claude accounts (claude_oauth_* / claude_account_*), processes, OAuth loopback, notifications
│  ├─ anthropic/      AnthropicUsageGateway (command `claude_usage_fetch`: the GET /api/oauth/usage runs in Rust)
│  ├─ claude-code/    TauriSessionDirectory (reads ~/.claude/sessions through plugin-fs)
│  ├─ claude-usage-bar/  TauriClaudeUsageBarHistorySource (reads only ~/.config/claude-usage-bar/history.json)
│  ├─ github/         GhCliTokenSource, GitHubDeviceFlowAuthorizer, GitHubRestAccountGateway, GitHubGraphqlGateway
│  ├─ microsoft/      PkceMicrosoftAuthorizer (PKCE + loopback), GraphCalendarGateway
│  ├─ config/         auth-config.ts: GitHub and Microsoft client_id (placeholders)
│  ├─ updates/        TauriUpdateChecker (commands `updater_check`, `updater_install`, `updater_restart`)
│  └─ demo/           fake adapters of the demo mode, with scenarios by query param
├─ ui/
│  ├─ shell/          popover, "updated Xs ago" footer and ⚙ button
│  ├─ settings/       Settings: pages, connections, appearance
│  ├─ theme/          snapshot of the Mottu DS `--me-*` tokens, `--cm-*` vars, accent, background, light/dark/system
│  └─ pages/          one folder per page
├─ composition-root.ts        manual DI with the real (Tauri) adapters
└─ composition-root.demo.ts   DI of the demo mode in the browser (localStorage)
src-tauri/src/
├─ commands/          thin platform layer: secrets, claude_oauth, claude_usage, session_usage and daily_usage (both read transcripts through transcript), process, oauth_loopback, terminal, open_external, updater
└─ tray.rs, platform.rs   tray and popover
└─ usage_icon.rs          pure (RGBA) renderer of the tray usage icon
```

### Layer rules

1. `domain` imports nothing from outside `domain` itself.
2. `application` imports only `domain` and its own ports; no `@angular/*` and no `@tauri-apps/*`.
3. `infrastructure` implements ports; it is never imported by the `ui`.
4. The `ui` calls use cases; it never calls `fetch` (nor `window.fetch`/`globalThis.fetch`), `HttpClient` (`@angular/common/http`), `invoke` or a Tauri plugin.
5. Rules 1 to 4 are checked by `yarn lint` (`eslint-plugin-boundaries` + `no-restricted-imports`). `tools/architecture-lint.spec.ts` proves that each violation is blocked.
6. OS detection (`navigator.platform`, `window.navigator.*`, `process.platform`, `@tauri-apps/plugin-os`) only exists in the `composition-root` (`src/*.ts`) and in `src-tauri/`.

### How to add a page

1. Create `src/ui/pages/<name>/` with the component and a `PageModule`:

```ts
export const USAGE_PAGE = pageRef<UsageData>('usage');

export function createUsagePage(deps: { clock: Clock }): PageModule<UsageData> {
  return {
    id: USAGE_PAGE.id,
    title: 'Usage',
    requiredConnections: ['claude'],
    pollIntervalMs: 60_000,
    load: () => loadUsage.execute(),
    component: UsageComponent,
  };
}
```

2. Register it in `composition-root.ts` (and in `composition-root.demo.ts`, with fake adapters) by adding a line to `pages`. `pages` accepts the list directly or a function that receives `{ connections, skills }` from the application itself (the pages that report connection problems use this form). `createApplication` also receives `skills`, ready or as a function `({ connections }) => Skills` (skills notify the end of a run using the state of the notifications connection):

```ts
pages: [createUsagePage({ clock })],
```

The checkbox in Settings, the polling and the connection requirement come from the `PageRegistry`. A new data source = a port in `application/ports` + an adapter in `infrastructure/`. The component reads the typed result with `PageStateService.of(USAGE_PAGE)`; whoever subscribes to the scheduler later receives the latest result of each page, so pages without polling (`pollIntervalMs: null`) do not miss the first update.

`PageComponent` is `new () => unknown`: the component injects dependencies with `inject()`, not through the constructor.

## Publishing a version

Each tag `v*` runs `.github/workflows/release.yml`, which builds macOS (universal `.app` + `.dmg`), Windows (`.msi` + NSIS `.exe`) and Linux (`.AppImage` + `.deb` on `ubuntu-22.04`), signs the updater artifacts and publishes the release with `latest.json`. Installed apps find it on the next check (at most 6 h, or **Check now**).

The release goes out only when every platform passed. The workflow has no default permissions (`permissions: {}`); each job that writes gets `contents: write`, and one run per tag at a time (`concurrency`, without cancelling the running one).

- **`draft`** (no environment, no secrets) refuses a tag that already has a published release: running again would replace files under the `latest.json` installed apps read. Otherwise it reuses the draft of a previous run of the same tag, or creates one, and passes its id to the next jobs.
- **`release`** (one job per platform, `fail-fast: false`, environment `release`) builds and runs `tauri-action` with `releaseId` (so it uploads to that draft and never looks a release up by tag) and `includeUpdaterJson: false`. Each job only uploads its files and their `.sig`; no build job touches `latest.json`, so the two cannot overwrite each other's entries.
- **`publish`** (environment `release`) runs only if every build job passed. It downloads the draft's `.sig` files and builds `latest.json` once with `tools/release/latest-json.mjs`: version = the tag without `v`, the same `notes` as the release, `pub_date`, and the same seven platforms as v0.2.2 (`windows-x86_64` = the NSIS `.exe`, as with `updaterJsonPreferNsis`; `windows-x86_64-nsis`; `windows-x86_64-msi`; `darwin-aarch64`, `darwin-x86_64`, `darwin-aarch64-app`, `darwin-x86_64-app` = the universal `.app.tar.gz`) plus `linux-x86_64-appimage` = the `.AppImage`, each with the `/releases/download/<tag>/<asset>` URL and the `.sig` content as signature. It refuses a release without exactly one package of each kind, a Windows or Linux package of another version, or a `.sig` whose signed version (the `version:` in the minisign trusted comment) is not the tag's. It uploads `latest.json` to the draft (replacing one left by a previous run), then publishes the draft (by id, `make_latest=legacy`). Installed apps only see published releases, so nothing reaches them before that. `tools/release/latest-json.spec.ts` rebuilds the published v0.2.2 `latest.json` from its asset names and `.sig` files, with the same keys, order and values, plus the Linux entry. There is deliberately no plain `linux-x86_64` key: `tauri-plugin-updater` falls back to it for a `.deb` install (after `linux-x86_64-deb`), which would download the AppImage and hand it to `dpkg`; without it the `.deb` reads as up to date and is updated by hand.

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads the version from `package.json`) and add the entry to `CHANGELOG.md`. Merge it before tagging: the workflow fails when the tag is not `v` + that version, because the updater compares the version inside `latest.json`, not the tag.
2. Create and push the tag on the merged commit:

   ```bash
   git tag v0.2.1 && git push origin v0.2.1
   ```

3. When the `publish` job finishes, the release is public. Check that it has `latest.json`, the `.app.tar.gz`/`.sig` pair, the Windows installers with their `.sig` and the `.AppImage`/`.sig` pair plus the `.deb`.

**When the release stays a draft.** If a build job or `publish` fails, the draft stays on the Releases page, visible only to maintainers, and installed apps keep the previous version. Fix the cause (for example the missing certificate secrets, whose error names them) and re-run the failed jobs (or all of them): `draft` reuses the same draft, a rebuilt platform replaces its files and `.sig`, and `publish` builds `latest.json` again from what is in the draft. If the fix needs a new commit, delete the draft (`gh release delete v0.2.1 --yes`) and the tag (`git push origin :refs/tags/v0.2.1`) and tag again. Once a release is published, running its workflow again stops at `draft`; publish a new version instead.

### Secrets of the repository

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the content of the private key file (one base64 line), e.g. `~/.tauri/clawdmeter-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key password; the current key has none, so the secret can stay unset (the workflow then passes an empty value) |
| `APPLE_CERTIFICATE` | the macOS code signing certificate and its private key, as one base64 line of the `.p12` (see [macOS signing certificate](#macos-signing-certificate)) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |

All of them are secrets of the `release` environment, the one the release job runs in. `GITHUB_TOKEN` comes from Actions. The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private keys never go into the repository.

### Signing key

The key was generated without a password:

```bash
yarn tauri signer generate --ci -p "" -w ~/.tauri/clawdmeter-updater.key
```

It writes `clawdmeter-updater.key` (private) and `clawdmeter-updater.key.pub` (public, the value of `pubkey`). Keep a backup of the private key: without it, installed apps cannot receive new versions (they only accept packages signed by the key whose public half they carry). To rotate it, publish a version with the new `pubkey` signed with the old key first; only the versions after that one can be signed with the new key.

### macOS signing certificate

The macOS release is signed with a self-signed certificate of our own, `ClawdMeter Self-Signed`, the same in every version. The Keychain remembers **Always Allow** by the app's designated requirement; with an ad hoc signature that requirement is the hash of the build (`cdhash H"…"`), so every update looked like another app and macOS asked for the login password again. Signed by the certificate, the requirement becomes `identifier "com.mottu.clawdmeter" and certificate leaf = H"<SHA-1 of the certificate>"`, which does not change between versions. It is not an Apple certificate: Gatekeeper still refuses the downloaded app and the `xattr` step of the README stays. A Developer ID (Apple Developer Program, US$ 99/year, plus notarization) would remove that step too; the workflow would then take the Apple certificate in the same two secrets, its name in `APPLE_SIGNING_IDENTITY`, plus the notarization variables.

Create it once, on a Mac, and save it in the `release` environment:

```bash
tools/macos-signing/create-certificate.sh
```

The script builds everything in a temporary directory and only moves the files into place at the end, so a failed run leaves nothing behind. It only writes local files, in `~/.tauri/clawdmeter-macos-signing/` (or the directory given as its argument, which cannot be inside the repository), with `600` permissions (and `700` on the directory when the script creates it): `certificate.p12` (certificate and private key), `certificate.p12.base64`, `certificate-password.txt` (a random password) and `certificate.pem` (the public certificate). It uses `/usr/bin/openssl` (RSA 3072, valid for 10 years, Extended Key Usage = Code Signing, the `.p12` in the format `security import` reads), never prints the key or the password, adds nothing to your Keychain and refuses to overwrite an existing certificate. At the end it prints the commands to run from the clawdmeter checkout:

```bash
gh secret set APPLE_CERTIFICATE --env release < ~/.tauri/clawdmeter-macos-signing/certificate.p12.base64
gh secret set APPLE_CERTIFICATE_PASSWORD --env release < ~/.tauri/clawdmeter-macos-signing/certificate-password.txt
```

Keep a backup of `certificate.p12` and `certificate-password.txt` (a password manager); the other two files can be recreated from them.

**In the release job (macOS only).** Right before `tauri-action` (after `yarn install`, so dependency install scripts never run with the keychain unlocked), a step checks the two secrets and stops the job with an error naming the missing ones, so a release never goes out ad hoc again by accident (the release stays a draft, see above). It decodes the `.p12` into a keychain of its own under `$RUNNER_TEMP` (random password, added to the search list), imports the private key as non-extractable (`security import -x`), checks that it holds exactly one code signing identity named `ClawdMeter Self-Signed` and exports `APPLE_SIGNING_IDENTITY`. The name is a fixed value in the workflow, not a secret: Actions masks secret values in the logs, which would hide it in the `Authority=` line. The Tauri CLI reads `APPLE_SIGNING_IDENTITY`, which overrides `signingIdentity: "-"` from `tauri.conf.json`, and signs with `codesign --options runtime` as before (hardened runtime, no entitlements). `APPLE_CERTIFICATE` is deliberately not passed to `tauri-action`: the Tauri CLI's own import only recognizes certificates whose name starts with an Apple prefix (`Developer ID Application:`, `Apple Development:`, …) and stops with "failed to resolve signing identity" on a self-signed one, so the import is the step above, the same one in tauri-action's signing example. After the build, a step checks that the `.app` says `Authority=ClawdMeter Self-Signed` (before `publish`, so a wrong signature keeps the release a draft) and the keychain is deleted at the end, even on failure. Windows does not use any of this.

**Local builds** keep the ad hoc signature (`signingIdentity: "-"`): nothing in `tauri.conf.json` needs the certificate.

**The first update.** The Keychain items saved by ad hoc versions trust only the cdhash of the build that saved them, so the first version signed by the certificate still asks for the password once per item (click **Always Allow**); from then on the requirement stays the same and updates no longer ask. To check an installed app:

```bash
codesign -dv --verbose=4 /Applications/ClawdMeter.app 2>&1 | grep -E '^(Authority|Identifier|TeamIdentifier)'
codesign -d -r- /Applications/ClawdMeter.app
```

The first shows `Authority=ClawdMeter Self-Signed` (and `TeamIdentifier=not set`); the second shows the designated requirement, which must be the same line in every version.

**Renewal.** The certificate lasts 10 years. A new certificate means a new requirement, so the update that brings it asks for the password once more, like the first one. To renew, move the old files away, run the script again, run the two `gh secret set` again and say it in the `CHANGELOG.md` of that version.

**If the certificate leaks.** Whoever holds the `.p12` and its password can sign an app that the Keychain treats as ClawdMeter and read its items (the Claude tokens, the GitHub token, the Microsoft refresh token) without asking, on any Mac where ClawdMeter got **Always Allow**; they still need to put that app on the Mac. The updater does not trust it: updates are accepted only with the minisign signature. What to do: generate a new certificate, replace the two secrets, publish a version right away (users will be asked for the password once), and tell users to sign in to Claude again, remove and add the GitHub token and reconnect Microsoft, so the tokens the old certificate could read stop working. Revoke the GitHub tokens you can on github.com.

### Local build with updater artifacts

`bundle.createUpdaterArtifacts` is `true`, so `yarn tauri build` asks for the private key:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/clawdmeter-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
CI=true yarn tauri build --bundles app,dmg
```

Without the key, skip the updater artifacts: `CI=true yarn tauri build --bundles dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'` (on Linux, `--bundles appimage,deb`).

### Linux beta packages from a PR

The `ubuntu-22.04` job of `ci.yml` builds the `.AppImage` and `.deb` of every PR without updater signatures (PRs have no access to the `release` environment) and uploads them as the `clawdmeter-linux-x86_64` artifact, kept 30 days. Download it from the run's **Summary** page, or with `gh run download <run-id> -n clawdmeter-linux-x86_64`. They carry the version in `package.json` and the same updater public key, so an AppImage from a PR updates itself to the next signed release like a released one.

### Repository of the releases

The app reads the releases of `RELEASE_REPOSITORY` in `src-tauri/src/commands/updater.rs` (today `rafalibano/clawdmeter`). When the repository moves to `Mottu-ops/clawdmeter`, change that constant and publish a version; versions installed before it keep asking the old name, which GitHub redirects while the redirect exists (the client follows redirects inside `api.github.com` with the token).

### Demo scenarios of the updates

`?demo=update:available` shows the "New version 0.2.0 · Update" bar and simulates download, install and restart; also `update:latest`, `update:no-access`, `update:rate-limited`, `update:error` and `update:install-error`. Any `update:` value connects the demo GitHub, unless `github:` is given.
