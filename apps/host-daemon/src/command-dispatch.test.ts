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

  it('forwards clientRequestId from thread.start into startWork', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-creq-'));
    const startedWork: Array<{ clientRequestId?: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        startedWork.push({ clientRequestId: input.clientRequestId });
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
      providerId: 'claude',
      input: ['/plan inspect'],
      clientRequestId: 'creq_23456789ab'
    })).resolves.toMatchObject({ started: true });
    expect(startedWork).toEqual([{ clientRequestId: 'creq_23456789ab' }]);
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

  it('forwards remoteToolProxy into startWork without spawning ssh -t', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-proxy-'));
    const started: Array<{ remoteToolProxy?: boolean; remote?: unknown; cwd: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        started.push({
          remoteToolProxy: input.remoteToolProxy,
          remote: input.remote,
          cwd: input.cwd
        });
      }
    });
    const environmentId = randomUUID();
    await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'unmanaged',
      path: project
    });
    await dispatchHostCommand(runtime, {
      type: 'thread.start',
      threadId: randomUUID(),
      environmentId,
      projectId: 'proj-1',
      providerId: 'claude',
      input: ['hello'],
      cwd: project,
      remote: { host: 'box.example', user: 'me', remotePath: '/src' },
      remoteToolProxy: true
    });
    expect(started).toHaveLength(1);
    expect(started[0]?.remoteToolProxy).toBe(true);
    expect(started[0]?.remote).toEqual({ host: 'box.example', user: 'me', remotePath: '/src' });
    expect(started[0]?.cwd).toBe(realpathSync(project));
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

  it('reads text as utf8 and images as base64', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-read-file-'));
    writeFileSync(join(root, 'note.md'), '# hello\n');
    writeFileSync(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'host.read_file',
      root,
      relPath: 'note.md'
    })).resolves.toEqual({ content: '# hello\n', encoding: 'utf8' });
    const image = await dispatchHostCommand(runtime, {
      type: 'host.read_file',
      root,
      relPath: 'shot.png'
    }) as { content: string; encoding: string };
    expect(image.encoding).toBe('base64');
    expect(Buffer.from(image.content, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
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
      command: { type: 'not.a.command' }
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('unknown_command');
  });

  it('writes, browses, and probes host paths through dispatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-host-fs-dispatch-'));
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude
    });
    const written = await dispatchHostCommand(runtime, {
      type: 'host.write_file',
      path: join(root, 'note.txt'),
      rootPath: root,
      content: 'hello',
      contentEncoding: 'utf8',
      createParents: false
    }) as { outcome: string; sizeBytes: number };
    expect(written).toMatchObject({ outcome: 'written', sizeBytes: 5 });
    await expect(dispatchHostCommand(runtime, {
      type: 'host.mkdir',
      path: join(root, 'apps'),
      rootPath: root,
      recursive: false
    })).resolves.toEqual({ ok: true });
    const listed = await dispatchHostCommand(runtime, {
      type: 'host.browse_directory',
      path: root
    }) as { entries: Array<{ name: string }> };
    expect(listed.entries.map((entry) => entry.name).sort()).toEqual(['apps', 'note.txt']);
    const existence = await dispatchHostCommand(runtime, {
      type: 'host.paths_exist',
      paths: [join(root, 'note.txt'), join(root, 'missing.txt')]
    }) as { existence: Record<string, boolean> };
    expect(existence.existence[join(root, 'note.txt')]).toBe(true);
    expect(existence.existence[join(root, 'missing.txt')]).toBe(false);
    const searched = await dispatchHostCommand(runtime, {
      type: 'host.list_paths',
      path: root,
      query: 'note',
      limit: 20,
      includeFiles: true,
      includeDirectories: true
    }) as { paths: Array<{ path: string; kind: string }>; truncated: boolean };
    expect(searched.truncated).toBe(false);
    expect(searched.paths.some((entry) => entry.path === 'note.txt' && entry.kind === 'file')).toBe(true);
    const read = await dispatchHostCommand(runtime, {
      type: 'host.read_path',
      path: join(root, 'note.txt'),
      rootPath: root
    }) as { content: string; contentEncoding: string; sizeBytes: number };
    expect(read).toMatchObject({ content: 'hello', contentEncoding: 'utf8', sizeBytes: 5 });
    const metadata = await dispatchHostCommand(runtime, {
      type: 'host.file_metadata',
      path: join(root, 'note.txt'),
      rootPath: root
    }) as { sizeBytes: number };
    expect(metadata.sizeBytes).toBe(5);
  });

  it('rewinds, renames, archives, and clears a thread goal through dispatch', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-lifecycle-'));
    const rewound: string[] = [];
    const discarded: string[] = [];
    const renamed: string[] = [];
    const archived: string[] = [];
    const unarchived: string[] = [];
    const cleared: string[] = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      prepareRewind: async (input) => {
        rewound.push(input.leaseId);
        return { providerThreadId: 'fork-1' };
      },
      discardRewind: async (input) => {
        discarded.push(input.leaseId);
      },
      renameWork: async (input) => {
        renamed.push(input.title);
      },
      archiveWork: async (input) => {
        archived.push(input.providerThreadId);
      },
      unarchiveWork: async (input) => {
        unarchived.push(input.providerThreadId);
      },
      clearGoal: async (input) => {
        cleared.push(input.threadId);
        return { cleared: true };
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
      projectId: 'p1',
      providerId: 'claude',
      input: ['hello']
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.rewind.prepare',
      threadId,
      environmentId,
      leaseId: 'lease-1',
      projectId: 'p1',
      providerId: 'claude',
      sourceProviderThreadId: 'pt-1',
      retainThroughProviderCheckpoint: 'cp-1'
    })).resolves.toMatchObject({
      prepared: true,
      providerThreadId: 'fork-1'
    });
    expect(rewound).toEqual(['lease-1']);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.rewind.discard',
      threadId,
      environmentId,
      leaseId: 'lease-1'
    })).resolves.toEqual({ leaseId: 'lease-1', discarded: true });
    expect(discarded).toEqual(['lease-1']);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.rename',
      threadId,
      environmentId,
      title: 'New title'
    })).resolves.toEqual({ threadId, renamed: true });
    expect(renamed).toEqual(['New title']);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.archive',
      threadId,
      environmentId,
      providerId: 'claude',
      providerThreadId: 'pt-1'
    })).resolves.toEqual({ threadId, archived: true });
    expect(archived).toEqual(['pt-1']);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.unarchive',
      threadId,
      environmentId,
      providerId: 'claude',
      providerThreadId: 'pt-1'
    })).resolves.toEqual({ threadId, unarchived: true });
    expect(unarchived).toEqual(['pt-1']);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.goal.clear',
      threadId,
      environmentId
    })).resolves.toEqual({ threadId, cleared: true });
    expect(cleared).toEqual([threadId]);
    await expect(dispatchHostCommand(runtime, {
      type: 'host.write_file',
      path: join(project, '..', 'escape.txt'),
      rootPath: project,
      content: 'nope',
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toBeInstanceOf(HostCommandError);
  });

  it('rejects rewind when the environment is not provisioned', async () => {
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      prepareRewind: async () => ({ providerThreadId: 'fork-1' })
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.rewind.prepare',
      threadId: randomUUID(),
      environmentId: randomUUID(),
      leaseId: 'lease-1',
      projectId: 'p1',
      providerId: 'claude',
      sourceProviderThreadId: 'pt-1',
      retainThroughProviderCheckpoint: 'cp-1'
    })).rejects.toMatchObject({ code: 'environment_not_ready' });
  });

  it('cancels plan mode without dropping the running thread', async () => {
    const stopped: string[] = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      stopWork: async (input) => {
        stopped.push(input.threadId);
      }
    });
    const threadId = randomUUID();
    const missingId = randomUUID();
    runtime.threads.set(threadId, { environmentId: randomUUID(), providerId: 'claude' });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.plan.cancel',
      threadId: missingId,
      expectedTurnId: 'turn-plan-1'
    })).resolves.toMatchObject({ threadId: missingId, cancelled: false });
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.plan.cancel',
      threadId,
      expectedTurnId: 'turn-plan-1'
    })).resolves.toMatchObject({ threadId, cancelled: true });
    expect(stopped).toEqual([threadId]);
    expect(runtime.threads.has(threadId)).toBe(true);
    await expect(dispatchHostCommand(runtime, {
      type: 'thread.stop',
      threadId
    })).resolves.toMatchObject({ stopped: true });
    expect(runtime.threads.has(threadId)).toBe(false);
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

  it('places a personal workspace under the host data dir when the requested path is foreign', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-personal-data-'));
    const environmentId = randomUUID();
    const runtime = createCommandRuntime({
      dataDir,
      verifyProviders: async () => installedClaude
    });
    const provisioned = await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'personal',
      targetPath: join('/Users/me/.zcc/personal-workspaces', environmentId)
    }) as { path: string };
    expect(provisioned.path).toBe(realpathSync(join(dataDir, 'personal-workspaces', environmentId)));
  });

  it('keeps a personal workspace that already lives under the host data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-personal-keep-'));
    const environmentId = randomUUID();
    const targetPath = join(dataDir, 'personal-workspaces', environmentId);
    const runtime = createCommandRuntime({
      dataDir,
      verifyProviders: async () => installedClaude
    });
    const provisioned = await dispatchHostCommand(runtime, {
      type: 'environment.provision',
      environmentId,
      workspaceProvisionType: 'personal',
      targetPath
    }) as { path: string };
    expect(provisioned.path).toBe(realpathSync(targetPath));
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
    const submitted: Array<{ input: string[]; clientRequestId?: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      resumeWork: async (input) => {
        resumed.push({ threadId: input.threadId, providerThreadId: input.providerThreadId });
      },
      submitTurn: async (input) => {
        submitted.push({ input: input.input, clientRequestId: input.clientRequestId });
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
      clientRequestId: 'creq_23456789ab',
      resume: {
        projectId: 'proj-1',
        providerId: 'claude',
        providerThreadId: 'prov-1',
        cwd: project
      }
    })).resolves.toMatchObject({ accepted: true });
    expect(resumed).toEqual([{ threadId, providerThreadId: 'prov-1' }]);
    expect(submitted).toEqual([{ input: ['hello again'], clientRequestId: 'creq_23456789ab' }]);
    expect(runtime.threads.has(threadId)).toBe(true);
  });

  it('forwards plugin dynamicTools from thread.start and thread.resume', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-thread-tools-'));
    const started: Array<{ dynamicTools?: Array<{ name: string }>; instructions?: string }> = [];
    const resumed: Array<{ dynamicTools?: Array<{ name: string }>; instructions?: string }> = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startWork: async (input) => {
        started.push({ dynamicTools: input.dynamicTools, instructions: input.instructions });
      },
      resumeWork: async (input) => {
        resumed.push({ dynamicTools: input.dynamicTools, instructions: input.instructions });
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
    const dynamicTools = [{
      name: 'sf_soql',
      description: 'SOQL',
      inputSchema: { type: 'object' }
    }];
    await dispatchHostCommand(runtime, {
      type: 'thread.start',
      threadId,
      environmentId,
      projectId: 'proj-1',
      providerId: 'claude',
      input: ['hello'],
      dynamicTools,
      instructions: 'Use sf_soql.'
    });
    await dispatchHostCommand(runtime, {
      type: 'thread.stop',
      threadId
    });
    await dispatchHostCommand(runtime, {
      type: 'thread.resume',
      threadId,
      environmentId,
      projectId: 'proj-1',
      providerId: 'claude',
      providerThreadId: 'prov-1',
      cwd: project,
      dynamicTools,
      instructions: 'Use sf_soql.'
    });
    expect(started).toEqual([{ dynamicTools, instructions: 'Use sf_soql.' }]);
    expect(resumed).toEqual([{ dynamicTools, instructions: 'Use sf_soql.' }]);
  });

  it('starts and drives a confined terminal session', async () => {
    const project = mkdtempSync(join(tmpdir(), 'zcc-term-'));
    const started: Array<{ cwd: string; cols: number; rows: number; command?: string }> = [];
    const written: string[] = [];
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      startTerminal: async (input) => {
        started.push({ cwd: input.cwd, cols: input.cols, rows: input.rows, command: input.command });
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
      rows: 30,
      command: 'npm run dev'
    })).resolves.toMatchObject({ started: true, pid: 9 });
    expect(started).toEqual([{ cwd: realpathSync(project), cols: 100, rows: 30, command: 'npm run dev' }]);
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

  it('dispatches peer_daemon.status through injectable SSH', async () => {
    const runtime = createCommandRuntime({
      verifyProviders: async () => installedClaude,
      peerSsh: {
        async run() {
          return { code: 0, stdout: 'connected\n', stderr: '' };
        },
        async pipeFile() {
          return { code: 0, stdout: '', stderr: '' };
        }
      }
    });
    await expect(dispatchHostCommand(runtime, {
      type: 'peer_daemon.status',
      remote: { host: 'devbox' },
      serverHost: 'box.tailnet.ts.net'
    })).resolves.toEqual({ state: 'connected' });
  });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
}
