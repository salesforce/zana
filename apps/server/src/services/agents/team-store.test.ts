import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `team-store-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openPath: vi.fn() }
}));

import { TeamStore, sanitizeTeam } from './team-store.js';
import { PersonaStore } from './persona-store.js';
import { personaCanWriteFiles } from '@zana-ai/zcc-domain/squad-proposal';
import { PersonaTeamRegistry } from '../../../../desktop/src/extensions/persona-team-registry.js';
import type { Project } from '@zana-ai/zcc-domain/product';

describe('sanitizeTeam', () => {
  it('keeps only an explicit true isDefault', () => {
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], isDefault: true })).toMatchObject({ isDefault: true });
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], isDefault: 'true' })?.isDefault).toBeUndefined();
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], isDefault: false })?.isDefault).toBeUndefined();
  });

  it('preserves the explicit shared-worktree toggle', () => {
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], worktreeIsolation: true }))
      .toMatchObject({ worktreeIsolation: true });
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], worktreeIsolation: 'true' }))
      .toMatchObject({ worktreeIsolation: undefined });
  });

  it('preserves a boolean routing enforcement override and drops invalid values', () => {
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], routingEnforced: true }))
      .toMatchObject({ routingEnforced: true });
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], routingEnforced: 'true' }))
      .toMatchObject({ routingEnforced: undefined });
  });

  it('defaults legacy teams to CLI and preserves the whole-squad Modern transport', () => {
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [] })?.transport).toBe('CLI');
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], transport: 'MODERN' })?.transport).toBe('MODERN');
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], transport: 'mixed' })?.transport).toBe('CLI');
  });

  it('keeps only the infer and provided default planning modes', () => {
    for (const mode of ['provided', 'infer'] as const) {
      expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], defaultPlanning: mode })).toMatchObject({ defaultPlanning: mode });
    }
    for (const bad of ['structured', true, 'x']) {
      expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], defaultPlanning: bad })?.defaultPlanning).toBeUndefined();
    }
  });

  it('keeps only the review and direct launch approval modes', () => {
    for (const mode of ['review', 'direct'] as const) {
      expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], launchApproval: mode })).toMatchObject({ launchApproval: mode });
    }
    for (const bad of ['always', true, '']) {
      expect(sanitizeTeam({ id: 'x', name: 'X', slots: [], launchApproval: bad })?.launchApproval).toBeUndefined();
    }
  });

  it('emits no defaultPlanning key after a JSON round-trip when absent', () => {
    const team = sanitizeTeam({ id: 'x', name: 'X', slots: [] });
    expect(Object.keys(JSON.parse(JSON.stringify(team)))).not.toContain('defaultPlanning');
  });

  it('requires id, name, and a slots array', () => {
    expect(sanitizeTeam({ name: 'X', slots: [] })).toBeNull(); // no id
    expect(sanitizeTeam({ id: 'x', slots: [] })).toBeNull(); // no name
    expect(sanitizeTeam({ id: 'x', name: 'X' })).toBeNull(); // no slots array
    expect(sanitizeTeam({ id: 'x', name: 'X', slots: [] })).not.toBeNull();
  });

  it('clamps slot quantity to 1..16 and defaults to 1', () => {
    const t = sanitizeTeam({
      id: 'x',
      name: 'X',
      slots: [
        { personaId: 'a', quantity: 999 },
        { personaId: 'b', quantity: 0 },
        { personaId: 'c' },
        { personaId: 'd', quantity: 3 }
      ]
    });
    expect(t?.slots.map((s) => s.quantity)).toEqual([16, 1, 1, 3]);
  });

  it('drops slots whose personaId is not a non-empty string', () => {
    const t = sanitizeTeam({
      id: 'x',
      name: 'X',
      slots: [
        { personaId: 'ok' },
        { personaId: '' },
        { personaId: 123 as never },
        { quantity: 2 } as never
      ]
    });
    expect(t?.slots.map((s) => s.personaId)).toEqual(['ok']);
  });

  it('keeps a label override and trims string fields', () => {
    const t = sanitizeTeam({
      id: '  x  ',
      name: '  Squad  ',
      orchestratorPersonaId: ' lead ',
      slots: [{ personaId: ' a ', label: ' Engineer ' }]
    });
    expect(t?.id).toBe('x');
    expect(t?.name).toBe('Squad');
    expect(t?.orchestratorPersonaId).toBe('lead');
    expect(t?.slots[0]).toEqual({ personaId: 'a', quantity: 1, label: 'Engineer' });
  });
});

describe('TeamStore', () => {
  let store: TeamStore;
  let projects: Project[];
  const userDir = join(testHome, '.zcc', 'teams');

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });
    projects = [];
    store = new TeamStore(() => projects);
    store.start();
  });

  afterEach(() => {
    store.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('lists the built-in team on boot', () => {
    const t = store.list().find((x) => x.id === 'builtin:review-squad');
    expect(t).toBeDefined();
    expect(t?.source).toBe('builtin');
    expect(t?.slots.length).toBeGreaterThan(0);
  });

  it('ships focused built-in squads with enforced routing only for debug and delivery', () => {
    const builtins = new Map(store.list().filter((team) => team.source === 'builtin').map((team) => [team.id, team]));
    expect(builtins.get('builtin:research-squad')).toBeDefined();
    expect(builtins.get('builtin:design-squad')).toBeDefined();
    expect(builtins.get('builtin:review-squad')?.orchestratorPersonaId).toBe('builtin:orchestrator');
    expect(builtins.get('builtin:research-squad')?.orchestratorPersonaId).toBe('builtin:orchestrator');
    expect(builtins.get('builtin:design-squad')?.orchestratorPersonaId).toBe('builtin:orchestrator');
    expect(builtins.get('builtin:debug-squad')?.orchestratorPersonaId).toBe('builtin:orchestrator');
    expect(builtins.get('builtin:delivery-squad')?.orchestratorPersonaId).toBe('builtin:orchestrator');
    expect(builtins.get('builtin:debug-squad')?.routingEnforced).toBe(true);
    expect(builtins.get('builtin:delivery-squad')?.routingEnforced).toBe(true);
    expect(builtins.get('builtin:review-squad')?.routingEnforced).toBeUndefined();
    expect(builtins.get('builtin:research-squad')?.slots).toEqual([
      expect.objectContaining({ personaId: 'builtin:squad-worker-low', quantity: 2 })
    ]);
    expect(builtins.get('builtin:design-squad')?.slots).toEqual([
      expect.objectContaining({ personaId: 'builtin:squad-worker-high', label: 'Designer' }),
      expect.objectContaining({ personaId: 'builtin:squad-worker-high', label: 'Challenger' })
    ]);
    expect(builtins.get('builtin:debug-squad')?.slots.map((slot) => slot.personaId)).toEqual([
      'builtin:squad-worker-low', 'builtin:squad-worker-high'
    ]);
    expect(builtins.get('builtin:delivery-squad')?.slots).toEqual([
      expect.objectContaining({ personaId: 'builtin:squad-worker-medium', quantity: 2, label: 'Engineer' }),
      expect.objectContaining({ personaId: 'builtin:squad-worker-high', label: 'Reviewer' })
    ]);
  });

  it('every built-in team slot + orchestrator resolves to a built-in persona', () => {
    // Guards the cross-store contract: a team is only launchable if each
    // slot/orchestrator personaId actually resolves (persona existence is
    // checked at LAUNCH, not at store time — a typo here would ship a squad
    // that silently drops tabs). Assert against the real shipped persona ids.
    const personaIds = new Set(new PersonaStore(() => []).builtinIds());
    for (const team of store.list().filter((t) => t.source === 'builtin')) {
      if (team.orchestratorPersonaId) {
        expect(personaIds.has(team.orchestratorPersonaId), `${team.id} orchestrator`).toBe(true);
      }
      for (const slot of team.slots) {
        expect(personaIds.has(slot.personaId), `${team.id} slot ${slot.personaId}`).toBe(true);
      }
    }
  });

  it('personaCanWriteFiles matches the shipped personas', () => {
    const personas = new PersonaStore(() => []);
    personas.refresh();
    const byId = new Map(personas.list().map((p) => [p.id, p]));
    // Since the tiered built-in defaults (#348) the built-in orchestrator has no tool deny list,
    // so built-in Squads can infer their own plan.
    expect(personaCanWriteFiles(byId.get('builtin:orchestrator')!)).toBe(true);
    // A coordinator that denies Write/Edit (e.g. a custom contribution Squad) cannot.
    expect(personaCanWriteFiles({ deniedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'] })).toBe(false);
    // Plan-state and read-only personas cannot write a plan file.
    expect(personaCanWriteFiles({ executionState: 'plan' })).toBe(false);
    expect(personaCanWriteFiles({ codexSandbox: 'read-only' })).toBe(false);
    expect(personaCanWriteFiles(byId.get('builtin:software-engineer')!)).toBe(true);
    // A Squad engineer that only blocks specific paths can still write files.
    expect(personaCanWriteFiles({ deniedTools: ['Write(~/.zcc/**)', 'Edit(~/.zcc/**)', 'Bash(git push:*)'] })).toBe(true);
  });

  it('merges 4 sources with project > user > builtin precedence', () => {
    const projectPath = join(testHome, 'proj');
    const projectTeamsDir = join(projectPath, '.zcc', 'teams');
    mkdirSync(projectTeamsDir, { recursive: true });
    projects.push({
      id: 'proj-1',
      name: 'Proj',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'shared.json'),
      JSON.stringify({ id: 'shared', name: 'User Team', slots: [] })
    );
    writeFileSync(
      join(projectTeamsDir, 'shared.json'),
      JSON.stringify({ id: 'shared', name: 'Project Team', slots: [] })
    );

    store.refresh();
    const matches = store.list().filter((t) => t.id === 'shared');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Project Team');
    expect(matches[0].source).toEqual({ projectId: 'proj-1', projectName: 'Proj' });
  });

  it('keeps review required when a project file shadows a user Squad by id', () => {
    const projectPath = join(testHome, 'proj');
    const projectTeamsDir = join(projectPath, '.zcc', 'teams');
    mkdirSync(projectTeamsDir, { recursive: true });
    projects.push({ id: 'proj-1', name: 'Proj', path: projectPath, createdAt: Date.now(), lastActiveAt: Date.now() });
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'shared.json'), JSON.stringify({ id: 'shared', name: 'User Team', slots: [], launchApproval: 'review' }));
    writeFileSync(join(projectTeamsDir, 'shared.json'), JSON.stringify({ id: 'shared', name: 'Project Team', slots: [], launchApproval: 'direct' }));
    writeFileSync(join(projectTeamsDir, 'open.json'), JSON.stringify({ id: 'open', name: 'Open', slots: [], launchApproval: 'direct' }));
    writeFileSync(join(projectTeamsDir, 'gated.json'), JSON.stringify({ id: 'gated', name: 'Gated', slots: [], launchApproval: 'review' }));

    store.refresh();
    expect(store.list().find((t) => t.id === 'shared')?.launchApproval).toBe('direct');
    expect(store.launchReviewRequired('shared')).toBe(true);
    expect(store.launchReviewRequired('gated')).toBe(true);
    expect(store.launchReviewRequired('open')).toBe(false);
    expect(store.launchReviewRequired('missing')).toBe(false);
  });

  it('does not re-stamp user teams when a project shares the user teams directory', () => {
    projects.push({
      id: 'home',
      name: 'Home',
      path: testHome,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });
    const saved = store.saveUser({ name: 'User Team', slots: [] });
    expect(store.list().find((team) => team.id === saved.id)?.source).toBe('user');
  });

  it('saveUser round-trips defaultPlanning', () => {
    const saved = store.saveUser({ name: 'Planner', slots: [], defaultPlanning: 'provided' });
    expect(store.list().find((team) => team.id === saved.id)?.defaultPlanning).toBe('provided');
  });

  it('saveUser keeps a single default: flagging one un-flags the previous', () => {
    const first = store.saveUser({ name: 'First', slots: [], isDefault: true });
    expect(store.list().find((t) => t.id === first.id)?.isDefault).toBe(true);
    const second = store.saveUser({ name: 'Second', slots: [], isDefault: true });
    const listed = store.list();
    expect(listed.find((t) => t.id === second.id)?.isDefault).toBe(true);
    expect(listed.find((t) => t.id === first.id)?.isDefault).toBeUndefined();
    store.saveUser({ id: second.id, name: 'Second', slots: [] });
    expect(store.list().some((t) => t.isDefault)).toBe(false);
  });

  it('saveUser round-trips launchApproval', () => {
    const saved = store.saveUser({ name: 'Gated', slots: [], launchApproval: 'review' });
    expect(store.list().find((team) => team.id === saved.id)?.launchApproval).toBe('review');
  });

  it('saveUser replaces the file, so saving without launchApproval clears it', () => {
    const saved = store.saveUser({ name: 'Gated', slots: [], launchApproval: 'review', defaultPlanning: 'provided' });
    store.saveUser({ id: saved.id, name: 'Gated', slots: [] });
    const reloaded = store.list().find((team) => team.id === saved.id);
    expect(reloaded?.launchApproval).toBeUndefined();
    expect(reloaded?.defaultPlanning).toBeUndefined();
  });

  it('saveUser writes atomically and refresh picks it up', () => {
    const saved = store.saveUser({ name: 'My Team', slots: [{ personaId: 'builtin:reviewer' }] });
    expect(saved.id).toBe('my-team');
    expect(saved.source).toBe('user');
    expect(existsSync(join(userDir, 'my-team.json'))).toBe(true);
    expect(store.list().find((t) => t.id === 'my-team')?.name).toBe('My Team');
  });

  it('duplicates the resolved team into an independent user copy', () => {
    const source = store.saveUser({
      name: 'Source',
      description: 'Copied',
      slots: [{ personaId: 'builtin:reviewer', label: 'Reviewer' }]
    });
    const copy = store.duplicateUser(source.id);

    expect(copy).toMatchObject({ name: 'Source 1', source: 'user', description: 'Copied' });
    expect(copy.id).not.toBe(source.id);
    copy.slots[0].label = 'Changed';
    expect(store.list().find((team) => team.id === source.id)?.slots[0].label).toBe('Reviewer');
  });

  it('duplicates builtins using current names and rejects unknown ids', () => {
    store.saveUser({ name: 'Review Squad 1', slots: [] });
    expect(store.duplicateUser('builtin:review-squad').name).toBe('Review Squad 2');
    expect(() => store.duplicateUser('missing')).toThrow('team not found: missing');
  });

  it('deleteUser of a shadowed builtin resets it; of a user team removes it', () => {
    store.saveUser({ id: 'builtin:review-squad', name: 'Forked', slots: [] });
    expect(store.list().find((t) => t.id === 'builtin:review-squad')?.source).toBe('user');
    expect(store.deleteUser('builtin:review-squad')).toBe(true);
    expect(store.list().find((t) => t.id === 'builtin:review-squad')?.source).toBe('builtin');

    store.saveUser({ id: 'temp', name: 'Temp', slots: [] });
    expect(store.deleteUser('temp')).toBe(true);
    expect(store.list().find((t) => t.id === 'temp')).toBeUndefined();
  });

  it('merges extension teams from the registry and re-emits onChanged', () => {
    const registry = new PersonaTeamRegistry(() => []);
    const s = new TeamStore(() => [], registry);
    s.start();
    try {
      let fired = 0;
      s.onChanged(() => {
        fired += 1;
      });
      registry.setTeams('acme', [{ id: 'squad', name: 'Ext Squad', slots: [] }]);
      const ext = s.list().find((t) => t.id === 'ext:acme:squad');
      expect(ext?.source).toEqual({ extensionId: 'acme' });
      registry.clearModule('acme');
      expect(s.list().find((t) => t.id === 'ext:acme:squad')).toBeUndefined();
      expect(fired).toBeGreaterThanOrEqual(2);
    } finally {
      s.stop();
    }
  });

  it('rebindProjects re-discovers after a project is added', () => {
    const projectPath = join(testHome, 'late');
    const dir = join(projectPath, '.zcc', 'teams');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 't.json'), JSON.stringify({ id: 'late', name: 'Late', slots: [] }));
    // Not yet known.
    expect(store.list().find((t) => t.id === 'late')).toBeUndefined();
    projects.push({
      id: 'late-1',
      name: 'Late',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });
    store.rebindProjects();
    expect(store.list().find((t) => t.id === 'late')?.source).toEqual({
      projectId: 'late-1',
      projectName: 'Late'
    });
  });
});
