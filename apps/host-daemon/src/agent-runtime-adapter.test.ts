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
import { createAgentRuntimeAdapter, mapRuntimeThreadEvent, threadExecutionOptions } from './agent-runtime-adapter.js';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';

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

  it('forwards clientRequestId into startThread and runTurn', async () => {
    const started: string[] = [];
    const turned: string[] = [];
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
            started.push(input.clientRequestId);
            return runtime.startThread(input);
          },
          runTurn: async (input) => {
            turned.push(input.clientRequestId);
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
      clientRequestId: 'creq_23456789ab'
    });
    await adapter.submitTurn({
      threadId,
      input: ['follow up'],
      clientRequestId: 'creq_23456789ac'
    });
    adapter.dispose();
    expect(started).toEqual(['creq_23456789ab']);
    expect(turned).toEqual(['creq_23456789ac']);
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

  it('denies native fs/shell tools and attaches remote dynamic tools without ssh -t', async () => {
    const started: Array<{
      disallowedTools?: readonly string[];
      instructions?: string;
      dynamicTools?: Array<{ name: string }>;
    }> = [];
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
            started.push({
              disallowedTools: input.disallowedTools,
              instructions: input.instructions,
              dynamicTools: input.dynamicTools
            });
            return runtime.startThread(input);
          }
        };
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p-ssh',
      providerId: 'fake',
      input: ['inspect remote'],
      cwd,
      remote: { host: 'devbox', user: 'me', remotePath: '/src' },
      remoteToolProxy: true
    });
    adapter.dispose();
    expect(started[0]?.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write']));
    expect(started[0]?.instructions).toMatch(/remote_read/);
    expect(started[0]?.dynamicTools?.map((tool) => tool.name)).toContain('remote_exec');
  });

  it('does not deny native tools when remoteToolProxy is off', async () => {
    const started: Array<{ disallowedTools?: readonly string[] }> = [];
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
            started.push({ disallowedTools: input.disallowedTools });
            return runtime.startThread(input);
          }
        };
      }
    });
    await adapter.startWork({
      threadId: randomUUID(),
      environmentId: randomUUID(),
      projectId: 'p-ssh',
      providerId: 'fake',
      input: ['hello'],
      cwd,
      remote: { host: 'devbox' }
    });
    adapter.dispose();
    expect(started[0]?.disallowedTools).toBeUndefined();
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

describe('mapRuntimeThreadEvent', () => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  const scope = { kind: 'turn' as const, turnId: 'turn-1' };

  it('keeps retrying provider errors in-flight instead of failing the turn', () => {
    const event = {
      type: 'provider/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'Provider error',
      detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
      willRetry: true,
      errorInfo: {
        category: 'unauthorized',
        providerCode: 'authentication_failed',
        httpStatusCode: 401
      }
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event)).toEqual({
      threadId,
      kind: 'thread.event',
      payload: event
    });
  });

  it('keeps reconnecting system errors in-flight', () => {
    const event = {
      type: 'system/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'stream disconnected',
      reconnectAttempt: 3,
      reconnectTotal: 5
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('thread.event');
  });

  it('maps a terminal provider error as turn.failed', () => {
    const event = {
      type: 'provider/error',
      threadId,
      providerThreadId: '',
      scope,
      message: 'Provider error',
      willRetry: false,
      errorInfo: {
        category: 'unauthorized',
        providerCode: 'authentication_failed',
        httpStatusCode: 401
      }
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('turn.failed');
  });

  it('maps turn completion as turn.completed', () => {
    const event = {
      type: 'turn/completed',
      threadId,
      providerThreadId: '',
      scope,
      status: 'completed'
    } as ThreadEvent;
    expect(mapRuntimeThreadEvent(event).kind).toBe('turn.completed');
  });
});
