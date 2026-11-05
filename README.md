# ClawdMeter

App de bandeja para macOS e Windows. No macOS fica na barra de menu; no Windows, na área de notificação. Um clique no ícone abre um popover com as páginas ligadas (Usage, Sessões, PRs, Reviews, Agenda e Skills).

Stack: Tauri 2 (Rust só na camada de plataforma), TypeScript, Angular 19 (standalone + signals).

## Páginas

| Página | Id | Polling | Conexões | O que mostra |
|---|---|---|---|---|
| Usage | `usage` | 5 min | Claude | barras das janelas de 5 h e 7 d com uma marca vertical no % projetado no reset, e um gráfico (1h, 6h, 1d, 7d, 30d ou o ciclo semanal "Reset") com as duas séries e a tendência |
| Sessões | `sessions` | 5 s | nenhuma | sessões abertas do Claude Code e as que pedem atenção |
| PRs | `prs` | 5 min | GitHub | meus PRs abertos por repo |
| Reviews | `reviews` | 5 min | GitHub | PRs para revisar e revisados (abertos e dos últimos 30 dias) |
| Agenda | `teams` | 10 min | Microsoft | reuniões de hoje do Outlook/Teams, com **Entrar** |
| Skills | `skills` | sem polling | Claude | roda skills do Claude Code (`claude -p`) com stream, cancelamento e histórico |

Cada uma liga e desliga em Ajustes. A página só roda se as conexões exigidas (`requiredConnections`) estiverem ok; senão mostra o botão de conserto.

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
│  ├─ theme/          snapshot dos tokens --me-* do DS Mottu, vars --dp-*, destaque, fundo, claro/escuro/sistema
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

### Ajustes

O botão ⚙ no canto inferior direito é o único acesso. Páginas (checkboxes geradas do registry), aparência (idioma, cor de destaque e fundo do popover por paleta de presets ou hex digitado; tema claro/escuro/sistema) e as faixas de alerta do Usage valem na hora via CSS custom properties e são gravadas em `settings.json` na pasta de config do SO (`appConfigDir`):

| SO | Caminho |
|---|---|
| macOS | `~/Library/Application Support/com.mottu.devpulse/settings.json` |
| Windows | `%APPDATA%\com.mottu.devpulse\settings.json` |

O arquivo tem `schemaVersion`; versões antigas são migradas e regravadas na leitura, e versões futuras nunca são regravadas no boot (sem downgrade). Editar o arquivo à mão com o app aberto recarrega as configurações.

Um `settings.json` com JSON inválido nunca é sobrescrito: o app usa o último estado válido em memória (ou os padrões, se o boot já o encontrou quebrado) e só grava os padrões quando o arquivo não existe. Enquanto o arquivo estiver quebrado, os ajustes feitos na UI valem na sessão mas não são persistidos; ao corrigir o arquivo, o app recarrega o conteúdo do disco. Falha de leitura ou gravação aparece como aviso no topo do popover.

**Idioma:** `settings.language` (`pt-BR` padrão, `en`, `es-MX`), no seletor de Ajustes > Aparência; vale na hora. Arquivo sem o campo (versões antigas) abre em pt-BR (`schemaVersion` 3). Os dicionários tipados ficam em `src/ui/i18n/{pt-BR,en,es-MX}.ts`: o `pt-BR.ts` define as chaves (`MessageKey`), os outros dois são `Record<MessageKey, string>` (o compilador pega chave faltando) e `i18n.spec.ts` confere a paridade de chaves e de placeholders. O `Localizer` (`ui/i18n/localizer.ts`) traduz com `t(key, args)` e formata datas, horas, durações, números e custo com `Intl` na língua escolhida; o serviço `I18n` expõe o `Localizer` como signal, então a troca atualiza a tela sem recarregar. O `domain` não tem texto de UI: problemas de conexão (`ConnectionProblem`), consertos (`FixAction`/`ActionLabel`), notas de status (`StatusNote`) e erros do app (`CodedError`/`ErrorCode`) são códigos que a UI mapeia para chaves (`problem.*`, `action.*`, `note.*`, `error.*`). Notificações e o tooltip da bandeja são montados pela porta `Translator` (`application/ports/translator.ts`, implementada por `LiveTranslator` e ligada à língua atual em `CurrentLanguage`); trocar o idioma refaz a leitura do Usage para atualizar o tooltip. No demo, `?lang=en` (ou `es-MX`) grava o idioma antes do boot. Ainda em pt-BR: mensagens técnicas devolvidas por infraestrutura (rede, Rust, GitHub/Microsoft) e erros de run já gravados em `runs.json`.

**Faixas de alerta do Usage:** `settings.usageThresholds` (`warning` 70 e `critical` 90 por padrão), editáveis em Ajustes; valem `0 < alerta < crítico ≤ 100` (valor inválido é ignorado na UI, no patch e na migração).

O seletor de cor nativo (`<input type="color">`) é proibido na `ui`: ele abre numa janela separada e o popover se fecha por perder o foco. O lint de arquitetura barra o uso.

### Tema e cores (DS Mottu)

A fonte da verdade das cores é o DS externo da Mottu (`@mottu-ops/ds-core-external`, GitHub Packages privado, **não** é dependência do app). `src/ui/theme/mottu-tokens.scss` é um snapshot, com os mesmos nomes `--me-*`, só do que o app usa (escalas primary, warning, alert, info e neutral, aliases `*-base/-dark/-alt/-light`, `background-change`/`component-change`/`text-change`, radius 2/4/8/16/1000 e shadow 1/2/3). `mottu-tokens.ts` espelha em hex o que o ECharts precisa (canvas não resolve `var()`), e `tools/theme-tokens.spec.ts` prova que os dois batem. Para atualizar, copie os valores do `dist/mottu-ds.css` do pacote.

`theme.scss` define as vars do app (`--dp-*`) em cima dos tokens via `var(--me-*)`. Componentes usam só `--dp-*`; hex fora de `src/ui/theme` e de `domain` é barrado por teste.

| Tema | Popover | Cards | Texto | Texto secundário |
|---|---|---|---|---|
| Escuro | `#1a1a1a` (entre `neutral-10` e `neutral-20`) | `#202022` | `neutral-95` | `neutral-70` |
| Claro | `neutral-99` | `neutral-100` | `neutral-10` | `neutral-40` |

Visual suave: a janela do Tauri é `transparent: true` (no macOS exige `app.macOSPrivateApi: true` e a feature `macos-private-api` do crate `tauri`) e o `.popover` desenha os cantos de 12 px (`--dp-radius-window`) com borda de 1 px translúcida (`--dp-edge`, 8% do texto) e a sombra nativa da janela (`shadow: true`; uma sombra CSS seria cortada na borda da janela). `html` e `body` são transparentes e o `color-scheme` fica em `dp-root`, nunca no `:root`, senão o navegador pinta o canvas e os cantos voltam a ser retos. Cards, controles e separadores usam bordas translúcidas (`--dp-border` 6%, `--dp-control-border` 14% só em botões e campos), raio de 12 px nos cards (`--dp-radius-md`) e de 8 px nos controles; abas e seletores de período são pills com o segmento ativo em verde. Fundo personalizado recalcula essas variáveis a partir do texto (`BACKGROUND_OVERRIDES` em `theme-style.ts`). Os hex do escuro (`soft-surfaces.ts`) ficam entre `neutral-10` e `neutral-20` do DS, e `tools/theme-tokens.spec.ts` confere isso.

- **Destaque = verde Mottu** (`--dp-accent`, padrão `#00b131` = `primary-base`): aba ativa, botões primários (receita do `me-button`: radius 2px, `:active` em `primary-dark`), seletor de período, foco, checkbox, "agora" e "próxima" da agenda. Texto e linhas finas usam `--dp-accent-text`: `primary-alt` (`#1bd60b`) no escuro, `primary-50` no claro. O texto sobre o destaque é escolhido por contraste WCAG (escuro `#121212` ou branco, o que passar de AA); no verde base sai escuro. Uma cor de destaque personalizada vale para tudo isso, inclusive os gráficos.
- **Semânticos:** erro = `alert`, aviso = `warning`, info = `info`, sucesso = `primary` (`--dp-danger`, `--dp-warning`, `--dp-info`, `--dp-ok`; as variantes `*-text` usam o passo do DS com contraste em cada tema).
- **Usage:** 5h em `primary-alt` no escuro e `primary-base` no claro (ou a cor de destaque escolhida) e 7d sempre cinza (`--dp-series-five` e `--dp-series-seven`), na barra e no gráfico. As cores de faixa (cinza, amarelo `#FFC700`, vermelho `alert-base`) valem só para a projeção do 7d (tendência tracejada, marca vertical na barra e legenda "Projetado N%"), pela faixa do % projetado e pelos limiares de Ajustes; a projeção da 5h é verde e vira vermelha a partir de 100%.
- **SLA nos PRs (PRs e Reviews):** selo de idade e marca na borda esquerda da linha, pela idade desde a abertura de PRs abertos (`domain/pull-requests/sla.ts`): menos de 3 dias neutro, 3 a 6d23h amarelo `#FFC700` (Amarelo 1 da paleta oficial; o DS externo não tem amarelo) com texto escuro, 7 dias ou mais `alert-base`. Em Reviews a referência também é a abertura: o modelo de PR não traz a data do pedido de review. Vermelho nessas páginas só aparece para CI falhando e conflito; "Mudanças pedidas" usa `info`.
- **Fonte:** `"Helvetica Neue", Helvetica, Arial, sans-serif` em todo o app (`--dp-font-family`) e no `textStyle` do ECharts. Não há outra fonte.
- **Migração:** `schemaVersion` 2 troca o destaque antigo `#6366f1` (índigo, antigo padrão) por `#00b131`. Quem escolheu outra cor mantém a sua; quem tinha escolhido o índigo de propósito também é migrado, porque o valor é igual ao do padrão antigo.

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
| `microsoft-not-connected` | Conectar |
| `notifications-blocked` (negadas, ou ainda não liberadas: estado `prompt` no macOS) | Abrir ajustes do sistema |
| `notifications-unverifiable` (SO sem como informar) | Abrir ajustes do sistema (a linha mostra "Não verificável", nunca "Conectado") |
| `unexpected` (rede etc.) | Tentar de novo |

- **Claude:** lê a credencial do Claude Code (Keychain `Claude Code-credentials` no macOS; `~/.claude/.credentials.json` como fallback e no Windows). O access token e o refresh token nunca saem do Rust: o webview só recebe `expiresAt` e o plano (`claude_credentials_status`) e o dado de usage (`claude_usage_fetch`); o app nunca faz refresh. Desconectar só para de usar a credencial, não apaga nada do Claude Code.
- **GitHub:** `gh auth token` (o token não é copiado; a porta devolve `{ token }` ou `{ missing: 'not-installed' | 'not-logged-in' }` e a linha mostra o botão certo para cada motivo) → entrar pelo navegador (Device Flow) → PAT colado (os dois últimos ficam no cofre do SO). A validação confere escopos (`repo`, `read:org`) e o acesso à org `Mottu-ops`.
- **Microsoft:** PKCE com listener em `127.0.0.1` (porta efêmera); o refresh token fica no cofre do SO. Escopos delegados `Calendars.Read` + `offline_access`; nenhum client secret.
- **Notificações:** o plugin do Tauri sempre devolve `granted` no desktop, então o estado vem do command `notification_permission_state` (macOS: `UNUserNotificationCenter`, só no app empacotado; Windows: `ToastNotifier.Setting`; fora disso `unknown`). O app não pede a permissão pelo plugin: `denied` e `prompt` (nunca liberada) levam os dois a **Abrir ajustes do sistema**. Ao fim de uma run de skill o app envia uma notificação local (`notification:allow-notify`) só se essa conexão estiver `connected`.
- **Device Flow do GitHub:** tem botão Cancelar (`AbortSignal`, repassado também ao `fetch` do polling); abrir "Colar token" também cancela. Ao iniciar, a UI mostra o código com o botão Copiar e a instrução de colá-lo na página aberta. Um resultado que chega depois do cancelamento é descartado antes de gravar no cofre.
- Preferências não secretas (método do GitHub, conta Microsoft, Claude ligado) ficam em `connections.json` ao lado do `settings.json`.

`client_id` do GitHub OAuth App e do Entra ID são placeholders em `src/infrastructure/config/auth-config.ts` (`REPLACE_WITH_…`); enquanto forem placeholders, Device Flow e login Microsoft falham com estado `unexpected` explicando o que falta. Um 401 de gateway (ex.: Claude usage) marca a conexão com `connections.report.execute(id, problem)`.

#### Commands Rust (`src-tauri/src/commands`)

Cada command tem permissão própria (`allow-<nome>` em `capabilities/default.json`, declarados em `build.rs`). Erros chegam ao TS como `{ kind, message }` (o `rate_limited` acrescenta `retryAfterSecs`, ver abaixo) e viram `ConnectionProblemError` (`keychain_denied`, `claude_code_missing`, `claude_expired`) ou `PlatformCommandError`. No Rust o tipo é `CommandError` (`thiserror`, com `From` para `io`, `keyring`, `reqwest`, `tauri` e `url`) e o `kind` é um destes: `keychain_denied`, `keychain`, `claude_code_missing`, `claude_expired`, `credential_malformed`, `program_not_allowed`, `program_not_found`, `invalid_argument`, `policy`, `spawn_failed`, `too_many_processes`, `timeout`, `state_mismatch`, `provider_error`, `cancelled`, `http`, `rate_limited`, `tray`, `io`. Commands que bloqueiam (`process_run`, `oauth_loopback_wait`, `process_kill`, `process_is_alive`, `secret_*`, `claude_*`, `notification_permission_state`) são `async fn` e rodam o trabalho em `spawn_blocking`, sem prender um worker do runtime.

| Módulo | Commands | Observações |
|---|---|---|
| `secrets` | `secret_get/set/delete` | crate `keyring` (Keychain / Credential Manager), service `com.mottu.devpulse`; só as chaves de `ALLOWED_SECRET_KEYS` (`github.token`, `microsoft.refresh-token`, espelhadas em `SECRET_KEYS` por um teste), qualquer outra dá `policy`; segredos acima de 1200 bytes são fatiados em `<key>`, `<key>#1`… (o Credential Manager limita o blob a 2560 bytes) |
| `claude_credentials` | `claude_credentials_status`, `claude_usage_fetch` | lê a credencial do Claude Code (Keychain/arquivo) e faz o `GET https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`, timeout de 15 s, resposta até 256 KiB) com o `reqwest` do `tauri-plugin-http`; devolve só `{ expiresAt, subscriptionType }` ou o JSON de usage. Credencial vencida ou 401 dá `claude_expired`; 429 dá `{ kind: 'rate_limited', message, retryAfterSecs }`, com `retryAfterSecs` tirado do header `Retry-After` (segundos ou data HTTP `IMF-fixdate`, convertida em segundos a partir de agora, nunca negativa) e `null` quando o header falta ou é inválido; os demais status, inclusive 5xx, seguem `http`; Keychain negado, `claude_code_missing` e `credential_malformed` mantêm seus `kind`. O `allowlist` do `http:default` não tem mais `api.anthropic.com` |
| `process` | `process_run/spawn/kill/is_alive` | só `claude` e `gh`, com argumentos validados por programa (`process_policy.rs`): `gh auth token [-h github.com]`; `claude -p <prompt> --output-format stream-json [--verbose] --max-budget-usd <n> [--allowedTools <lista>]` (a lista vai num único argumento separado por vírgula) e nada mais: `/login`, `/mcp` e `--resume <uuid>` não passam pelo `process_spawn`, só pelo `terminal_run`; sem `--dangerously-skip-permissions`, `--permission-mode`, `--add-dir` e `--mcp-config`; `cwd` explícito só a pasta do usuário ou subpastas; sem `cwd`, o `process_spawn` usa um diretório de trabalho vazio do app, `app_cache_dir()/skill-cwd` (criado se não existir, fora do `$APPCONFIG` e fora de qualquer scope `fs` do webview, o que um teste confere em `capabilities/default.json`), e só o `process_run` do `gh` cai na pasta do usuário (no Windows o prefixo `\\?\` do caminho canônico é removido), nunca dentro do diretório de config do app (`app_config_dir()`, resolvido pelo `AppHandle`) nem de `~/.claude`: no Windows o scope `fs` do Tauri aceita caminhos com ponto, então o webview conseguiria gravar `$APPCONFIG\.claude\settings.json` e rodar o claude ali; `process_run` só executa `gh` (o `claude` só passa por `process_spawn`, que injeta as flags de endurecimento); timeout encerra o grupo; `kill` só de filhos do app (pid desconhecido ou já encerrado é ignorado); ao sair do app (`RunEvent::Exit`) os filhos ainda vivos são mortos; no máximo 4 processos simultâneos (`too_many_processes`); `kill` de um pid que já está saindo é ignorado, porque o registry marca o pid como "saindo" sob o mesmo lock do `kill` antes do `wait()` fazer o reap (no Unix o aguardo usa `waitid(WNOWAIT)`, que deixa o zumbi até a marcação); a saída capturada em `process_run` é limitada a 1 MiB por stream (com marca `[saída truncada]`) e cada linha do stream a 4 MiB no stdout (o `stream-json` traz um evento por linha, e o `result` pode ser grande) e 64 KiB no stderr (com marca `…[linha truncada]`; o TS reconhece a marca numa linha de stdout que começa com `{` e marca a run com o erro "Saída truncada: …" em vez do genérico "encerrou sem resultado"; se um evento intermediário for cortado mas o `result` final chegar íntegro, a run segue como concluída); eventos `process-output` e `process-exit` |
| `oauth_loopback` | `oauth_loopback_listen/wait/cancel` | valida `state`, timeout, página de retorno local; callback com `state` errado ou ausente recebe 400 e o listener continua esperando, só erro do provedor com `state` válido encerra; cada conexão tem um prazo total de 5 s para entregar o cabeçalho (além de 2 s por leitura), então um cliente que pinga um byte por vez não segura o listener (o pior atraso para um cancelamento é esse prazo, porque o accept é sequencial); leituras interrompidas (`ErrorKind::Interrupted`) são repetidas, tanto aqui quanto na captura de `process_run` |
| `terminal` | `terminal_run` | `claude`/`gh` com a mesma política por programa (`claude /login`, `/mcp`, `--resume <uuid>`, nunca `claude -p`; `gh auth login/refresh`) e argumentos sem metacaracteres de shell; aceita `cwd` (a pasta da run, validada como no `process`, inclusive a recusa de `app_config_dir()` e `~/.claude`, sem aspas nem barra invertida); sem `cwd` abre na pasta do usuário, exceto `claude --resume <uuid>`, que reabre em `app_cache_dir()/skill-cwd` porque o `claude` guarda a sessão por diretório e a run começou ali; o programa vai pelo caminho absoluto resolvido (o mesmo `resolve_program` do `process`), entre aspas simples como o `cwd` |
| `notification_permission` | `notification_permission_state` | `granted`, `denied`, `prompt` ou `unknown` |
| `open_external` | `open_url`, `open_system_settings` | só `https` e painéis conhecidos |

O acesso HTTP ao GitHub e à Microsoft passa pelo `tauri-plugin-http` (evita CORS do WebView), com allowlist de URLs na capability.

### Claude usage

Página `usage` (poll de 5 min, exige a conexão Claude). `LoadUsage` chama o `AnthropicUsageGateway`, que invoca o command `claude_usage_fetch`: o Rust lê a credencial do Claude Code e faz o `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`), então o token não chega ao TypeScript; a resposta é limitada a 256 KiB (o `Content-Length` é checado antes e o corpo é lido em pedaços, cortando ao passar do limite, mesmo sem `Content-Length`); o app nunca faz refresh. Token vencido ou 401 vira `claude-expired` na conexão Claude e a página mostra "Refazer login do Claude". Os campos lidos são `five_hour` e `seven_day` (`utilization`, `resets_at`); o parse ignora campos extras e janelas sem `utilization` válida.

- **Histórico:** `usage-history.json` ao lado do `settings.json`. Pontos brutos por 7 dias; do 8º ao 30º dia, agregados em baldes de 15 min pelo máximo; nada passa de 30 dias (`domain/usage/retention.ts`). Fica em memória depois da primeira leitura e é gravado em série por arquivo temporário + `rename` (`fs:allow-rename` só em `$APPCONFIG`). Arquivo ilegível vira `usage-history.json.corrupt` e o histórico recomeça vazio, sem sobrescrever o original.
- **Histórico do ClaudeUsageBar:** a cada carga, `ImportExternalUsageHistory` lê `~/.config/claude-usage-bar/history.json` (`{"dataPoints":[{"timestamp","pct5h","pct7d"}]}`, frações 0–1) pela porta `ExternalUsageHistorySource` (adapter `TauriClaudeUsageBarHistorySource`; no demo, um fake vazio) e mescla no histórico antes da retenção: fração vira %, pontos a até 1 min de um ponto existente (ou entre si) são descartados e o ponto nosso vence, nada com mais de 30 dias ou no futuro entra, e a retenção normal (brutos 7 d, baldes de 15 min até 30 d) vale para os importados. O parse é tolerante (entrada sem timestamp válido ou sem percentual é ignorada). Arquivo ausente, ilegível ou acima de 8 MiB é ignorado em silêncio. O ponto importado não tem `resets_at`: ele carrega a marca `imported` (4º elemento do ponto em `usage-history.json`) e a detecção de ciclo ignora a comparação de `resets_at` nos pares com um ponto importado, então só uma queda de utilização abre ciclo novo (`domain/usage/forecast.ts`). A capability dá ao plugin-fs só `read-text-file` em `$HOME/.config/claude-usage-bar/history.json`: sem `exists`, `read-dir`, escrita, nem o `credentials.json` da mesma pasta (`tools/capabilities.spec.ts` verifica o escopo). Não há toggle em Ajustes: a importação fica ligada quando o arquivo existe.
- **Erro transitório:** se uma atualização falha (rede, 5xx), a página mantém o último dado e mostra o banner de erro por cima, com "Mostrando os últimos dados carregados".
- **Rate limit (429/5xx):** a Anthropic devolve 429 em `/api/oauth/usage`. O Rust passa o `kind` `rate_limited` com `retryAfterSecs` opcional (um erro HTTP 429/5xx genérico também conta) e o gateway converte em `RateLimitedError`. O `PollingScheduler` adia o próximo poll da página para `max(Retry-After, 5 → 10 → 20 → 30 min)` (`domain/rate-limit.ts`), inclusive o refresh manual, e volta ao ritmo normal depois de um sucesso. O banner diz "Limite de consultas da Anthropic — tentando de novo em 12 min", sem path de API, mantendo os últimos dados.
- **Atualizar:** o botão ↻ do rodapé (à esquerda da engrenagem) recarrega a página atual por `scheduler.refresh`; fica girando enquanto carrega, tem cooldown de 30 s e, em backoff de rate limit, mostra o tempo restante no tooltip sem chamar a Anthropic (`ui/shell/refresh-state.ts`).
- **Layout:** no topo, duas barras (`5h` e `7d`) com o percentual à direita e "reseta em 2h06" embaixo; o previsto no reset é uma linha vertical fina (2 px, um pouco mais alta que a barra) no ponto do % projetado, na cor da projeção (no fim da barra e vermelha se passa de 100%, e a legenda traz o número real, ex.: "Projetado 132%"; sem marca com menos de 3 pontos no ciclo). Abaixo, o seletor `1h · 6h · 1d · 7d · 30d · Reset` (controle segmentado, padrão 6h; "Reset" mostra o ciclo semanal, de `resets_at` do 7d − 7 dias até o próximo reset, com marcas sutis em "agora" e nos resets da 5h do intervalo, e fica desabilitado sem `resets_at` conhecido) e um único gráfico ECharts (via `ngx-echarts`, carregado sob demanda) com as duas séries no mesmo eixo (eixo Y à direita, de 0 a 100% e de 25 em 25; quando a projeção desenhada passa de 100%, o eixo sobe até o próximo múltiplo de 25 acima do máximo projetado, com teto de 300% e passo de 50 acima de 200%), linhas suaves com área bem leve, grade tracejada, marcas verticais tracejadas em "agora" e nos resets que cabem no eixo, linha de referência sólida e sutil em 100% (vermelha com alfa baixo, só com o eixo expandido, e rótulo "100%" destacado no eixo) e legenda `● 5h ● 7d`. Não há frases de previsão nem títulos longos.
- **Tendência e previsão:** regressão linear dos pontos do ciclo atual (janela de 1 h no 5 h e de 24 h no semanal), desenhada, em cada série, como linha tracejada mais fina a partir do último ponto real até o `resets_at` (cortada na borda do eixo ou em 100%) e, na barra, como o trecho previsto. Um reset (queda de utilização ou mudança de `resets_at`) abre um ciclo novo e a regressão ignora os pontos anteriores (`domain/usage/forecast.ts`).
- **Projeção por média diária (só o período Reset):** o período `cycle` é o único com regra de projeção própria (`domain/usage/daily-average.ts`). Para o 7d, a taxa é o consumo médio por dia no histórico dos últimos 14 dias: soma dos incrementos positivos do 7d entre pontos consecutivos (quedas são resets e não contam) dividida pelos dias cobertos entre o primeiro e o último ponto da janela (mínimo de 1 dia de dados; o histórico importado do ClaudeUsageBar conta). A linha tracejada é `atual + taxa × dias(t − agora)` até o reset semanal, sem cortar em 100%. Com menos de 1 dia de dados, cai na regressão da regra anterior. Nessa linha há um ponto em cada 00:00 local entre agora e o reset, mais o ponto no reset, com o % projetado acima (cor da faixa do valor pelos limiares de Ajustes; se dois pontos ficam a menos de 0,6 dia, o rótulo do anterior some e o ponto continua) e tooltip "data + Projetado N%". A projeção do 5h não aparece no Reset. As barras do topo e a legenda "Projetado N%" não mudam com o período: usam sempre a regressão, só o Reset usa a média diária; os demais períodos mantêm a regressão (inclusive a do 5h), agora sem o corte em 100% (o eixo expande).

### Ícone de usage na bandeja

A cada leitura do `LoadUsage` (e a cada falha) a porta `UsageIndicator` atualiza o ícone e o tooltip da bandeja pelo command `tray_set_usage`; no demo o adapter é no-op.

- **macOS:** ícone largo (template, só o alfa conta) com o mascote pixel (grade 12×8 em `usage_icon.rs`, olhos como furos) à esquerda e duas linhas `5h`/`7d` com barra arredondada: trecho preenchido opaco, vazio a 35%. O mascote enche de baixo para cima conforme o `7d` (0% todo a 35%, 100% todo opaco) e, quando o `5h` ou o `7d` chega a 100% (sem limite), os olhos viram um X. A `tray-icon` fixa a altura do ícone em 18 pt, então o render é 128×36 px (@2x), pixel a pixel nessa altura.
- **Windows:** o ícone da bandeja é quadrado, então vai a variante 32×32 (16×16 em @1x) só com o mascote (enche com o `7d`, olhos em X quando um dos limites estoura; azul preenchido, cinza vazio, legível em barra clara e escura). Barras e números ficam no tooltip: `5h: 24% · reseta 14:09 | 7d: 51% · reseta seg 05:39` (`domain/usage/usage-tooltip.ts`).
- **Sem dado** (janela ausente, Claude desconectado, token vencido ou erro de leitura): mascote todo a 35% com olhos normais e barras com contorno tracejado (no Windows, só o mascote translúcido); o tooltip vira `ClawdMeter · usage indisponível`. Percentuais fora de 0–100 são limitados no Rust.
- **Antes da primeira leitura** (e com a página Usage desligada) vale o ícone padrão do app (`tray-template.png` no macOS, ícone da janela no Windows); o render com o mascote só aparece depois de uma tentativa de leitura.
- Os fontes ficam em `src-tauri/src/usage_icon.rs` (mascote em matriz de caracteres; fonte bitmap 4×6 embutida para `5`, `h`, `7`, `d`; sem fontes do sistema e sem dependência de imagem). `cargo run --example render_usage_preview` (em `src-tauri/`) regrava os PNGs de `docs/tray-preview/`.

### Popover sobre apps em tela cheia (macOS)

Com outro app em tela cheia (Space próprio), uma janela comum não aparece. Em `platform.rs`, `prepare_popover` roda na criação da janela e antes de cada `show`: chama `set_visible_on_all_workspaces(true)` e completa pelo `NSWindow` com `collectionBehavior` = `CanJoinAllSpaces | FullScreenAuxiliary | Stationary | IgnoresCycle` (sem `FullScreenPrimary`/`Transient`/`MoveToActiveSpace`, que conflitam) e nível `NSPopUpMenuWindowLevel`. A política de ativação segue `Accessory`. No Windows não há mudança: o popover é uma janela sem borda com `alwaysOnTop`, e isso não foi validado em máquina Windows. Só o cálculo do behavior e do nível tem teste automatizado; o efeito sobre um app em tela cheia real precisa ser conferido à mão.

### Sessões

Página `sessions` (poll de 5 s, sem conexão). `TauriSessionDirectory` lê `<home>/.claude/sessions/*.json` (`homeDir()` do Tauri: `~` no macOS, `%USERPROFILE%` no Windows) e `LoadSessions` mantém só os pids vivos (`process_is_alive`, command Rust da F2). Cada sessão mostra nome (ou pasta), pasta curta, status (`busy`/`idle`/`shell`) e há quanto tempo está nele (`statusUpdatedAt`, senão `updatedAt`). Fica destacada a sessão `idle` há mais de 5 min ("Aguardando input há X") ou `busy` há mais de 30 min ("Ocupada há X"); os limiares estão em `DEFAULT_ATTENTION_CONFIG` (`domain/sessions/attention.ts`) e são injetados em `LoadSessions` pelo composition root.

A capability dá ao plugin-fs só `exists` e `read-dir` em `$HOME/.claude/sessions` e `read-text-file` em `$HOME/.claude/sessions/*.json`; o allowlist do plugin-http não inclui mais `https://api.anthropic.com` (a chamada de usage é feita pelo Rust; o resto do HTTP passa pelo plugin, então o `connect-src` do CSP não lista hosts externos).

No modo demo as duas páginas usam dados falsos (histórico de 30 dias gerado por um modelo determinístico, cinco sessões em estados diferentes e uma morta). `?demo=claude:claude-expired` (e os demais cenários de conexão) mostra o estado de erro da página de usage com o botão de conserto.

### Página Agenda

Reuniões de hoje do Outlook/Teams, ligada à conexão Microsoft, com poll de 5 min.

- Fonte: `GET https://graph.microsoft.com/v1.0/me/calendarView` (permissão delegada) com `startDateTime`/`endDateTime` do dia em `America/Sao_Paulo`, header `Prefer: outlook.timezone="America/Sao_Paulo"`, `$select`, `$orderby=start/dateTime`, `$top=50` e paginação por `@odata.nextLink` (só segue links do próprio `graph.microsoft.com`; máximo de 10 páginas).
- Regras de dia, fuso, "agora" e "próxima" ficam em `src/domain/calendar` (testadas: virada de dia, horário de verão, dia inteiro, cancelada, reunião que atravessa a meia-noite).
- Canceladas aparecem riscadas e nunca contam como "agora" nem "próxima"; eventos de dia inteiro ficam numa lista própria.
- **Entrar** abre `onlineMeeting.joinUrl` pelo `OpenUrl`, só se for `https` em `teams.microsoft.com` ou `teams.live.com` (validado em `teamsJoinUrl`, no mapeamento do Graph e de novo no caso de uso `JoinMeeting`).
- 401/403 do Graph ou token vencido viram `microsoft-expired`: a página mostra o aviso e o botão "Refazer login da Microsoft"; depois do conserto ela recarrega na hora (`PollingScheduler.refresh`).
- A allowlist do `plugin-http` inclui `https://graph.microsoft.com`; o `connect-src` do CSP não lista hosts externos porque todo HTTP passa pelo plugin.

### PRs e Reviews

Duas páginas (`prs` e `reviews`, pollando a cada 5 min), cada uma com uma única requisição `POST https://api.github.com/graphql` (várias buscas aliasadas, `first: 50` cada) usando o token da conexão GitHub (`GitHubTokenResolver`). O acesso passa pelo `tauri-plugin-http`; a capability já libera `https://api.github.com/*` e `tools/capabilities.spec.ts` garante que `/graphql` está coberto (o `connect-src` da CSP não entra, o plugin não usa o WebView).

| Página | Buscas |
|---|---|
| PRs | `author:@me is:open is:pr` |
| Reviews: para revisar | `review-requested:@me is:open is:pr` |
| Reviews: revisados | `reviewed-by:@me -author:@me` abertos + fechados/mergeados nos últimos 30 dias |

- Agrupados por repo; `k8s` e `k8s-prod` formam o grupo **Deploy**, recolhido por padrão. No topo de cada página, o controle "Recolher tudo" / "Expandir tudo" (▾/▸) alterna todos os grupos, inclusive o Deploy; cada grupo continua clicável. O estado de cada grupo fica em memória durante a sessão (`PullRequestGroupsState`, por página/seção/grupo), sem ir para o `settings.json`.
- Todas as buscas usam `sort:updated-desc`. Selos por PR: rascunho, CI (`statusCheckRollup`), decisão de review, conflito e idade. Clicar abre no navegador, e o caso de uso `OpenGitHubUrl` só abre `https://github.com` (sem porta nem credenciais na URL).
- Limite de 50 por busca; quando há mais, a seção mostra "Mostrando X de Y" e um link para a busca no GitHub. No bloco dos revisados o link cobre abertos e fechados dos últimos 30 dias (`(is:open OR closed:>=data)`).
- Resposta GraphQL com `data` parcial usa os nós válidos; só escopo ou SAML viram problema de conexão, e `RATE_LIMITED` mostra "Limite de requisições do GitHub atingido".
- Erros viram `ConnectionProblem` (401 → `github-unauthorized`; 403 com `x-github-sso` ou erro SAML → `github-org-access`; `INSUFFICIENT_SCOPES` → `github-missing-scope`; GitHub não conectado → `github-unauthorized`) e a página mostra o botão de conserto da conexão (`FIX_FOR`) mais "Tentar de novo". O scheduler repassa o `problem` no `PageUpdate` de erro e tem `refresh(pageId)` para recarregar logo após o conserto.

### Skills (runs)

A página `skills` não faz polling: só roda no clique em **Rodar**. As skills vêm de `skills.json` ao lado do `settings.json` (somente leitura; ausente ou inválido usa o padrão `/acabativa`):

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

- Comando: `claude -p "<prompt>" --output-format stream-json --verbose --max-budget-usd <valor> --allowedTools "Read(./**),Bash(gh pr diff:*),…"` via `process_spawn` (sem shell; a lista de ferramentas é um único argumento). `--verbose` é exigido pelo `stream-json` em modo `-p`. Prompt começando com `-` é rejeitado. `cwd` precisa ser absoluto e sem `..`; sem `cwd` a run começa em `app_cache_dir()/skill-cwd` (no macOS `~/Library/Caches/com.mottu.devpulse/skill-cwd`), uma pasta vazia do app, e não na pasta do usuário.
- **Ferramentas: allowlist exata.** `--allowedTools` só aceita entradas idênticas às de `ALLOWED_CLAUDE_TOOLS` (`process_policy.rs`, espelhada em `skill-definition.ts` por um teste que lê o arquivo Rust): `Read(./**)`, `Bash(gh pr list|view|checks|diff:*)`, `Bash(gh search prs:*)` e dois tools MCP de leitura do Jira que a `/acabativa` usa (`mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` e `getJiraIssue`). `Bash` sem padrão, `Bash(*)`, `Bash(git:*)`, `Bash(gh:*)`, `Read` sem escopo, `Write`, `Edit`, qualquer `*` e qualquer outro tool são barrados no Rust; no TS a run falha antes de abrir o processo com "A skill … usa ferramenta não permitida: …". `Grep` e `Glob` não estão na lista: o `claude` os executa sem regra dentro do `cwd` da run e, fora dele, o `dontAsk` os nega; um `skills.json` antigo com `Grep`/`Glob` falha com "Atualize o skills.json". Os scripts auxiliares da `/acabativa` (`bash`/`python`) ficam de fora de propósito.
- **Migração do `skills.json` (round 2).** `Bash(git diff:*)`, `Bash(git log:*)` e `Bash(git status:*)` saíram da lista porque o `claude` casa o padrão por prefixo e o subcomando aceita flags de escrita (`git diff --output=$HOME/.zshrc` grava um arquivo arbitrário); troque por `Bash(gh pr diff:*)` ou remova. `Read` virou `Read(./**)` (regra de leitura relativa ao diretório da run, sintaxe de regras de permissão do Claude Code, não confirmada rodando o `claude`). Um `skills.json` com os nomes antigos continua sendo lido, mas a run falha antes de abrir o processo com a mensagem "A skill … usa ferramenta não permitida: …. Atualize o skills.json …". Com `cwd` nulo a run começa na pasta vazia `skill-cwd` do app (round 3), então `Read(./**)` cobre só ela; uma skill que precise ler um projeto define o `cwd` dele no `skills.json`.
- **Flags injetadas pelo Rust (round 2).** Depois de validar o argv vindo do webview, o `process_spawn` acrescenta sempre ao fim de qualquer `claude -p`: `--setting-sources user --permission-mode dontAsk --disallowedTools Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Read(~/.ssh/**),Read(~/.aws/**),Read(~/.config/gh/**),Read(~/.claude/**),Read(~/.gnupg/**)` (`prepare_invocation` em `process_policy.rs`, nessa ordem). O TS não passa essas flags e o Rust as barra se vierem do webview, inclusive na forma `--flag=valor` (`--settings`, `--setting-sources`, `--permission-mode`, `--dangerously-skip-permissions`, `--add-dir`, `--mcp-config`, `--strict-mcp-config`, `--disallowedTools`/`--disallowed-tools`). Os nomes foram conferidos no `claude --help` local (2.1.318): `--setting-sources <sources>` (lista de `user`, `project`, `local`), `--disallowedTools, --disallowed-tools <tools...>` e `--permission-mode <mode>` com as opções `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` e `plan`. `--setting-sources user` ainda lê o `~/.claude/settings.json` do usuário, e um `permissions.defaultMode` permissivo dele valeria na run; por isso o Rust fixa `--permission-mode dontAsk` (nega tudo que não estiver em `--allowedTools`) e nega `WebFetch` e `WebSearch`, que não fazem parte da allowlist. Efeito: o `settings.json`/hooks/permissions do projeto (`<cwd>/.claude/`) e `settings.local.json` não são lidos, e as deny rules valem mesmo que o frontmatter de uma skill traga `allowed-tools` mais largo, já que deny vence allow.
  - **Leitura de caminhos sensíveis negada (round 3).** O `--disallowedTools` leva `Read(~/.ssh/**)`, `Read(~/.aws/**)`, `Read(~/.config/gh/**)`, `Read(~/.claude/**)` e `Read(~/.gnupg/**)`. Não confirmado rodando o `claude`: o `--help` só lista a flag e o formato `Bash(git *)`, não a sintaxe de regras `Read(~/…)`; ela segue a documentação de permissões do Claude Code (`~/` é a pasta do usuário; regra de `Read` vale também para `Grep` e `Glob`, em regime de melhor esforço). Por isso não há regras `Grep(...)`/`Glob(...)` separadas. Efeito colateral: um arquivo de apoio de uma skill que mora em `~/.claude` e seja lido pelo tool `Read` também é negado.
  - **Variável do `gh`.** O Rust define `GH_PROMPT_DISABLED=1` no ambiente dos filhos, para o `gh` nunca ficar esperando prompt.
  - **`Bash` fora do `--disallowedTools`.** A revisão pediu `Bash` na lista de negadas, mas deny vence allow no Claude Code: `Bash` negado anularia `Bash(gh pr …:*)` e a skill ficaria sem `gh`. Só entram as quatro ferramentas de escrita. Risco residual: uma skill com `allowed-tools: Bash` no frontmatter pode ampliar o Bash para além dos padrões `gh`.
  - **MCPs do usuário carregam.** O Rust não injeta `--strict-mcp-config`, então os servidores MCP do usuário e de plugins voltam a carregar; o `--allowedTools` continua restringindo os tools MCP aos dois de leitura do Jira (`searchJiraIssuesUsingJql` e `getJiraIssue`). `--mcp-config` e `--strict-mcp-config` vindos do webview continuam barrados.
  - **`process_spawn` só aceita `claude -p` (round 3).** `claude /login` e `claude --resume <uuid>` eram aceitos sem as flags de endurecimento; agora são recusados (`argumentos do claude não permitidos`) e só rodam no terminal interativo.
  - `terminal_run` com `claude` aceita só `/login`, `/mcp` e `--resume <uuid>` (nunca `-p`), então não há caminho de `claude -p` que escape dessas flags.
- **Falha sem `result` (round 3).** Se o processo termina sem evento `result`, a run falha mostrando o stderr (últimos 2000 caracteres); quando houve linha truncada, o erro é a mensagem de truncamento seguida do stderr, em outra linha. Sem stderr, vale a mensagem genérica com o código de saída.
- O stream é lido linha a linha (`process-output`/`process-exit`) e interpretado no `domain/skills` (`parseStreamLine` + `applyStreamEvent`): mensagens do assistant, `result` com custo/duração e `session_id`.
- **Cancelar** mata o grupo do processo (`process_kill`); cancelar antes do processo estar anexado fica guardado e é aplicado no attach. O histórico (últimas 20 runs, sem o log ao vivo) fica em `runs.json` no `appConfigDir`, com gravações serializadas.
- Ao fim da run (sucesso ou falha, nunca cancelada) sai uma notificação local com custo e duração, se a conexão de notificações estiver ok.
- **Continuar no terminal** abre `claude --resume <session_id>` (o id precisa ser UUID) na mesma pasta da run.
- Problemas com botão de conserto: MCP com `needs-auth`, `pending` ou `failed` no `init` (`mcp_servers[].status`) → **Reconectar MCP** (Terminal com `claude /mcp`); Claude Code ausente → **Instalar Claude Code**.

### Modo demo: cenários de conexão

`yarn dev:web` abre o app com adapters fakes. O query param `demo` escolhe o estado inicial de cada conexão (`id:valor`, separados por vírgula); clicar nos botões de conserto muda o estado como no app real.

```
http://127.0.0.1:4200/?demo=claude:claude-expired,github:github-org-access
http://127.0.0.1:4200/?demo=errors
```

A agenda do demo usa só títulos genéricos (Daily do time, 1:1, Planejamento) ancorados no horário atual; `microsoft:microsoft-expired` e `microsoft:unexpected` exercitam os estados de erro da página.

Valores: `ok` (padrão do Claude e das notificações), `disconnected`, qualquer `ConnectionProblem` da tabela, e `github:ok` / `microsoft:ok`. `errors` liga um erro em cada conexão. No demo, o token `ghp_…` é aceito como PAT válido.

Estados do GitHub desconectado: `?demo=github:gh-not-installed` (GitHub CLI não encontrado: **Instalar GitHub CLI**, **Entrar pelo navegador** e o link **Colar token**) e `?demo=github:gh-not-logged-in` (gh instalado sem login: **Conectar GitHub CLI**, que abre o Terminal com `gh auth login -h github.com -w`, depois **Verificar de novo**). Sem parâmetro o demo parte de `gh-not-logged-in`. Em **Colar token**, o link **Criar token no GitHub** abre a página de novo token com os escopos `repo` e `read:org`.

PRs e Reviews no demo precisam do GitHub conectado: use `?demo=github:ok` (os repos são genéricos, `acme/*`). Os problemas do GitHub (`github:github-unauthorized`, `github:github-missing-scope`, `github:github-org-access`) também aparecem nas duas páginas, e o botão de conserto resolve. A página Skills roda uma run simulada com stream; `?demo=skills:mcp-needs-auth` e `?demo=skills:claude-code-missing` mostram os problemas de run com **Reconectar MCP** e **Instalar Claude Code**. Usage e Sessões mostram dados falsos (histórico de 30 dias de um modelo determinístico e cinco sessões); `?demo=claude:claude-expired` mostra o erro da página de usage com o botão de conserto, e `?demo=notifications:disconnected` mostra o estado `prompt` das notificações (leva aos ajustes do sistema).

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
| `yarn build:demo` | build do modo demo (`fileReplacements` para `composition-root.demo.ts`) |
| `yarn tauri build` | gera os instaladores do SO atual |

O modo demo troca `composition-root.ts` por `composition-root.demo.ts` por `fileReplacements` do Angular (configuração `demo`). O popover tem largura fixa de 380 px nos dois modos.

## Build e release

- `.github/workflows/ci.yml`: em push na `main` e em PR, roda lint, typecheck, Vitest, build, `cargo test`, `cargo fmt --check` e `cargo clippy --all-targets -- -D warnings` em `macos-latest` e `windows-latest`; um job `supply-chain` (ubuntu) roda `cargo audit` e `cargo deny check` (`src-tauri/deny.toml`: licenças permissivas, advisories e fontes só do crates.io).
- `.github/workflows/release.yml`: em tag `v*`, gera `.dmg` universal (arm64 + x64, macOS 14+) e `.msi` (Windows 10+) com `tauri-apps/tauri-action` e anexa a um release em rascunho.
- **Permissões e pins.** O `ci.yml` roda com `permissions: contents: read`; o `release.yml` só tem `contents: write` (precisa criar o release em rascunho). Todo `actions/checkout` usa `persist-credentials: false`, então o token não fica gravado no `.git` dos jobs. Todas as actions estão fixadas por SHA de commit, com a versão em comentário `# vN` ao lado: `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0, `swatinem/rust-cache` v2.9.3, `taiki-e/install-action` v2.90.1, `tauri-apps/tauri-action` v0.6.2 e `dtolnay/rust-toolchain` na branch `stable` (a action deriva o toolchain do nome da ref, e um SHA não carrega esse nome, então o `toolchain:` vai explícito). O Dependabot (`.github/dependabot.yml`) abre PRs semanais para `github-actions`, `cargo` (`/src-tauri`) e `npm`, e atualiza o SHA junto com o comentário. Os SHAs foram conferidos com `gh api repos/<org>/<repo>/commits/<sha>` e `…/tags`. Um teste (`tools/workflows.spec.ts`) falha se uma action sair do pin por SHA, perder o comentário de versão, ou se um checkout perder o `persist-credentials: false`.
- **Toolchain Rust fixo.** `rust-toolchain.toml` (raiz) fixa `1.99.1`, a versão estável instalada na máquina de desenvolvimento (`rustc 1.99.1`, 2026-10-13), com `clippy` e `rustfmt`; o CI e o release passam `toolchain: 1.99.1` à action e o mesmo teste exige que os valores coincidam. Para subir a versão, troque o `channel` e os `toolchain:` juntos.

Para publicar: ajuste a versão em `package.json` e `src-tauri/Cargo.toml` (o `tauri.conf.json` lê a versão do `package.json`), e crie a tag.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

> O `identifier` do bundle (`com.mottu.devpulse`), o serviço do Keychain e a pasta de configuração mantêm o nome legado de propósito: renomear apagaria ajustes, histórico e logins já salvos. O crate (`dev-pulse` / `dev_pulse_lib`) também segue com o nome antigo.

## Instalação

Os instaladores ainda não são assinados (sem Apple Developer ID e sem Authenticode), então os sistemas mostram um aviso na primeira abertura.

### macOS (14 ou superior)

1. Abra o `.dmg` e arraste **ClawdMeter** para Aplicativos.
2. Na primeira abertura, o Gatekeeper bloqueia o app. Abra **Ajustes do Sistema > Privacidade e Segurança** e clique em **Abrir Mesmo Assim**; ou rode:

```bash
xattr -dr com.apple.quarantine "/Applications/ClawdMeter.app"
```

3. O ícone aparece na barra de menu. O app não aparece no Dock. Clique com o botão direito no ícone para sair.

### Windows (10 ou superior)

1. Execute o `.msi`.
2. O SmartScreen avisa "O Windows protegeu seu computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O ícone aparece na área de notificação (pode estar em "Mostrar ícones ocultos"). O app não aparece na barra de tarefas. Clique com o botão direito no ícone para sair.

## Backlog

- **Atualização automática.** Criar o repositório no GitHub (Mottu-ops), publicar cada versão como Release pelo `release.yml` (.dmg e .msi) e fazer o app consultar a última Release com o login do GitHub que ele já tem. Ao detectar versão mais nova, mostrar um bloco "Nova versão X · Atualizar" que baixa, confere a assinatura (`tauri-plugin-updater` com chave própria) e instala.

## Pendências de segurança (review de Rust)

- **Dívida: tokens do GitHub e do Graph ainda cruzam o IPC.** O token do Claude já não sai do Rust (`claude_usage_fetch`), mas `secret_get` ainda devolve `github.token` e `microsoft.refresh-token` ao webview, que faz as chamadas ao GitHub e ao Microsoft Graph pelo `tauri-plugin-http`. Mover essas chamadas para o Rust (como foi feito no usage) é o passo seguinte; até lá `secret_*` só aceita essas duas chaves.
- **Pendência S3 (macOS): leitura do Keychain via `/usr/bin/security`.** Se o usuário marcar "Sempre permitir", o acesso é concedido ao binário `security`, não ao ClawdMeter, e qualquer processo local passa a ler a credencial do Claude Code sem aviso. A correção é usar a API nativa (`security-framework`), que amarra o acesso à assinatura do app; hoje o app é assinado ad hoc (`signingIdentity: "-"`), então o acesso quebraria a cada build. Fica para quando houver identidade de assinatura real.
- **Limite do allowlist de ferramentas:** o `claude` casa `Bash(gh pr diff:*)` e os demais padrões `gh` por prefixo; a lista só contém subcomandos do `gh` sem flag de escrita em arquivo, mas uma versão futura do `gh` que acrescente uma flag assim a reabriria.

## Limitações conhecidas

- **`gh … <URL>` e `-R host/…` sem trava.** `Bash(gh pr view:*)` e os outros padrões `gh` casam por prefixo, então o Rust não consegue impedir que o `claude` passe ao `gh` uma URL de outro host ou `-R host/org/repo`; o `gh` faz a requisição (incluindo POST) para esse host, e um prompt injetado por conteúdo de PR poderia usá-lo para exfiltrar o que a run leu. Não existe variável de ambiente que restrinja o `gh` a `github.com` (`GH_HOST` só escolhe o host padrão, não bloqueia URLs completas). Mitigação parcial: a run começa numa pasta vazia, `Read` de `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude` e `~/.gnupg` é negado, e `WebFetch`/`WebSearch` estão fora. Risco residual aceito: o que ainda é legível (por exemplo, o texto dos PRs e dos cards que a própria run busca). A skill padrão não precisa de URLs, mas isso depende do prompt da skill e não é imposto.
- Sem assinatura de código (macOS e Windows) e sem updater. No macOS o bundle usa assinatura ad-hoc (`signingIdentity: "-"`), que não substitui o Developer ID.
- A CSP do app (`src-tauri/tauri.conf.json`) só libera `self` e IPC (todo HTTP vai pelo `plugin-http`, com allowlist na capability). Não foi validada rodando o app Tauri.
- O comportamento no Windows (posição do popover, ocultar ao perder o foco, `terminal_run` com `cwd`, remoção do prefixo `\\?\`, `taskkill`) não foi validado em máquina Windows; o CI só compila e roda testes.
- As runs de skills nunca foram executadas com o `claude` real nesta fase: o formato do `stream-json` (incluindo `mcp_servers[].status` no `init`) segue a documentação e as fixtures de `domain/skills/stream-fixtures.ts`. Um `claude` instalado via npm depende de `node` no `PATH`, que um app aberto pelo Finder pode não ter; o instalador nativo (`~/.local/bin/claude`) não tem esse problema.
- A notificação ao fim da run, o envio pelo plugin e o `RunEvent::Exit` não foram exercitados no app Tauri real (só por fakes e testes Rust do registry). No macOS a notificação depende de o app empacotado ter permissão do sistema.
- Nada foi validado contra GitHub, Microsoft Graph e Anthropic reais: os formatos de resposta seguem a documentação e as fixtures dos testes. O link "Ver todos" dos revisados usa `OR` com parênteses na busca do GitHub.
- O `terminal_run` com `cwd` e `/mcp` só foi validado por testes de política; o AppleScript do Terminal do macOS não foi executado.
- O modo demo roda só no navegador; ele não exercita os commands Rust.
- O ícone de usage da bandeja só foi validado como imagem (PNGs em `docs/tray-preview/`) e por testes do renderizador; `tray_set_usage` não rodou no app Tauri real, e o aspecto na barra de menus do macOS e na bandeja do Windows não foi conferido.
