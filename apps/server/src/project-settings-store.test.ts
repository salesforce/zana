import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectSettingsStore } from './project-settings-store.js';

const roots: string[] = [];

function makeDir(): string {
  const value = mkdtempSync(join(tmpdir(), 'zcc-server-project-settings-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('project settings store', () => {
  it('projects canonical compatibility fields for existing launch consumers', () => {
    const root = makeDir();
    const dataDir = join(root, '.zcc');
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, 'project-settings.json'), JSON.stringify({ p1: {
      harnesses: { byId: {
        claude: { compatibility: { model: 'sonnet', permissionMode: 'acceptEdits' } },
        codex: { compatibility: { codexSandbox: 'read-only' } },
        pi: { compatibility: { model: 'provider/model' } }
      } }
    } }));
    const store = createProjectSettingsStore({ projectSettingsFile: join(dataDir, 'project-settings.json') });

    expect(store.get('p1')).toMatchObject({
      model: 'sonnet', permissionMode: 'acceptEdits', codexSandbox: 'read-only', piModel: 'provider/model'
    });
  });

  it('writes legacy-shaped updates into canonical containers without empty scaffolding', async () => {
    const root = makeDir();
    const file = join(root, '.zcc', 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });

    await store.set('p1', { model: 'sonnet', permissionMode: 'plan', piModel: 'provider/model' });
    await store.set('p1', { model: 'opus' });
    await store.set('p2', { worktreeIsolation: true });
    await store.set('p3', { remoteToolProxy: true });

    const disk = JSON.parse(readFileSync(file, 'utf8'));
    expect(disk.p1.harnesses.byId.claude.compatibility).toMatchObject({ model: 'opus', permissionMode: 'plan' });
    expect(disk.p1.harnesses.byId.codex.compatibility).toMatchObject({ model: 'opus' });
    expect(disk.p1.harnesses.byId.pi.compatibility).toMatchObject({ model: 'provider/model' });
    expect(disk.p1).not.toHaveProperty('model');
    expect(disk.p2).toEqual({ worktreeIsolation: true });
    expect(disk.p3).toEqual({ remoteToolProxy: true });
    expect(store.get('p3')).toMatchObject({ remoteToolProxy: true });
  });

  it('round-trips launchApproval and rejects values outside the policy', async () => {
    const root = makeDir();
    const file = join(root, '.zcc', 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });

    await store.set('p1', { launchApproval: 'review' });
    expect(store.get('p1')).toMatchObject({ launchApproval: 'review' });
    expect(JSON.parse(readFileSync(file, 'utf8')).p1).toEqual({ launchApproval: 'review' });
    await store.set('p1', { worktreeIsolation: true });
    expect(store.get('p1')).toMatchObject({ launchApproval: 'review', worktreeIsolation: true });
    await expect(store.set('p1', { launchApproval: 'always' } as never)).rejects.toThrow();
    expect(store.get('p1').launchApproval).toBe('review');
  });

  it('removes only the requested project settings entry', async () => {
    const root = makeDir();
    const file = join(root, '.zcc', 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });
    await store.set('p1', { worktreeIsolation: true });
    await store.set('p2', { worktreeIsolation: false });

    await store.remove('p1');

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ p2: { worktreeIsolation: false } });
  });

  it('recovers malformed legacy JSON on the next settings mutation', async () => {
    const root = makeDir();
    const dataDir = join(root, '.zcc');
    const file = join(dataDir, 'project-settings.json');
    mkdirSync(dataDir);
    writeFileSync(file, '{not json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });

    await store.set('p1', { worktreeIsolation: true });

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ p1: { worktreeIsolation: true } });
  });

  it('rejects malformed or oversized renderer settings patches before persistence', async () => {
    const root = makeDir();
    const file = join(root, '.zcc', 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });

    await expect(store.set('p1', { unexpected: true } as never)).rejects.toThrow();
    await expect(store.set('p1', { appendSystemPrompt: 'x'.repeat(32_769) })).rejects.toThrow();
  });
});

describe('project settings store plugin harness routing', () => {
  const routing = { schemaVersion: 1 as const, byAdapter: { codex: { modelTargetId: 'gpt-5.4' } } };

  it('keeps plugin overrides out of get(), across set(), and removes them with the project', async () => {
    const file = join(makeDir(), 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });
    expect(store.getPluginHarnessRouting('p1', 'a')).toBeNull();
    await store.setPluginHarnessRouting('p1', 'a', routing);
    expect(store.get('p1')).toEqual({});
    await store.set('p1', { worktreeIsolation: true });
    expect(store.get('p1')).toEqual({ worktreeIsolation: true });
    expect(store.getPluginHarnessRouting('p1', 'a')).toEqual(routing);
    expect(store.getPluginHarnessRouting('p2', 'a')).toBeNull();
    const chosen = { ...routing, defaultHarness: 'codex' as const };
    await store.setPluginHarnessRouting('p1', 'c', chosen);
    expect(createProjectSettingsStore({ projectSettingsFile: file }).getPluginHarnessRouting('p1', 'c')).toEqual(chosen);
    await store.setPluginHarnessRouting('p1', 'c', null);
    await store.remove('p1');
    expect(store.getPluginHarnessRouting('p1', 'a')).toBeNull();
  });

  it('clearing the last override drops an otherwise empty entry', async () => {
    const file = join(makeDir(), 'project-settings.json');
    const store = createProjectSettingsStore({ projectSettingsFile: file });
    await store.setPluginHarnessRouting('p1', 'a', routing);
    await store.setPluginHarnessRouting('p1', 'b', routing);
    await store.setPluginHarnessRouting('p1', 'a', null);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ p1: { pluginHarnessRouting: { b: routing } } });
    await store.setPluginHarnessRouting('p1', 'b', null);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
  });
});
