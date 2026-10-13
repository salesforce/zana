import { expect, it } from 'vitest';
import type { SkillEntry } from '@zana-ai/zcc-domain/product';
import { filterSkills, harnessOptions, parseSkillQuery, skillState, stateCounts, type SkillFilters } from './skills-filter.js';

const entry = (name: string, extra: Partial<SkillEntry> = {}): SkillEntry =>
  ({
    id: `user:${name}`,
    name,
    tool: 'claude-code',
    toolLabel: 'Claude Code',
    source: 'user',
    path: `/skills/${name}`,
    kind: 'skill',
    enabled: true,
    toggle: { supported: true, enabled: true },
    ...extra
  }) as SkillEntry;
const skills = [
  entry('review', { description: 'Review the diff' }),
  entry('lint', { tool: 'codex', toolLabel: 'Codex', toggle: { supported: true, enabled: true, state: 'manual' } }),
  entry('old', { enabled: false, toggle: { supported: false, enabled: false } }),
  entry('gus-work', { id: 'zcc:gus/gus-work', tool: 'zcc', toolLabel: 'All harnesses', allHarnesses: true, source: 'plugin', pluginName: 'gus' })
];
const base: SkillFilters = { source: 'all', harness: 'all', state: 'all', query: '' };
const names = (filters: Partial<SkillFilters>) => filterSkills(skills, { ...base, ...filters }).map((s) => s.name);

it('parses structured tokens and keeps unknown keys as text', () => {
  expect(parseSkillQuery('  Harness:Codex is:man source:user plugin:gus foo:bar  x tool: ')).toEqual({
    text: ['foo:bar', 'x', 'tool:'],
    harness: ['codex'],
    state: ['man'],
    source: ['user'],
    plugin: ['gus']
  });
});

it('derives state from toggle.state or enabled', () => {
  expect(skills.map(skillState)).toEqual(['on', 'manual', 'off', 'on']);
});

it('filters by chips and tokens; injected skills belong to every harness', () => {
  expect(names({ harness: 'Codex' })).toEqual(['lint', 'gus-work']);
  expect(names({ query: 'harness:claude' })).toEqual(['review', 'old', 'gus-work']);
  expect(names({ query: 'tool:codex' })).toEqual(['lint', 'gus-work']);
  expect(names({ state: 'off' })).toEqual(['old']);
  expect(names({ query: 'state:m' })).toEqual(['lint']);
  expect(names({ source: 'plugin' })).toEqual(['gus-work']);
  expect(names({ query: 'source:us' })).toEqual(['review', 'lint', 'old']);
  expect(names({ query: 'plugin:gus' })).toEqual(['gus-work']);
  expect(names({ query: 'diff' })).toEqual(['review']);
  expect(names({ query: 'all harnesses' })).toEqual(['gus-work']);
  expect(names({ query: '/skills/li' })).toEqual(['lint']);
});

it('counts harness and state chips', () => {
  expect(harnessOptions(skills)).toEqual([
    { label: 'Claude Code', count: 3 },
    { label: 'Codex', count: 2 }
  ]);
  expect(harnessOptions([entry('a', { toolLabel: 'B' }), entry('b', { toolLabel: 'A' })]).map((h) => h.label)).toEqual(['A', 'B']);
  expect(stateCounts(skills)).toEqual({ all: 4, on: 2, manual: 1, off: 1 });
});
