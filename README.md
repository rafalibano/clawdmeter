# Dev Pulse

App de bandeja para macOS e Windows. No macOS fica na barra de menu; no Windows, na área de notificação. Um clique no ícone abre um popover com as páginas ligadas (hoje: Claude usage, Sessões, Agenda e uma página de exemplo; PRs, Reviews e Skills entram nas próximas fases).

Stack: Tauri 2 (Rust só na camada de plataforma), TypeScript, Angular 19 (standalone + signals).

## Arquitetura

Clean architecture. As dependências apontam para dentro; a diferença entre SOs fica só na infraestrutura.

```
ui (Angular)  ─►  application  ─►  domain
                       ▲
infrastructure ────────┘   (implementa as portas da application)
       │
       └─► Tauri (plugins e commands em src-tauri/)
```

```
src/
├─ domain/            TS puro: modelos e regras (settings, connections, calendar, ...)
├─ application/
│  ├─ ports/          interfaces que a infraestrutura implementa (SettingsStore, Clock, SecretStore, ...)
│  ├─ use-cases/      um arquivo por caso de uso, um método execute() (connections/ tem os de conexão)
│  ├─ connections/    ConnectionMonitor, ConnectionRunner e createConnections (liga casos de uso e adapters)
│  ├─ pages/          PageModule (contrato) e PageRegistry
│  ├─ scheduler/      PollingScheduler: só agenda páginas ligadas
│  └─ testing/        fakes das portas, usados só nos testes
├─ infrastructure/
│  ├─ persistence/    JsonSettingsStore, JsonConnectionPrefsStore, LocalStorageJsonFile
│  ├─ platform/       adapters Tauri (invoke, plugins): cofre, credencial do Claude, processos, loopback OAuth, notificações
│  ├─ anthropic/      AnthropicUsageGateway (GET /api/oauth/usage)
│  ├─ claude-code/    TauriSessionDirectory (lê ~/.claude/sessions via plugin-fs)
│  ├─ github/         GhCliTokenSource, GitHubDeviceFlowAuthorizer, GitHubRestAccountGateway
│  ├─ microsoft/      PkceMicrosoftAuthorizer (PKCE + loopback), GraphCalendarGateway
│  ├─ config/         auth-config.ts: client_id do GitHub e da Microsoft (placeholders)
│  └─ demo/           adapters fakes do modo demo, com cenários por query param
├─ ui/
│  ├─ shell/          popover, rodapé "atualizado há Xs" e botão ⚙
│  ├─ settings/       Ajustes: páginas, conexões, aparência
│  ├─ theme/          tokens CSS: destaque, fundo, claro/escuro/sistema
│  └─ pages/          uma pasta por página
├─ composition-root.ts        DI manual com os adapters reais (Tauri)
└─ composition-root.demo.ts   DI do modo demo no navegador (localStorage)
src-tauri/src/
├─ commands/          camada fina de plataforma: secrets, claude_credentials, process, oauth_loopback, terminal, open_external
└─ tray.rs, platform.rs   bandeja e popover
```

### Regras de camada

1. `domain` não importa nada de fora do próprio `domain`.
2. `application` importa só `domain` e as próprias portas; sem `@angular/*` e sem `@tauri-apps/*`.
3. `infrastructure` implementa portas; nunca é importada pela `ui`.
4. A `ui` chama casos de uso; nunca chama `fetch` (nem `window.fetch`/`globalThis.fetch`), `HttpClient` (`@angular/common/http`), `invoke` ou plugin do Tauri.
5. As regras 1 a 4 são verificadas pelo `yarn lint` (`eslint-plugin-boundaries` + `no-restricted-imports`). `tools/architecture-lint.spec.ts` prova que cada violação é barrada.
6. Detecção de SO (`navigator.platform`, `window.navigator.*`, `process.platform`, `@tauri-apps/plugin-os`) só existe no `composition-root` (`src/*.ts`) e em `src-tauri/`.

### Como adicionar uma página

1. Crie `src/ui/pages/<nome>/` com o componente e um `PageModule`:

```ts
export const USAGE_PAGE = pageRef<UsageData>('usage');

export function createUsagePage(deps: { clock: Clock }): PageModule<UsageData> {
  return {
    id: USAGE_PAGE.id,
    title: 'Claude usage',
    requiredConnections: ['claude'],
    pollIntervalMs: 60_000,
    load: () => loadUsage.execute(),
    component: UsageComponent,
  };
}
```

2. Registre em `composition-root.ts` (e em `composition-root.demo.ts`, com adapters fakes) adicionando uma linha em `pages`. `pages` aceita a lista direta ou uma função que recebe `{ connections }` da própria aplicação (as páginas que reportam problema de conexão usam essa forma):

```ts
pages: [createExamplePage({ clock }), createUsagePage({ clock })],
```

Checkbox em Ajustes, polling e exigência de conexão saem do `PageRegistry`. Fonte de dado nova = uma porta em `application/ports` + um adapter em `infrastructure/`. O componente lê o resultado tipado com `PageStateService.of(USAGE_PAGE)`; quem assina o scheduler depois recebe o último resultado de cada página, então páginas sem polling (`pollIntervalMs: null`) não perdem o primeiro update.

`PageComponent` é `new () => unknown`: o componente injeta dependências com `inject()`, não pelo construtor.

### Ajustes

O botão ⚙ no canto inferior direito é o único acesso. Páginas (checkboxes geradas do registry), aparência (cor de destaque e fundo do popover por paleta de presets ou hex digitado; tema claro/escuro/sistema) valem na hora via CSS custom properties e são gravadas em `settings.json` na pasta de config do SO (`appConfigDir`):

| SO | Caminho |
|---|---|
| macOS | `~/Library/Application Support/com.mottu.devpulse/settings.json` |
| Windows | `%APPDATA%\com.mottu.devpulse\settings.json` |

O arquivo tem `schemaVersion`; versões antigas são migradas e regravadas na leitura, e versões futuras nunca são regravadas no boot (sem downgrade). Editar o arquivo à mão com o app aberto recarrega as configurações.

Um `settings.json` com JSON inválido nunca é sobrescrito: o app usa o último estado válido em memória (ou os padrões, se o boot já o encontrou quebrado) e só grava os padrões quando o arquivo não existe. Enquanto o arquivo estiver quebrado, os ajustes feitos na UI valem na sessão mas não são persistidos; ao corrigir o arquivo, o app recarrega o conteúdo do disco. Falha de leitura ou gravação aparece como aviso no topo do popover.

O seletor de cor nativo (`<input type="color">`) é proibido na `ui`: ele abre numa janela separada e o popover se fecha por perder o foco. O lint de arquitetura barra o uso.

### Conexões

Ajustes tem uma seção **Conexões** com as conexões exigidas pelas páginas ligadas (`PageModule.requiredConnections`). Cada uma tem status e o botão de conserto do estado atual; toda conexão desconectável tem **Desconectar**.

| Situação (`ConnectionProblem`) | Botão |
|---|---|
| `keychain-denied` | Refazer permissão |
| `claude-expired` (401 ou token vencido) | Refazer login do Claude (abre o Terminal com `claude /login`) |
| `claude-code-missing` | Instalar Claude Code |
| `github-unauthorized` | Refazer login do GitHub |
| `github-missing-scope` | Refazer permissões |
| `github-org-access` (SSO pendente) | Autorizar na org (abre a URL de SSO enviada pelo GitHub no header `x-github-sso`, só se for https em github.com) |
| `github-not-member` | Abrir página da org |
| `microsoft-expired` | Refazer login da Microsoft |
| `notifications-blocked` | Abrir ajustes do sistema |
| `notifications-unverifiable` (SO sem como informar) | Abrir ajustes do sistema (a linha mostra "Não verificável", nunca "Conectado") |
| `unexpected` (rede etc.) | Tentar de novo |

- **Claude:** lê a credencial do Claude Code (Keychain `Claude Code-credentials` no macOS; `~/.claude/.credentials.json` como fallback e no Windows). O Rust devolve só `accessToken`, `expiresAt` e o plano; o refresh token nunca sai do Rust e o app nunca faz refresh. Desconectar só para de usar a credencial, não apaga nada do Claude Code.
- **GitHub:** `gh auth token` (o token não é copiado) → Device Flow → PAT colado (os dois últimos ficam no cofre do SO). A validação confere escopos (`repo`, `read:org`) e o acesso à org `Mottu-ops`.
- **Microsoft:** PKCE com listener em `127.0.0.1` (porta efêmera); o refresh token fica no cofre do SO. Escopos delegados `Calendars.Read` + `offline_access`; nenhum client secret.
- **Notificações:** o plugin do Tauri sempre devolve `granted` no desktop, então o estado vem do command `notification_permission_state` (macOS: `UNUserNotificationCenter`, só no app empacotado; Windows: `ToastNotifier.Setting`; fora disso `unknown`). Bloqueada leva aos ajustes do SO.
- **Device Flow do GitHub:** tem botão Cancelar (`AbortSignal`); abrir "Colar token" também cancela o polling.
- Preferências não secretas (método do GitHub, conta Microsoft, Claude ligado) ficam em `connections.json` ao lado do `settings.json`.

`client_id` do GitHub OAuth App e do Entra ID são placeholders em `src/infrastructure/config/auth-config.ts` (`REPLACE_WITH_…`); enquanto forem placeholders, Device Flow e login Microsoft falham com estado `unexpected` explicando o que falta. Um 401 de gateway (ex.: Claude usage) marca a conexão com `connections.report.execute(id, problem)`.

#### Commands Rust (`src-tauri/src/commands`)

Cada command tem permissão própria (`allow-<nome>` em `capabilities/default.json`, declarados em `build.rs`). Erros chegam ao TS como `{ kind, message }` e viram `ConnectionProblemError` (`keychain_denied`, `claude_code_missing`) ou `PlatformCommandError`.

| Módulo | Commands | Observações |
|---|---|---|
| `secrets` | `secret_get/set/delete` | crate `keyring` (Keychain / Credential Manager), service `com.mottu.devpulse`; segredos acima de 1200 bytes são fatiados em `<key>`, `<key>#1`… (o Credential Manager limita o blob a 2560 bytes) |
| `claude_credentials` | `claude_credentials_read` | só leitura |
| `process` | `process_run/spawn/kill/is_alive` | só `claude` e `gh`, com argumentos validados por programa (`process_policy.rs`): `gh auth token [-h github.com]`; `claude -p <prompt> --output-format stream-json --max-budget-usd <n> [--allowedTools <lista>]`, `--resume <uuid>` e `/login`, sem `--dangerously-skip-permissions`, `--permission-mode`, `--add-dir` e `--mcp-config`; `cwd` só a pasta do usuário ou subpastas; timeout encerra o grupo; `kill` só de filhos do app; eventos `process-output` e `process-exit` |
| `oauth_loopback` | `oauth_loopback_listen/wait/cancel` | valida `state`, timeout, página de retorno local |
| `terminal` | `terminal_run` | `claude`/`gh` com a mesma política por programa (`gh auth login/refresh`) e argumentos sem metacaracteres de shell; no Windows abre na pasta do usuário |
| `notification_permission` | `notification_permission_state` | `granted`, `denied`, `prompt` ou `unknown` |
| `open_external` | `open_url`, `open_system_settings` | só `https` e painéis conhecidos |

O acesso HTTP ao GitHub e à Microsoft passa pelo `tauri-plugin-http` (evita CORS do WebView), com allowlist de URLs na capability.

### Página Agenda

Reuniões de hoje do Outlook/Teams, ligada à conexão Microsoft, com poll de 5 min.

- Fonte: `GET https://graph.microsoft.com/v1.0/me/calendarView` (permissão delegada) com `startDateTime`/`endDateTime` do dia em `America/Sao_Paulo`, header `Prefer: outlook.timezone="America/Sao_Paulo"`, `$select`, `$orderby=start/dateTime`, `$top=50` e paginação por `@odata.nextLink` (só segue links do próprio `graph.microsoft.com`; máximo de 10 páginas).
- Regras de dia, fuso, "agora" e "próxima" ficam em `src/domain/calendar` (testadas: virada de dia, horário de verão, dia inteiro, cancelada, reunião que atravessa a meia-noite).
- Canceladas aparecem riscadas e nunca contam como "agora" nem "próxima"; eventos de dia inteiro ficam numa lista própria.
- **Entrar** abre `onlineMeeting.joinUrl` pelo `OpenUrl`, só se for `https` em `teams.microsoft.com` ou `teams.live.com` (validado em `teamsJoinUrl`, no mapeamento do Graph e de novo no caso de uso `JoinMeeting`).
- 401/403 do Graph ou token vencido viram `microsoft-expired`: a página mostra o aviso e o botão "Refazer login da Microsoft"; depois do conserto ela recarrega na hora (`PollingScheduler.refresh`).
- A allowlist do `plugin-http` e o `connect-src` do CSP incluem `https://graph.microsoft.com`.

### Modo demo: cenários de conexão

`yarn dev:web` abre o app com adapters fakes. O query param `demo` escolhe o estado inicial de cada conexão (`id:valor`, separados por vírgula); clicar nos botões de conserto muda o estado como no app real.

```
http://127.0.0.1:4200/?demo=claude:claude-expired,github:github-org-access
http://127.0.0.1:4200/?demo=errors
```

A agenda do demo usa só títulos genéricos (Daily do time, 1:1, Planejamento) ancorados no horário atual; `microsoft:microsoft-expired` e `microsoft:unexpected` exercitam os estados de erro da página.

Valores: `ok` (padrão do Claude e das notificações), `disconnected`, qualquer `ConnectionProblem` da tabela, e `github:ok` / `microsoft:ok`. `errors` liga um erro em cada conexão. No demo, o token `ghp_…` é aceito como PAT válido.

## Comandos

Pré-requisitos: Node 22, Yarn 1, Rust estável (`rustup`).

| Comando | O que faz |
|---|---|
| `yarn install` | instala as dependências |
| `yarn dev:web` | só o Angular no navegador (http://127.0.0.1:4200), sem Tauri, com adapters fakes |
| `yarn dev` | app completo (`tauri dev`) |
| `yarn lint` | ESLint, incluindo as regras de camada |
| `yarn typecheck` | `tsc` no app e nos testes |
| `yarn test` | Vitest (domain, application, infrastructure, ui e o lint de arquitetura) |
| `yarn test:rust` | `cargo test` em `src-tauri` (exige `yarn build` antes) |
| `yarn build` | build de produção do Angular em `dist/dev-pulse/browser` |
| `yarn tauri build` | gera os instaladores do SO atual |

O modo demo troca `composition-root.ts` por `composition-root.demo.ts` por `fileReplacements` do Angular (configuração `demo`). O popover tem largura fixa de 380 px nos dois modos.

## Build e release

- `.github/workflows/ci.yml`: em push na `main` e em PR, roda lint, typecheck, Vitest, build e `cargo test` em `macos-latest` e `windows-latest`.
- `.github/workflows/release.yml`: em tag `v*`, gera `.dmg` universal (arm64 + x64, macOS 14+) e `.msi` (Windows 10+) com `tauri-apps/tauri-action` e anexa a um release em rascunho.

Para publicar: ajuste a versão em `package.json` e `src-tauri/Cargo.toml` (o `tauri.conf.json` lê a versão do `package.json`), e crie a tag.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Instalação

Os instaladores ainda não são assinados (sem Apple Developer ID e sem Authenticode), então os sistemas mostram um aviso na primeira abertura.

### macOS (14 ou superior)

1. Abra o `.dmg` e arraste **Dev Pulse** para Aplicativos.
2. Na primeira abertura, o Gatekeeper bloqueia o app. Abra **Ajustes do Sistema > Privacidade e Segurança** e clique em **Abrir Mesmo Assim**; ou rode:

```bash
xattr -dr com.apple.quarantine "/Applications/Dev Pulse.app"
```

3. O ícone aparece na barra de menu. O app não aparece no Dock. Clique com o botão direito no ícone para sair.

### Windows (10 ou superior)

1. Execute o `.msi`.
2. O SmartScreen avisa "O Windows protegeu seu computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O ícone aparece na área de notificação (pode estar em "Mostrar ícones ocultos"). O app não aparece na barra de tarefas. Clique com o botão direito no ícone para sair.

## Limitações conhecidas

- Sem assinatura de código (macOS e Windows) e sem updater. No macOS o bundle usa assinatura ad-hoc (`signingIdentity: "-"`), que não substitui o Developer ID.
- A CSP do app (`src-tauri/tauri.conf.json`) só libera `self` e IPC; hosts de API das próximas fases precisam entrar em `connect-src`. Não foi validada rodando o app Tauri.
- O comportamento no Windows (posição do popover, ocultar ao perder o foco) não foi validado em máquina Windows; o CI só compila e roda testes.

### Claude usage

Página `usage` (poll de 60 s, exige a conexão Claude). `LoadUsage` lê o access token do Claude Code pela `ClaudeCredentialSource` e chama `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) por `AnthropicUsageGateway`; o app nunca faz refresh. Token vencido ou 401 vira `claude-expired` na conexão Claude e a página mostra "Refazer login do Claude". Os campos lidos são `five_hour` e `seven_day` (`utilization`, `resets_at`); o parse ignora campos extras e janelas sem `utilization` válida.

- **Histórico:** `usage-history.json` ao lado do `settings.json`. Pontos brutos por 7 dias; do 8º ao 30º dia, agregados em baldes de 15 min pelo máximo; nada passa de 30 dias (`domain/usage/retention.ts`). Arquivo ilegível recomeça vazio.
- **Gráficos:** ECharts via `ngx-echarts` (carregado sob demanda, fora do bundle inicial), uma série para a janela de 5 h e outra para a semanal, com marca em 100% e em "agora". Seletor `1h · 12h · 1d · 7d · 30d` comum aos dois.
- **Tendência e previsão:** regressão linear dos pontos do ciclo atual (janela de 1 h no 5 h e de 24 h no semanal), desenhada tracejada a partir do último ponto real até o `resets_at` (cortada na borda do eixo ou em 100%). A previsão aparece em linha separada: `Previsão no reset (17:00): ~78%` ou `100% · estoura às 15:40, 1h20 antes`; com menos de 3 pontos no ciclo, `Previsão: coletando dados…`. Um reset (queda de utilização ou mudança de `resets_at`) abre um ciclo novo e a regressão ignora os pontos anteriores (`domain/usage/forecast.ts`).

### Sessões

Página `sessions` (poll de 5 s, sem conexão). `TauriSessionDirectory` lê `<home>/.claude/sessions/*.json` (`homeDir()` do Tauri: `~` no macOS, `%USERPROFILE%` no Windows) e `LoadSessions` mantém só os pids vivos (`process_is_alive`, command Rust da F2). Cada sessão mostra nome (ou pasta), pasta curta, status (`busy`/`idle`/`shell`) e há quanto tempo está nele (`statusUpdatedAt`, senão `updatedAt`). Fica destacada a sessão `idle` há mais de 5 min ("Aguardando input") ou `busy` há mais de 30 min ("Parada no mesmo estado"); os limiares estão em `DEFAULT_ATTENTION_CONFIG` (`domain/sessions/attention.ts`) e são injetados em `LoadSessions` pelo composition root.

A capability dá ao plugin-fs só `exists` e `read-dir` em `$HOME/.claude/sessions` e `read-text-file` em `$HOME/.claude/sessions/*.json`; o allowlist do plugin-http e o `connect-src` do CSP incluem `https://api.anthropic.com`.

No modo demo as duas páginas usam dados falsos (histórico de 30 dias gerado por um modelo determinístico, cinco sessões em estados diferentes e uma morta). `?demo=claude:claude-expired` (e os demais cenários de conexão) mostra o estado de erro da página de usage com o botão de conserto.
