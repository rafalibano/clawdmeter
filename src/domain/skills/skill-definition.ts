export interface SkillDefinition {
  id: string;
  name: string;
  prompt: string;
  maxBudgetUsd: number;
  allowedTools: string[];
  cwd: string | null;
}

export const SKILLS_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_BUDGET_USD = 2;
export const ALLOWED_CLAUDE_TOOLS: readonly string[] = [
  'Read(./**)',
  'Bash(gh pr list:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr checks:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh search prs:*)',
];
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  'Read(./**)',
  'Bash(gh pr list:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr checks:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh search prs:*)',
];

export const DEFAULT_SKILLS: readonly SkillDefinition[] = [
  {
    id: 'acabativa',
    name: 'Acabativa',
    prompt: '/acabativa',
    maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
    allowedTools: [...DEFAULT_ALLOWED_TOOLS],
    cwd: null,
  },
];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const TOOL_PATTERN = /^[a-z0-9()*:._/@ -]+$/i;
const MAX_ALLOWED_TOOLS_LENGTH = 1_024;
const MAX_PROMPT_BYTES = 8_192;
const MAX_BUDGET_USD = 1_000;
const MAX_BUDGET_TEXT_LENGTH = 12;
const BUDGET_TEXT_PATTERN = /^\d+(\.\d+)?$/;

const ABSOLUTE_PATH_PATTERN = /^(\/|[a-z]:[\\/]|\\\\)/i;

export function isAbsolutePath(path: string): boolean {
  return (
    ABSOLUTE_PATH_PATTERN.test(path) &&
    !path.includes('\0') &&
    !path.split(/[\\/]/).includes('..')
  );
}

function isValidBudget(budget: unknown): budget is number {
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_USD) return false;
  const text = String(budget);
  return text.length <= MAX_BUDGET_TEXT_LENGTH && BUDGET_TEXT_PATTERN.test(text);
}

function isValidTool(tool: unknown): tool is string {
  return typeof tool === 'string' && tool.trim() !== '' && !tool.startsWith('-') && TOOL_PATTERN.test(tool);
}

function parseSkill(raw: unknown): SkillDefinition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const { id, name, prompt, maxBudgetUsd, allowedTools, cwd } = source;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.trim().startsWith('-')) return null;
  if (new TextEncoder().encode(prompt.trim()).length > MAX_PROMPT_BYTES) return null;
  const budget = maxBudgetUsd === undefined ? DEFAULT_MAX_BUDGET_USD : maxBudgetUsd;
  if (!isValidBudget(budget)) return null;
  const tools = allowedTools === undefined ? [...DEFAULT_ALLOWED_TOOLS] : allowedTools;
  if (!Array.isArray(tools) || !tools.every(isValidTool) || tools.join(',').length > MAX_ALLOWED_TOOLS_LENGTH) return null;
  if (cwd !== undefined && cwd !== null && (typeof cwd !== 'string' || !isAbsolutePath(cwd))) return null;
  return {
    id,
    name: name.trim(),
    prompt: prompt.trim(),
    maxBudgetUsd: budget,
    allowedTools: tools as string[],
    cwd: typeof cwd === 'string' ? cwd : null,
  };
}

export function parseSkillsConfig(raw: unknown): SkillDefinition[] {
  const list = (raw as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(list)) return DEFAULT_SKILLS.map((skill) => ({ ...skill }));
  const seen = new Set<string>();
  const skills: SkillDefinition[] = [];
  for (const entry of list) {
    const skill = parseSkill(entry);
    if (skill === null || seen.has(skill.id)) continue;
    seen.add(skill.id);
    skills.push(skill);
  }
  return skills;
}

export function findDisallowedTools(tools: readonly string[]): string[] {
  return tools.filter((tool) => !ALLOWED_CLAUDE_TOOLS.includes(tool));
}

export function assertAllowedTools(skill: SkillDefinition): void {
  const disallowed = findDisallowedTools(skill.allowedTools);
  if (disallowed.length > 0) {
    throw new Error(
      `Skill "${skill.name}" uses a tool that is not allowed: ${disallowed.join(', ')}. Update skills.json (e.g. "Read" became "Read(./**)" and "Bash(git diff|log|status:*)" was removed from the list; use "Bash(gh pr diff:*)"; "Grep" and "Glob" were also removed, inside the run cwd they work without a rule). Allowed: ${ALLOWED_CLAUDE_TOOLS.join(', ')}.`,
    );
  }
}

export function buildClaudeArgs(skill: SkillDefinition): string[] {
  assertAllowedTools(skill);
  const args = [
    '-p',
    skill.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-budget-usd',
    String(skill.maxBudgetUsd),
  ];
  if (skill.allowedTools.length > 0) args.push('--allowedTools', skill.allowedTools.join(','));
  return args;
}
