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

import { TeamStore, sanitizeTeam } from '../team-store.js';
import { PersonaStore } from '../persona-store.js';
import { PersonaTeamRegistry } from '../extensions/persona-team-registry.js';
import type { Project } from '../../shared/types.js';

describe('sanitizeTeam', () => {
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

  it('saveUser writes atomically and refresh picks it up', () => {
    const saved = store.saveUser({ name: 'My Team', slots: [{ personaId: 'builtin:reviewer' }] });
    expect(saved.id).toBe('my-team');
    expect(saved.source).toBe('user');
    expect(existsSync(join(userDir, 'my-team.json'))).toBe(true);
    expect(store.list().find((t) => t.id === 'my-team')?.name).toBe('My Team');
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
