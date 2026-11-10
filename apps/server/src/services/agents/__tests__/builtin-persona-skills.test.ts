import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const testHome = join(tmpdir(), `builtin-persona-skills-${process.pid}-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { effectiveSkills, type Persona } from '@zana-ai/zcc-domain/product';
import { PersonaStore } from '../persona-store.js';
import { TeamStore } from '../team-store.js';

const clean = () => rmSync(testHome, { recursive: true, force: true });
beforeEach(clean);
afterAll(clean);

const UNRESTRICTED = [
  'builtin:squad-worker-low',
  'builtin:squad-worker-medium',
  'builtin:squad-worker-high',
  'builtin:software-engineer',
  'builtin:architect',
  'builtin:orchestrator',
  'builtin:ext-creator'
];

function store() {
  const s = new PersonaStore(() => []);
  s.refresh();
  return s;
}
const byId = (list: Persona[], id: string) => list.find((p) => p.id === id);

describe('built-in persona skill policy (s5)', () => {
  it('builtin:reviewer is stored as skills: [] and resolves to [zcc-inbox] in any slot or outside a team', () => {
    const reviewer = byId(store().list(), 'builtin:reviewer')!;
    expect(reviewer.source).toBe('builtin');
    expect(reviewer.skills).toEqual([]);
    expect(effectiveSkills(undefined, reviewer, 'worker')).toEqual(['zcc-inbox']);
    expect(effectiveSkills({ leanWorkers: true }, reviewer, 'worker')).toEqual(['zcc-inbox']);
    expect(effectiveSkills(undefined, reviewer, 'orchestrator')).toEqual(['zcc-inbox']);
  });

  it('only builtin:reviewer is restricted; every other built-in leaves skills unset', () => {
    const list = store().list().filter((p) => p.source === 'builtin');
    expect(list.filter((p) => p.skills !== undefined).map((p) => p.id)).toEqual(['builtin:reviewer']);
    for (const id of UNRESTRICTED) {
      const p = byId(list, id);
      if (!p) continue; // id set varies by catalogue; presence checked below
      expect(p).not.toHaveProperty('skills');
      expect(effectiveSkills(undefined, p, 'worker')).toBeUndefined();
    }
    expect(UNRESTRICTED.filter((id) => byId(list, id)).length).toBeGreaterThan(3);
  });

  it('a user edit of the reviewer shadows the built-in and wins', () => {
    const s = store();
    const saved = s.saveUser({ id: 'builtin:reviewer', name: 'Code Reviewer', skills: ['codenod'] });
    expect(saved.skills).toEqual(['codenod']);
    const resolved = byId(s.list(), 'builtin:reviewer')!;
    expect(resolved.source).toBe('user');
    expect(effectiveSkills(undefined, resolved, 'worker')).toEqual(['zcc-inbox', 'codenod']);
  });

  it('an unrestricted user edit of the reviewer wins (skills unset = unrestricted)', () => {
    const s = store();
    s.saveUser({ id: 'builtin:reviewer', name: 'Code Reviewer' });
    const resolved = byId(s.list(), 'builtin:reviewer')!;
    expect(resolved.source).toBe('user');
    expect(effectiveSkills(undefined, resolved, 'worker')).toBeUndefined();
  });

  it('a fork of the reviewer is a separate record; the built-in data is not modified', () => {
    const s = store();
    const fork = s.duplicateUser('builtin:reviewer');
    expect(fork.id).not.toBe('builtin:reviewer');
    expect(fork.skills).toEqual([]);
    const forked = s.saveUser({ ...fork, skills: ['codenod'] });
    expect(effectiveSkills(undefined, forked, 'worker')).toEqual(['zcc-inbox', 'codenod']);
    expect(byId(s.list(), 'builtin:reviewer')!.skills).toEqual([]);
  });
});

describe('Review Squad (team-store) still resolves with the restricted reviewer', () => {
  it('every slot persona id resolves to a persona and the reviewer slot is restricted', () => {
    const teams = new TeamStore(() => [], undefined);
    teams.refresh();
    const team = teams.list().find((t) => t.id === 'builtin:review-squad')!;
    expect(team).toBeTruthy();
    const personas = store().list();
    const resolved = team.slots.map((slot) => byId(personas, slot.personaId));
    expect(resolved.every(Boolean)).toBe(true);
    const reviewerSlot = team.slots.findIndex((slot) => slot.personaId === 'builtin:reviewer');
    expect(reviewerSlot).toBeGreaterThanOrEqual(0);
    expect(effectiveSkills(team, resolved[reviewerSlot]!, 'worker')).toEqual(['zcc-inbox']);
    // the other slots stay unrestricted
    expect(effectiveSkills(team, byId(personas, 'builtin:software-engineer')!, 'worker')).toBeUndefined();
  });
});
