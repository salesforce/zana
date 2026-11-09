import { describe, expect, it } from 'vitest';
import { evaluateTeamAdmission, uninstalledSkillWarnings, type SlotRoute } from '../preflight.js';
import { slotRouteSnapshot } from '../../execution/store.js';

const plan = (skills?: string[]) => [{
  id: 'a', title: 'A', task: 'do', dependencies: [], files: ['a.ts'], verification: ['t'],
  ...(skills ? { requires: { skills } } : {})
}];
const slot = (slotId: string, skillAllowlist?: readonly string[]): SlotRoute => ({ slotId, personaId: slotId, ...(skillAllowlist ? { skillAllowlist } : {}) });
const admit = (slotRoutes: SlotRoute[], skills: string[] = ['review'], extra = {}) => evaluateTeamAdmission({
  workUnits: plan(skills), requireCompletePlan: true, slotCount: slotRoutes.length, maxSlots: 8, initialTasks: ['x'], slotRoutes, now: 1,
  inventory: { version: 1, observedAt: 1, maxAgeMs: 10, skills: [{ name: 'review', available: true }], mcpServers: [], models: [], providers: [] }, ...extra
});
const skillChecks = (r: ReturnType<typeof admit>) => r.checks.filter((c) => c.code === 'SKILL_AVAILABLE' && c.subject === 'a');

describe('skill allowlist reach in admission', () => {
  it('unrestricted slots (no skillAllowlist) pass and add no reach check', () => {
    const r = admit([slot('w1'), slot('w2')]);
    expect(r.ready).toBe(true);
    expect(skillChecks(r)).toHaveLength(1);
  });

  it('is a hard FAIL naming the gap when no worker slot allows a required skill', () => {
    const r = admit([slot('w1', ['zcc-inbox']), slot('w2', ['other']), slot('orchestrator:0')]);
    expect(r.ready).toBe(false);
    expect(skillChecks(r).find((c) => c.status === 'FAIL')).toMatchObject({ required: true, unavailable: ['review'], message: expect.stringContaining('review') });
  });

  it('orchestrator slots do not count as reaching a skill', () => {
    expect(admit([slot('w1', ['zcc-inbox']), slot('orchestrator:0')]).ready).toBe(false);
  });

  it('warns (non-required) when only some worker slots can reach the skill', () => {
    const r = admit([slot('w1', ['plug:review']), slot('w2', ['zcc-inbox'])]);
    expect(r.ready).toBe(true);
    expect(skillChecks(r).find((c) => c.status === 'UNKNOWN')).toMatchObject({ required: false, message: expect.stringContaining('1 of 2') });
  });

  it('all slots restricted but all allowing the skill produces no warning', () => {
    const r = admit([slot('w1', [':review']), slot('w2', ['review'])]);
    expect(r.ready).toBe(true);
    expect(skillChecks(r)).toHaveLength(1);
  });

  it('does not depend on inventory: unknown inventory leaves only the existing UNKNOWN check and still FAILs the gap', () => {
    const r = admit([slot('w1', ['zcc-inbox'])], ['review'], { inventory: undefined });
    expect(skillChecks(r).some((c) => c.status === 'FAIL' && c.unavailable?.[0] === 'review')).toBe(true);
  });

  it('units without requires.skills and plans without slot routes are untouched', () => {
    expect(skillChecks(admit([slot('w1', ['zcc-inbox'])], []))).toHaveLength(0);
    expect(skillChecks(admit([], ['review'], { slotCount: 1 })).every((c) => c.status !== 'FAIL')).toBe(true);
    expect(evaluateTeamAdmission({ workUnits: plan(['review']), requireCompletePlan: true, slotCount: 1, maxSlots: 8, initialTasks: ['x'], now: 1 }).checks.filter((c) => c.required && c.status === 'FAIL')).toHaveLength(0);
  });

  it('R1/R2: unset allowlist leaves the digest identical; identical rosters give identical results', () => {
    const noField = [{ slotId: 'w1', personaId: 'p' }];
    const a = admit(noField, ['review']);
    expect(admit([slot('w1', undefined)].map((s) => ({ ...s, personaId: 'p' })), ['review']).digest).toBe(a.digest);
    const copy = admit([{ slotId: 'w1', personaId: 'p', skillAllowlist: ['zcc-inbox', 'review'] }], ['review']);
    expect(copy.digest).toBe(admit([{ slotId: 'w1', personaId: 'p', skillAllowlist: ['review', 'zcc-inbox'] }], ['review']).digest);
    expect(copy.digest).not.toBe(a.digest);
  });
});

describe('uninstalledSkillWarnings', () => {
  it('names missing allowlisted skills, ignores zcc-inbox, ignores unavailable items', () => {
    const inv = [{ name: 'a', available: true }, { name: 'b', available: false }, { name: 'c', enabled: false }, { name: 'd', enabled: true }];
    expect(uninstalledSkillWarnings(['zcc-inbox', 'a', 'b', 'c', 'd', 'e'], inv)).toEqual([
      'allowlisted skill b is not installed', 'allowlisted skill c is not installed', 'allowlisted skill e is not installed'
    ]);
  });
  it('is silent when the inventory is unavailable or the allowlist is unset', () => {
    expect(uninstalledSkillWarnings(['a'], undefined)).toEqual([]);
    expect(uninstalledSkillWarnings(undefined, [{ name: 'a' }])).toEqual([]);
  });
});

describe('slotRouteSnapshot skillAllowlist', () => {
  it('carries a copy of the allowlist only when supplied', () => {
    const list = ['zcc-inbox'];
    const withList = slotRouteSnapshot({ slotId: 's', personaId: 'p' }, undefined, list);
    expect(withList.skillAllowlist).toEqual(['zcc-inbox']);
    expect(withList.skillAllowlist).not.toBe(list);
    expect(slotRouteSnapshot({ slotId: 's', personaId: 'p' }, undefined)).not.toHaveProperty('skillAllowlist');
    expect(slotRouteSnapshot({ slotId: 's', personaId: 'p' }, undefined, [])).toHaveProperty('skillAllowlist', []);
  });
});
