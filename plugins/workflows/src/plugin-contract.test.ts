import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import plugin from './server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE = `export const meta = {
  name: "review-change",
  description: "Review a change",
  phases: [{ title: "Review" }],
};
return await agent("Review the tree", { phase: "Review" });
`;

function memoryPluginDatabase(): PluginDatabase {
  const db = new Database(':memory:');
  return {
    runScript(sql) {
      db.exec(sql);
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        all: (...params) => stmt.all(...params),
        get: (...params) => stmt.get(...params),
        run: (...params) => ({ changes: stmt.run(...params).changes })
      };
    },
    migrate(statements) {
      db.exec(statements.join(';\n'));
    },
    transaction(fn) {
      return db.transaction(fn)();
    }
  };
}

function originThread() {
  return {
    id: 'thread-origin',
    projectId: 'project-1',
    hostId: 'host-1',
    environmentId: 'env-1',
    providerId: 'fake',
    status: 'idle'
  };
}

describe('workflows plugin', () => {
  it('is official (stable id) and ships a skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(derivePluginId(pkg.name)).toBe('workflows');
    const manifest = readPluginManifest(pkg);
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(readFileSync(join(root, 'skills/workflows/SKILL.md'), 'utf8')).toContain('zcc workflows');
    expect(manifest.appEntry).toBe('./app.js');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(existsSync(join(root, 'skills/workflows/references/authoring.md'))).toBe(true);
    expect(readFileSync(join(root, 'server.mjs'), 'utf8')).toContain(
      'createRequire as __createRequire'
    );
    expect(readFileSync(join(root, 'server.mjs'), 'utf8')).not.toMatch(
      /from ["']@zana-ai\/zcc-plugin-sdk(?:\/server)?["']/
    );
  });

  it('registers CLI, tools, and origin-aware configure', async () => {
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'workflows',
      database: memoryPluginDatabase(),
      getThread: async () => originThread(),
      defaultExecutionOptions: async () => ({
        model: 'gpt-test',
        reasoningLevel: 'medium',
        permissionMode: 'full'
      }),
      listProviders: async () => [
        { id: 'fake', available: true, capabilities: { permissionModes: ['full'] } }
      ],
      loadProviderModels: async () => ({
        models: [{ id: 'gpt-test', model: 'gpt-test', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }],
        selectedOnlyModels: [],
        modelLoadError: null
      })
    });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('workflows');
    expect(harness.agentTools.map((tool) => tool.name).sort()).toEqual([
      'zcc_workflow_result',
      'zcc_workflow_run'
    ]);
    const author = await harness.agentConfigurers[0]!({
      threadId: 'thread-origin',
      projectId: 'project-1',
      origin: { pluginId: null },
      thread: originThread()
    });
    expect(author?.tools).toEqual(['zcc_workflow_run']);
    const worker = await harness.agentConfigurers[0]!({
      threadId: 'thread-worker',
      projectId: 'project-1',
      origin: { pluginId: 'workflows' },
      thread: { ...originThread(), id: 'thread-worker' }
    });
    expect(worker?.tools).toEqual(['zcc_workflow_result']);
    const validated = await harness.runCli(
      ['validate', '--script', SAMPLE],
      { projectId: 'project-1', threadId: 'thread-origin' }
    );
    expect(validated.exitCode).toBe(0);
    expect(validated.stdout).toContain('"valid":true');
    await harness.dispose();
  });

  it('starts a run, stamps hidden spawn, and stops it', async () => {
    const spawned: unknown[] = [];
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'workflows',
      database: memoryPluginDatabase(),
      getThread: async ({ threadId }) => ({
        ...originThread(),
        id: threadId,
        visibility: threadId === 'thread-origin' ? 'visible' : 'hidden'
      }),
      defaultExecutionOptions: async () => ({
        model: 'gpt-test',
        reasoningLevel: 'medium',
        permissionMode: 'full'
      }),
      listProviders: async () => [
        { id: 'fake', available: true, capabilities: { permissionModes: ['full'] } }
      ],
      loadProviderModels: async () => ({
        models: [{ id: 'gpt-test', model: 'gpt-test', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }],
        selectedOnlyModels: [],
        modelLoadError: null
      }),
      spawnThread: async (args) => {
        spawned.push(args);
        return { id: `thread-worker-${spawned.length}` };
      },
      stopThread: async () => ({ ok: true as const }),
      threadOutput: async () => ({ output: 'done' }),
      sendThread: async () => ({ id: 'msg-1' }),
      archiveThread: async ({ threadId }) => ({ id: threadId })
    });
    await plugin(zcc);
    try {
      const startedRaw = await harness.callAgentTool(
        'zcc_workflow_run',
        { script: SAMPLE },
        { threadId: 'thread-origin', projectId: 'project-1' }
      );
      const started = JSON.parse(String(startedRaw)) as {
        runId: string;
        previewDirective: string;
      };
      expect(started.previewDirective).toBe(`::workflow-preview{run="${started.runId}"}`);
      await vi.waitFor(() => {
        expect(spawned[0]).toMatchObject({
          visibility: 'hidden',
          environment: { kind: 'reuse', environmentId: 'env-1' }
        });
      });
      const listed = await harness.runCli(['list'], {
        projectId: 'project-1',
        threadId: 'thread-origin'
      });
      expect(listed.stdout).toContain(started.runId);
      const stopped = await harness.runCli(['stop', started.runId], {
        projectId: 'project-1',
        threadId: 'thread-origin'
      });
      expect(stopped.exitCode).toBe(0);
    } finally {
      await harness.dispose();
    }
  });
});
