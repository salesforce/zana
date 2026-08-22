import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEnrollRequestSchema,
  HostEnrollResponseSchema,
  HostEventBatchMessageSchema,
  HostRpcCommandSchema,
  HostRpcRequestMessageSchema,
  HostRpcResponseMessageSchema,
  parseHostRpcResult
} from './host-rpc.js';

const hostId = randomUUID();
const instanceId = randomUUID();
const threadId = randomUUID();
const environmentId = randomUUID();

describe('host-rpc contract', () => {
  it('accepts enroll request and response at the current protocol version', () => {
    expect(HostEnrollRequestSchema.parse({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostName: 'laptop',
      instanceId
    })).toMatchObject({ hostName: 'laptop', instanceId });
    expect(HostEnrollResponseSchema.parse({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId,
      hostKey: 'k'.repeat(32)
    })).toMatchObject({ hostId });
  });

  it('rejects an incompatible protocol version before dispatch', () => {
    expect(HostRpcRequestMessageSchema.safeParse({
      type: 'host-rpc.request',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION + 1,
      requestId: 'r1',
      command: { type: 'provider.status' }
    }).success).toBe(false);
  });

  it('round-trips the command union and rejects unknown types', () => {
    expect(HostRpcCommandSchema.parse({ type: 'provider.status' }).type).toBe('provider.status');
    expect(HostRpcCommandSchema.parse({
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: '/tmp/proj'
    }).type).toBe('environment.provision');
    expect(HostRpcCommandSchema.parse({
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'managed-worktree',
      sourcePath: '/tmp/proj',
      targetPath: '/tmp/worktrees/env/proj',
      branchName: 'zcc/feat-1',
      baseBranch: 'main',
      setupTimeoutMs: 60_000
    }).workspaceProvisionType).toBe('managed-worktree');
    expect(HostRpcCommandSchema.parse({
      type: 'workspace.status',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'unmanaged'
    }).type).toBe('workspace.status');
    expect(HostRpcCommandSchema.parse({
      type: 'workspace.pull_request_merge',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'managed-worktree',
      method: 'squash'
    }).type).toBe('workspace.pull_request_merge');
    expect(HostRpcCommandSchema.parse({
      type: 'workspace.pull_request_create',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'managed-worktree',
      title: 'Ship it'
    }).type).toBe('workspace.pull_request_create');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'claude',
      input: ['hello']
    }).type).toBe('thread.start');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'shell',
      input: []
    }).input).toEqual([]);
    expect(HostRpcCommandSchema.parse({
      type: 'thread.resize',
      threadId,
      cols: 120,
      rows: 40
    }).type).toBe('thread.resize');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.input',
      threadId,
      data: '\x03'
    }).type).toBe('thread.input');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.stop',
      threadId
    }).type).toBe('thread.stop');
    expect(HostRpcCommandSchema.parse({
      type: 'host.list_dir',
      root: '/tmp/proj',
      relPath: 'apps'
    }).type).toBe('host.list_dir');
    expect(HostRpcCommandSchema.parse({
      type: 'host.list_dir',
      root: '/tmp/proj',
      relPath: ''
    }).type).toBe('host.list_dir');
    expect(HostRpcCommandSchema.safeParse({
      type: 'thread.resize',
      threadId,
      cols: 0,
      rows: 24
    }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ type: 'thread.rewind.prepare' }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'managed-worktree',
      path: '/tmp/proj'
    }).success).toBe(false);
  });

  it('round-trips rpc request/response and event batches without a host sequence', () => {
    const request = HostRpcRequestMessageSchema.parse({
      type: 'host-rpc.request',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'req-1',
      command: { type: 'provider.status' }
    });
    expect(request.requestId).toBe('req-1');
    expect(HostRpcResponseMessageSchema.parse({
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'req-1',
      ok: true,
      commandType: 'provider.status',
      result: { providers: [] }
    }).ok).toBe(true);
    expect(HostRpcResponseMessageSchema.parse({
      type: 'host-rpc.response',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'req-1',
      ok: false,
      error: { code: 'path_not_found', message: 'missing' }
    }).ok).toBe(false);
    const batch = HostEventBatchMessageSchema.parse({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId,
      instanceId,
      events: [
        { threadId, kind: 'thread.started' },
        { kind: 'project.clone.progress', payload: { text: 'Cloning into repo...' } }
      ]
    });
    expect(batch.events[0]).not.toHaveProperty('sequence');
    expect(batch.events[1]?.kind).toBe('project.clone.progress');
  });

  it('parses provider.status results by command type', () => {
    expect(parseHostRpcResult('provider.status', { providers: [] })).toEqual({ providers: [] });
    expect(parseHostRpcResult('thread.resize', { threadId, resized: true })).toEqual({
      threadId,
      resized: true
    });
    expect(() => parseHostRpcResult('thread.start', { providers: [] })).toThrow();
  });
});
