import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostBridgeLaunchSchema,
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
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'p1',
      providerId: 'opencode',
      input: ['hello'],
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
    expect(HOST_RPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(18);
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
});
