import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `persona-skills-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import {
  ALWAYS_ALLOWED_SKILLS,
  PERSONA_SKILLS_MAX,
  effectiveSkills,
  mapSkillAllowlist,
  sanitizePersonaSkills,
  skillAllowlistCovers,
  skillAllowlistEntryMatches,
  toPersonaSummary,
  uninstalledAllowlistSkills,
  type Persona
} from '@zana-ai/zcc-domain/product';
import { SquadMemberRuntimeRequestSchema } from '@zana-ai/zcc-contracts/runtime';
import { sanitizePersona, projectPersonaFields } from '../persona-store.js';
import { sanitizeTeam } from '../team-store.js';

describe('sanitizePersonaSkills', () => {
  it('keeps unset distinct from an explicit empty list', () => {
    expect(sanitizePersonaSkills(undefined)).toBeUndefined();
    expect(sanitizePersonaSkills([])).toEqual([]);
  });
  it('accepts name, plugin:skill and :name; trims and dedupes', () => {
    expect(sanitizePersonaSkills([' a ', 'a', 'plug:b', ':c', 'd.e-f_g'])).toEqual(['a', 'plug:b', ':c', 'd.e-f_g']);
  });
  it('rejects non-arrays, globs, bad entries and over-limit lists', () => {
    for (const bad of ['a', {}, null, 3, ['*'], ['a*'], ['pl*:x'], [''], ['  '], [1], [{}], ['a b'], ['a:b:c:'], ['x'.repeat(201)], Array.from({ length: PERSONA_SKILLS_MAX + 1 }, (_, i) => `s${i}`)]) {
      expect(sanitizePersonaSkills(bad)).toBeNull();
    }
    expect(sanitizePersonaSkills(Array.from({ length: PERSONA_SKILLS_MAX }, (_, i) => `s${i}`))).toHaveLength(PERSONA_SKILLS_MAX);
  });
});

describe('persona-store sanitizer with skills', () => {
  const base = { id: 'p', name: 'P' };
  it('preserves skills, including an empty array, and omits the key when unset', () => {
    expect(sanitizePersona({ ...base, skills: ['x'] })?.skills).toEqual(['x']);
    expect(sanitizePersona({ ...base, skills: [] })?.skills).toEqual([]);
    expect(sanitizePersona(base)).not.toHaveProperty('skills');
    expect(JSON.stringify(sanitizePersona(base))).not.toContain('skills');
  });
  it('rejects a persona with malformed skills', () => {
    expect(sanitizePersona({ ...base, skills: '*' })).toBeNull();
    expect(sanitizePersona({ ...base, skills: ['a*'] })).toBeNull();
  });
  it('survives projectPersonaFields and surfaces on the summary only when set', () => {
    const p = sanitizePersona({ ...base, skills: ['x'] })!;
    expect(projectPersonaFields(p).skills).toEqual(['x']);
    expect(toPersonaSummary(p).skills).toEqual(['x']);
    expect(toPersonaSummary({ ...p, skills: [] }).skills).toEqual([]);
    expect(toPersonaSummary({ id: 'q', name: 'Q' })).not.toHaveProperty('skills');
  });
});

describe('sanitizeTeam leanWorkers', () => {
  const team = (extra: Record<string, unknown> = {}) => sanitizeTeam({ id: 't', name: 'T', slots: [{ personaId: 'a' }], ...extra })!;
  it('keeps leanWorkers only for boolean true', () => {
    expect(team({ leanWorkers: true }).leanWorkers).toBe(true);
    for (const bad of [false, 'true', 1, null, {}]) expect(team({ leanWorkers: bad })).not.toHaveProperty('leanWorkers');
  });
  it('frozen loader: an unset file loads and saves byte for byte', () => {
    const raw = { id: 't', name: 'T', slots: [{ personaId: 'a' }] };
    const once = JSON.stringify(sanitizeTeam(raw));
    expect(once).not.toContain('leanWorkers');
    expect(JSON.stringify(sanitizeTeam(JSON.parse(once)))).toBe(once);
  });
});

describe('effectiveSkills (D5)', () => {
  const A: Pick<Persona, 'skills'> = {};
  const B: Pick<Persona, 'skills'> = { skills: ['foo'] };
  const lean = { leanWorkers: true };
  it('unset persona, no lean, is unrestricted', () => {
    expect(effectiveSkills(undefined, A, 'worker')).toBeUndefined();
    expect(effectiveSkills({}, A, 'worker')).toBeUndefined();
    expect(effectiveSkills({ leanWorkers: false }, A, 'worker')).toBeUndefined();
  });
  it('restricted persona always unions zcc-inbox, first, deduped', () => {
    expect(effectiveSkills(undefined, B, 'worker')).toEqual(['zcc-inbox', 'foo']);
    expect(effectiveSkills(undefined, { skills: ['zcc-inbox', 'x'] }, 'orchestrator')).toEqual(['zcc-inbox', 'x']);
    expect(effectiveSkills(undefined, { skills: [] }, 'worker')).toEqual([...ALWAYS_ALLOWED_SKILLS]);
  });
  it('lean presets worker slots with unset skills only', () => {
    expect(effectiveSkills(lean, A, 'worker')).toEqual(['zcc-inbox']);
    expect(effectiveSkills(lean, A, 'orchestrator')).toBeUndefined();
  });
  it('explicit persona skills win over lean (mixed-persona example)', () => {
    expect(effectiveSkills(lean, A, 'worker')).toEqual(['zcc-inbox']);
    expect(effectiveSkills(lean, B, 'worker')).toEqual(['zcc-inbox', 'foo']);
    expect(effectiveSkills({ leanWorkers: false }, B, 'worker')).toEqual(['zcc-inbox', 'foo']);
  });
  it('returns a fresh array each call', () => {
    const one = effectiveSkills(lean, A, 'worker')!;
    one.push('mutated');
    expect(effectiveSkills(lean, A, 'worker')).toEqual(['zcc-inbox']);
  });
});

describe('skill matching', () => {
  it('matches exact, plugin-qualified and :name suffix forms without globs', () => {
    expect(skillAllowlistEntryMatches('foo', 'foo')).toBe(true);
    expect(skillAllowlistEntryMatches('foo', 'plug:foo')).toBe(true);
    expect(skillAllowlistEntryMatches('plug:foo', 'foo')).toBe(true);
    expect(skillAllowlistEntryMatches('plug:foo', 'plug:foo')).toBe(true);
    expect(skillAllowlistEntryMatches('plug:foo', 'other:foo')).toBe(false);
    expect(skillAllowlistEntryMatches(':foo', 'plug:foo')).toBe(true);
    expect(skillAllowlistEntryMatches('foo', 'foobar')).toBe(false);
  });
  it('an undefined allowlist covers everything; an empty one nothing', () => {
    expect(skillAllowlistCovers(undefined, 'x')).toBe(true);
    expect(skillAllowlistCovers([], 'x')).toBe(false);
    expect(skillAllowlistCovers(['a', 'x'], 'x')).toBe(true);
  });
});

describe('mapSkillAllowlist', () => {
  const catalog = [
    { id: 'zcc:built-in/zcc-inbox', name: 'zcc-inbox' },
    { id: 'zcc:plug-a/review', name: 'review' },
    { id: 'malformed-id', name: 'odd' }
  ];
  it('unrestricted maps to nothing', () => {
    expect(mapSkillAllowlist(undefined, catalog)).toEqual({});
  });
  it('splits catalog ids from remaining names; unmatched entry stays a name', () => {
    expect(mapSkillAllowlist(['zcc-inbox', 'plug-a:review', 'user-skill', 'user-skill', 'odd'], catalog)).toEqual({
      automatedSkillIds: ['malformed-id', 'zcc:built-in/zcc-inbox', 'zcc:plug-a/review'],
      allowedSkillNames: ['user-skill']
    });
    expect(mapSkillAllowlist(['other:review'], catalog)).toEqual({ automatedSkillIds: [], allowedSkillNames: ['other:review'] });
    expect(mapSkillAllowlist([':review'], catalog).automatedSkillIds).toEqual(['zcc:plug-a/review']);
  });
  it('fails clearly when bare entries fan out past the 64-id wire limit', () => {
    const big = Array.from({ length: 65 }, (_, i) => ({ id: `zcc:o${i}/shared`, name: 'shared' }));
    expect(() => mapSkillAllowlist(['shared'], big)).toThrow(/limit 64/);
    expect(mapSkillAllowlist(['o1:shared'], big).automatedSkillIds).toEqual(['zcc:o1/shared']);
  });
  it('an empty allowlist yields empty (restricted) selections', () => {
    expect(mapSkillAllowlist([], catalog)).toEqual({ automatedSkillIds: [], allowedSkillNames: [] });
  });
});

describe('uninstalledAllowlistSkills', () => {
  it('warns for missing entries, ignores zcc-inbox, and is silent on unknown inventory', () => {
    expect(uninstalledAllowlistSkills(['a', 'b', 'zcc-inbox'], ['a'])).toEqual(['b']);
    expect(uninstalledAllowlistSkills(['a'], undefined)).toEqual([]);
    expect(uninstalledAllowlistSkills(undefined, ['a'])).toEqual([]);
  });
});

describe('allowedSkillNames contract field', () => {
  const request = {
    bindingId: '00000000-0000-4000-8000-000000000001', generation: 1, projectId: 'project-1',
    teamId: 'team-1', cohortId: '00000000-0000-4000-8000-000000000002', role: 'worker',
    providerId: 'claude-code', prompt: 'Do work', title: 'Worker', worktreePath: '/tmp/worktree'
  };
  it('is optional, bounded and strict', () => {
    expect(SquadMemberRuntimeRequestSchema.safeParse(request).success).toBe(true);
    expect(SquadMemberRuntimeRequestSchema.safeParse({ ...request, allowedSkillNames: ['a'] }).success).toBe(true);
    expect(SquadMemberRuntimeRequestSchema.safeParse({ ...request, allowedSkillNames: Array(65).fill('a') }).success).toBe(false);
    expect(SquadMemberRuntimeRequestSchema.safeParse({ ...request, allowedSkillNames: [''] }).success).toBe(false);
  });
});
