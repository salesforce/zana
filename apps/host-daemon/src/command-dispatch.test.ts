import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createCommandRuntime, dispatchHostCommand } from './command-dispatch.js';
import { HostCommandError } from './host-command-error.js';
import { handleHostRpcRequest } from './command-router.js';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';

const installedClaude = {
  providers: [{
    family: 'claude',
    label: 'Claude Code',
    binary: process.execPath,
    enabled: true,
    alwaysEnabled: true,
    installed: true,
    installHint: 'install claude'
  }]
};

describe('host command dispatch', () => {
  it('rejects a missing unmanaged path without crashing', async () => {
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId: randomUUID(),
      workspaceProvisionType: 'unmanaged',
      path: join(tmpdir(), 'zcc-missing-env', randomUUID())
    })).rejects.toMatchObject({ code: 'path_not_found' });
  });

  it('starts a thread after unmanaged provision when the provider CLI is present', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-proj-'));
    const startedWork: Array<{ cwd: string; input: string[]; providerId: string }> = [];
    const resizedWork: Array<{ threadId: string; cols: number; rows: number }> = [];
    const writtenWork: Array<{ threadId: string; data: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        startedWork.push({ cwd: input.cwd, input: input.input, providerId: input.providerId });
      },
      resizeWork: async (input) => {
        resizedWork.push(input);
      },
      writeWork: async (input) => {
        writtenWork.push(input);
      }
    });
    const environmentId = randomUUID();
    const threadId = randomUUID();
    const provisioned = await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: project
    }) as { path: string; isGitRepo: boolean; transcript: unknown[] };
    expect(provisioned.path).toBeTruthy();
    expect(provisioned.isGitRepo).toBe(false);
    expect(Array.isArray(provisioned.transcript)).toBe(true);
    const started = await dispatchHostCommand(runtime, {
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'proj-1',
      providerId: 'claude',
      input: ['hello']
    }) as { started: boolean };
    expect(started.started).toBe(true);
    expect(startedWork).toEqual([{
      cwd: provisioned.path,
      input: ['hello'],
      providerId: 'claude'
    }]);
    const resized = await dispatchHostCommand(runtime, {
      type: 'thread.resize',
      threadId,
      cols: 120,
      rows: 40
    }) as { resized: boolean };
    expect(resized.resized).toBe(true);
    expect(resizedWork).toEqual([{ threadId, cols: 120, rows: 40 }]);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.input',
      threadId,
      data: '\x03'
    })).resolves.toMatchObject({ accepted: true });
    expect(writtenWork).toEqual([{ threadId, data: '\x03' }]);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.stop',
      threadId
    })).resolves.toMatchObject({ stopped: true });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.resize',
      threadId: randomUUID(),
      cols: 80,
      rows: 24
    })).rejects.toMatchObject({ code: 'unknown_thread' });
  });

  it('starts a shell thread with an empty prompt', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-shell-'));
    const startedWork: Array<{ providerId: string; input: string[] }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        startedWork.push({ providerId: input.providerId, input: input.input });
      }
    });
    const environmentId = randomUUID();
    await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: project
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.start',
      threadId: randomUUID(),
      environmentId,
      projectId: 'proj-1',
      providerId: 'shell',
      input: []
    })).resolves.toMatchObject({ started: true });
    expect(startedWork).toEqual([{ providerId: 'shell', input: [] }]);
  });

  it('forwards remote reconnect fields into startWork', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-remote-'));
    const started: Array<{ remote?: unknown; reconnectTmuxId?: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        started.push({ remote: input.remote, reconnectTmuxId: input.reconnectTmuxId });
      }
    });
    const environmentId = randomUUID();
    const threadId = randomUUID();
    await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: project
    });
    await dispatchHostCommand(runtime, {
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'proj-1',
      providerId: 'claude',
      input: [],
      remote: { host: 'box.example', user: 'me', remotePath: '/src' },
      reconnectTmuxId: threadId,
      resume: true
    });
    expect(started).toEqual([{
      remote: { host: 'box.example', user: 'me', remotePath: '/src' },
      reconnectTmuxId: threadId
    }]);
  });

  it('lists a seeded library file and rejects a path escape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-lib-root-'));
    writeFileSync(join(root, 'note.md'), '# hello\n');
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    const listed = await dispatchHostCommand(runtime, {
      type: 'host.list_files',
      roots: [root]
    }) as { files: Array<{ relPath: string }> };
    expect(listed.files.some((file) => file.relPath === 'note.md')).toBe(true);
    await expect(dispatchHostCommand(runtime, {
      type: 'host.read_file',
      root,
      relPath: '../secret'
    })).rejects.toBeInstanceOf(HostCommandError);
  });

  it('lists a single directory and skips denied names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-listdir-'));
    writeFileSync(join(root, 'note.md'), '# hello\n');
    mkdirSync(join(root, 'apps'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'secret'), 'nope');
    writeFileSync(join(root, 'apps', 'index.ts'), 'export {}\n');
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    const listed = await dispatchHostCommand(runtime, {
      type: 'host.list_dir',
      root,
      relPath: ''
    }) as { entries: Array<{ name: string; kind: string }> };
    expect(listed.entries.map((entry) => entry.name).sort()).toEqual(['apps', 'note.md']);
    const nested = await dispatchHostCommand(runtime, {
      type: 'host.list_dir',
      root,
      relPath: 'apps'
    }) as { entries: Array<{ name: string }> };
    expect(nested.entries.map((entry) => entry.name)).toEqual(['index.ts']);
    await expect(dispatchHostCommand(runtime, {
      type: 'host.list_dir',
      root,
      relPath: '../secret'
    })).rejects.toBeInstanceOf(HostCommandError);
  });

  it('rejects an unknown command type before dispatch', async () => {
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    const response = await handleHostRpcRequest(runtime, {
      type: 'host-rpc.request',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: 'r1',
      command: { type: 'thread.rewind.prepare' }
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('unknown_command');
  });

  it('delivers interactive.resolve through the runtime registry', async () => {
    const delivered: Array<{ interactionId: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      deliverInteractiveResolve: (input) => {
        delivered.push({ interactionId: input.interactionId });
      }
    });
    const threadId = randomUUID();
    await expect(dispatchHostCommand(runtime, {
      type: 'interactive.resolve',
      threadId,
      interactionId: 'pint_1',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-1',
      resolution: { decision: 'deny' }
    })).resolves.toEqual({ interactionId: 'pint_1', delivered: true });
    expect(delivered).toEqual([{ interactionId: 'pint_1' }]);
  });

  it('provisions a managed worktree, reports status, and destroys it', async () => {
    const source = mkdtempSync(join(tmpdir(), 'zcc-wt-src-'));
    git(source, ['init', '-b', 'main']);
    git(source, ['config', 'user.name', 'Test']);
    git(source, ['config', 'user.email', 'test@example.com']);
    writeFileSync(join(source, 'README.md'), 'hello\n');
    git(source, ['add', '.']);
    git(source, ['commit', '-m', 'init']);
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-wt-data-'));
    const environmentId = randomUUID();
    const targetPath = join(dataDir, 'worktrees', environmentId, 'repo');
    const runtime = createCommandRuntime({
      dataDir,
      verifyProviders: async () => installedClaude
    });
    const provisioned = await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'managed-worktree',
      sourcePath: source,
      targetPath,
      branchName: `zcc/task-${environmentId}`,
      baseBranch: 'main',
      setupTimeoutMs: 15_000
    }) as { path: string; isWorktree: boolean; branchName: string | null };
    expect(provisioned.path.endsWith(`/worktrees/${environmentId}/repo`) || provisioned.path.includes(`/worktrees/${environmentId}/`)).toBe(true);
    expect(provisioned.isWorktree).toBe(true);
    expect(provisioned.branchName).toBe(`zcc/task-${environmentId}`);
    const status = await dispatchHostCommand(runtime, {
      type: 'workspace.status',
      workspacePath: targetPath,
      workspaceProvisionType: 'managed-worktree'
    }) as { dirty: boolean; branchName: string | null };
    expect(status.branchName).toBe(`zcc/task-${environmentId}`);
    const destroyed = await dispatchHostCommand(runtime, {
      type: 'environment.destroy',
      environmentId,
      workspacePath: targetPath,
      workspaceProvisionType: 'managed-worktree'
    }) as { destroyed: boolean };
    expect(destroyed.destroyed).toBe(true);
  });

  it('fails PR actions closed when gh is missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'zcc-no-gh-'));
    const previous = process.env.PATH;
    process.env.PATH = empty;
    try {
      const runtime = createCommandRuntime({ verifyProviders: async () => installedClaude });
      await expect(dispatchHostCommand(runtime, {
        type: 'workspace.pull_request_ready',
        workspacePath: tmpdir(),
        workspaceProvisionType: 'unmanaged'
      })).rejects.toMatchObject({ code: 'gh_missing' });
    } finally {
      process.env.PATH = previous;
    }
  });

  it('lazily resumes a missing thread runtime before turn.submit', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-lazy-resume-'));
    const resumed: Array<{ threadId: string; providerThreadId: string }> = [];
    const submitted: string[][] = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      resumeWork: async (input) => {
        resumed.push({ threadId: input.threadId, providerThreadId: input.providerThreadId });
      },
      submitTurn: async (input) => {
        submitted.push(input.input);
      }
    });
    const environmentId = randomUUID();
    await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: project
    });
    const threadId = randomUUID();
    await expect(dispatchHostCommand(runtime, {
      type: 'turn.submit',
      threadId,
      environmentId,
      input: ['hello again']
    })).rejects.toMatchObject({ code: 'unknown_thread' });
    expect(resumed).toEqual([]);
    await expect(dispatchHostCommand(runtime, {
      type: 'turn.submit',
      threadId,
      environmentId,
      input: ['hello again'],
      resume: {
        projectId: 'proj-1',
        providerId: 'claude',
        providerThreadId: 'prov-1',
        cwd: project
      }
    })).resolves.toMatchObject({ accepted: true });
    expect(resumed).toEqual([{ threadId, providerThreadId: 'prov-1' }]);
    expect(submitted).toEqual([['hello again']]);
    expect(runtime.threads.has(threadId)).toBe(true);
  });

  it('starts and drives a confined terminal session', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-term-'));
    const started: Array<{ cwd: string; cols: number; rows: number }> = [];
    const written: string[] = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startTerminal: async (input) => {
        started.push({ cwd: input.cwd, cols: input.cols, rows: input.rows });
        return { pid: 9 };
      },
      writeTerminal: async (input) => {
        written.push(input.data);
      }
    });
    const sessionId = randomUUID();
    await expect(dispatchHostCommand(runtime, {
      type: 'terminal.start',
      sessionId,
      root: project,
      cwd: project,
      cols: 100,
      rows: 30
    })).resolves.toMatchObject({ started: true, pid: 9 });
    expect(started).toEqual([{ cwd: realpathSync(project), cols: 100, rows: 30 }]);
    await expect(dispatchHostCommand(runtime, {
      type: 'terminal.input',
      sessionId,
      data: 'echo hi\n'
    })).resolves.toMatchObject({ accepted: true });
    expect(written).toEqual(['echo hi\n']);
    await expect(dispatchHostCommand(runtime, {
      type: 'terminal.resize',
      sessionId,
      cols: 120,
      rows: 40
    })).resolves.toMatchObject({ resized: true });
    await expect(dispatchHostCommand(runtime, {
      type: 'terminal.stop',
      sessionId
    })).resolves.toMatchObject({ stopped: true });
    await expect(dispatchHostCommand(runtime, {
      type: 'terminal.input',
      sessionId,
      data: 'nope'
    })).rejects.toMatchObject({ code: 'unknown_terminal' });
  });

  it('lists provider models through the injected runtime', async () => {
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      listModels: async ({ providerId }) => ({
        models: [{
          id: `${providerId}-model`,
          model: `${providerId}-model`,
          displayName: 'Live Model',
          description: 'from host',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          defaultReasoningEffort: 'medium',
          isDefault: true
        }],
        selectedOnlyModels: []
      })
    });
    const listed = await dispatchHostCommand(runtime, {
      type: 'provider.list_models',
      providerId: 'codex',
      bridgeLaunch: {
        pluginId: 'provider-codex',
        dataDir: '/tmp/bridge',
        source: { kind: 'daemon-bundled', id: 'codex' },
        capabilities: {
          supportsServiceTier: true,
          permissionModes: ['full'],
          supportsThreadArchive: false,
          supportsThreadRename: true,
          fork: 'checkpoint'
        }
      }
    });
    expect(listed).toMatchObject({ models: [{ displayName: 'Live Model' }] });
  });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
}
