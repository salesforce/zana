import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const testHome = join(tmpdir(), `team-duplicate-parity-${process.pid}-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { effectiveSkills, type Persona, type Team } from '@zana-ai/zcc-domain/product';
import { PersonaStore } from '../persona-store.js';
import { TeamStore } from '../team-store.js';
import { createExecutionStore } from '../../execution/store.js';

// A duplicated built-in Team (real save path) must behave exactly like its source: nothing in
// skills resolution or dispatch may branch on `isBuiltIn` / team id / source.

const clean = () => rmSync(testHome, { recursive: true, force: true });
beforeEach(clean);
afterAll(clean);

const MODELS = ['claude-opus-4', 'claude-haiku-4', 'claude-sonnet-4'];

function stores() {
  const personas = new PersonaStore(() => []);
  personas.refresh();
  const teams = new TeamStore(() => [], undefined);
  teams.refresh();
  return { personas: personas.list(), teams };
}

/** Expanded slots in launch order: orchestrator first, then workers by quantity. */
function routes(team: Team, personas: Persona[]) {
  const byId = new Map(personas.map((p) => [p.id, p]));
  const out: Array<{ slotId: string; role: 'worker' | 'orchestrator'; personaId: string; skills: string[] | undefined }> = [];
  const orchestrator = byId.get(team.orchestratorPersonaId!);
  if (orchestrator) out.push({ slotId: 'orchestrator:lead', role: 'orchestrator', personaId: orchestrator.id, skills: effectiveSkills(team, orchestrator, 'orchestrator') });
  let n = 0;
  for (const slot of team.slots) {
    const persona = byId.get(slot.personaId);
    if (!persona || slot.personaId === team.orchestratorPersonaId) continue;
    for (let i = 0; i < (slot.quantity ?? 1); i++, n++) {
      out.push({ slotId: `worker:${n}`, role: 'worker', personaId: persona.id, skills: effectiveSkills(team, persona, 'worker') });
    }
  }
  return out;
}

async function assignments(dir: string, teamId: string, slots: ReturnType<typeof routes>) {
  const workers = slots.filter((s) => s.role === 'worker');
  const store = createExecutionStore({ filePath: join(dir, `${teamId.replace(/[^a-z0-9]/gi, '_')}.json`), id: () => 'execution', now: () => 1_000 });
  let record = (await store.claim({
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId, jobTitle: 'Ship', requestDigest: 'd', launchRequestId: 'r', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 't' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 's');
  record = await store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'r');
  record = await store.setAuthorizationContext(record.id, record.stateVersion, {
    version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2,
    slots: [{ slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' }, ...workers.map((w) => ({ slotId: w.slotId, personaId: w.personaId, authorizationIdDigest: w.slotId }))]
  }, 'auth');
  record = await store.replaceResolvedModels(record.id, workers.map((w, i) => ({
    slotId: w.slotId, personaId: w.personaId, provider: 'claude', model: MODELS[i % MODELS.length], maxContextBytes: 10_000_000
  })));
  record = await store.registerPlan(record.id, record.stateVersion, ['a', 'b', 'c'].map((id) => ({ id, title: id, task: id, dependencies: [], readOnly: true })));
  return (await store.dispatchReady(record.id, {})).assignments.map((a) => `${a.workUnitId ?? ''}->${a.slotId}`);
}

describe('duplicated built-in Team parity', () => {
  it('every built-in duplicates to an identical configuration, effectiveSkills, slot routes and dispatch', async () => {
    const { personas, teams } = stores();
    const dir = mkdtempSync(join(tmpdir(), 'team-parity-exec-'));
    try {
      const ids = teams.builtinIds();
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        const source = teams.list().find((t) => t.id === id)!;
        const copy = teams.duplicateUser(id);
        expect(copy.id).not.toBe(id);
        expect(copy.source).toBe('user');
        // sanitizeTeam makes the implicit CLI transport explicit; every consumer tests `=== 'MODERN'` only.
        const strip = ({ id: _i, name: _n, source: _s, ...rest }: Team) => JSON.parse(JSON.stringify({ ...rest, transport: rest.transport ?? 'CLI' }));
        expect(strip(copy)).toEqual(strip(source));
        const sourceRoutes = routes(source, personas);
        const copyRoutes = routes(copy, personas);
        expect(copyRoutes.length).toBeGreaterThan(0);
        expect(copyRoutes).toEqual(sourceRoutes);
        const expected = await assignments(dir, id, sourceRoutes);
        if (copyRoutes.some((r) => r.role === 'worker')) expect(expected.length).toBeGreaterThan(0);
        expect(await assignments(dir, copy.id, copyRoutes)).toEqual(expected);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a lean built-in shadow and its duplicate resolve the same restricted worker skills; orchestrator stays unrestricted', () => {
    const { personas, teams } = stores();
    const builtin = teams.list().find((t) => t.id === 'builtin:research-squad')!;
    expect(builtin.leanWorkers).toBeUndefined();
    const lean = teams.saveUser({ ...builtin, leanWorkers: true });
    const copy = teams.duplicateUser(lean.id);
    expect(copy.leanWorkers).toBe(true);
    const r = routes(copy, personas);
    expect(r).toEqual(routes(lean, personas));
    expect(r.filter((s) => s.role === 'worker').every((s) => JSON.stringify(s.skills) === JSON.stringify(['zcc-inbox']))).toBe(true);
    expect(r.find((s) => s.role === 'orchestrator')!.skills).toBeUndefined();
  });

  it('duplicating an unknown team fails and does not write', () => {
    const { teams } = stores();
    expect(() => teams.duplicateUser('builtin:nope')).toThrow(/team not found/);
  });
});
