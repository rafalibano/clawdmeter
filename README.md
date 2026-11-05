# Dev Pulse

App de bandeja para macOS e Windows. No macOS fica na barra de menu; no Windows, na área de notificação. Um clique no ícone abre um popover com as páginas ligadas (hoje só uma página de exemplo; Claude usage, PRs, Sessões, Teams e Skills entram nas próximas fases).

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
├─ domain/            TS puro: modelos e regras (settings, connections, ...)
├─ application/
│  ├─ ports/          interfaces que a infraestrutura implementa (SettingsStore, Clock, ...)
│  ├─ use-cases/      um arquivo por caso de uso, um método execute()
│  ├─ pages/          PageModule (contrato) e PageRegistry
│  ├─ scheduler/      PollingScheduler: só agenda páginas ligadas
│  └─ testing/        fakes das portas, usados só nos testes
├─ infrastructure/
│  ├─ persistence/    JsonSettingsStore, LocalStorageJsonFile
│  └─ platform/       TauriJsonFile (appConfigDir + plugin fs), SystemClock
├─ ui/
│  ├─ shell/          popover, rodapé "atualizado há Xs" e botão ⚙
│  ├─ settings/       Ajustes: páginas, aparência
│  ├─ theme/          tokens CSS: destaque, fundo, claro/escuro/sistema
│  └─ pages/          uma pasta por página
├─ composition-root.ts        DI manual com os adapters reais (Tauri)
└─ composition-root.demo.ts   DI do modo demo no navegador (localStorage)
src-tauri/            Rust: bandeja, janela do popover, plugins
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

2. Registre em `composition-root.ts` (e em `composition-root.demo.ts`, com adapters fakes) adicionando uma linha em `pages`:

```ts
pages: [createExamplePage({ clock }), createUsagePage({ clock })],
```

Checkbox em Ajustes, polling e exigência de conexão saem do `PageRegistry`. Fonte de dado nova = uma porta em `application/ports` + um adapter em `infrastructure/`. O componente lê o resultado tipado com `PageStateService.of(USAGE_PAGE)`; quem assina o scheduler depois recebe o último resultado de cada página, então páginas sem polling (`pollIntervalMs: null`) não perdem o primeiro update.

`PageComponent` é `new () => unknown`: o componente injeta dependências com `inject()`, não pelo construtor.

### Ajustes

O botão ⚙ no canto inferior direito é o único acesso. Páginas (checkboxes geradas do registry), aparência (cor de destaque, fundo do popover, tema claro/escuro/sistema) valem na hora via CSS custom properties e são gravadas em `settings.json` na pasta de config do SO (`appConfigDir`):

| SO | Caminho |
|---|---|
| macOS | `~/Library/Application Support/com.mottu.devpulse/settings.json` |
| Windows | `%APPDATA%\com.mottu.devpulse\settings.json` |

O arquivo tem `schemaVersion`; versões antigas são migradas na leitura. Editar o arquivo à mão com o app aberto recarrega as configurações.

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

Para publicar: ajuste a versão em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`, e crie a tag.

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

- Sem assinatura de código (macOS e Windows) e sem updater.
- O comportamento no Windows (posição do popover, ocultar ao perder o foco) não foi validado em máquina Windows; o CI só compila e roda testes.
