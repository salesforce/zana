import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  fakeProviderScriptPath
} from '@zana-ai/zcc-agent-runtime/test';
import { createAgentRuntimeAdapter, threadExecutionOptions } from './agent-runtime-adapter.js';

describe('agent runtime thread adapter', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'zcc-agent-rt-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('starts a thread through AgentRuntime without PtyManager', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd
    });
    expect(events.some((event) => event.threadId === threadId)).toBe(true);
    await adapter.stopWork({ threadId });
    adapter.dispose();
  });

  it('runs a follow-up turn on the same AgentRuntime', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        })
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd
    });
    await adapter.submitTurn({ threadId, input: ['follow up'] });
    await adapter.stopWork({ threadId });
    adapter.dispose();
    expect(events.some((event) => event.kind === 'turn.completed' || event.kind === 'thread.event')).toBe(true);
  });

  it('passes model and reasoningLevel through startThread and runTurn', async () => {
    const started: Array<{ model?: string; reasoningLevel?: string }> = [];
    const turned: Array<{ model?: string; reasoningLevel?: string }> = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        const runtime = createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        });
        return {
          ...runtime,
          startThread: async (input) => {
            started.push(input.options);
            return runtime.startThread(input);
          },
          runTurn: async (input) => {
            turned.push(input.options);
            return runtime.runTurn(input);
          }
        };
      }
    });
    const threadId = randomUUID();
    await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd,
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
    await adapter.submitTurn({
      threadId,
      input: ['follow up'],
      model: 'claude-sonnet-5',
      reasoningLevel: 'xhigh'
    });
    adapter.dispose();
    expect(started[0]).toMatchObject({ model: 'claude-sonnet-5', reasoningLevel: 'high' });
    expect(turned[0]).toMatchObject({ model: 'claude-sonnet-5', reasoningLevel: 'xhigh' });
  });

  it('resumes a thread through AgentRuntime', async () => {
    const events: HostEventEnvelope[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: (event) => events.push(event),
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        })
    });
    const threadId = randomUUID();
    const started = await adapter.startWork({
      threadId,
      environmentId: randomUUID(),
      projectId: 'p1',
      providerId: 'fake',
      input: ['hello'],
      cwd
    });
    await adapter.stopWork({ threadId });
    if (started?.providerThreadId) {
      await adapter.resumeWork({
        threadId,
        environmentId: randomUUID(),
        projectId: 'p1',
        providerId: 'fake',
        providerThreadId: started.providerThreadId,
        cwd
      });
    }
    adapter.dispose();
    expect(events.length).toBeGreaterThan(0);
  });

  it('reuses one AgentRuntime for threads in the same environment', async () => {
    const created: string[] = [];
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) => {
        created.push(options.workspacePath);
        return createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        });
      }
    });
    const environmentId = randomUUID();
    const otherCwd = join(cwd, 'other');
    mkdirSync(otherCwd, { recursive: true });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: ['one'],
      cwd
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId,
      projectId: 'p1',
      providerId: 'fake',
      input: ['two'],
      cwd: otherCwd
    });
    adapter.dispose();
    expect(created).toEqual([cwd]);
  });

  it('lists fake provider models through AgentRuntime', async () => {
    const adapter = createAgentRuntimeAdapter({
      emit: () => undefined,
      dataDir: cwd,
      createRuntime: (options) =>
        createAgentRuntimeWithAdapters({
          ...options,
          adapterFactory: () => createFakeAdapter(fakeProviderScriptPath)
        })
    });
    const listed = await adapter.listModels({
      providerId: 'fake',
      bridgeLaunch: {
        pluginId: 'provider-fake',
        dataDir: cwd,
        source: { kind: 'daemon-bundled', id: 'fake' },
        capabilities: {
          supportsServiceTier: false,
          permissionModes: ['full'],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: 'checkpoint'
        }
      }
    });
    expect(listed.models.length).toBeGreaterThan(0);
    expect(listed.models[0]?.model).toBeTruthy();
    adapter.dispose();
  });
});

describe('threadExecutionOptions', () => {
  it('builds a valid permission policy for accept-edits and auto', () => {
    expect(threadExecutionOptions({ permissionMode: 'accept-edits' })).toMatchObject({
      permissionMode: 'accept-edits',
      permissionScope: 'workspace',
      approvalReviewer: 'user',
      permissionEscalation: 'ask'
    });
    expect(threadExecutionOptions({ permissionMode: 'auto' })).toMatchObject({
      permissionMode: 'auto',
      permissionScope: 'workspace',
      approvalReviewer: 'automatic',
      permissionEscalation: 'ask'
    });
    expect(threadExecutionOptions({})).toMatchObject({
      permissionMode: 'full',
      permissionScope: 'full',
      approvalReviewer: null,
      permissionEscalation: null
    });
  });

  it('passes model and reasoningLevel into runtime options', () => {
    expect(threadExecutionOptions({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    })).toMatchObject({
      model: 'claude-sonnet-5',
      reasoningLevel: 'high'
    });
  });
});
