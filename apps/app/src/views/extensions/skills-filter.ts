import type { SkillEntry, SkillSource, SkillState } from '@zana-ai/zcc-domain/product';

export type SourceFilter = 'all' | SkillSource;
export type StateFilter = 'all' | SkillState;

export interface SkillFilters {
  source: SourceFilter;
  /** `SkillEntry.toolLabel`, or `all`. */
  harness: string;
  state: StateFilter;
  query: string;
}

export interface ParsedSkillQuery {
  text: string[];
  harness: string[];
  state: string[];
  source: string[];
  plugin: string[];
}

const TOKEN_KEYS: Record<string, keyof Omit<ParsedSkillQuery, 'text'>> = {
  harness: 'harness',
  tool: 'harness',
  state: 'state',
  is: 'state',
  source: 'source',
  plugin: 'plugin'
};

/** Effective load state, also for rows whose owner only reports `enabled`. */
export function skillState(skill: SkillEntry): SkillState {
  return skill.toggle.state ?? (skill.enabled ? 'on' : 'off');
}

/** `harness:codex state:manual gus` → structured terms. Unknown `key:` tokens stay free text. */
export function parseSkillQuery(query: string): ParsedSkillQuery {
  const out: ParsedSkillQuery = { text: [], harness: [], state: [], source: [], plugin: [] };
  for (const raw of query.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    const colon = raw.indexOf(':');
    const key = colon > 0 ? TOKEN_KEYS[raw.slice(0, colon)] : undefined;
    const value = colon > 0 ? raw.slice(colon + 1) : '';
    if (key && value) out[key].push(value);
    else out.text.push(raw);
  }
  return out;
}

function harnessMatches(skill: SkillEntry, harness: string): boolean {
  // ZCC-injected skills reach every harness, so they belong to each harness view.
  return skill.allHarnesses === true || skill.toolLabel === harness;
}

function harnessTermMatches(skill: SkillEntry, term: string): boolean {
  if (skill.allHarnesses) return true;
  return skill.toolLabel.toLowerCase().includes(term) || skill.tool.toLowerCase().includes(term);
}

export function matchesSkill(
  skill: SkillEntry,
  filters: SkillFilters,
  parsed: ParsedSkillQuery = parseSkillQuery(filters.query)
): boolean {
  if (filters.source !== 'all' && skill.source !== filters.source) return false;
  if (filters.harness !== 'all' && !harnessMatches(skill, filters.harness)) return false;
  const state = skillState(skill);
  if (filters.state !== 'all' && state !== filters.state) return false;
  if (!parsed.harness.every((term) => harnessTermMatches(skill, term))) return false;
  if (!parsed.state.every((term) => state.startsWith(term))) return false;
  if (!parsed.source.every((term) => skill.source.startsWith(term))) return false;
  if (!parsed.plugin.every((term) => (skill.pluginName ?? '').toLowerCase().includes(term)))
    return false;
  if (!parsed.text.length) return true;
  const haystack =
    `${skill.name} ${skill.description ?? ''} ${skill.pluginName ?? ''} ${skill.toolLabel} ${skill.path}`.toLowerCase();
  return parsed.text.every((term) => haystack.includes(term));
}

export function filterSkills(skills: readonly SkillEntry[], filters: SkillFilters): SkillEntry[] {
  const parsed = parseSkillQuery(filters.query);
  return skills.filter((skill) => matchesSkill(skill, filters, parsed));
}

export interface HarnessOption {
  label: string;
  count: number;
}

/** Harness chips derived from the catalogue itself — no tool ids are named in the renderer. */
export function harnessOptions(skills: readonly SkillEntry[]): HarnessOption[] {
  const labels = new Map<string, number>();
  let shared = 0;
  for (const skill of skills) {
    if (skill.allHarnesses) shared += 1;
    else labels.set(skill.toolLabel, (labels.get(skill.toolLabel) ?? 0) + 1);
  }
  return [...labels]
    .map(([label, count]) => ({ label, count: count + shared }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function stateCounts(skills: readonly SkillEntry[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { all: skills.length, on: 0, manual: 0, off: 0 };
  for (const skill of skills) counts[skillState(skill)] += 1;
  return counts;
}
