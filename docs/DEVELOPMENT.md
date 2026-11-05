# Desenvolvimento

Guia para quem quer rodar, alterar e empacotar o ClawdMeter. Para instalar e usar, veja o [README](../README.md). Detalhes técnicos em [ARCHITECTURE.md](ARCHITECTURE.md) e [SECURITY.md](SECURITY.md).

## Pré-requisitos

- macOS 14 ou superior
- Node 22 e Yarn 1
- Rust 1.99.1 via [rustup](https://rustup.rs): o `rust-toolchain.toml` na raiz fixa a versão, o rustup instala sozinho na primeira vez que o `cargo` roda
- Xcode Command Line Tools: `xcode-select --install`

## Comandos

| Comando | O que faz |
|---|---|
| `yarn install` | instala as dependências |
| `yarn dev:web` | só o Angular no navegador (http://127.0.0.1:4200), sem Tauri, com adapters fakes e cenários `?demo=` |
| `yarn tauri dev` (ou `yarn dev`) | app completo |
| `yarn lint` | ESLint, incluindo as regras de camada |
| `yarn typecheck` | `tsc` no app e nos testes |
| `yarn test` | Vitest (domain, application, infrastructure, ui e o lint de arquitetura) |
| `yarn build` | build de produção do Angular em `dist/clawdmeter/browser` (exigido antes do `cargo test`) |
| `yarn build:demo` | build do modo demo (`fileReplacements` para `composition-root.demo.ts`) |
| `yarn test:rust` | `cargo test` em `src-tauri` |
| `cargo clippy --all-targets -- -D warnings` | lint do Rust (rode em `src-tauri/`) |
| `cargo fmt --check` | formatação do Rust (rode em `src-tauri/`) |
| `cargo deny check` | licenças, advisories e fontes das dependências (`src-tauri/deny.toml`) |
| `CI=true yarn tauri build --bundles dmg` | gera o `.dmg` em `src-tauri/target/release/bundle/dmg/` |

O modo demo troca `composition-root.ts` por `composition-root.demo.ts` por `fileReplacements` do Angular (configuração `demo`). O popover tem largura fixa de 380 px nos dois modos.

## Modo demo: cenários de conexão

`yarn dev:web` abre o app com adapters fakes. O query param `demo` escolhe o estado inicial de cada conexão (`id:valor`, separados por vírgula); clicar nos botões de conserto muda o estado como no app real.

```
http://127.0.0.1:4200/?demo=claude:claude-expired,github:github-org-access
http://127.0.0.1:4200/?demo=errors
```

A agenda do demo usa só títulos genéricos (Daily do time, 1:1, Planejamento) ancorados no horário atual; `microsoft:microsoft-expired` e `microsoft:unexpected` exercitam os estados de erro da página.

Valores: `ok` (padrão do Claude e das notificações), `disconnected`, qualquer `ConnectionProblem` da tabela, e `github:ok` / `microsoft:ok`. `errors` liga um erro em cada conexão. No demo, o token `ghp_…` é aceito como PAT válido.

Estados do GitHub desconectado: `?demo=github:gh-not-installed` (GitHub CLI não encontrado: **Instalar GitHub CLI**, **Entrar pelo navegador** e o link **Colar token**) e `?demo=github:gh-not-logged-in` (gh instalado sem login: **Conectar GitHub CLI**, que abre o Terminal com `gh auth login -h github.com -w`, depois **Verificar de novo**). Sem parâmetro o demo parte de `gh-not-logged-in`. Em **Colar token**, o link **Criar token no GitHub** abre a página de novo token com os escopos `repo` e `read:org`.

PRs e Reviews no demo precisam do GitHub conectado: use `?demo=github:ok` (os repos são genéricos, `acme/*`). Os problemas do GitHub (`github:github-unauthorized`, `github:github-missing-scope`, `github:github-org-access`) também aparecem nas duas páginas, e o botão de conserto resolve. A página Skills roda uma run simulada com stream; `?demo=skills:mcp-needs-auth` e `?demo=skills:claude-code-missing` mostram os problemas de run com **Reconectar MCP** e **Instalar Claude Code**. Usage e Sessões mostram dados falsos (histórico de 30 dias de um modelo determinístico e cinco sessões); `?demo=claude:claude-expired` mostra o erro da página de usage com o botão de conserto, e `?demo=notifications:disconnected` mostra o estado `prompt` das notificações (leva aos ajustes do sistema).

## Estrutura e camadas

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
├─ domain/            TS puro: modelos e regras (settings, connections, usage, sessions, pull-requests, skills, calendar, ...)
├─ application/
│  ├─ ports/          interfaces que a infraestrutura implementa (SettingsStore, Clock, SecretStore, ...)
│  ├─ use-cases/      um arquivo por caso de uso, um método execute() (connections/ tem os de conexão)
│  ├─ connections/    ConnectionMonitor, ConnectionRunner e createConnections (liga casos de uso e adapters)
│  ├─ pull-requests/  createPullRequests, GitHubSession e o dado das páginas PRs/Reviews
│  ├─ skills/         createSkills e SkillRunBoard (runs ao vivo e histórico)
│  ├─ pages/          PageModule (contrato) e PageRegistry
│  ├─ scheduler/      PollingScheduler: só agenda páginas ligadas
│  └─ testing/        fakes das portas, usados só nos testes
├─ infrastructure/
│  ├─ persistence/    JsonSettingsStore, JsonConnectionPrefsStore, LocalStorageJsonFile
│  ├─ platform/       adapters Tauri (invoke, plugins): cofre, credencial do Claude, processos, loopback OAuth, notificações
│  ├─ anthropic/      AnthropicUsageGateway (command `claude_usage_fetch`: o GET /api/oauth/usage roda no Rust)
│  ├─ claude-code/    TauriSessionDirectory (lê ~/.claude/sessions via plugin-fs)
│  ├─ claude-usage-bar/  TauriClaudeUsageBarHistorySource (lê só ~/.config/claude-usage-bar/history.json)
│  ├─ github/         GhCliTokenSource, GitHubDeviceFlowAuthorizer, GitHubRestAccountGateway, GitHubGraphqlGateway
│  ├─ microsoft/      PkceMicrosoftAuthorizer (PKCE + loopback), GraphCalendarGateway
│  ├─ config/         auth-config.ts: client_id do GitHub e da Microsoft (placeholders)
│  └─ demo/           adapters fakes do modo demo, com cenários por query param
├─ ui/
│  ├─ shell/          popover, rodapé "atualizado há Xs" e botão ⚙
│  ├─ settings/       Ajustes: páginas, conexões, aparência
│  ├─ theme/          snapshot dos tokens --me-* do DS Mottu, vars --cm-*, destaque, fundo, claro/escuro/sistema
│  └─ pages/          uma pasta por página
├─ composition-root.ts        DI manual com os adapters reais (Tauri)
└─ composition-root.demo.ts   DI do modo demo no navegador (localStorage)
src-tauri/src/
├─ commands/          camada fina de plataforma: secrets, claude_credentials, process, oauth_loopback, terminal, open_external
└─ tray.rs, platform.rs   bandeja e popover
└─ usage_icon.rs          renderizador puro (RGBA) do ícone de usage da bandeja
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
    title: 'Usage',
    requiredConnections: ['claude'],
    pollIntervalMs: 60_000,
    load: () => loadUsage.execute(),
    component: UsageComponent,
  };
}
```

2. Registre em `composition-root.ts` (e em `composition-root.demo.ts`, com adapters fakes) adicionando uma linha em `pages`. `pages` aceita a lista direta ou uma função que recebe `{ connections, skills }` da própria aplicação (as páginas que reportam problema de conexão usam essa forma). `createApplication` também recebe `skills`, pronto ou como função `({ connections }) => Skills` (as skills notificam o fim da run usando o estado da conexão de notificações):

```ts
pages: [createUsagePage({ clock })],
```

Checkbox em Ajustes, polling e exigência de conexão saem do `PageRegistry`. Fonte de dado nova = uma porta em `application/ports` + um adapter em `infrastructure/`. O componente lê o resultado tipado com `PageStateService.of(USAGE_PAGE)`; quem assina o scheduler depois recebe o último resultado de cada página, então páginas sem polling (`pollIntervalMs: null`) não perdem o primeiro update.

`PageComponent` é `new () => unknown`: o componente injeta dependências com `inject()`, não pelo construtor.

## Publicar uma versão

Para publicar: ajuste a versão em `package.json` e `src-tauri/Cargo.toml` (o `tauri.conf.json` lê a versão do `package.json`), e crie a tag.

```bash
git tag v0.1.0 && git push origin v0.1.0
```
