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
      input: ['hello'],
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
      input: ['hello'],
      clientRequestId: 'not-a-request-id'
    }).success).toBe(false);
    expect(HostRpcCommandSchema.parse({
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'claude',
      input: ['hello'],
      remote: { host: 'box', user: 'me', remotePath: '/src' },
      remoteToolProxy: true
    })).toMatchObject({
      type: 'thread.start',
      remoteToolProxy: true,
      remote: { host: 'box', user: 'me', remotePath: '/src' }
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
      type: 'turn.submit',
      threadId,
      environmentId,
      input: ['follow up'],
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
      type: 'terminal.start',
      sessionId: threadId,
      root: '/tmp/proj',
      cwd: '/tmp/proj',
      cols: 80,
      rows: 24
    }).type).toBe('terminal.start');
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
        dataDir: '/tmp/bridge',
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
  });

  it('parses provider.status results by command type', () => {
    expect(parseHostRpcResult('provider.status', { providers: [] })).toEqual({ providers: [] });
    expect(parseHostRpcResult('thread.resize', { threadId, resized: true })).toEqual({
      threadId,
      resized: true
    });
    expect(parseHostRpcResult('thread.plan.cancel', { threadId, cancelled: true })).toEqual({
      threadId,
      cancelled: true
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
      serverHost: 'box.tailnet.ts.net'
    }).type).toBe('peer_daemon.status');
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.restart',
      remote: { host: 'devbox' },
      serverHost: 'box.tailnet.ts.net'
    }).type).toBe('peer_daemon.restart');
    expect(HostRpcCommandSchema.parse({
      type: 'peer_daemon.install',
      remote: { host: 'devbox' },
      joinCode: 'zcde_x',
      hostId,
      serverUrl: 'https://box.tailnet.ts.net',
      artifactPath: '/tmp/zcc-host.tgz'
    }).type).toBe('peer_daemon.install');
    expect(parseHostRpcResult('peer_daemon.status', { state: 'not_installed' })).toEqual({
      state: 'not_installed'
    });
    expect(parseHostRpcResult('peer_daemon.restart', { ok: true, log: 'restarted' })).toEqual({
      ok: true,
      log: 'restarted'
    });
    expect(parseHostRpcResult('peer_daemon.install', { ok: true, log: 'installed' })).toEqual({
      ok: true,
      log: 'installed'
    });
  });
});
