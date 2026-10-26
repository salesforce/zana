import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostBridgeLaunchSchema,
  HostEnrollRequestSchema,
  HostEnrollResponseSchema,
  HostEventBatchMessageSchema,
  HostHelloOkMessageSchema,
  HostReadyMessageSchema,
  HostReadyOkMessageSchema,
  HostHeartbeatMessageSchema,
  HostHeartbeatAckMessageSchema,
  HostRpcCommandSchema,
  HostRpcRequestMessageSchema,
  HostRpcResponseMessageSchema,
  isForbiddenHostEnvironmentName,
  HostEnvironmentEntrySchema,
  PeerForwardCommandSchema,
  PeerRequestEnvelopeSchema,
  parseHostRpcResult
} from './host-rpc.js';

const hostId = randomUUID();
const instanceId = randomUUID();
const threadId = randomUUID();
const environmentId = randomUUID();
const peerCommand = {
  protocolVersion: 2 as const, pairId: 'pair-a', senderId: 'app-a', recipientId: 'app-b',
  pluginId: 'plugin-a', scope: 'opaque-repo-1', route: '/api/v1/peer/plugin-a/handshake', httpMethod: 'POST' as const,
  payloadHash: createHash('sha256').update('{}').digest('hex'), signature: 'a'.repeat(43),
  nonce: 'n'.repeat(16), issuedAt: 1_000_000, epoch: 1,
  type: 'peer.forward' as const, method: 'handshake', body: '{}', timeoutMs: 1000
};

describe('peer.forward v2 contract', () => {
  it('round-trips the flat command and envelope with separate protocol versions', () => {
    const { type: _type, method: _method, body: _body, timeoutMs: _timeout, ...envelope } = peerCommand;
    expect(HOST_RPC_PROTOCOL_VERSION).toBe(48);
    expect(PeerRequestEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(PeerForwardCommandSchema.parse(peerCommand)).toEqual(peerCommand);
    expect(HostRpcCommandSchema.parse(peerCommand)).toEqual(peerCommand);
    expect(HostRpcRequestMessageSchema.parse({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'peer-1', command: peerCommand }).command).toEqual(peerCommand);
    expect(parseHostRpcResult('peer.forward', { status: 409, body: '{}' })).toEqual({ status: 409, body: '{}' });
    for (const result of [{ status: 0, body: '' }, { status: 600, body: '' }, { status: 200, body: 1 },
      { status: 200, body: '', headers: {} }]) expect(() => parseHostRpcResult('peer.forward', result)).toThrow();
    expect(PeerRequestEnvelopeSchema.safeParse(peerCommand).success).toBe(false);
  });

  it.each(Object.keys(peerCommand))('requires explicit %s without legacy defaults', field => {
    const incomplete = { ...peerCommand };
    delete incomplete[field as keyof typeof incomplete];
    expect(PeerForwardCommandSchema.safeParse(incomplete).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    { protocolVersion: 1 }, { protocolVersion: 44 }, { pairId: '../pair' }, { senderId: 'app\n' },
    { recipientId: 'app\r' }, { recipientId: peerCommand.senderId }, { pluginId: 'Plugin-a' },
    { scope: '' }, { scope: 'x'.repeat(1025) }, { scope: '\u00e9'.repeat(513) }, { scope: '\ud800' },
    { scope: 'x\n' }, { scope: 'x\u007f' }, { httpMethod: 'GET' }, { payloadHash: 'A'.repeat(64) },
    { payloadHash: 'a'.repeat(63) }, { signature: 'a'.repeat(42) }, { signature: '+'.repeat(43) },
    { nonce: 'n'.repeat(15) }, { nonce: 'n'.repeat(129) }, { issuedAt: -1 }, { issuedAt: 1.5 },
    { issuedAt: Number.MAX_SAFE_INTEGER + 1 }, { epoch: 0 }, { epoch: 1.5 }, { epoch: Number.MAX_SAFE_INTEGER + 1 },
    { method: '../apply' }, { method: 'apply' }, { pluginId: 'plugin-b' }, { route: '/api/v1/peer/plugin-b/handshake' },
    { route: '/api/v1/peer/plugin-a/apply' }, { route: '/api/v1/peer/plugin-a/%68andshake' },
    { route: '/api/v1/peer/plugin-a/handshake?x=1' }, { route: 'http://127.0.0.1/api/v1/peer/plugin-a/handshake' },
    { timeoutMs: 0 }, { timeoutMs: 30_001 }, { timeoutMs: 1.5 }, { body: 'x'.repeat(8 * 1024 * 1024 + 1) },
    { type: 'host.read_file' }, { headers: {} }, { url: 'http://evil.example' }, { envelope: {} }
  ])('rejects strict malformed or mismatched envelope %j', patch => {
    expect(PeerForwardCommandSchema.safeParse({ ...peerCommand, ...patch }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ ...peerCommand, ...patch }).success).toBe(false);
  });

  it('accepts matching method/route changes and exact scalar boundaries', () => {
    const command = { ...peerCommand, method: 'apply', route: '/api/v1/peer/plugin-a/apply',
      scope: '\u00e9'.repeat(512), nonce: 'n'.repeat(128), issuedAt: 0, epoch: Number.MAX_SAFE_INTEGER,
      timeoutMs: 30_000, body: '' };
    expect(PeerForwardCommandSchema.parse(command)).toEqual(command);
    expect(PeerForwardCommandSchema.parse({ ...command, timeoutMs: 1, issuedAt: Number.MAX_SAFE_INTEGER }).timeoutMs).toBe(1);
  });
});

describe('host-rpc contract', () => {
  it('round-trips native catalogue discovery and author restrictions at protocol 45', () => {
    expect(HOST_RPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(45);
    const command = { type: 'host.list_commands', providerId: 'fixture-provider', cwd: null };
    expect(HostRpcCommandSchema.parse(command)).toEqual(command);
    for (const patch of [{ providerId: '' }, { cwd: undefined }, { root: '/private' }]) {
      expect(HostRpcCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
    }
    const result = {
      commands: [{ name: 'review', source: 'skill', origin: 'user', description: null,
        argumentHint: null, filePath: '/home/skills/review/SKILL.md', linked: true,
        userInvocable: false, disableModelInvocation: true, allowedTools: ['Read'] }],
      diagnostics: ['One root is unavailable']
    };
    expect(parseHostRpcResult('host.list_commands', result)).toEqual(result);
    expect(() => parseHostRpcResult('host.list_commands', {
      commands: [{ ...result.commands[0], userInvocable: 'false' }]
    })).toThrow();
  });
  it('keeps Connect and legacy peer installation as separate strict request shapes', () => {
    const command = { type: 'peer_daemon.install', remote: { host: 'devbox' }, connect: {
      accountUrl: 'https://account.example', serverId: randomUUID(), code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD'
    } };
    expect(HostRpcCommandSchema.parse(command)).toEqual(command);
    for (const invalid of [
      { ...command, joinCode: 'zcde_legacy' },
      { ...command, connect: { ...command.connect, code: 'zcde_legacy' } },
      { ...command, connect: { ...command.connect, serverId: 'not-a-uuid' } },
      { ...command, connect: { ...command.connect, credential: 'hidden' } }
    ]) expect(HostRpcCommandSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires a bounded runtime inventory before readiness and binds the acknowledgement to the lifetime', () => {
    const ready = { type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId,
      runtime: { threads: [{ threadId, status: 'active' }], loadedEnvironments: [environmentId] } };
    expect(HostReadyMessageSchema.safeParse(ready).success).toBe(true);
    for (const patch of [
      { runtime: undefined }, { instanceId: 'invalid' }, { protocolVersion: HOST_RPC_PROTOCOL_VERSION - 1 },
      { runtime: { ...ready.runtime, threads: Array(4097).fill({ threadId, status: 'active' }) } },
      { runtime: { ...ready.runtime, loadedEnvironments: Array(4097).fill(environmentId) } },
      { runtime: { ...ready.runtime, threads: [{ threadId, status: 'invented' }] } }
    ]) expect(HostReadyMessageSchema.safeParse({ ...ready, ...patch }).success).toBe(false);
    const ack = { type: 'host.ready-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId };
    expect(HostReadyOkMessageSchema.safeParse(ack).success).toBe(true);
    expect(HostReadyOkMessageSchema.safeParse({ ...ack, instanceId: undefined }).success).toBe(false);
  });
  it('advertises bounded heartbeat leases and validates heartbeat replies', () => {
    const hello = { type: 'host.hello-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId };
    expect(HostHelloOkMessageSchema.parse(hello)).toMatchObject({ heartbeatIntervalMs: 5000, leaseTimeoutMs: 30000 });
    for (const patch of [{ heartbeatIntervalMs: 0 }, { heartbeatIntervalMs: 30001 }, { leaseTimeoutMs: 29999 }, { leaseTimeoutMs: 120001 }]) {
      expect(HostHelloOkMessageSchema.safeParse({ ...hello, ...patch }).success).toBe(false);
    }
    expect(HostHeartbeatMessageSchema.safeParse({ type: 'heartbeat' }).success).toBe(true);
    expect(HostHeartbeatAckMessageSchema.safeParse({ type: 'heartbeat-ack' }).success).toBe(true);
    expect(HostHeartbeatMessageSchema.safeParse({ type: 'heartbeat', hostId: 'forged' }).success).toBe(false);
    expect(HostHeartbeatAckMessageSchema.safeParse({ type: 'heartbeat-ack', extra: true }).success).toBe(false);
  });
  it('bounds read-only checkout history commands and validates returned rows', () => {
    const command = { type: 'host.git_history', root: '/project', limit: 50 };
    expect(HostRpcCommandSchema.safeParse(command).success).toBe(true);
    for (const patch of [{ limit: 0 }, { limit: 101 }, { limit: 1.2 }, { root: undefined }, { args: ['--all'] }]) expect(HostRpcCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
    expect(parseHostRpcResult('host.git_history', [])).toEqual([]);
    const row = { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Author', ts: 1, subject: 'Commit' };
    expect(parseHostRpcResult('host.git_history', [row])).toEqual([row]);
    for (const rows of [Array(101).fill(row), [{ ...row, path: '/private' }], [{ ...row, ts: Infinity }]]) expect(() => parseHostRpcResult('host.git_history', rows)).toThrow();
  });
  it('requires both confinement roots for complete tree snapshots and validates bounded results', () => {
    const command = { type: 'host.snapshot_path', path: '/project/.zcc/library/tree', rootPath: '/project', boundaryPath: '/project/.zcc/library' };
    expect(HostRpcCommandSchema.safeParse(command).success).toBe(true);
    for (const patch of [{ rootPath: undefined }, { boundaryPath: undefined }, { recursive: true }]) expect(HostRpcCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
    expect(parseHostRpcResult('host.snapshot_path', { entries: [{ kind: 'dir', relPath: '' }] })).toEqual({ entries: [{ kind: 'dir', relPath: '' }] });
    expect(() => parseHostRpcResult('host.snapshot_path', { entries: [{ kind: 'file', relPath: '', sizeBytes: 26 * 1024 * 1024, sha256: 'a'.repeat(64) }] })).toThrow();
  });
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
    expect(HostHelloOkMessageSchema.parse({
      type: 'host.hello-ok',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId
    })).toEqual({
      type: 'host.hello-ok',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId,
      pluginHostGenerations: [],
      heartbeatIntervalMs: 5000,
      leaseTimeoutMs: 30000
    });
  });

  it('rejects an incompatible protocol version before dispatch', () => {
    expect(HostRpcRequestMessageSchema.safeParse({
      type: 'host-rpc.request',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION + 1,
      requestId: 'r1',
      command: { type: 'provider.status' }
    }).success).toBe(false);
  });

  it('accepts project-bound plugin host calls at the current protocol', () => {
    const command = {
      type: 'plugin.host.call', pluginId: 'fixture', generation: 'g1',
      artifact: { digest: 'a'.repeat(64), byteLength: 12 },
      callId: 'call-1', method: 'echo', input: {}, timeoutMs: 1000,
      projectRoot: '/registered/project'
    };
    expect(HOST_RPC_PROTOCOL_VERSION).toBe(48);
    expect(HostRpcRequestMessageSchema.parse({
      type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'r1', command
    }).command).toEqual(command);
    expect(HostRpcRequestMessageSchema.safeParse({
      type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION - 1,
      requestId: 'r1', command
    }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ ...command, projectRoot: '' }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ ...command, unexpected: true }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ ...command, projectRoot: undefined }).success).toBe(true);
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
      type: 'workspace.processes.list',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'unmanaged'
    }).type).toBe('workspace.processes.list');
    expect(HostRpcCommandSchema.parse({
      type: 'workspace.processes.kill',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'unmanaged',
      pids: [4242]
    }).type).toBe('workspace.processes.kill');
    expect(HostRpcCommandSchema.safeParse({
      type: 'workspace.processes.kill',
      workspacePath: '/tmp/proj',
      workspaceProvisionType: 'unmanaged',
      pids: []
    }).success).toBe(false);
    expect(parseHostRpcResult('workspace.processes.list', {
      processes: [{ pid: 7, cwd: '/tmp/proj', command: 'vite' }],
      truncated: false,
      supported: true
    })).toMatchObject({ processes: [{ pid: 7, command: 'vite' }], supported: true });
    expect(parseHostRpcResult('workspace.processes.kill', {
      killed: [{ pid: 7, cwd: '/tmp/proj', command: 'vite' }]
    })).toMatchObject({ killed: [{ pid: 7 }] });
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'claude',
      input: [{ type: 'text', text: 'hello' }],
      clientRequestId: 'creq_23456789ab'
    })).toMatchObject({
      type: 'thread.start',
      clientRequestId: 'creq_23456789ab'
    });
    expect(HostRpcCommandSchema.safeParse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'claude',
      input: [{ type: 'text', text: 'hello' }],
      clientRequestId: 'not-a-request-id'
    }).success).toBe(false);
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'claude',
      input: [{ type: 'text', text: 'hello' }],
      remote: { host: 'box', user: 'me', remotePath: '/src' },
      remoteToolProxy: true
    })).toMatchObject({
      type: 'thread.start',
      remoteToolProxy: true,
      remote: { host: 'box', user: 'me', remotePath: '/src' }
    });
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'opencode',
      input: [{ type: 'text', text: 'hello' }],
      dynamicTools: [{
        name: 'sf_soql',
        description: 'Run SOQL',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }],
      instructions: 'Use Salesforce tools.'
    })).toMatchObject({
      type: 'thread.start',
      instructions: 'Use Salesforce tools.',
      dynamicTools: [expect.objectContaining({ name: 'sf_soql' })]
    });
    expect(HostRpcCommandSchema.parse({
      type: 'thread.resume',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'opencode',
      providerThreadId: 'prov-1',
      dynamicTools: [{ name: 'sf_apex', description: 'Run Apex', inputSchema: {} }],
      instructions: 'Use sf_apex.'
    })).toMatchObject({
      type: 'thread.resume',
      instructions: 'Use sf_apex.',
      dynamicTools: [expect.objectContaining({ name: 'sf_apex' })]
    });
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
      type: 'thread.plan.cancel',
      threadId,
      expectedTurnId: 'turn-plan-1'
    })).toMatchObject({
      type: 'thread.plan.cancel',
      expectedTurnId: 'turn-plan-1'
    });
    expect(HostRpcCommandSchema.safeParse({
      type: 'thread.plan.cancel',
      threadId
    }).success).toBe(false);
    expect(HostRpcCommandSchema.parse({
      type: 'thread.background.stop',
      threadId,
      itemId: 'item-bg-1'
    })).toMatchObject({ type: 'thread.background.stop', itemId: 'item-bg-1' });
    expect(HostRpcCommandSchema.safeParse({
      type: 'thread.background.stop',
      threadId,
      itemId: ''
    }).success).toBe(false);
    expect(HostRpcCommandSchema.parse({
      type: 'turn.submit',
      threadId,
      environmentId,
      input: [{ type: 'text', text: 'follow up' }],
      model: 'claude-sonnet-5',
      reasoningLevel: 'high',
      clientRequestId: 'creq_23456789ab',
      resume: {
        projectId: 'p1',
        providerId: 'claude',
        providerThreadId: 'prov-1'
      }
    })).toMatchObject({
      type: 'turn.submit',
      model: 'claude-sonnet-5',
      reasoningLevel: 'high',
      clientRequestId: 'creq_23456789ab',
      resume: { providerThreadId: 'prov-1' }
    });
    expect(HostRpcCommandSchema.parse({
      type: 'turn.submit',
      threadId,
      environmentId,
      input: [{
        type: 'text',
        text: '/plan inspect',
        mentions: [{
          start: 0,
          end: 5,
          resource: {
            kind: 'command',
            trigger: '/',
            name: 'plan',
            source: 'command',
            origin: 'builtin',
            label: 'plan',
            argumentHint: null
          }
        }]
      }]
    }).input).toEqual([{
      type: 'text',
      text: '/plan inspect',
      mentions: [{
        start: 0,
        end: 5,
        resource: {
          kind: 'command',
          trigger: '/',
          name: 'plan',
          source: 'command',
          origin: 'builtin',
          label: 'plan',
          argumentHint: null
        }
      }]
    }]);
    expect(HostRpcCommandSchema.safeParse({
      type: 'turn.submit',
      threadId,
      environmentId,
      input: ['follow up']
    }).success).toBe(false);
    expect(HostRpcCommandSchema.parse({
      type: 'terminal.start',
      sessionId: threadId,
      root: '/tmp/proj',
      cwd: '/tmp/proj',
      cols: 80,
      rows: 24,
      command: 'npm run dev'
    }).type).toBe('terminal.start');
    expect(HostRpcCommandSchema.safeParse({
      type: 'terminal.start',
      sessionId: threadId,
      root: '/tmp/proj',
      command: 'x'.repeat(10_001)
    }).success).toBe(false);
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
    expect(HostRpcCommandSchema.parse({
      type: 'codex.voice.transcribe',
      model: 'gpt-transcribe',
      audioBase64: 'YQ==',
      mimeType: 'audio/webm',
      filename: 'recording.webm',
      prompt: null,
      timeoutMs: 10_000
    }).type).toBe('codex.voice.transcribe');
    expect(HostRpcCommandSchema.parse({
      type: 'codex.inference.complete',
      model: 'gpt-5',
      reasoningEffort: 'none',
      prompt: 'Name this thread.',
      outputSchema: { type: 'object' },
      timeoutMs: 10_000
    }).type).toBe('codex.inference.complete');
    expect(HostRpcCommandSchema.safeParse({
      type: 'thread.resize',
      threadId,
      cols: 0,
      rows: 24
    }).success).toBe(false);
    expect(HostRpcCommandSchema.safeParse({ type: 'not.a.command' }).success).toBe(false);
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
        { kind: 'project.clone.progress', payload: { text: 'Cloning into repo...' } },
        { terminalId: threadId, kind: 'terminal.output', payload: { data: 'hi' } }
      ]
    });
    expect(batch.events[0]).not.toHaveProperty('sequence');
    expect(batch.events[1]?.kind).toBe('project.clone.progress');
  });

  it('parses provider.list_models commands and results', () => {
    const command = HostRpcCommandSchema.parse({
      type: 'provider.list_models',
      providerId: 'codex',
      bridgeLaunch: {
        pluginId: 'provider-codex',
        source: { kind: 'daemon-bundled', id: 'codex' },
        capabilities: {
          supportsServiceTier: true,
          permissionModes: ['full'],
          supportsThreadArchive: true,
          supportsThreadRename: true,
          fork: 'checkpoint'
        }
      }
    });
    expect(command.type).toBe('provider.list_models');
    expect(
      HostRpcCommandSchema.parse({
        type: 'provider.list_models',
        providerId: 'acp-opencode',
        bridgeLaunch: {
          pluginId: 'provider-acp',
          source: {
            kind: 'artifact',
            digest: 'ab'.repeat(32),
            byteLength: 2048
          },
          capabilities: {
            supportsServiceTier: true,
            permissionModes: ['full'],
            supportsThreadArchive: false,
            supportsThreadRename: false,
            fork: 'tip'
          }
        }
      }).bridgeLaunch.source
    ).toEqual({
      kind: 'artifact',
      digest: 'ab'.repeat(32),
      byteLength: 2048
    });
    expect(parseHostRpcResult('provider.list_models', {
      models: [{
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'GPT-5.5',
        description: 'Codex default',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
        defaultReasoningEffort: 'medium',
        isDefault: true
      }],
      selectedOnlyModels: []
    }).models[0]?.displayName).toBe('GPT-5.5');
  });

  it('parses provider.health commands and results', () => {
    const command = HostRpcCommandSchema.parse({
      type: 'provider.health',
      providerId: 'acp-opencode',
      bridgeLaunch: {
        pluginId: 'provider-acp',
        source: { kind: 'daemon-bundled', id: 'acp-opencode' },
        capabilities: {
          supportsServiceTier: true,
          permissionModes: ['full'],
          supportsThreadArchive: false,
          supportsThreadRename: false,
          fork: 'tip'
        }
      }
    });
    expect(command.type).toBe('provider.health');
    expect(parseHostRpcResult('provider.health', { supported: false })).toEqual({ supported: false });
    expect(parseHostRpcResult('provider.health', {
      supported: true,
      health: { status: 'not_installed' }
    })).toMatchObject({ supported: true, health: { status: 'not_installed' } });
  });

  it('rejects leftover laptop artifactPath and dataDir on HostBridgeLaunch', () => {
    const launch = {
      pluginId: 'provider-acp',
      source: {
        kind: 'artifact' as const,
        digest: 'ab'.repeat(32),
        byteLength: 2048,
        artifactPath: '/Users/me/plugins/provider-acp/src/bridge/bridge.ts'
      },
      dataDir: '/Users/me/.zcc/thread-bridges/acp-opencode',
      capabilities: {
        supportsServiceTier: true,
        permissionModes: ['full'],
        supportsThreadArchive: false,
        supportsThreadRename: false,
        fork: 'tip'
      }
    };
    expect(HostBridgeLaunchSchema.safeParse(launch).success).toBe(false);
    expect(HOST_RPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(20);
  });

  it('parses provider CLI status and install commands', () => {
    expect(HostRpcCommandSchema.parse({ type: 'provider.cli_status' }).type).toBe('provider.cli_status');
    expect(HostRpcCommandSchema.parse({
      type: 'provider.cli_install',
      provider: 'codex',
      actionKind: 'install'
    }).type).toBe('provider.cli_install');
    expect(parseHostRpcResult('provider.cli_status', {
      codex: {
        displayName: 'Codex',
        executableName: 'codex',
        executablePath: null,
        installed: false,
        installSource: 'notInstalled',
        currentVersion: null,
        latestVersion: '0.149.1',
        minimumSupportedVersion: '0.136.0',
        npmPackageName: '@openai/codex',
        npmGlobalPackageVersion: null,
        installAction: {
          kind: 'install',
          label: 'Install',
          commandKind: 'exec',
          command: 'npm install -g @openai/codex@latest'
        },
        needsUpdate: false,
        versionUnsupported: false
      }
    }).codex?.displayName).toBe('Codex');
    expect(parseHostRpcResult('provider.cli_install', {
      events: [{ type: 'started', provider: 'pi', command: 'npm install -g @earendil-works/pi-coding-agent@latest' }]
    }).events).toHaveLength(1);
  });

  it('parses global CLI skill install and status commands', () => {
    expect(HostRpcCommandSchema.parse({
      type: 'host.install_global_skills',
      skills: [{ name: 'zcc-cli', content: '# zcc\n' }]
    }).type).toBe('host.install_global_skills');
    expect(HostRpcCommandSchema.parse({
      type: 'host.global_skills_status',
      names: ['zcc-cli']
    }).type).toBe('host.global_skills_status');
    expect(parseHostRpcResult('host.global_skills_status', {
      entries: [{ name: 'zcc-cli', path: '/tmp/.claude/skills/zcc-cli', installed: false, hash: null }]
    }).entries).toHaveLength(1);
    expect(parseHostRpcResult('host.install_global_skills', {
      installations: [{ name: 'zcc-cli', path: '/tmp/.agents/skills/zcc-cli' }]
    }).installations[0]?.name).toBe('zcc-cli');
    expect(parseHostRpcResult('codex.voice.transcribe', {
      model: 'gpt-transcribe',
      text: 'hello'
    })).toEqual({ model: 'gpt-transcribe', text: 'hello' });
    expect(parseHostRpcResult('codex.inference.complete', {
      model: 'gpt-5',
      value: { title: 'Hello' }
    })).toEqual({ model: 'gpt-5', value: { title: 'Hello' } });
  });

  it('parses provider.status results by command type', () => {
    expect(parseHostRpcResult('provider.status', { providers: [] })).toEqual({ providers: [] });
    expect(parseHostRpcResult('provider.status', {
      providers: [],
      extraInstalledAgents: [{ providerId: 'acp-omp', installed: false }]
    }).extraInstalledAgents).toEqual([{ providerId: 'acp-omp', installed: false }]);
    expect(parseHostRpcResult('thread.resize', { threadId, resized: true })).toEqual({
      threadId,
      resized: true
    });
    expect(parseHostRpcResult('thread.plan.cancel', { threadId, cancelled: true })).toEqual({
      threadId,
      cancelled: true
    });
    expect(parseHostRpcResult('thread.background.stop', { threadId, stopped: false })).toEqual({
      threadId,
      stopped: false
    });
    expect(() => parseHostRpcResult('thread.start', { providers: [] })).toThrow();
    expect(parseHostRpcResult('workspace.diffFiles', {
      files: [{
        path: 'a.ts',
        previousPath: null,
        statusLetter: 'M',
        additions: 1,
        deletions: 0,
        binary: false,
        origin: 'tracked'
      }],
      shortstat: '1 file changed',
      mergeBaseRef: null,
      truncated: false
    })).toMatchObject({ truncated: false, files: [{ path: 'a.ts' }] });
    expect(() => parseHostRpcResult('workspace.diffPatch', [{
      path: 'a.ts',
      patch: 'diff --git a/a.ts b/a.ts\n',
      truncated: false
    }])).toThrow(/expected object/i);
    expect(parseHostRpcResult('workspace.diffPatch', {
      patches: [{ path: 'a.ts', patch: 'diff --git a/a.ts b/a.ts\n', truncated: false }]
    })).toEqual({
      patches: [{ path: 'a.ts', patch: 'diff --git a/a.ts b/a.ts\n', truncated: false }]
    });
    expect(HostRpcCommandSchema.parse({
      type: 'interactive.resolve',
      threadId,
      interactionId: 'pint_1',
      providerId: 'claude-code',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      resolution: { decision: 'deny' }
    }).type).toBe('interactive.resolve');
    expect(parseHostRpcResult('interactive.resolve', {
      interactionId: 'pint_1',
      delivered: true
    })).toEqual({ interactionId: 'pint_1', delivered: true });
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.status',
      remote: { host: 'devbox', user: 'me' },
      serverHost: 'machine.example.com'
    }).type).toBe('peer_daemon.status');
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.restart',
      remote: { host: 'devbox' },
      serverHost: 'machine.example.com'
    }).type).toBe('peer_daemon.restart');
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.install',
      remote: { host: 'devbox' },
      joinCode: 'zcde_x',
      hostId,
      serverUrl: 'https://machine.example.com',
      artifactPath: '/tmp/zcc-host.tgz'
    }).type).toBe('peer_daemon.install');
    expect(parseHostRpcResult('peer_daemon.status', { state: 'not_installed' })).toEqual({
      state: 'not_installed'
    });
    expect(parseHostRpcResult('peer_daemon.status', {
      state: 'disconnected',
      hostId
    })).toEqual({
      state: 'disconnected',
      hostId
    });
    expect(parseHostRpcResult('peer_daemon.restart', { ok: true, log: 'restarted' })).toEqual({
      ok: true,
      log: 'restarted'
    });
    expect(parseHostRpcResult('peer_daemon.install', { ok: true, log: 'installed' })).toEqual({
      ok: true,
      log: 'installed'
    });
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.logs',
      remote: { host: 'devbox' },
      serverHost: 'machine.example.com'
    }).type).toBe('peer_daemon.logs');
    expect(parseHostRpcResult('peer_daemon.logs', { log: '--- host-daemon.log ---\njoined' })).toEqual({
      log: '--- host-daemon.log ---\njoined'
    });
  });

  it('parses host filesystem mutations and thread lifecycle commands', () => {
    expect(HostRpcCommandSchema.parse({
      type: 'host.write_file',
      path: '/tmp/proj/a.ts',
      rootPath: '/tmp/proj',
      content: 'hello',
      contentEncoding: 'utf8',
      createParents: true
    }).type).toBe('host.write_file');
    expect(parseHostRpcResult('host.write_file', {
      outcome: 'written',
      sha256: 'a'.repeat(64),
      sizeBytes: 5
    })).toMatchObject({ outcome: 'written', sizeBytes: 5 });
    expect(parseHostRpcResult('host.write_file', {
      outcome: 'conflict',
      currentSha256: null
    })).toEqual({ outcome: 'conflict', currentSha256: null });
    expect(HostRpcCommandSchema.parse({
      type: 'host.mkdir',
      path: '/tmp/proj/dir',
      recursive: true
    }).type).toBe('host.mkdir');
    expect(HostRpcCommandSchema.parse({
      type: 'host.move_path',
      sourcePath: '/tmp/proj/a.ts',
      destinationPath: '/tmp/proj/b.ts',
      rootPath: '/tmp/proj'
    }).type).toBe('host.move_path');
    expect(HostRpcCommandSchema.parse({
      type: 'host.remove_path',
      path: '/tmp/proj/b.ts',
      recursive: false
    }).type).toBe('host.remove_path');
    expect(HostRpcCommandSchema.parse({
      type: 'host.browse_directory'
    }).type).toBe('host.browse_directory');
    expect(HostRpcCommandSchema.parse({
      type: 'host.paths_exist',
      paths: ['/tmp/proj/a.ts']
    }).type).toBe('host.paths_exist');
    expect(parseHostRpcResult('host.paths_exist', {
      existence: { '/tmp/proj/a.ts': true }
    })).toEqual({ existence: { '/tmp/proj/a.ts': true } });
    expect(HostRpcCommandSchema.parse({
      type: 'host.list_paths',
      path: '/tmp/proj',
      query: 'foo',
      limit: 80,
      includeFiles: true,
      includeDirectories: false
    }).type).toBe('host.list_paths');
    expect(HostRpcCommandSchema.safeParse({
      type: 'host.list_paths',
      path: '/tmp/proj',
      limit: 80,
      includeFiles: false,
      includeDirectories: false
    }).success).toBe(false);
    expect(parseHostRpcResult('host.list_paths', {
      paths: [{
        kind: 'file',
        path: 'src/foo.ts',
        name: 'foo.ts',
        score: 12,
        positions: [4, 5, 6]
      }],
      truncated: false
    })).toMatchObject({ truncated: false, paths: [{ path: 'src/foo.ts' }] });
    expect(HostRpcCommandSchema.parse({
      type: 'host.read_path',
      path: '/tmp/proj/a.ts',
      rootPath: '/tmp/proj'
    }).type).toBe('host.read_path');
    expect(parseHostRpcResult('host.read_file', {
      content: '# Notes',
      encoding: 'utf8'
    })).toEqual({ content: '# Notes', encoding: 'utf8' });
    expect(parseHostRpcResult('host.read_file', {
      content: 'iVBORw0KGgo=',
      encoding: 'base64'
    })).toEqual({ content: 'iVBORw0KGgo=', encoding: 'base64' });
    expect(parseHostRpcResult('host.read_path', {
      path: '/tmp/proj/a.ts',
      content: 'hello',
      contentEncoding: 'utf8',
      sizeBytes: 5,
      sha256: 'a'.repeat(64)
    })).toMatchObject({ contentEncoding: 'utf8', sizeBytes: 5 });
    expect(HostRpcCommandSchema.parse({
      type: 'host.file_metadata',
      path: '/tmp/proj/a.ts'
    }).type).toBe('host.file_metadata');
    expect(parseHostRpcResult('host.file_metadata', {
      path: '/tmp/proj/a.ts',
      modifiedAtMs: 1,
      sizeBytes: 5
    })).toEqual({ path: '/tmp/proj/a.ts', modifiedAtMs: 1, sizeBytes: 5 });
    expect(HostRpcCommandSchema.parse({
      type: 'host.pick_folder'
    }).type).toBe('host.pick_folder');
    expect(parseHostRpcResult('host.pick_folder', { path: null })).toEqual({ path: null });
    expect(HostRpcCommandSchema.parse({
      type: 'thread.rewind.prepare',
      threadId,
      environmentId,
      leaseId: 'lease-1',
      projectId: 'p1',
      providerId: 'codex',
      sourceProviderThreadId: 'pt-1',
      retainThroughProviderCheckpoint: 'cp-1'
    }).type).toBe('thread.rewind.prepare');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.rewind.discard',
      threadId,
      environmentId,
      leaseId: 'lease-1'
    }).type).toBe('thread.rewind.discard');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.rename',
      threadId,
      environmentId,
      title: 'New title'
    }).type).toBe('thread.rename');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.archive',
      threadId,
      environmentId,
      providerId: 'claude',
      providerThreadId: 'pt-1'
    }).type).toBe('thread.archive');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.unarchive',
      threadId,
      environmentId,
      providerId: 'claude',
      providerThreadId: 'pt-1'
    }).type).toBe('thread.unarchive');
    expect(HostRpcCommandSchema.parse({
      type: 'thread.goal.clear',
      threadId,
      environmentId
    }).type).toBe('thread.goal.clear');
    expect(parseHostRpcResult('thread.goal.clear', {
      threadId,
      cleared: true
    })).toEqual({ threadId, cleared: true });
  });

  it('parses desktop.browser commands, results, and a non-UUID thread payload', () => {
    expect(HOST_RPC_PROTOCOL_VERSION).toBe(48);
    expect(HostRpcCommandSchema.parse({
      type: 'desktop.browser.list_instances'
    }).type).toBe('desktop.browser.list_instances');
    expect(HostRpcCommandSchema.parse({
      type: 'desktop.browser.list_tabs',
      instanceId: 'window-1',
      generation: 'gen-1',
      threadId: 'thr_abcdefghij'
    }).type).toBe('desktop.browser.list_tabs');
    expect(parseHostRpcResult('desktop.browser.list_instances', {
      instances: [{ instanceId: 'window-1', generation: 'gen-1', label: 'ZCC window 1' }]
    })).toEqual({
      instances: [{ instanceId: 'window-1', generation: 'gen-1', label: 'ZCC window 1' }]
    });
    expect(parseHostRpcResult('desktop.browser.create_tab', {
      tab: {
        tabId: 'browser:tab-1',
        threadId: 'thr_abcdefghij',
        url: 'about:blank',
        title: '',
        control: null,
        profile: { kind: 'automation', id: randomUUID() },
        presentation: 'hidden'
      }
    })).toMatchObject({ tab: { tabId: 'browser:tab-1', threadId: 'thr_abcdefghij' } });
    const batch = HostEventBatchMessageSchema.parse({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId,
      instanceId,
      events: [{
        kind: 'desktop.browser.changed',
        payload: {
          type: 'desktop-browser.changed',
          instanceId: 'window-1',
          generation: 'gen-1',
          threadId: 'thr_abcdefghij',
          tabs: []
        }
      }]
    });
    expect(batch.events[0]?.kind).toBe('desktop.browser.changed');
    expect((batch.events[0]?.payload as { threadId: string }).threadId).toBe('thr_abcdefghij');
  });
});

it('validates bounded preview declarations and their owner generation', () => {
  const command = { type: 'preview.replace', epoch: '11111111-1111-4111-8111-111111111111', generation: 1, targets: [{ port: 5173, expiresAt: Date.now() + 60000 }] };
  expect(HostRpcCommandSchema.parse(command)).toEqual(command);
  for (const patch of [{ epoch: 'forged' }, { generation: -1 }, { targets: [{ port: 22, expiresAt: 1 }] }, { targets: Array(33).fill(command.targets[0]) }, { targetHost: 'other' }]) {
    expect(HostRpcCommandSchema.safeParse({ ...command, ...patch }).success).toBe(false);
  }
});

describe('host.environment.replace', () => {
  const entry = { name: 'GH_TOKEN', value: 'token-value' };

  it('retains protocol 44 environment forwarding in the combined protocol and parses a bounded, strict entry list', () => {
    expect(HOST_RPC_PROTOCOL_VERSION).toBe(48);
    const command = {
      type: 'host.environment.replace',
      entries: [
        entry,
        { name: 'GIT_AUTHOR_NAME', value: 'octocat', group: 'identity' },
        { name: 'GIT_CONFIG_COUNT', value: '1', group: 'git-config', requires: ['GH_TOKEN'] }
      ]
    };
    expect(HostRpcCommandSchema.parse(command)).toEqual(command);
    expect(HostRpcCommandSchema.parse({ type: 'host.environment.replace', entries: [] }).type)
      .toBe('host.environment.replace');
  });

  it('rejects malformed, oversized, forbidden or unknown-key entries', () => {
    const base = { type: 'host.environment.replace' };
    const bad: unknown[] = [
      { ...base, entries: [{ name: '1BAD', value: 'x' }] },
      { ...base, entries: [{ name: 'HAS SPACE', value: 'x' }] },
      { ...base, entries: [{ name: 'GH_TOKEN', value: 'a\u0000b' }] },
      { ...base, entries: [{ name: 'GH_TOKEN', value: 'x'.repeat(8193) }] },
      { ...base, entries: [{ name: 'GH_TOKEN', value: 'x', extra: true }] },
      { ...base, entries: [{ name: 'GH_TOKEN', value: 'x', group: '' }] },
      { ...base, entries: [{ name: 'GH_TOKEN', value: 'x', requires: ['bad name'] }] },
      { ...base, entries: Array.from({ length: 129 }, (_, i) => ({ name: `V_${i}`, value: 'x' })) },
      { ...base, entries: [entry], unexpected: true },
      { ...base }
    ];
    for (const command of bad) expect(HostRpcCommandSchema.safeParse(command).success).toBe(false);
    for (const name of ['PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'HOME', 'ZCC_SERVER_URL', 'BB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'path']) {
      expect(HostRpcCommandSchema.safeParse({ ...base, entries: [{ name, value: 'x' }] }).success, name).toBe(false);
    }
  });

  it('exposes the forbidden-name predicate used by the daemon and the server', () => {
    expect(isForbiddenHostEnvironmentName('PATH')).toBe(true);
    expect(isForbiddenHostEnvironmentName('ld_library_path')).toBe(true);
    expect(isForbiddenHostEnvironmentName('GH_TOKEN')).toBe(false);
    expect(isForbiddenHostEnvironmentName('GIT_CONFIG_KEY_0')).toBe(false);
    expect(isForbiddenHostEnvironmentName('GIT_CONFIG_COUNT')).toBe(false);
    for (const name of [
      'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_PARAMETERS', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_PROXY_COMMAND', 'GIT_EXTERNAL_DIFF',
      'GH_CONFIG_DIR', 'ZDOTDIR', 'PROMPT_COMMAND', 'EDITOR', 'VISUAL', 'PAGER', 'XDG_CONFIG_HOME', 'PERL5OPT',
      'RUBYOPT', 'PYTHONSTARTUP', 'JAVA_TOOL_OPTIONS', 'HTTPS_PROXY', 'http_proxy', 'ALL_PROXY', 'SSL_CERT_FILE'
    ]) expect(isForbiddenHostEnvironmentName(name), name).toBe(true);
  });

  it('accepts only credential, URL-rewrite and identity git keys, and a small config count', () => {
    const parse = (name: string, value: string) => HostEnvironmentEntrySchema.safeParse({ name, value }).success;
    for (const key of [
      'credential.helper', 'credential.https://github.com.helper', 'url.https://github.com/.insteadOf',
      'url.https://github.com/.pushInsteadOf', 'user.name', 'user.email'
    ]) expect(parse('GIT_CONFIG_KEY_0', key), key).toBe(true);
    for (const key of [
      'core.sshCommand', 'core.fsmonitor', 'core.hooksPath', 'core.pager', 'alias.st', 'include.path',
      'credential.https://x .helper', 'url..insteadOf', ' user.name', ''
    ]) expect(parse('GIT_CONFIG_KEY_3', key), key).toBe(false);
    expect(parse('GIT_CONFIG_VALUE_0', '!f() { echo; }; f')).toBe(true);
    expect(parse('GIT_CONFIG_COUNT', '4')).toBe(true);
    for (const count of ['17', '-1', '1e3', '', 'four']) expect(parse('GIT_CONFIG_COUNT', count), count).toBe(false);
  });

  it('parses a names-only result and rejects values smuggled into it', () => {
    expect(parseHostRpcResult('host.environment.replace', { applied: ['GH_TOKEN'], skipped: [] }))
      .toEqual({ applied: ['GH_TOKEN'], skipped: [] });
    expect(() => parseHostRpcResult('host.environment.replace', { applied: ['GH_TOKEN'], skipped: [], value: 'x' }))
      .toThrow();
  });
});
