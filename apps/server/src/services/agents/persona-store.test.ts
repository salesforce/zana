import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock electron before importing the store
const testHome = join(tmpdir(), `persona-store-test-${Date.now()}`);
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: {
    openPath: vi.fn()
  }
}));

import {
  PersonaStore,
  migratePersonaIfNeeded,
  projectPersonaFields,
  resolvePersonaLaunch
} from './persona-store.js';
import { PersonaTeamRegistry } from '../../../../desktop/src/extensions/persona-team-registry.js';
import type { Project, Persona } from '@zana-ai/zcc-domain/product';

describe('PersonaStore', () => {
  let store: PersonaStore;
  let projects: Project[];
  const userDir = join(testHome, '.zcc', 'personas');

  beforeEach(() => {
    // Clean slate
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });

    projects = [];
    store = new PersonaStore(() => projects);
    store.start();
  });

  afterEach(() => {
    store.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('lists built-in personas on boot', () => {
    const personas = store.list();
    expect(personas.length).toBeGreaterThanOrEqual(2);

    const reviewer = personas.find((p) => p.id === 'builtin:reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer?.name).toBe('Code Reviewer');
    expect(reviewer?.icon).toBe('ShieldCheck');
    expect(reviewer?.source).toBe('builtin');
    expect(reviewer?.baseProfile).toBeUndefined();
    expect(reviewer?.modelLevel).toBe('high');
    expect(reviewer?.executionState).toBe('plan');
    expect(reviewer?.allowedTools).toContain('Read');
    expect(reviewer?.appendSystemPrompt).toContain('senior code reviewer');
    expect(reviewer?.initialPrompt).toContain('diff');

    const architect = personas.find((p) => p.id === 'builtin:architect');
    expect(architect).toBeDefined();
    expect(architect?.name).toBe('Architect');
    expect(architect?.icon).toBe('Compass');
    expect(architect?.source).toBe('builtin');
    expect(architect?.baseProfile).toBeUndefined();
    expect(architect?.executionState).toBe('plan');
    expect(architect?.appendSystemPrompt).toContain('systems architect');

    const engineer = personas.find((p) => p.id === 'builtin:software-engineer');
    expect(engineer).toBeDefined();
    expect(engineer?.name).toBe('Software Engineer');
    expect(engineer?.source).toBe('builtin');
    expect(engineer?.baseProfile).toBeUndefined();
    expect(engineer?.modelLevel).toBe('medium');

    const orchestrator = personas.find((p) => p.id === 'builtin:orchestrator');
    expect(orchestrator).toBeDefined();
    expect(orchestrator?.name).toBe('ZCC Agent');
    expect(orchestrator?.source).toBe('builtin');

    // The old per-stack engineer personas were consolidated away.
    const removed = [
      'builtin:qa-engineer',
      'builtin:frontend-engineer',
      'builtin:backend-engineer',
      'builtin:fullstack-engineer',
      'builtin:devops-engineer'
    ];
    for (const id of removed) {
      expect(personas.find((p) => p.id === id)).toBeUndefined();
    }
  });

  it('shadows a builtin persona with a user file of same id', () => {
    // Write a user persona with the same id as builtin:reviewer
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'builtin:reviewer.json'),
      JSON.stringify({
        id: 'builtin:reviewer',
        name: 'My Custom Reviewer',
        icon: 'Star',
        baseProfile: 'claude',
        appendSystemPrompt: 'Custom review instructions.'
      })
    );

    store.refresh();
    const personas = store.list();
    const reviewer = personas.find((p) => p.id === 'builtin:reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer?.name).toBe('My Custom Reviewer');
    expect(reviewer?.icon).toBe('Star');
    expect(reviewer?.source).toBe('user');
    expect(reviewer?.appendSystemPrompt).toBe('Custom review instructions.');
  });

  it('project persona wins over user and builtin', () => {
    const projectPath = join(testHome, 'my-project');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.zcc', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'My Project',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    // User file
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'test-persona.json'),
      JSON.stringify({
        id: 'test-persona',
        name: 'User Persona',
        baseProfile: 'claude'
      })
    );

    // Project file with same id
    writeFileSync(
      join(projectPersonasDir, 'test-persona.json'),
      JSON.stringify({
        id: 'test-persona',
        name: 'Project Persona',
        baseProfile: 'claude',
        description: 'Project-specific'
      })
    );

    store.refresh();
    const personas = store.list();
    const persona = personas.find((p) => p.id === 'test-persona');
    expect(persona).toBeDefined();
    expect(persona?.name).toBe('Project Persona');
    expect(persona?.source).toEqual({ projectId: 'proj-1', projectName: 'My Project' });
    expect(persona?.description).toBe('Project-specific');
  });

  it('skips malformed JSON files without throwing', () => {
    mkdirSync(userDir, { recursive: true });
    // Malformed JSON
    writeFileSync(join(userDir, 'bad.json'), '{ invalid json }');
    // Missing required field (name)
    writeFileSync(join(userDir, 'no-name.json'), JSON.stringify({ id: 'test' }));
    // Invalid baseProfile
    writeFileSync(
      join(userDir, 'bad-profile.json'),
      JSON.stringify({ id: 'bad', name: 'Bad', baseProfile: 'invalid' })
    );

    // Should not throw
    expect(() => store.refresh()).not.toThrow();
    const personas = store.list();
    // Only built-ins should be present
    expect(personas.every((p) => p.source === 'builtin')).toBe(true);
  });

  it('validates baseProfile against VALID_PROFILES', () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'invalid-profile.json'),
      JSON.stringify({
        id: 'test',
        name: 'Test',
        baseProfile: 'invalid-profile-name'
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'test')).toBeUndefined();
  });

  it('validates model field (type-only — any string accepted, non-string dropped)', () => {
    mkdirSync(userDir, { recursive: true });
    // A claude alias — valid.
    writeFileSync(
      join(userDir, 'valid-model.json'),
      JSON.stringify({
        id: 'valid',
        name: 'Valid',
        model: 'opus'
      })
    );
    // A codex model slug is ALSO valid now — `model` was widened to `string`
    // (harness-agnostic dialect), so provider-specific slugs round-trip.
    writeFileSync(
      join(userDir, 'codex-model.json'),
      JSON.stringify({
        id: 'codex',
        name: 'Codex',
        model: 'gpt-5-codex'
      })
    );
    // A non-string model is still rejected (type-only validation drops the file).
    writeFileSync(
      join(userDir, 'invalid-model.json'),
      JSON.stringify({
        id: 'invalid',
        name: 'Invalid',
        model: 42
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'valid')).toBeDefined();
    expect(personas.find((p) => p.id === 'codex')?.model).toBe('gpt-5-codex');
    expect(personas.find((p) => p.id === 'invalid')).toBeUndefined();
  });

  it('validates permissionMode field', () => {
    mkdirSync(userDir, { recursive: true });
    // Valid permissionMode
    writeFileSync(
      join(userDir, 'valid-perm.json'),
      JSON.stringify({
        id: 'valid',
        name: 'Valid',
        permissionMode: 'plan'
      })
    );
    // Invalid permissionMode
    writeFileSync(
      join(userDir, 'invalid-perm.json'),
      JSON.stringify({
        id: 'invalid',
        name: 'Invalid',
        permissionMode: 'super-yolo'
      })
    );

    store.refresh();
    const personas = store.list();
    expect(personas.find((p) => p.id === 'valid')).toBeDefined();
    expect(personas.find((p) => p.id === 'invalid')).toBeUndefined();
  });

  it('correctly stamps source on merged personas', () => {
    const projectPath = join(testHome, 'proj');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.zcc', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'Test Project',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    mkdirSync(userDir, { recursive: true });

    // User persona
    writeFileSync(
      join(userDir, 'user-persona.json'),
      JSON.stringify({ id: 'user-persona', name: 'User' })
    );

    // Project persona
    writeFileSync(
      join(projectPersonasDir, 'project-persona.json'),
      JSON.stringify({ id: 'project-persona', name: 'Project' })
    );

    store.refresh();
    const personas = store.list();

    const userPersona = personas.find((p) => p.id === 'user-persona');
    expect(userPersona?.source).toBe('user');

    const projectPersona = personas.find((p) => p.id === 'project-persona');
    expect(projectPersona?.source).toEqual({ projectId: 'proj-1', projectName: 'Test Project' });

    const builtinPersona = personas.find((p) => p.id === 'builtin:reviewer');
    expect(builtinPersona?.source).toBe('builtin');
  });

  it('keeps personas as "user" when a project is registered at the user dir root', () => {
    // A project whose path is HOME (or any ancestor of ~/.zcc) makes its
    // `.zcc/personas` resolve to the SAME folder as the user dir. The project
    // pass must be skipped so global personas stay stamped 'user' (and thus
    // visible in every project's launcher) instead of being re-stamped as
    // project-scoped and hidden everywhere else.
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'global.json'),
      JSON.stringify({ id: 'global', name: 'Global Persona' })
    );

    projects.push({
      id: 'home-proj',
      name: 'Home',
      path: testHome, // its `.zcc/personas` === userDir
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    store.refresh();
    const persona = store.list().find((p) => p.id === 'global');
    expect(persona).toBeDefined();
    expect(persona?.source).toBe('user');
    // And it appears exactly once (not duplicated by the double scan).
    expect(store.list().filter((p) => p.id === 'global')).toHaveLength(1);
  });

  it('still scopes a genuine project persona when a HOME project is also registered', () => {
    // The HOME-root skip must not leak to real projects: a distinct project dir
    // still stamps its personas project-scoped.
    const projectPath = join(testHome, 'real-project');
    const projectPersonasDir = join(projectPath, '.zcc', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });
    writeFileSync(
      join(projectPersonasDir, 'scoped.json'),
      JSON.stringify({ id: 'scoped', name: 'Scoped' })
    );

    projects.push(
      { id: 'home-proj', name: 'Home', path: testHome, createdAt: Date.now(), lastActiveAt: Date.now() },
      { id: 'real-proj', name: 'Real', path: projectPath, createdAt: Date.now(), lastActiveAt: Date.now() }
    );

    store.refresh();
    const persona = store.list().find((p) => p.id === 'scoped');
    expect(persona?.source).toEqual({ projectId: 'real-proj', projectName: 'Real' });
  });

  it('dedups by id (later source wins)', () => {
    const projectPath = join(testHome, 'proj');
    mkdirSync(projectPath, { recursive: true });
    const projectPersonasDir = join(projectPath, '.zcc', 'personas');
    mkdirSync(projectPersonasDir, { recursive: true });

    projects.push({
      id: 'proj-1',
      name: 'Proj',
      path: projectPath,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });

    mkdirSync(userDir, { recursive: true });

    const sharedId = 'shared-id';
    // User
    writeFileSync(
      join(userDir, 'shared.json'),
      JSON.stringify({ id: sharedId, name: 'User Version' })
    );
    // Project (should win)
    writeFileSync(
      join(projectPersonasDir, 'shared.json'),
      JSON.stringify({ id: sharedId, name: 'Project Version' })
    );

    store.refresh();
    const personas = store.list();
    const matches = personas.filter((p) => p.id === sharedId);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Project Version');
  });

  it('filters array fields to strings only', () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'arrays.json'),
      JSON.stringify({
        id: 'arrays',
        name: 'Arrays',
        allowedTools: ['Read', 123, 'Write', null],
        deniedTools: ['Bash', false],
        addDirs: ['../other', 42],
        mcpServers: ['slack', true, 'gmail']
      })
    );

    store.refresh();
    const persona = store.list().find((p) => p.id === 'arrays');
    expect(persona?.allowedTools).toEqual(['Read', 'Write']);
    expect(persona?.deniedTools).toEqual(['Bash']);
    expect(persona?.addDirs).toEqual(['../other']);
    expect(persona?.mcpServers).toEqual(['slack', 'gmail']);
  });

  it('preserves a string microVmImage and drops a non-string one', () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'imaged.json'),
      JSON.stringify({ id: 'imaged', name: 'Imaged', microVmImage: 'node' })
    );
    writeFileSync(
      join(userDir, 'unimaged.json'),
      JSON.stringify({ id: 'unimaged', name: 'Unimaged', microVmImage: 42 })
    );

    store.refresh();
    expect(store.list().find((p) => p.id === 'imaged')?.microVmImage).toBe('node');
    expect(store.list().find((p) => p.id === 'unimaged')?.microVmImage).toBeUndefined();
  });

  it('saveUser round-trips a microVmImage through the sanitize gate', () => {
    const saved = store.saveUser({ name: 'VM Persona', microVmImage: 'python' });
    expect(saved.microVmImage).toBe('python');
    expect(store.list().find((p) => p.id === saved.id)?.microVmImage).toBe('python');
  });

  it('saveUser writes a new persona, deriving a slug id from the name', () => {
    const saved = store.saveUser({ name: 'My New Persona', baseProfile: 'claude' });
    expect(saved.id).toBe('my-new-persona');
    expect(saved.source).toBe('user');
    expect(existsSync(join(userDir, 'my-new-persona.json'))).toBe(true);

    const persona = store.list().find((p) => p.id === 'my-new-persona');
    expect(persona?.name).toBe('My New Persona');
    expect(persona?.source).toBe('user');
  });

  it('saveUser dedupes derived ids against existing personas', () => {
    const first = store.saveUser({ name: 'Dup' });
    const second = store.saveUser({ name: 'Dup' });
    expect(first.id).toBe('dup');
    expect(second.id).toBe('dup-2');
  });

  it('duplicates the resolved persona into an independent user copy', () => {
    const source = store.saveUser({
      name: 'Source',
      allowedTools: ['Read'],
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'model' } } }
    });
    const copy = store.duplicateUser(source.id);

    expect(copy).toMatchObject({ name: 'Source 1', source: 'user', allowedTools: ['Read'] });
    expect(copy.id).not.toBe(source.id);
    copy.allowedTools?.push('Write');
    expect(store.list().find((persona) => persona.id === source.id)?.allowedTools).toEqual(['Read']);
  });

  it('duplicates builtins using current names and rejects unknown ids', () => {
    store.saveUser({ name: 'Code Reviewer 1' });
    store.saveUser({ name: ' code reviewer 2 ' });
    expect(store.duplicateUser('builtin:reviewer').name).toBe('Code Reviewer 3');
    expect(() => store.duplicateUser('missing')).toThrow('persona not found: missing');
  });

  it('saveUser with an explicit id edits in place (same file)', () => {
    store.saveUser({ id: 'fixed', name: 'First' });
    store.saveUser({ id: 'fixed', name: 'Second' });
    const matches = store.list().filter((p) => p.id === 'fixed');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Second');
  });

  it('saveUser with a builtin id writes a user shadow', () => {
    const saved = store.saveUser({
      id: 'builtin:reviewer',
      name: 'Forked Reviewer',
      appendSystemPrompt: 'My instructions.'
    });
    expect(saved.source).toBe('user');
    const reviewer = store.list().find((p) => p.id === 'builtin:reviewer');
    expect(reviewer?.name).toBe('Forked Reviewer');
    expect(reviewer?.source).toBe('user');
  });

  it('saveUser rejects an invalid enum value', () => {
    // `permissionMode` is still a closed enum — an unknown value is rejected.
    expect(() =>
      store.saveUser({ name: 'Bad', permissionMode: 'wide-open' as never })
    ).toThrow();
  });

  it('saveUser accepts any string model (harness-agnostic dialect)', () => {
    // `model` was widened from the claude alias union to `string` so codex model
    // slugs (and future provider dialects) round-trip. Only a non-string is
    // rejected (type-only validation).
    const saved = store.saveUser({ name: 'Codex Persona', model: 'gpt-5-codex' });
    expect(store.list().find((p) => p.id === saved.id)?.model).toBe('gpt-5-codex');
    expect(() =>
      store.saveUser({ name: 'Bad Model', model: 123 as never })
    ).toThrow();
  });

  it('deleteUser of a shadowed builtin resets it to the shipped default', () => {
    store.saveUser({ id: 'builtin:reviewer', name: 'Forked Reviewer' });
    expect(store.list().find((p) => p.id === 'builtin:reviewer')?.source).toBe('user');

    const removed = store.deleteUser('builtin:reviewer');
    expect(removed).toBe(true);
    const reviewer = store.list().find((p) => p.id === 'builtin:reviewer');
    expect(reviewer?.name).toBe('Code Reviewer');
    expect(reviewer?.source).toBe('builtin');
  });

  it('deleteUser of a purely-user persona removes it', () => {
    store.saveUser({ id: 'temp', name: 'Temp' });
    expect(store.deleteUser('temp')).toBe(true);
    expect(store.list().find((p) => p.id === 'temp')).toBeUndefined();
  });

  it('deleteUser returns false when there is no user file', () => {
    expect(store.deleteUser('nonexistent')).toBe(false);
  });

  it('builtinIds lists the shipped persona ids', () => {
    const ids = store.builtinIds();
    expect(ids).toContain('builtin:reviewer');
    expect(ids).toContain('builtin:architect');
  });

  it('revealDir creates the dir and returns the path', async () => {
    const result = await store.revealDir();
    expect(result.ok).toBe(true);
    expect(result.path).toBe(userDir);
    expect(existsSync(userDir)).toBe(true);
  });

  it('onChanged fires when refresh is called', () => {
    return new Promise<void>((resolve) => {
      const unsubscribe = store.onChanged(() => {
        unsubscribe();
        resolve();
      });
      store.refresh();
    });
  });

  it('onChanged returns an unsubscribe function', () => {
    let fired = false;
    const unsubscribe = store.onChanged(() => {
      fired = true;
    });
    unsubscribe();
    store.refresh();
    expect(fired).toBe(false);
  });

  it('Phase 3 — model level and execution state persistence, validation, and migration', () => {
    const saved = store.saveUser({
      name: 'Portable Persona',
      modelLevel: 'high',
      executionState: 'plan'
    });
    expect(saved.modelLevel).toBe('high');
    expect(saved.executionState).toBe('plan');

    // @ts-expect-error bad enum
    expect(() => store.saveUser({ name: 'Bad Level', modelLevel: 'bogus' })).toThrow();
    // @ts-expect-error bad enum
    expect(() => store.saveUser({ name: 'Bad State', executionState: 'bogus' })).toThrow();

    const neutral = store.saveUser({ name: 'Neutral Persona' });
    expect(neutral.baseProfile).toBeUndefined();

    const native = store.saveUser({
      name: 'Native Persona',
      baseProfile: 'opencode',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: {
            providerTargetId: 'openai',
            modelTargetId: 'llmgw/gpt-5.6-sol-1M',
            executionState: 'accept-edits'
          }
        }
      }
    });
    expect(native.harnessRouting?.byAdapter.opencode).toEqual({
      providerTargetId: 'openai',
      modelTargetId: 'llmgw/gpt-5.6-sol-1M',
      executionState: 'accept-edits'
    });

    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      join(userDir, 'legacy-claude.json'),
      JSON.stringify({
        id: 'legacy-claude',
        name: 'Legacy Claude Persona',
        baseProfile: 'claude',
        model: 'sonnet',
        permissionMode: 'acceptEdits'
      })
    );
    store.refresh();
    const migrated = store.list().find((p) => p.id === 'legacy-claude');
    expect(migrated).toBeDefined();
    expect(migrated?.model).toBe('sonnet');
    expect(migrated?.permissionMode).toBe('acceptEdits');
    expect(migrated?.harnessRouting?.byAdapter?.claude?.compatibility?.model).toBe('sonnet');
    expect(migrated?.harnessRouting?.byAdapter?.claude?.compatibility?.permissionMode).toBe('acceptEdits');

    writeFileSync(
      join(userDir, 'legacy-codex.json'),
      JSON.stringify({
        id: 'legacy-codex',
        name: 'Legacy Codex Persona',
        baseProfile: 'codex',
        codexSandbox: 'read-only',
        codexApproval: 'never'
      })
    );
    store.refresh();
    const codexMigrated = store.list().find((p) => p.id === 'legacy-codex');
    expect(codexMigrated).toBeDefined();
    expect(codexMigrated?.codexSandbox).toBe('read-only');
    expect(codexMigrated?.codexApproval).toBe('never');
    expect(codexMigrated?.harnessRouting?.byAdapter?.codex?.compatibility?.codexSandbox).toBe('read-only');
    expect(codexMigrated?.harnessRouting?.byAdapter?.codex?.compatibility?.codexApproval).toBe('never');

    const reSaved = store.saveUser({ ...migrated! });
    const fileContent = JSON.parse(readFileSync(join(userDir, 'legacy-claude.json'), 'utf8'));
    expect(fileContent.model).toBeUndefined();
    expect(fileContent.permissionMode).toBeUndefined();
    expect(fileContent.harnessRouting).toBeDefined();
  });

  it('keeps startup migration and legacy projection aligned without cross-adapter leakage', () => {
    const migrated = migratePersonaIfNeeded({
      id: 'legacy-opencode',
      name: 'Legacy OpenCode',
      baseProfile: 'opencode',
      model: 'legacy-model',
      permissionMode: 'plan',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { modelTargetId: 'canonical-model' },
          claude: { compatibility: { permissionMode: 'acceptEdits' } }
        }
      }
    });

    expect(migrated.harnessRouting.byAdapter.opencode).toEqual({
      modelTargetId: 'canonical-model',
      compatibility: { model: 'legacy-model' }
    });
    expect(migrated.harnessRouting.byAdapter.claude.compatibility.permissionMode).toBe('acceptEdits');
    const projected = projectPersonaFields(migrated);
    expect(projected.model).toBe('canonical-model');
    expect(projected.permissionMode).toBe('acceptEdits');

    const neutral = projectPersonaFields({
      id: 'neutral',
      name: 'Neutral',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { modelTargetId: 'opencode-only' } }
      }
    });
    expect(neutral.model).toBeUndefined();
  });
});

describe('PersonaStore — extension registry merge', () => {
  let store: PersonaStore;
  let registry: PersonaTeamRegistry;
  let projects: Project[];

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });
    projects = [];
    registry = new PersonaTeamRegistry(() => []);
    store = new PersonaStore(() => projects, registry);
    store.start();
  });

  afterEach(() => {
    store.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  it('merges extension personas with an {extensionId} source', () => {
    registry.setPersonas('acme', [{ id: 'rev', name: 'Ext Reviewer' }]);
    const p = store.list().find((x) => x.id === 'ext:acme:rev');
    expect(p).toBeDefined();
    expect(p?.name).toBe('Ext Reviewer');
    expect(p?.source).toEqual({ extensionId: 'acme' });
  });

  it('re-emits onChanged when the registry (de)registers', () => {
    const fired: number[] = [];
    store.onChanged(() => fired.push(store.list().length));
    const before = store.list().length;
    registry.setPersonas('acme', [{ id: 'a', name: 'A' }]);
    expect(store.list().some((p) => p.id === 'ext:acme:a')).toBe(true);
    registry.clearModule('acme');
    expect(store.list().some((p) => p.id === 'ext:acme:a')).toBe(false);
    // Two registry emits → at least two store onChanged fires.
    expect(fired.length).toBeGreaterThanOrEqual(2);
    expect(store.list().length).toBe(before);
  });

  it('ext ids never shadow a builtin/user persona (namespaced ext:*)', () => {
    // An extension naming its persona `builtin:reviewer` is namespaced away.
    registry.setPersonas('acme', [{ id: 'builtin:reviewer', name: 'Hijack' }]);
    const builtin = store.list().find((p) => p.id === 'builtin:reviewer');
    expect(builtin?.name).toBe('Code Reviewer'); // untouched
    const ext = store.list().find((p) => p.id === 'ext:acme:builtin-reviewer');
    expect(ext?.name).toBe('Hijack');
  });
});

describe('resolvePersonaLaunch', () => {
  const reviewer: Persona = { id: 'p-claude', name: 'Reviewer', baseProfile: 'claude' };
  const shellPersona: Persona = { id: 'p-shell', name: 'Sheller', baseProfile: 'shell' };

  it('resolves the persona by id from the supplied list', () => {
    const { persona } = resolvePersonaLaunch(
      { personaId: 'p-claude', profile: 'claude' },
      [reviewer, shellPersona]
    );
    expect(persona).toBe(reviewer);
  });

  it('returns undefined persona for an unknown id (falls through to bare profile)', () => {
    const { persona } = resolvePersonaLaunch(
      { personaId: 'nope', profile: 'claude' },
      [reviewer]
    );
    expect(persona).toBeUndefined();
  });

  it('appends the opening prompt as the last positional for a claude profile', () => {
    const { extraArgs } = resolvePersonaLaunch(
      { profile: 'claude', prompt: 'do the thing', extraArgs: ['--foo'] },
      []
    );
    expect(extraArgs).toEqual(['--foo', 'do the thing']);
  });

  it('appends the opening prompt for codex + cursor (they accept a positional seed prompt)', () => {
    // Regression: these paths used to gate on the claude family, silently dropping
    // the prompt for the agent CLIs that also take `[prompt]` as the first turn.
    for (const profile of ['codex', 'codex-resume', 'cursor', 'cursor-resume'] as const) {
      const { extraArgs } = resolvePersonaLaunch(
        { profile, prompt: 'do the thing', extraArgs: ['--foo'] },
        []
      );
      expect(extraArgs, profile).toEqual(['--foo', 'do the thing']);
    }
  });

  it('delivers the opening prompt via --prompt for OpenCode (positional is a project dir)', () => {
    // Regression for the `Failed to change directory to …/<prompt>` launch bug:
    // OpenCode's positional is a project directory, so a bare positional prompt
    // makes it cd into a bogus path and exit. It must ride `--prompt <text>`.
    for (const profile of ['opencode', 'opencode-resume'] as const) {
      const { extraArgs } = resolvePersonaLaunch(
        { profile, prompt: 'fix the flaky test', extraArgs: ['--foo'] },
        []
      );
      expect(extraArgs, profile).toEqual(['--foo', '--prompt', 'fix the flaky test']);
    }
  });

  it('does NOT append the prompt for a shell profile', () => {
    const { extraArgs } = resolvePersonaLaunch(
      { profile: 'shell', prompt: 'do the thing', extraArgs: ['--foo'] },
      []
    );
    expect(extraArgs).toEqual(['--foo']);
  });

  it("a persona's claude baseProfile flips a shell req into claude prompt handling", () => {
    const { extraArgs } = resolvePersonaLaunch(
      { personaId: 'p-claude', profile: 'shell', prompt: 'hi' },
      [reviewer]
    );
    expect(extraArgs).toEqual(['hi']);
  });

  it("a persona's shell baseProfile suppresses the prompt even on a claude req", () => {
    const { extraArgs } = resolvePersonaLaunch(
      { personaId: 'p-shell', profile: 'claude', prompt: 'hi' },
      [shellPersona]
    );
    expect(extraArgs).toBeUndefined();
  });

  it('returns ONLY persona + extraArgs — no profile/effectiveProfile leaks to the caller', () => {
    const result = resolvePersonaLaunch({ profile: 'claude', prompt: 'x' }, []);
    expect(Object.keys(result).sort()).toEqual(['extraArgs', 'persona']);
  });

  it('leaves extraArgs untouched when there is no prompt', () => {
    const { extraArgs } = resolvePersonaLaunch(
      { profile: 'claude', extraArgs: ['--foo'] },
      []
    );
    expect(extraArgs).toEqual(['--foo']);
  });
});
