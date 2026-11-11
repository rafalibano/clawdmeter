# Development

Guide for those who want to run, change and package ClawdMeter. To install and use it, see the [README](../README.md). Technical details in [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Prerequisites

- macOS 14 or later
- Node 22 and Yarn 1
- Rust 1.99.1 via [rustup](https://rustup.rs): the `rust-toolchain.toml` at the root pins the version, and rustup installs it on its own the first time `cargo` runs
- Xcode Command Line Tools: `xcode-select --install`

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
├─ commands/          thin platform layer: secrets, claude_oauth, claude_usage, process, oauth_loopback, terminal, open_external, updater
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

Each tag `v*` runs `.github/workflows/release.yml`, which builds macOS (universal `.app` + `.dmg`) and Windows (`.msi` + NSIS `.exe`), signs the updater artifacts and publishes the release (not as a draft) with `latest.json`. Installed apps find it on the next check (at most 6 h, or **Check now**).

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads the version from `package.json`) and add the entry to `CHANGELOG.md`. Merge it before tagging: the workflow fails when the tag is not `v` + that version, because the updater compares the version inside `latest.json`, not the tag.
2. Create and push the tag on the merged commit:

   ```bash
   git tag v0.2.1 && git push origin v0.2.1
   ```

3. When both jobs finish, check that the release has `latest.json`, the `.app.tar.gz`/`.sig` pair and the Windows installers with their `.sig`.

### Secrets of the repository

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the content of the private key file (one base64 line), e.g. `~/.tauri/clawdmeter-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key password; the current key has none, so the secret can stay unset (the workflow then passes an empty value) |
| `APPLE_CERTIFICATE` | the macOS code signing certificate and its private key, as one base64 line of the `.p12` (see [macOS signing certificate](#macos-signing-certificate)) |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_SIGNING_IDENTITY` | the certificate name, `ClawdMeter Self-Signed` |

All of them are secrets of the `release` environment, the one the release job runs in. `GITHUB_TOKEN` comes from Actions. The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private keys never go into the repository.

### Signing key

The key was generated without a password:

```bash
yarn tauri signer generate --ci -p "" -w ~/.tauri/clawdmeter-updater.key
```

It writes `clawdmeter-updater.key` (private) and `clawdmeter-updater.key.pub` (public, the value of `pubkey`). Keep a backup of the private key: without it, installed apps cannot receive new versions (they only accept packages signed by the key whose public half they carry). To rotate it, publish a version with the new `pubkey` signed with the old key first; only the versions after that one can be signed with the new key.

### macOS signing certificate

The macOS release is signed with a self-signed certificate of our own, `ClawdMeter Self-Signed`, the same in every version. The Keychain remembers **Always Allow** by the app's designated requirement; with an ad hoc signature that requirement is the hash of the build (`cdhash H"…"`), so every update looked like another app and macOS asked for the login password again. Signed by the certificate, the requirement becomes `identifier "com.mottu.clawdmeter" and certificate leaf = H"<SHA-1 of the certificate>"`, which does not change between versions. It is not an Apple certificate: Gatekeeper still refuses the downloaded app and the `xattr` step of the README stays. A Developer ID (Apple Developer Program, US$ 99/year, plus notarization) would remove that step too; the workflow would then take the Apple certificate in the same three secrets, plus the notarization variables.

Create it once, on a Mac, and save it in the `release` environment:

```bash
tools/macos-signing/create-certificate.sh
```

The script only writes local files, in `~/.tauri/clawdmeter-macos-signing/` (or the directory given as its argument, which cannot be inside the repository), with `700`/`600` permissions: `certificate.p12` (certificate and private key), `certificate.p12.base64`, `certificate-password.txt` (a random password) and `certificate.pem` (the public certificate). It uses `/usr/bin/openssl` (RSA 3072, valid for 10 years, Extended Key Usage = Code Signing, the `.p12` in the format `security import` reads), never prints the key or the password, adds nothing to your Keychain and refuses to overwrite an existing certificate. At the end it prints the commands to run from the clawdmeter checkout:

```bash
gh secret set APPLE_CERTIFICATE --env release < ~/.tauri/clawdmeter-macos-signing/certificate.p12.base64
gh secret set APPLE_CERTIFICATE_PASSWORD --env release < ~/.tauri/clawdmeter-macos-signing/certificate-password.txt
gh secret set APPLE_SIGNING_IDENTITY --env release --body "ClawdMeter Self-Signed"
```

Keep a backup of `certificate.p12` and `certificate-password.txt` (a password manager); the other two files can be recreated from them.

**In the release job (macOS only).** Before the build, a step checks the three secrets and stops the release with an error naming the missing ones, so a release never goes out ad hoc again by accident. It decodes the `.p12` into a keychain of its own under `$RUNNER_TEMP` (random password, added to the search list), checks that it holds exactly one code signing identity with the name in `APPLE_SIGNING_IDENTITY` and exports that name. The Tauri CLI reads `APPLE_SIGNING_IDENTITY`, which overrides `signingIdentity: "-"` from `tauri.conf.json`, and signs with `codesign --options runtime` as before (hardened runtime, no entitlements). `APPLE_CERTIFICATE` is deliberately not passed to `tauri-action`: the Tauri CLI's own import only recognizes certificates whose name starts with an Apple prefix (`Developer ID Application:`, `Apple Development:`, …) and stops with "failed to resolve signing identity" on a self-signed one, so the import is the step above, the same one in tauri-action's signing example. After the build, a step checks that the `.app` says `Authority=ClawdMeter Self-Signed` (this runs after the release is published: if it fails, delete the release and its tag) and the keychain is deleted at the end, even on failure. Windows does not use any of this.

**Local builds** keep the ad hoc signature (`signingIdentity: "-"`): nothing in `tauri.conf.json` needs the certificate.

**The first update.** The Keychain items saved by ad hoc versions trust only the cdhash of the build that saved them, so the first version signed by the certificate still asks for the password once per item (click **Always Allow**); from then on the requirement stays the same and updates no longer ask. To check an installed app:

```bash
codesign -dv --verbose=4 /Applications/ClawdMeter.app 2>&1 | grep -E '^(Authority|Identifier|TeamIdentifier)'
codesign -d -r- /Applications/ClawdMeter.app
```

The first shows `Authority=ClawdMeter Self-Signed` (and `TeamIdentifier=not set`); the second shows the designated requirement, which must be the same line in every version.

**Renewal.** The certificate lasts 10 years. A new certificate means a new requirement, so the update that brings it asks for the password once more, like the first one. To renew, move the old files away, run the script again, run the three `gh secret set` again and say it in the `CHANGELOG.md` of that version.

**If the certificate leaks.** Whoever holds the `.p12` and its password can sign an app that the Keychain treats as ClawdMeter and read its items (the Claude tokens, the GitHub token, the Microsoft refresh token) without asking, on any Mac where ClawdMeter got **Always Allow**; they still need to put that app on the Mac. The updater does not trust it: updates are accepted only with the minisign signature. What to do: generate a new certificate, replace the three secrets, publish a version right away (users will be asked for the password once), and tell users to sign in to Claude again, remove and add the GitHub token and reconnect Microsoft, so the tokens the old certificate could read stop working. Revoke the GitHub tokens you can on github.com.

### Local build with updater artifacts

`bundle.createUpdaterArtifacts` is `true`, so `yarn tauri build` asks for the private key:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/clawdmeter-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
CI=true yarn tauri build --bundles app,dmg
```

Without the key, skip the updater artifacts: `CI=true yarn tauri build --bundles dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'`.

### Repository of the releases

The app reads the releases of `RELEASE_REPOSITORY` in `src-tauri/src/commands/updater.rs` (today `rafalibano/clawdmeter`). When the repository moves to `Mottu-ops/clawdmeter`, change that constant and publish a version; versions installed before it keep asking the old name, which GitHub redirects while the redirect exists (the client follows redirects inside `api.github.com` with the token).

### Demo scenarios of the updates

`?demo=update:available` shows the "New version 0.2.0 · Update" bar and simulates download, install and restart; also `update:latest`, `update:no-access`, `update:rate-limited`, `update:error` and `update:install-error`. Any `update:` value connects the demo GitHub, unless `github:` is given.
