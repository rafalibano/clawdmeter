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
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'Bash(gh:*)', 'Bash(git:*)'];

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
  const budget = maxBudgetUsd === undefined ? DEFAULT_MAX_BUDGET_USD : maxBudgetUsd;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return null;
  const tools = allowedTools === undefined ? [...DEFAULT_ALLOWED_TOOLS] : allowedTools;
  if (!Array.isArray(tools) || !tools.every(isValidTool) || tools.join(',').length > MAX_ALLOWED_TOOLS_LENGTH) return null;
  if (cwd !== undefined && cwd !== null && (typeof cwd !== 'string' || cwd.trim() === '')) return null;
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

export function buildClaudeArgs(skill: SkillDefinition): string[] {
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
