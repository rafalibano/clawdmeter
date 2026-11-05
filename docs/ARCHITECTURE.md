# Arquitetura do ClawdMeter

Documento técnico para quem mantém o app. Para instalar e usar, veja o [README](../README.md); para rodar e contribuir, [DEVELOPMENT.md](DEVELOPMENT.md); para política de processos, segredos, capabilities e pendências de segurança, [SECURITY.md](SECURITY.md).

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

## Ajustes

O botão ⚙ no canto inferior direito é o único acesso. Páginas (checkboxes geradas do registry), aparência (idioma, cor de destaque e fundo do popover por paleta de presets ou hex digitado; tema claro/escuro/sistema) e as faixas de alerta do Usage valem na hora via CSS custom properties e são gravadas em `settings.json` na pasta de config do SO (`appConfigDir`):

| SO | Caminho |
|---|---|
| macOS | `~/Library/Application Support/com.mottu.clawdmeter/settings.json` |
| Windows | `%APPDATA%\com.mottu.clawdmeter\settings.json` |

O arquivo tem `schemaVersion`; versões antigas são migradas e regravadas na leitura, e versões futuras nunca são regravadas no boot (sem downgrade). Editar o arquivo à mão com o app aberto recarrega as configurações.

Um `settings.json` com JSON inválido nunca é sobrescrito: o app usa o último estado válido em memória (ou os padrões, se o boot já o encontrou quebrado) e só grava os padrões quando o arquivo não existe. Enquanto o arquivo estiver quebrado, os ajustes feitos na UI valem na sessão mas não são persistidos; ao corrigir o arquivo, o app recarrega o conteúdo do disco. Falha de leitura ou gravação aparece como aviso no topo do popover.

**Idioma:** `settings.language` (`pt-BR` padrão, `en`, `es-MX`), no seletor de Ajustes > Aparência; vale na hora. Arquivo sem o campo (versões antigas) abre em pt-BR (`schemaVersion` 3). Os dicionários tipados ficam em `src/ui/i18n/{pt-BR,en,es-MX}.ts`: o `pt-BR.ts` define as chaves (`MessageKey`), os outros dois são `Record<MessageKey, string>` (o compilador pega chave faltando) e `i18n.spec.ts` confere a paridade de chaves e de placeholders. O `Localizer` (`ui/i18n/localizer.ts`) traduz com `t(key, args)` e formata datas, horas, durações, números e custo com `Intl` na língua escolhida; o serviço `I18n` expõe o `Localizer` como signal, então a troca atualiza a tela sem recarregar. O `domain` não tem texto de UI: problemas de conexão (`ConnectionProblem`), consertos (`FixAction`/`ActionLabel`), notas de status (`StatusNote`) e erros do app (`CodedError`/`ErrorCode`) são códigos que a UI mapeia para chaves (`problem.*`, `action.*`, `note.*`, `error.*`). Notificações e o tooltip da bandeja são montados pela porta `Translator` (`application/ports/translator.ts`, implementada por `LiveTranslator` e ligada à língua atual em `CurrentLanguage`); trocar o idioma refaz a leitura do Usage para atualizar o tooltip. No demo, `?lang=en` (ou `es-MX`) grava o idioma antes do boot. Ainda em pt-BR: mensagens técnicas devolvidas por infraestrutura (rede, Rust, GitHub/Microsoft) e erros de run já gravados em `runs.json`.

**Faixas de alerta do Usage:** `settings.usageThresholds` (`warning` 70 e `critical` 90 por padrão), editáveis em Ajustes; valem `0 < alerta < crítico ≤ 100` (valor inválido é ignorado na UI, no patch e na migração).

O seletor de cor nativo (`<input type="color">`) é proibido na `ui`: ele abre numa janela separada e o popover se fecha por perder o foco. O lint de arquitetura barra o uso.

## Tema e cores (DS Mottu)

A fonte da verdade das cores é o DS externo da Mottu (`@mottu-ops/ds-core-external`, GitHub Packages privado, **não** é dependência do app). `src/ui/theme/mottu-tokens.scss` é um snapshot, com os mesmos nomes `--me-*`, só do que o app usa (escalas primary, warning, alert, info e neutral, aliases `*-base/-dark/-alt/-light`, `background-change`/`component-change`/`text-change`, radius 2/4/8/16/1000 e shadow 1/2/3). `mottu-tokens.ts` espelha em hex o que o ECharts precisa (canvas não resolve `var()`), e `tools/theme-tokens.spec.ts` prova que os dois batem. Para atualizar, copie os valores do `dist/mottu-ds.css` do pacote.

`theme.scss` define as vars do app (`--cm-*`) em cima dos tokens via `var(--me-*)`. Componentes usam só `--cm-*`; hex fora de `src/ui/theme` e de `domain` é barrado por teste.

| Tema | Popover | Cards | Texto | Texto secundário |
|---|---|---|---|---|
| Escuro | `#1a1a1a` (entre `neutral-10` e `neutral-20`) | `#202022` | `neutral-95` | `neutral-70` |
| Claro | `neutral-99` | `neutral-100` | `neutral-10` | `neutral-40` |

Visual suave: a janela do Tauri é `transparent: true` (no macOS exige `app.macOSPrivateApi: true` e a feature `macos-private-api` do crate `tauri`) e o `.popover` desenha os cantos de 12 px (`--cm-radius-window`) com borda de 1 px translúcida (`--cm-edge`, 8% do texto) e a sombra nativa da janela (`shadow: true`; uma sombra CSS seria cortada na borda da janela). `html` e `body` são transparentes e o `color-scheme` fica em `cm-root`, nunca no `:root`, senão o navegador pinta o canvas e os cantos voltam a ser retos. Cards, controles e separadores usam bordas translúcidas (`--cm-border` 6%, `--cm-control-border` 14% só em botões e campos), raio de 12 px nos cards (`--cm-radius-md`) e de 8 px nos controles; abas e seletores de período são pills com o segmento ativo em verde. Fundo personalizado recalcula essas variáveis a partir do texto (`BACKGROUND_OVERRIDES` em `theme-style.ts`). Os hex do escuro (`soft-surfaces.ts`) ficam entre `neutral-10` e `neutral-20` do DS, e `tools/theme-tokens.spec.ts` confere isso.

- **Destaque = verde Mottu** (`--cm-accent`, padrão `#00b131` = `primary-base`): aba ativa, botões primários (receita do `me-button`: radius 2px, `:active` em `primary-dark`), seletor de período, foco, checkbox, "agora" e "próxima" da agenda. Texto e linhas finas usam `--cm-accent-text`: `primary-alt` (`#1bd60b`) no escuro, `primary-50` no claro. O texto sobre o destaque é escolhido por contraste WCAG (escuro `#121212` ou branco, o que passar de AA); no verde base sai escuro. Uma cor de destaque personalizada vale para tudo isso, inclusive os gráficos.
- **Semânticos:** erro = `alert`, aviso = `warning`, info = `info`, sucesso = `primary` (`--cm-danger`, `--cm-warning`, `--cm-info`, `--cm-ok`; as variantes `*-text` usam o passo do DS com contraste em cada tema).
- **Usage:** por padrão o 5h fica em `primary-alt` no escuro e `primary-base` no claro (ou a cor de destaque escolhida) e o 7d em cinza (`--cm-series-five` e `--cm-series-seven`), na barra e no gráfico. Em Ajustes, na seção recolhível "Linhas de consumo" (fechada por padrão; o cabeçalho mostra as cores atuais do 5h e do 7d), "5h" e "7d" (mesmo seletor de presets + hex validado, com "Usar cor padrão") gravam `seriesColors: { fiveHour, sevenDay }` no `settings.json` (schema 7; `null` = padrão do tema, então o padrão continua acompanhando claro/escuro e a cor de destaque). A cor escolhida vale em tudo que desenha a série: preenchimento da barra, marca do projetado, bolinha do "Projetado", legenda do gráfico, linha real, área, tendência tracejada e bolinha do tooltip. Nenhum texto é pintado com a cor da série (percentuais, rótulos e tooltip usam a cor de texto do tema), então uma cor escura demais ou clara demais para o fundo nunca deixa texto ilegível; a linha mantém exatamente a cor escolhida. As cores de faixa (cinza, amarelo `#FFC700`, vermelho `alert-base`) valem só para a projeção do 7d (tendência tracejada, marca vertical na barra e legenda "Projetado N%"), pela faixa do % projetado e pelos limiares de Ajustes; a projeção da 5h é verde e vira vermelha a partir de 100%.
- **SLA nos PRs (PRs e Reviews):** selo de idade e marca na borda esquerda da linha, pela idade desde a abertura de PRs abertos (`domain/pull-requests/sla.ts`): menos de 3 dias neutro, 3 a 6d23h amarelo `#FFC700` (Amarelo 1 da paleta oficial; o DS externo não tem amarelo) com texto escuro, 7 dias ou mais `alert-base`. Em Reviews a referência também é a abertura: o modelo de PR não traz a data do pedido de review. Vermelho nessas páginas só aparece para CI falhando e conflito; "Mudanças pedidas" usa `info`.
- **Fonte:** `"Helvetica Neue", Helvetica, Arial, sans-serif` em todo o app (`--cm-font-family`) e no `textStyle` do ECharts. Não há outra fonte.
- **Migração:** `schemaVersion` 2 troca o destaque antigo `#6366f1` (índigo, antigo padrão) por `#00b131`. Quem escolheu outra cor mantém a sua; quem tinha escolhido o índigo de propósito também é migrado, porque o valor é igual ao do padrão antigo.

## Conexões

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

## Claude usage

Página `usage` (poll de 5 min, exige a conexão Claude). `LoadUsage` chama o `AnthropicUsageGateway`, que invoca o command `claude_usage_fetch`: o Rust lê a credencial do Claude Code e faz o `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`), então o token não chega ao TypeScript; a resposta é limitada a 256 KiB (o `Content-Length` é checado antes e o corpo é lido em pedaços, cortando ao passar do limite, mesmo sem `Content-Length`); o app nunca faz refresh. Token vencido ou 401 vira `claude-expired` na conexão Claude e a página mostra "Refazer login do Claude". Os campos lidos são `five_hour` e `seven_day` (`utilization`, `resets_at`); o parse ignora campos extras e janelas sem `utilization` válida.

- **Histórico:** `usage-history.json` ao lado do `settings.json`. Pontos brutos por 7 dias; do 8º ao 30º dia, agregados em baldes de 15 min pelo máximo; nada passa de 30 dias (`domain/usage/retention.ts`). Fica em memória depois da primeira leitura e é gravado em série por arquivo temporário + `rename` (`fs:allow-rename` só em `$APPCONFIG`). Arquivo ilegível vira `usage-history.json.corrupt` e o histórico recomeça vazio, sem sobrescrever o original.
- **Histórico do ClaudeUsageBar (migração única):** na primeira carga bem-sucedida, `ImportExternalUsageHistory` lê `~/.config/claude-usage-bar/history.json` (`{"dataPoints":[{"timestamp","pct5h","pct7d"}]}`, frações 0–1) pela porta `ExternalUsageHistorySource` (adapter `TauriClaudeUsageBarHistorySource`; no demo, um fake vazio), mescla no histórico antes da retenção e grava o marcador `claudeUsageBarImportedAt` no próprio `usage-history.json`. Depois disso o arquivo nunca mais é lido: a partir daí o histórico é do próprio ClaudeMeter. Quem já tem qualquer ponto com a marca `imported` no `usage-history.json` é tratado como já migrado, sem ler o arquivo. Arquivo ausente ou ilegível conta como fonte vazia e também conclui a migração; só uma falha inesperada da fonte repete a tentativa na carga seguinte. Na mescla, fração vira %, pontos a até 1 min de um ponto existente (ou entre si) são descartados e o ponto nosso vence, nada com mais de 30 dias ou no futuro entra, e a retenção normal (brutos 7 d, baldes de 15 min até 30 d) vale para os importados. O parse é tolerante e arquivos acima de 8 MiB são ignorados. O ponto importado não tem `resets_at`: ele carrega a marca `imported` (4º elemento do ponto) e a detecção de ciclo ignora a comparação de `resets_at` nos pares com um ponto importado. A capability dá ao plugin-fs só `read-text-file` em `$HOME/.config/claude-usage-bar/history.json` (necessária para quem instala agora e tem o arquivo; `tools/capabilities.spec.ts` verifica o escopo). Não há toggle em Ajustes.
- **Erro transitório:** se uma atualização falha (rede, 5xx), a página mantém o último dado e mostra o banner de erro por cima, com "Mostrando os últimos dados carregados".
- **Rate limit (429/5xx):** a Anthropic devolve 429 em `/api/oauth/usage`. O Rust passa o `kind` `rate_limited` com `retryAfterSecs` opcional (um erro HTTP 429/5xx genérico também conta) e o gateway converte em `RateLimitedError`. O `PollingScheduler` adia o próximo poll da página para `max(Retry-After, 5 → 10 → 20 → 30 min)` (`domain/rate-limit.ts`), inclusive o refresh manual, e volta ao ritmo normal depois de um sucesso. O banner diz "Limite de consultas da Anthropic — tentando de novo em 12 min", sem path de API, mantendo os últimos dados.
- **Atualizar:** o botão ↻ do rodapé (à esquerda da engrenagem) recarrega a página atual por `scheduler.refresh`; fica girando enquanto carrega, tem cooldown de 30 s e, em backoff de rate limit, mostra o tempo restante no tooltip sem chamar a Anthropic (`ui/shell/refresh-state.ts`).
- **Layout:** no topo, duas barras (`5h` e `7d`) com o percentual à direita e "reseta em 2h06" embaixo; o previsto no reset é uma linha vertical fina (2 px, um pouco mais alta que a barra) no ponto do % projetado, na cor da projeção (no fim da barra e vermelha se passa de 100%, e a legenda traz o número real, ex.: "Projetado 132%"; sem marca quando não há projeção). Abaixo, o seletor `1h · 6h · 1d · 7d · 30d · Reset` (controle segmentado, padrão 6h; "Reset" mostra o ciclo semanal, de `resets_at` do 7d − 7 dias até o próximo reset, com marcas sutis em "agora" e nos resets da 5h do intervalo, e fica desabilitado sem `resets_at` conhecido) e um único gráfico ECharts (via `ngx-echarts`, carregado sob demanda) com as duas séries no mesmo eixo (eixo Y à direita, de 0 a 100% e de 25 em 25; quando a projeção desenhada passa de 100%, o eixo sobe até o próximo múltiplo de 25 acima do máximo projetado, com teto de 300% e passo de 50 acima de 200%), linhas suaves com área bem leve, grade tracejada, marcas verticais tracejadas em "agora" e nos resets que cabem no eixo, linha de referência sólida e sutil em 100% (vermelha com alfa baixo, só com o eixo expandido, e rótulo "100%" destacado no eixo) e legenda `● 5h ● 7d`. Não há frases de previsão nem títulos longos.
- **Gráfico (curva suave, como o ClaudeUsageBar):** o período visível (do início do eixo até agora) é dividido em 120 baldes (`CHART_BUCKETS`); cada balde com leitura vira um ponto com a média do % e a média do instante, e balde vazio é descartado (`downsample` em `usage-chart-model.ts`). Os pontos são ligados por curva suave (`smooth: 0.5` no ECharts), sem degraus e sem tratamento especial de lacunas ou resets. O tooltip do passado interpola na curva por Catmull-Rom (`curveValueAt`); depois do último ponto mostra o último valor. A projeção tracejada não usa os baldes: parte da última leitura real.
- **Projeção (uma regra só, escolhida em Ajustes > Projeção):** `projectionMethod` no `settings.json` (schema 6, padrão `14d`). `ProjectUsage` (`application/use-cases/usage`) calcula UMA vez por renderização `{ rate, valueAtReset, resetsAt, trend }` para o 5h e o 7d, e barras, linha tracejada (todos os períodos e o Ciclo), tooltip futuro e legenda "Projetado N%" só leem esse resultado (`domain/usage/forecast.ts`); o chart-model não recalcula nada. Métodos do 7d: `24h` (taxa = soma dos incrementos positivos do 7d nas últimas 24 h ÷ horas cobertas, quedas são reset e ignoradas; sem 2 h de dados cai em `since-reset`), `14d` (padrão: o mesmo nos últimos 14 dias, mínimo de 1 dia de dados, senão `since-reset`) e `since-reset` (taxa = % atual ÷ tempo desde o último reset, `resets_at` − duração da janela; com menos de 30 min decorridos não há projeção). Em todos, projetado = atual + taxa × tempo até o reset. O 5h usa sempre `since-reset`, qualquer que seja a escolha (a opção em Ajustes traz a linha de ajuda). A linha tem a cor da série, tracejada, do ponto atual até o `resets_at` (corte em 100% fora do Ciclo; o Ciclo expande o eixo, teto de 300%), com tooltip "data + Projetado N%" no Ciclo. A regressão linear foi removida. A bandeja mostra só o uso atual (percentuais e horários de reset), não projeção.

## Ícone de usage na bandeja

A cada leitura do `LoadUsage` (e a cada falha) a porta `UsageIndicator` atualiza o ícone e o tooltip da bandeja pelo command `tray_set_usage`; no demo o adapter é no-op.

- **macOS:** ícone largo (template, só o alfa conta) com o mascote pixel (grade 12×8 em `usage_icon.rs`, olhos como furos) à esquerda e duas linhas `5h`/`7d` com barra arredondada: trecho preenchido opaco, vazio a 35%. O mascote enche de baixo para cima conforme o `7d` (0% todo a 35%, 100% todo opaco) e, quando o `5h` ou o `7d` chega a 100% (sem limite), os olhos viram um X. A `tray-icon` fixa a altura do ícone em 18 pt, então o render é 128×36 px (@2x), pixel a pixel nessa altura.
- **Windows:** o ícone da bandeja é quadrado, então vai a variante 32×32 (16×16 em @1x) só com o mascote (enche com o `7d`, olhos em X quando um dos limites estoura; azul preenchido, cinza vazio, legível em barra clara e escura). Barras e números ficam no tooltip: `5h: 24% · reseta 14:09 | 7d: 51% · reseta seg 05:39` (`domain/usage/usage-tooltip.ts`).
- **Sem dado** (janela ausente, Claude desconectado, token vencido ou erro de leitura): mascote todo a 35% com olhos normais e barras com contorno tracejado (no Windows, só o mascote translúcido); o tooltip vira `ClawdMeter · usage indisponível`. Percentuais fora de 0–100 são limitados no Rust.
- **Antes da primeira leitura** (e com a página Usage desligada) vale o ícone padrão do app (`tray-template.png` no macOS, ícone da janela no Windows); o render com o mascote só aparece depois de uma tentativa de leitura.
- Os fontes ficam em `src-tauri/src/usage_icon.rs` (mascote em matriz de caracteres; fonte bitmap 4×6 embutida para `5`, `h`, `7`, `d`; sem fontes do sistema e sem dependência de imagem). `cargo run --example render_usage_preview` (em `src-tauri/`) regrava os PNGs de `docs/tray-preview/`.

## Popover sobre apps em tela cheia (macOS)

Com outro app em tela cheia (Space próprio), uma janela comum não aparece. Em `platform.rs`, `prepare_popover` roda na criação da janela e antes de cada `show`: chama `set_visible_on_all_workspaces(true)` e completa pelo `NSWindow` com `collectionBehavior` = `CanJoinAllSpaces | FullScreenAuxiliary | Stationary | IgnoresCycle` (sem `FullScreenPrimary`/`Transient`/`MoveToActiveSpace`, que conflitam) e nível `NSPopUpMenuWindowLevel`. A política de ativação segue `Accessory`. No Windows não há mudança: o popover é uma janela sem borda com `alwaysOnTop`, e isso não foi validado em máquina Windows. Só o cálculo do behavior e do nível tem teste automatizado; o efeito sobre um app em tela cheia real precisa ser conferido à mão.

## Sessões

Página `sessions` (poll de 5 s, sem conexão). `TauriSessionDirectory` lê `<home>/.claude/sessions/*.json` (`homeDir()` do Tauri: `~` no macOS, `%USERPROFILE%` no Windows) e `LoadSessions` mantém só os pids vivos (`process_is_alive`, command Rust da F2). Cada sessão mostra nome (ou pasta), pasta curta, status (`busy`/`idle`/`shell`) e há quanto tempo está nele (`statusUpdatedAt`, senão `updatedAt`). Fica destacada a sessão `idle` há mais de 5 min ("Aguardando input há X") ou `busy` há mais de 30 min ("Ocupada há X"); os limiares estão em `DEFAULT_ATTENTION_CONFIG` (`domain/sessions/attention.ts`) e são injetados em `LoadSessions` pelo composition root.

A capability dá ao plugin-fs só `exists` e `read-dir` em `$HOME/.claude/sessions` e `read-text-file` em `$HOME/.claude/sessions/*.json`; o allowlist do plugin-http não inclui mais `https://api.anthropic.com` (a chamada de usage é feita pelo Rust; o resto do HTTP passa pelo plugin, então o `connect-src` do CSP não lista hosts externos).

No modo demo as duas páginas usam dados falsos (histórico de 30 dias gerado por um modelo determinístico, cinco sessões em estados diferentes e uma morta). `?demo=claude:claude-expired` (e os demais cenários de conexão) mostra o estado de erro da página de usage com o botão de conserto.

## Página Agenda

Reuniões de hoje do Outlook/Teams, ligada à conexão Microsoft, com poll de 5 min.

- Fonte: `GET https://graph.microsoft.com/v1.0/me/calendarView` (permissão delegada) com `startDateTime`/`endDateTime` do dia em `America/Sao_Paulo`, header `Prefer: outlook.timezone="America/Sao_Paulo"`, `$select`, `$orderby=start/dateTime`, `$top=50` e paginação por `@odata.nextLink` (só segue links do próprio `graph.microsoft.com`; máximo de 10 páginas).
- Regras de dia, fuso, "agora" e "próxima" ficam em `src/domain/calendar` (testadas: virada de dia, horário de verão, dia inteiro, cancelada, reunião que atravessa a meia-noite).
- Canceladas aparecem riscadas e nunca contam como "agora" nem "próxima"; eventos de dia inteiro ficam numa lista própria.
- **Entrar** abre `onlineMeeting.joinUrl` pelo `OpenUrl`, só se for `https` em `teams.microsoft.com` ou `teams.live.com` (validado em `teamsJoinUrl`, no mapeamento do Graph e de novo no caso de uso `JoinMeeting`).
- 401/403 do Graph ou token vencido viram `microsoft-expired`: a página mostra o aviso e o botão "Refazer login da Microsoft"; depois do conserto ela recarrega na hora (`PollingScheduler.refresh`).
- A allowlist do `plugin-http` inclui `https://graph.microsoft.com`; o `connect-src` do CSP não lista hosts externos porque todo HTTP passa pelo plugin.

## PRs e Reviews

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

## Skills (runs)

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

- Comando: `claude -p "<prompt>" --output-format stream-json --verbose --max-budget-usd <valor> --allowedTools "Read(./**),Bash(gh pr diff:*),…"` via `process_spawn` (sem shell; a lista de ferramentas é um único argumento). `--verbose` é exigido pelo `stream-json` em modo `-p`. Prompt começando com `-` é rejeitado. `cwd` precisa ser absoluto e sem `..`; sem `cwd` a run começa em `app_cache_dir()/skill-cwd` (no macOS `~/Library/Caches/com.mottu.clawdmeter/skill-cwd`), uma pasta vazia do app, e não na pasta do usuário.

- **Falha sem `result` (round 3).** Se o processo termina sem evento `result`, a run falha mostrando o stderr (últimos 2000 caracteres); quando houve linha truncada, o erro é a mensagem de truncamento seguida do stderr, em outra linha. Sem stderr, vale a mensagem genérica com o código de saída.
- O stream é lido linha a linha (`process-output`/`process-exit`) e interpretado no `domain/skills` (`parseStreamLine` + `applyStreamEvent`): mensagens do assistant, `result` com custo/duração e `session_id`.
- **Cancelar** mata o grupo do processo (`process_kill`); cancelar antes do processo estar anexado fica guardado e é aplicado no attach. O histórico (últimas 20 runs, sem o log ao vivo) fica em `runs.json` no `appConfigDir`, com gravações serializadas.
- Ao fim da run (sucesso ou falha, nunca cancelada) sai uma notificação local com custo e duração, se a conexão de notificações estiver ok.
- **Continuar no terminal** abre `claude --resume <session_id>` (o id precisa ser UUID) na mesma pasta da run.
- Problemas com botão de conserto: MCP com `needs-auth`, `pending` ou `failed` no `init` (`mcp_servers[].status`) → **Reconectar MCP** (Terminal com `claude /mcp`); Claude Code ausente → **Instalar Claude Code**.

## Build e release

- `.github/workflows/ci.yml`: em push na `main` e em PR, roda lint, typecheck, Vitest, build, `cargo test`, `cargo fmt --check` e `cargo clippy --all-targets -- -D warnings` em `macos-latest` e `windows-latest`; um job `supply-chain` (ubuntu) roda `cargo audit` e `cargo deny check` (`src-tauri/deny.toml`: licenças permissivas, advisories e fontes só do crates.io).
- `.github/workflows/release.yml`: em tag `v*`, gera `.dmg` universal (arm64 + x64, macOS 14+) e `.msi` (Windows 10+) com `tauri-apps/tauri-action` e anexa a um release em rascunho.
- **Permissões e pins.** O `ci.yml` roda com `permissions: contents: read`; o `release.yml` só tem `contents: write` (precisa criar o release em rascunho). Todo `actions/checkout` usa `persist-credentials: false`, então o token não fica gravado no `.git` dos jobs. Todas as actions estão fixadas por SHA de commit, com a versão em comentário `# vN` ao lado: `actions/checkout` v4.4.0, `actions/setup-node` v4.4.0, `swatinem/rust-cache` v2.9.3, `taiki-e/install-action` v2.90.1, `tauri-apps/tauri-action` v0.6.2 e `dtolnay/rust-toolchain` na branch `stable` (a action deriva o toolchain do nome da ref, e um SHA não carrega esse nome, então o `toolchain:` vai explícito). O Dependabot (`.github/dependabot.yml`) abre PRs semanais para `github-actions`, `cargo` (`/src-tauri`) e `npm`, e atualiza o SHA junto com o comentário. Os SHAs foram conferidos com `gh api repos/<org>/<repo>/commits/<sha>` e `…/tags`. Um teste (`tools/workflows.spec.ts`) falha se uma action sair do pin por SHA, perder o comentário de versão, ou se um checkout perder o `persist-credentials: false`.
- **Toolchain Rust fixo.** `rust-toolchain.toml` (raiz) fixa `1.99.1`, a versão estável instalada na máquina de desenvolvimento (`rustc 1.99.1`, 2026-10-13), com `clippy` e `rustfmt`; o CI e o release passam `toolchain: 1.99.1` à action e o mesmo teste exige que os valores coincidam. Para subir a versão, troque o `channel` e os `toolchain:` juntos.

Para publicar: ajuste a versão em `package.json` e `src-tauri/Cargo.toml` (o `tauri.conf.json` lê a versão do `package.json`), e crie a tag.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

> O `identifier` do bundle é `com.mottu.clawdmeter`, o mesmo nome do serviço do Keychain / Credential Manager e das pastas do app (config, cache e logs). Veja [Migração do identifier antigo](#migração-do-identifier-antigo).

### Migração do identifier antigo

Até a 0.1.0 o app usava o identifier `com.mottu.devpulse`. Na primeira abertura com `com.mottu.clawdmeter` (`legacy_migration.rs`, no `setup` do Tauri, antes do log e antes de o webview ler qualquer config):

- **Arquivos:** se a pasta nova de config (`~/Library/Application Support/com.mottu.clawdmeter` no macOS, `%APPDATA%\com.mottu.clawdmeter` no Windows) não existe ou está vazia e a antiga (`…/com.mottu.devpulse`) existe, os arquivos do nível de cima da antiga (`settings.json`, `usage-history.json`, `connections.json`, `runs.json`, `skills.json` e afins; ignora `*.tmp`, ocultos e subpastas) são **copiados** para uma pasta temporária `com.mottu.clawdmeter.migrating`, que ganha o marcador `.legacy-config-migrated` e é renomeada para a pasta nova de uma vez. A pasta antiga não é apagada. Com o marcador presente, ou com a pasta nova já em uso, nada acontece.
- **Segredos:** na primeira chamada de `secret_get/set/delete`, cada chave de `ALLOWED_SECRET_KEYS` que não existe no serviço `com.mottu.clawdmeter` e existe em `com.mottu.devpulse` é lida (remontando as fatias `dp-chunked:v1:`) e gravada no serviço novo; o antigo não é apagado. O marcador `.legacy-secrets-migrated` na pasta de config impede uma segunda cópia (um logout não é desfeito na abertura seguinte); se o Keychain recusar a leitura, o marcador não é gravado e a cópia é tentada de novo na próxima abertura. A credencial do Claude Code não é do app e não é tocada.
- **Logs:** o `popover.log` passa a ser gravado no `app_log_dir()` novo (`~/Library/Logs/com.mottu.clawdmeter` no macOS); o resultado das duas migrações fica registrado nele (`legacy-config …`, `legacy-secrets …`).
- O cabeçalho `dp-chunked:v1:` dos segredos fatiados é formato persistido e mantém o nome antigo.

## Backlog

- **Atualização automática.** Criar o repositório no GitHub (Mottu-ops), publicar cada versão como Release pelo `release.yml` (.dmg e .msi) e fazer o app consultar a última Release com o login do GitHub que ele já tem. Ao detectar versão mais nova, mostrar um bloco "Nova versão X · Atualizar" que baixa, confere a assinatura (`tauri-plugin-updater` com chave própria) e instala.
