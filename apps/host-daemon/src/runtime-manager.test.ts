import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  fakeProviderScriptPath
} from '@zana-ai/zcc-agent-runtime/test';
import { createRuntimeManager } from './runtime-manager.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runtime manager', () => {
  it('disposes the idle-session reaper', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-runtime-mgr-'));
    dirs.push(dataDir);
    const manager = createRuntimeManager({
      emit: () => undefined,
      dataDir,
      idleReapIntervalMs: 10,
      idleReapAfterMs: 1,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        })
    });
    expect(manager.listLoadedEnvironments()).toEqual([]);
    manager.dispose();
  });

  it('refreshes the skill catalog for idle environments', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-runtime-skills-'));
    dirs.push(dataDir);
    let created = 0;
    const manager = createRuntimeManager({
      emit: () => undefined,
      dataDir,
      idleReapIntervalMs: 0,
      createRuntime: (options) => {
        created += 1;
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        });
      }
    });
    const environmentId = 'env-1';
    await manager.startWork({
      threadId: 't1',
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd: dataDir
    });
    await manager.stopWork({ threadId: 't1' });
    mkdirSync(join(dataDir, 'skills-generated', 'hello'), { recursive: true });
    writeFileSync(join(dataDir, 'skills-generated', 'hello', 'SKILL.md'), '---\ndescription: Hi\n---\n');
    await manager.refreshSkillCatalog();
    expect(manager.listLoadedEnvironments()).toEqual([]);
    await manager.startWork({
      threadId: 't2',
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd: dataDir
    });
    expect(created).toBe(2);
    const idle = await manager.reapIdleProviderSessions({
      idleForMs: 30 * 60 * 1000,
      nowMs: Date.now(),
      providerSessionReapingEnabled: false
    });
    expect(idle.reapedSessions).toEqual([]);
    manager.dispose();
  });
});
