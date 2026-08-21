import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHarnessRoutingMigration } from '../migrator.js';

const roots: string[] = [];

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-routing-migrator-'));
  roots.push(dir);
  mkdirSync(join(dir, 'personas'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    version: 1,
    claudeBinary: '/opt/claude', cursorBinary: 'cursor-x', codexBinary: 'codex-x', piBinary: 'pi-x', opencodeBinary: 'oc-x',
    harnessCursorEnabled: true, harnessCodexEnabled: false, harnessPiEnabled: true, harnessOpenCodeEnabled: false,
    defaultModel: 'default', defaultPermissionMode: 'acceptEdits',
    autoModeEnabled: false, autoModeEnvironment: ['host'], autoModeAllow: ['git status'], autoModeSoftDeny: ['npm'],
    autoModeHardDeny: ['rm'], autoModeClassifyAllShell: true,
    piProvider: ' custom ', piModel: 'provider/fuzzy:thinking', piThinking: 'xhigh'
  }, null, 2));
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{
    id: 'p1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1,
    defaultPersonas: ['missing', 'neutral'], defaultAgents: ['opencode']
  }] }, null, 2));
  writeFileSync(join(dir, 'project-settings.json'), JSON.stringify({ p1: {
    model: 'historical-model', permissionMode: 'plan', codexSandbox: 'read-only', codexApproval: 'never',
    appendSystemPrompt: ' exact ', extraArgs: ['--x', ' y '], piProvider: '', piModel: 'fuzzy', piThinking: 'max'
  } }, null, 2));
  writeFileSync(join(dir, 'personas', 'neutral.json'), JSON.stringify({
    id: 'neutral', name: 'Neutral', model: 'legacy-neutral', permissionMode: 'plan'
  }, null, 2));
  writeFileSync(join(dir, 'personas', 'canonical.json'), JSON.stringify({
    id: 'canonical', name: 'Canonical', baseProfile: 'codex', model: 'legacy-loses',
    harnessRouting: { schemaVersion: 1, byAdapter: { codex: { modelTargetId: 'canonical-wins' } } }
  }, null, 2));
  return dir;
}

const json = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runHarnessRoutingMigration', () => {
  it('is a no-op for a fresh data directory without a personas folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-routing-migrator-empty-'));
    roots.push(dir);

    await expect(runHarnessRoutingMigration(dir)).resolves.toEqual({ migrated: 0, noOp: true });
  });

  it('converts representable legacy routing exactly, removes consumed keys, and is restart-idempotent', async () => {
    const dir = fixture();
    const first = await runHarnessRoutingMigration(dir);
    expect(first).toMatchObject({ migrated: 5, noOp: false });

    const config = json(join(dir, 'config.json'));
    expect(config.harnesses.byId).toMatchObject({
      claude: { binary: '/opt/claude', compatibility: { model: 'default', permissionMode: 'acceptEdits', autoMode: {
        enabled: false, environment: ['host'], allow: ['git status'], softDeny: ['npm'], hardDeny: ['rm'], classifyAllShell: true
      } } },
      cursor: { binary: 'cursor-x', enabled: true }, codex: { binary: 'codex-x', enabled: false },
      pi: { binary: 'pi-x', enabled: true, compatibility: { provider: ' custom ', model: 'provider/fuzzy:thinking', thinking: 'xhigh' } },
      opencode: { binary: 'oc-x', enabled: false }
    });
    expect(config).not.toHaveProperty('defaultModel');
    expect(config).not.toHaveProperty('piModel');

    const projects = json(join(dir, 'projects.json')).projects;
    expect(projects[0].launchDefault).toEqual({
      schemaVersion: 1, kind: 'exact-profile', personaId: 'neutral', adapterId: 'claude', profileId: 'claude', source: 'migration'
    });
    expect(projects[0]).not.toHaveProperty('defaultPersonas');
    expect(projects[0]).not.toHaveProperty('defaultAgents');

    const settings = json(join(dir, 'project-settings.json')).p1;
    expect(settings.harnesses.byId.claude.compatibility).toMatchObject({ model: 'historical-model', permissionMode: 'plan', appendSystemPrompt: ' exact ', extraArgs: ['--x', ' y '] });
    expect(settings.harnesses.byId.codex.compatibility).toMatchObject({ model: 'historical-model', codexSandbox: 'read-only', codexApproval: 'never' });
    expect(settings.harnesses.byId.pi.compatibility).toEqual({ provider: '', model: 'fuzzy', thinking: 'max' });
    expect(settings).not.toHaveProperty('model');

    const neutral = json(join(dir, 'personas', 'neutral.json'));
    expect(neutral.harnessRouting.byAdapter.claude.compatibility).toEqual({ model: 'legacy-neutral', permissionMode: 'plan' });
    expect(neutral.harnessRouting.byAdapter.codex.compatibility.model).toBe('legacy-neutral');
    const canonical = json(join(dir, 'personas', 'canonical.json'));
    expect(canonical.harnessRouting.byAdapter.codex.modelTargetId).toBe('canonical-wins');
    expect(canonical).not.toHaveProperty('model');

    expect(await runHarnessRoutingMigration(dir)).toMatchObject({ migrated: 0, noOp: true });
  });

  it('leaves source authoritative before canonical write and recovers forward after it', async () => {
    const before = fixture();
    await expect(runHarnessRoutingMigration(before, { afterState: (_op, state) => {
      if (state === 'planned') throw new Error('pre-canonical');
    }})).rejects.toThrow('pre-canonical');
    expect(json(join(before, 'config.json'))).toHaveProperty('defaultModel', 'default');
    await expect(runHarnessRoutingMigration(before)).resolves.toMatchObject({ noOp: false });

    const after = fixture();
    await expect(runHarnessRoutingMigration(after, { afterState: (op, state) => {
      if (op === 'app-config-v1' && state === 'canonical-written') throw new Error('post-canonical');
    }})).rejects.toThrow('post-canonical');
    expect(json(join(after, 'config.json'))).not.toHaveProperty('defaultModel');
    await expect(runHarnessRoutingMigration(after)).resolves.toMatchObject({ noOp: false });
  });

  it('writes use-global only for empty legacy selections and preserves unresolved selections without a tombstone', async () => {
    const dir = fixture();
    const projectsPath = join(dir, 'projects.json');
    const projects = json(projectsPath);
    projects.projects.push({
      id: 'empty', name: 'Empty', path: '/tmp/empty', createdAt: 1, lastActiveAt: 1,
      defaultAgents: [], defaultPersonas: []
    }, {
      id: 'stale', name: 'Stale', path: '/tmp/stale', createdAt: 1, lastActiveAt: 1,
      defaultAgents: ['unknown'], defaultPersonas: ['missing']
    });
    writeFileSync(projectsPath, JSON.stringify(projects, null, 2));

    await runHarnessRoutingMigration(dir);
    const [empty, stale] = json(projectsPath).projects.slice(1);
    expect(empty.launchDefault).toEqual({ schemaVersion: 1, kind: 'use-global', source: 'migration' });
    expect(empty).not.toHaveProperty('defaultAgents');
    expect(empty).not.toHaveProperty('defaultPersonas');
    expect(stale).not.toHaveProperty('launchDefault');
    expect(stale.defaultAgents).toEqual(['unknown']);
    expect(stale.defaultPersonas).toEqual(['missing']);
  });

  it('does not prefix-match unknown profiles or write non-canonical launch pairs', async () => {
    const dir = fixture();
    const personasPath = join(dir, 'personas', 'future.json');
    writeFileSync(personasPath, JSON.stringify({
      id: 'future', name: 'Future', baseProfile: 'claude-future', model: 'opaque-model'
    }, null, 2));
    const projectsPath = join(dir, 'projects.json');
    const projects = json(projectsPath);
    projects.projects.push({
      id: 'future', name: 'Future', path: '/tmp/future', createdAt: 1, lastActiveAt: 1,
      defaultPersonas: ['future'], defaultAgents: ['cursor-future']
    });
    writeFileSync(projectsPath, JSON.stringify(projects, null, 2));

    await runHarnessRoutingMigration(dir);

    const persona = json(personasPath);
    expect(persona.baseProfile).toBe('claude-future');
    expect(persona.model).toBe('opaque-model');
    expect(persona).not.toHaveProperty('harnessRouting');
    const project = json(projectsPath).projects.find((value: any) => value.id === 'future');
    expect(project).not.toHaveProperty('launchDefault');
    expect(project.defaultPersonas).toEqual(['future']);
    expect(project.defaultAgents).toEqual(['cursor-future']);
  });

  it('removes stale legacy arrays when canonical launch default already exists', async () => {
    const dir = fixture();
    const projectsPath = join(dir, 'projects.json');
    const projects = json(projectsPath);
    projects.projects[0].launchDefault = {
      schemaVersion: 1, kind: 'use-global', source: 'user'
    };
    projects.projects[0].defaultAgents = ['opencode'];
    projects.projects[0].defaultPersonas = ['neutral'];
    writeFileSync(projectsPath, JSON.stringify(projects, null, 2));

    await runHarnessRoutingMigration(dir);
    const migrated = json(projectsPath).projects[0];
    expect(migrated.launchDefault).toEqual({ schemaVersion: 1, kind: 'use-global', source: 'user' });
    expect(migrated).not.toHaveProperty('defaultAgents');
    expect(migrated).not.toHaveProperty('defaultPersonas');
  });

  it('migrates Claude native default and Auto Mode as one compatibility policy', async () => {
    const dir = fixture();
    const configPath = join(dir, 'config.json');
    const config = json(configPath);
    config.defaultPermissionMode = 'default';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await runHarnessRoutingMigration(dir);

    expect(json(configPath).harnesses.byId.claude.compatibility).toMatchObject({
      executionPolicy: {
        target: 'native-default-with-auto',
        autoMode: {
          enabled: false,
          environment: ['host'],
          allow: ['git status'],
          softDeny: ['npm'],
          hardDeny: ['rm'],
          classifyAllShell: true
        }
      }
    });
    expect(json(configPath).harnesses.byId.claude.compatibility).not.toHaveProperty('permissionMode');
    expect(json(configPath).harnesses.byId.claude.compatibility).not.toHaveProperty('autoMode');
  });

  it('materializes absent Claude defaults as native default with Auto Mode', async () => {
    const dir = fixture();
    const configPath = join(dir, 'config.json');
    const config = json(configPath);
    delete config.defaultPermissionMode;
    for (const key of [
      'autoModeEnabled', 'autoModeEnvironment', 'autoModeAllow',
      'autoModeSoftDeny', 'autoModeHardDeny', 'autoModeClassifyAllShell'
    ]) delete config[key];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await runHarnessRoutingMigration(dir);

    expect(json(configPath).harnesses.byId.claude.compatibility.executionPolicy).toEqual({
      target: 'native-default-with-auto'
    });
  });

  it('allows owning-store canonical edits after completion on a fresh run', async () => {
    const dir = fixture();
    const configPath = join(dir, 'config.json');
    await runHarnessRoutingMigration(dir);
    const config = json(configPath);
    config.fontSize = 17;
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await expect(runHarnessRoutingMigration(dir)).resolves.toEqual({ migrated: 0, noOp: true });
    expect(json(configPath).fontSize).toBe(17);
  });
});
