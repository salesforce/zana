import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ entries: [] as Array<{ id: string; name: string }> }));
vi.mock('../skills/injected-skill-entries.js', () => ({ listInjectedSkillEntries: () => catalog.entries }));

import { narrowAutomatedSkillIds, providerSkillAllowlist, resolvePersonaSkillSelection } from './persona-skill-selection.js';

beforeEach(() => {
  catalog.entries = [
    { id: 'zcc:acme/review', name: 'review' },
    { id: 'zcc:acme/zcc-inbox', name: 'zcc-inbox' },
    { id: 'zcc:acme/other', name: 'other' }
  ];
});

describe('resolvePersonaSkillSelection', () => {
  it('is unrestricted ({}) when persona has no skills and team is not lean', () => {
    expect(resolvePersonaSkillSelection('/d', undefined, {}, 'worker')).toEqual({});
    expect(resolvePersonaSkillSelection('/d', { leanWorkers: false }, {}, 'worker')).toEqual({});
  });

  it('maps a restricted list to catalog ids and remaining names', () => {
    const out = resolvePersonaSkillSelection('/d', undefined, { skills: ['review', 'ext:fmt'] }, 'worker');
    expect(out.automatedSkillIds).toEqual(expect.arrayContaining(['zcc:acme/review', 'zcc:acme/zcc-inbox']));
    expect(out.automatedSkillIds).not.toContain('zcc:acme/other');
    expect(out.allowedSkillNames).toContain('ext:fmt');
  });

  it('keeps an empty persona list restricted (not unset)', () => {
    const out = resolvePersonaSkillSelection('/d', undefined, { skills: [] }, 'worker');
    expect(out.automatedSkillIds).toBeDefined();
    expect(out.allowedSkillNames).toEqual([]);
  });

  it('lean workers restrict workers but not orchestrators; explicit list beats lean', () => {
    const lean = { leanWorkers: true };
    expect(resolvePersonaSkillSelection('/d', lean, {}, 'worker').automatedSkillIds).toEqual(['zcc:acme/zcc-inbox']);
    expect(resolvePersonaSkillSelection('/d', lean, {}, 'orchestrator')).toEqual({});
    expect(resolvePersonaSkillSelection('/d', lean, { skills: ['review'] }, 'worker').automatedSkillIds)
      .toContain('zcc:acme/review');
  });
});

describe('providerSkillAllowlist', () => {
  it('is undefined when unrestricted', () => {
    expect(providerSkillAllowlist(['zcc:a/b'], undefined)).toBeUndefined();
    expect(providerSkillAllowlist(undefined, undefined)).toBeUndefined();
  });
  it('merges names and bare catalog names, deduped; empty stays an empty array', () => {
    expect(providerSkillAllowlist(['zcc:acme/review'], ['x', 'review'])).toEqual(['zcc-inbox', 'x', 'review']);
    expect(providerSkillAllowlist(undefined, [])).toEqual(['zcc-inbox']);
  });
});

describe('narrowAutomatedSkillIds', () => {
  it('unrestricted keeps the explicit selection (or stays unset)', () => {
    expect(narrowAutomatedSkillIds(undefined, undefined)).toBeUndefined();
    expect(narrowAutomatedSkillIds(['a'], undefined)).toEqual(['a']);
  });
  it('restricted never widens: no explicit selection stays empty, explicit is intersected', () => {
    expect(narrowAutomatedSkillIds(undefined, ['zcc:o/zcc-inbox', 'zcc:o/x'])).toEqual([]);
    expect(narrowAutomatedSkillIds(['zcc:o/x', 'zcc:o/y'], ['zcc:o/x'])).toEqual(['zcc:o/x']);
    expect(narrowAutomatedSkillIds(['zcc:o/y'], [])).toEqual([]);
  });
});
