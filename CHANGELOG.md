# Changelog

## 0.1.0

Primeira versão distribuída internamente.

- Ícone na barra de menu do macOS com o mascote, que enche conforme o consumo semanal e mostra as barras de 5h e 7d; atalho Ctrl + Option + D abre o painel.
- Aba Uso: barras de 5h e 7d com projeção até o reset, gráfico de 1h a 30d e ciclo semanal, curva suave, histórico de até 30 dias guardado localmente e importação única do histórico do ClaudeUsageBar.
- Aba Sessões: sessões abertas do Claude Code, com aviso para as que esperam input há muito tempo.
- Abas Pull Requests e Reviews: PRs por repositório com CI, decisão de review, conflito e idade (SLA), via GitHub.
- Conexões com Claude Code (credencial somente leitura), GitHub (gh CLI, navegador ou token) e Microsoft.
- Ajustes: abas, conexões, método de projeção, faixas de alerta, idioma (pt-BR, en, es-MX), cor de destaque, cores das linhas de consumo e tema claro, escuro ou do sistema.
- Aba Agenda (Outlook/Teams) e aba Skills (runs do Claude Code com allowlist de ferramentas) implementadas e em manutenção.
- Migração automática dos dados do identifier antigo `com.mottu.devpulse`.
- Instalador `.dmg` não assinado para macOS 14 ou superior (Apple Silicon).
