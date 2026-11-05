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

Demo mode swaps `composition-root.ts` for `composition-root.demo.ts` through Angular's `fileReplacements` (the `demo` configuration). The popover has a fixed width of 380 px in both modes.

## Demo mode: connection scenarios

`yarn dev:web` opens the app with fake adapters. The `demo` query param picks the initial state of each connection (`id:value`, comma-separated); clicking the fix buttons changes the state as in the real app. The demo opens in English; `?lang=pt-BR` or `?lang=es-MX` switches the language before boot.

```
http://127.0.0.1:4200/?demo=claude:claude-expired,github:github-org-access
http://127.0.0.1:4200/?demo=errors
```

The demo agenda uses only generic titles (Team daily, 1:1, Planning) anchored to the current time; `microsoft:microsoft-expired` and `microsoft:unexpected` exercise the page's error states.

Values: `ok` (default for Claude and notifications), `disconnected`, any `ConnectionProblem` from the table, and `github:ok` / `microsoft:ok`. `errors` turns on an error in each connection. In the demo, the `ghp_…` token is accepted as a valid PAT.

Disconnected GitHub states: `?demo=github:gh-not-installed` (GitHub CLI not found: **Install GitHub CLI**, **Sign in through the browser** and the **Paste token** link) and `?demo=github:gh-not-logged-in` (gh installed without login: **Connect GitHub CLI**, which opens Terminal with `gh auth login -h github.com -w`, then **Check again**). Without the parameter the demo starts from `gh-not-logged-in`. Under **Paste token**, the **Create token on GitHub** link opens the new token page with the `repo` and `read:org` scopes.

PRs and Reviews in the demo need GitHub connected: use `?demo=github:ok` (the repos are generic, `acme/*`). The GitHub problems (`github:github-unauthorized`, `github:github-missing-scope`, `github:github-org-access`) also show up on both pages, and the fix button resolves them. The Skills page runs a simulated run with a stream; `?demo=skills:mcp-needs-auth` and `?demo=skills:claude-code-missing` show the run problems with **Reconnect MCP** and **Install Claude Code**. Usage and Sessions show fake data (a 30-day history from a deterministic model and five sessions); `?demo=claude:claude-expired` shows the usage page error with the fix button, and `?demo=notifications:disconnected` shows the `prompt` state of notifications (it leads to the system settings).

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
│  ├─ persistence/    JsonSettingsStore, JsonConnectionPrefsStore, LocalStorageJsonFile
│  ├─ platform/       Tauri adapters (invoke, plugins): vault, Claude credential, processes, OAuth loopback, notifications
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
├─ commands/          thin platform layer: secrets, claude_credentials, process, oauth_loopback, terminal, open_external, updater
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

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads the version from `package.json`) and add the entry to `CHANGELOG.md`.
2. Create and push the tag:

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

3. When both jobs finish, check that the release has `latest.json`, the `.app.tar.gz`/`.sig` pair and the Windows installers with their `.sig`.

### Secrets of the repository

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the content of the private key file (one base64 line), e.g. `~/.tauri/clawdmeter-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key password; the current key has none, so the secret can stay unset (the workflow then passes an empty value) |

`GITHUB_TOKEN` comes from Actions. The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private key never goes into the repository.

### Signing key

The key was generated without a password:

```bash
yarn tauri signer generate --ci -p "" -w ~/.tauri/clawdmeter-updater.key
```

It writes `clawdmeter-updater.key` (private) and `clawdmeter-updater.key.pub` (public, the value of `pubkey`). Keep a backup of the private key: without it, installed apps cannot receive new versions (they only accept packages signed by the key whose public half they carry). To rotate it, publish a version with the new `pubkey` signed with the old key first; only the versions after that one can be signed with the new key.

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
