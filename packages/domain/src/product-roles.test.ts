import { describe, expect, it } from 'vitest';
import { ROLES_MAX, ROLE_MAX_CHARS, effectiveRoles, normalizeRoles, toTeamSummary, type Team } from './product.js';

describe('normalizeRoles', () => {
  it('passes undefined through and rejects non-arrays', () => {
    expect(normalizeRoles(undefined)).toBeUndefined();
    expect(normalizeRoles('reviewer')).toBeNull();
    expect(normalizeRoles({})).toBeNull();
  });
  it('lowercases, trims, de-duplicates and drops empty or non-string entries', () => {
    expect(normalizeRoles([' Reviewer ', 'reviewer', '', 7, null, 'QA'])).toEqual(['reviewer', 'qa']);
  });
  it('bounds the count and the length', () => {
    expect(normalizeRoles(Array.from({ length: ROLES_MAX + 5 }, (_, i) => `r${i}`))).toHaveLength(ROLES_MAX);
    expect(normalizeRoles(['x'.repeat(ROLE_MAX_CHARS + 10)])![0]).toHaveLength(ROLE_MAX_CHARS);
  });
});

describe('effectiveRoles', () => {
  it('prefers the slot tags, falls back to the persona, else undefined', () => {
    expect(effectiveRoles({ roles: ['a'] }, { roles: ['b'] })).toEqual(['a']);
    expect(effectiveRoles({}, { roles: ['b'] })).toEqual(['b']);
    expect(effectiveRoles({ roles: [] }, { roles: ['b'] })).toEqual([]);
    expect(effectiveRoles({}, undefined)).toBeUndefined();
  });
});

describe('toTeamSummary slots', () => {
  const team = { id: 't', name: 'T', description: 'd', slots: [
    { personaId: 'p1', label: 'Builder', roles: ['build'] },
    { personaId: 'p2' },
    { personaId: 'missing' }
  ] } as unknown as Team;
  it('projects each slot with effective roles and the persona level', () => {
    const personas: Record<string, { modelLevel?: 'low' | 'medium' | 'high'; roles?: string[] }> = { p1: { modelLevel: 'high', roles: ['x'] }, p2: { roles: ['review'] } };
    const summary = toTeamSummary(team, (id) => personas[id] as never);
    expect(summary.slots).toEqual([
      { personaId: 'p1', label: 'Builder', level: 'high', roles: ['build'] },
      { personaId: 'p2', roles: ['review'] },
      { personaId: 'missing' }
    ]);
  });
  it('is empty-safe without a persona lookup or a slot array', () => {
    expect(toTeamSummary(team).slots.map((s) => s.personaId)).toEqual(['p1', 'p2', 'missing']);
    expect(toTeamSummary({ ...team, slots: undefined } as unknown as Team)).toMatchObject({ slotCount: 0, slots: [] });
  });
});
