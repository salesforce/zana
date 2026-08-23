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
});
