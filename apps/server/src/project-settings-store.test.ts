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
