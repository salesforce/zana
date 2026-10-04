import { ClaudeCliProvider } from '@zana-ai/zcc-llm';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConversationThread, openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { createCommandRuntime, dispatchHostCommand } from '../../../host-daemon/src/command-dispatch.js';
import { HostRpcCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createPluginApi,
  importServerFactory,
  jitiRequireIds,
  loadCreateJiti,
  resolveCreateJiti,
  validatePluginRequestInput
} from './plugin-api.js';

describe('plugin requestInput validation', () => {
  it('accepts a well-formed request and trims the title', () => {
    expect(validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'confirm_form',
      title: '  Confirm  ',
      payload: { ok: true }
    })).toMatchObject({
      threadId: 'thr-1',
      rendererId: 'confirm_form',
      title: 'Confirm',
      payload: { ok: true },
      timeoutMs: 10 * 60 * 1000
    });
  });

  it('rejects missing threadId, bad rendererId, empty title, and oversized payloads', () => {
    expect(() => validatePluginRequestInput({
      threadId: '',
      rendererId: 'form',
      title: 'Hi',
      payload: {}
    } as never)).toThrow(/threadId/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'bad id',
      title: 'Hi',
      payload: {}
    })).toThrow(/rendererId/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: '',
      payload: {}
    })).toThrow(/title/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Hi',
      payload: 'x'.repeat(65 * 1024)
    })).toThrow(/64 KiB/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Hi',
      payload: {},
      timeoutMs: 0
    })).toThrow(/timeoutMs/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'x'.repeat(161),
      payload: {}
    })).toThrow(/title/);
  });

  it('throws when requestInput has no backend', async () => {
    const handle = createPluginApi('ask-user', '/tmp');
    await expect(handle.api.ui.requestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Go',
      payload: {}
    })).rejects.toThrow(/not available/);
  });

  it('waits on the interaction backend and interrupts on dispose', async () => {
    const interrupted: string[] = [];
    const handle = createPluginApi('ask-user', '/tmp', {
      requestPluginInteraction: async () => ({ outcome: 'submitted', value: { ok: true } }),
      interruptPluginInteractions: (pluginId) => {
        interrupted.push(pluginId);
      }
    });
    await expect(handle.api.ui.requestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Go',
      payload: { n: 1 }
    })).resolves.toEqual({ outcome: 'submitted', value: { ok: true } });
    await handle.dispose();
    expect(interrupted).toEqual(['ask-user']);
  });
});

describe('plugin realtime', () => {
  it('broadcasts a namespaced signal through product hub', async () => {
    const emit = vi.fn();
    const handle = createPluginApi('pr-monitor', '/tmp', {
      productContext: { hub: { emit } } as never
    });
    handle.api.realtime.publish('prs-changed', { count: 2 });
    expect(emit).toHaveBeenCalledWith('plugin-signal', {
      pluginId: 'pr-monitor',
      channel: 'prs-changed',
      payload: { count: 2 }
    });
    await handle.dispose();
  });
});

describe('plugin storage and settings', () => {
  it('persists kv across api instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-kv-'));
    try {
      const handle = createPluginApi('kv', dir);
      await handle.api.storage.kv.set('n', 3);
      await handle.dispose();
      const again = createPluginApi('kv', dir);
      await expect(again.api.storage.kv.get('n')).resolves.toBe(3);
      await again.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists settings.define defaults and host writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-settings-'));
    try {
      const handle = createPluginApi('set', dir);
      const settings = handle.api.settings.define({
        token: { type: 'string', label: 'Token', default: 'x' }
      });
      expect(await settings.get()).toEqual({ token: 'x' });
      await handle.setSettings({ token: 'secret' });
      expect(await settings.get()).toEqual({ token: 'secret' });
      expect(handle.getSettings().values.token).toBe('secret');
      expect(handle.getSettings().descriptors.token?.label).toBe('Token');
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plugin CLI, HTTP, events, and sdk', () => {
  it('rejects reserved and duplicate CLI names, then runs with the 1MiB cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-cli-'));
    try {
      const handle = createPluginApi('hello', dir);
      expect(() =>
        handle.api.cli.register({
          name: 'plugin',
          summary: 'nope',
          run: async () => ({ exitCode: 0 })
        })
      ).toThrow(/reserved/);
      handle.api.cli.register({
        name: 'hello',
        summary: 'Say hello',
        commands: [{ name: 'world', summary: 'hi', usage: 'zcc hello world' }],
        run: async (argv) => ({ exitCode: 0, stdout: argv.join(' ') })
      });
      expect(() =>
        handle.api.cli.register({
          name: 'other',
          summary: 'too late',
          run: async () => ({ exitCode: 0 })
        })
      ).toThrow(/already registered/);
      const { runPluginCli } = await import('./plugin-api.js');
      await expect(runPluginCli(handle, ['world'])).resolves.toMatchObject({
        exitCode: 0,
        stdout: 'world',
        stderr: ''
      });
      handle.cli.registration = {
        name: 'hello',
        summary: 'Say hello',
        run: async () => ({ exitCode: 0, stdout: 'x'.repeat(1024 * 1024 + 1) })
      };
      const capped = await runPluginCli(handle, []);
      expect(capped.error?.code).toBe('plugin_cli_output_too_large');
      expect(capped.stdout).toBe('');
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers http routes, fans thread events, and stubs host/sdk unless spawn is wired', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-http-'));
    try {
      const spawnThread = vi.fn(async () => ({ id: 'thr-spawned' }));
      const handle = createPluginApi('demo', dir, { spawnThread });
      const admission = vi.fn(() => ({ action: 'proceed' as const }));
      handle.api.hooks.on(admission);
      expect(handle.dispatchAdmissionHandlers).toHaveLength(1);
      expect(handle.dispatchAdmissionHandlers[0]).toBe(admission);
      expect(() => handle.api.hooks.on(admission)).toThrow('only one dispatch admission handler');
      handle.api.http.route('GET', '/ping', () => ({ json: { ok: true } }));
      expect(handle.httpRoutes[0]?.path).toBe('/ping');
      handle.api.agents.registerTool({
        name: 'echo',
        description: 'Echo',
        parameters: { type: 'object', properties: {} },
        execute: async (input) => input
      });
      expect(handle.agentTools[0]?.name).toBe('echo');
      const seen: string[] = [];
      handle.api.events.on('thread.created', (event) => {
        seen.push(event.threadId);
      });
      await handle.emitThreadEvent({ name: 'thread.created', threadId: 'thr-1', projectId: 'p' });
      expect(seen).toEqual(['thr-1']);
      await expect(handle.api.sdk.threads.spawn({ projectId: 'p', prompt: 'hi' })).resolves.toEqual({
        id: 'thr-spawned'
      });
      expect(spawnThread).toHaveBeenCalledWith({ pluginId: 'demo', projectId: 'p', prompt: 'hi' });
      await expect(handle.api.sdk.threads.spawn({
        projectId: 'p',
        prompt: 'seeded',
        pluginMetadata: { ticket: 'W-1' }
      })).resolves.toEqual({ id: 'thr-spawned' });
      expect(spawnThread).toHaveBeenCalledWith({
        pluginId: 'demo',
        projectId: 'p',
        prompt: 'seeded',
        pluginMetadata: { ticket: 'W-1' }
      });
      await expect(handle.api.sdk.threads.spawn({
        projectId: 'p',
        prompt: 'work',
        visibility: 'hidden',
        environment: { kind: 'reuse', environmentId: '11111111-1111-4111-8111-111111111111' },
        title: 'Review · 1',
        model: 'opus',
        permissionMode: 'accept-edits'
      })).resolves.toEqual({ id: 'thr-spawned' });
      expect(spawnThread).toHaveBeenCalledWith({
        pluginId: 'demo',
        projectId: 'p',
        prompt: 'work',
        visibility: 'hidden',
        environment: { kind: 'reuse', environmentId: '11111111-1111-4111-8111-111111111111' },
        title: 'Review · 1',
        model: 'opus',
        permissionMode: 'accept-edits'
      });
      await expect(handle.api.host.experimental_call('keep-awake')).rejects.toThrow(/not available/);
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.threads.spawn({ projectId: 'p', prompt: 'hi' })).rejects.toThrow(
        /not available/
      );
      await handle.dispose();
      await bare.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forwards worktree, host, and service tier choices after validating the environment', async () => {
    const spawnThread = vi.fn(async () => ({ id: 'thr-worker' }));
    const handle = createPluginApi('demo', '/tmp', { spawnThread });
    try {
      const args = {
        projectId: 'p',
        prompt: 'Implement the task',
        hostId: 'host-1',
        serviceTier: 'fast' as const,
        environment: { kind: 'worktree' as const, baseBranch: 'main' }
      };
      await expect(handle.api.sdk.threads.spawn(args)).resolves.toEqual({ id: 'thr-worker' });
      expect(spawnThread).toHaveBeenCalledWith({ pluginId: 'demo', ...args });
      spawnThread.mockClear();
      await expect(handle.api.sdk.threads.spawn({
        ...args,
        environment: { kind: 'reuse', environmentId: 'not-an-environment-id' }
      })).rejects.toThrow();
      expect(spawnThread).not.toHaveBeenCalled();
    } finally {
      await handle.dispose();
    }
  });

  it('requires a product runtime for host-backed task APIs', async () => {
    const handle = createPluginApi('demo', '/tmp');
    try {
      await expect(handle.api.sdk.system.defaultHost()).rejects.toThrow(/not available/);
      await expect(handle.api.sdk.files.write({ path: '/tmp/task-output', content: 'result' })).rejects.toThrow(/not available/);
      await expect(handle.api.sdk.environments.pullRequest({ environmentId: 'env-1' })).rejects.toThrow(/not available/);
    } finally {
      await handle.dispose();
    }
  });

  it('defaults plugin metadata namespaces to the calling plugin and rejects invalid ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-meta-sdk-'));
    try {
      const getPluginMetadata = vi.fn(async () => ({ ticket: 'W-1' }));
      const updatePluginMetadata = vi.fn(async () => ({ ticket: 'W-2' }));
      const handle = createPluginApi('notes', dir, { getPluginMetadata, updatePluginMetadata });
      await expect(handle.api.sdk.threads.getPluginMetadata({ threadId: 'thr-1' })).resolves.toEqual({
        ticket: 'W-1'
      });
      expect(getPluginMetadata).toHaveBeenCalledWith({ pluginId: 'notes', threadId: 'thr-1' });
      await expect(handle.api.sdk.threads.getPluginMetadata({
        threadId: 'thr-1',
        pluginId: 'other-plugin'
      })).resolves.toEqual({ ticket: 'W-1' });
      expect(getPluginMetadata).toHaveBeenCalledWith({ pluginId: 'other-plugin', threadId: 'thr-1' });
      await expect(handle.api.sdk.threads.getPluginMetadata({
        threadId: 'thr-1',
        pluginId: 'Not Valid'
      })).rejects.toThrow(/pluginId is invalid/);
      await expect(handle.api.sdk.threads.updatePluginMetadata({
        threadId: 'thr-1',
        set: { ticket: 'W-2' },
        remove: ['stale']
      })).resolves.toEqual({ ticket: 'W-2' });
      expect(updatePluginMetadata).toHaveBeenCalledWith({
        pluginId: 'notes',
        threadId: 'thr-1',
        set: { ticket: 'W-2' },
        remove: ['stale']
      });
      await expect(handle.api.sdk.threads.updatePluginMetadata({
        threadId: 'thr-1',
        set: { a: 1 },
        remove: ['a']
      })).rejects.toThrow(/overlap/);
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets only validated icons on registered projects, publishes changes, and stops on dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-project-icon-'));
    try {
      const update = vi.fn(async (id: string) => id === 'p1' ? { id, icon: 'Cloud' } : null);
      const list = vi.fn(() => [{ id: 'p1', icon: 'Cloud' }]);
      const emit = vi.fn();
      const handle = createPluginApi('demo', dir, { productContext: { projects: { update, list }, hub: { emit } } as never });
      await handle.api.sdk.projects.setIcon({ projectId: ' p1 ', icon: 'Cloud' });
      expect(update).toHaveBeenCalledWith('p1', { icon: 'Cloud' });
      expect(emit).toHaveBeenCalledWith('projects:changed', [{ id: 'p1', icon: 'Cloud' }]);
      update.mockClear(); emit.mockClear();
      for (const args of [undefined, { projectId: '' }, { projectId: 'p1', icon: 'bad' }, { projectId: 'p1', icon: null }]) {
        await expect(handle.api.sdk.projects.setIcon(args as never)).rejects.toThrow();
      }
      expect(update).not.toHaveBeenCalled();
      await expect(handle.api.sdk.projects.setIcon({ projectId: 'unknown', icon: 'Cloud' })).rejects.toThrow('unrecognized projectId');
      expect(emit).not.toHaveBeenCalled();
      await handle.dispose();
      await expect(handle.api.sdk.projects.setIcon({ projectId: 'p1', icon: 'Cloud' })).rejects.toThrow();
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.projects.setIcon({ projectId: 'p1', icon: 'Cloud' })).rejects.toThrow('not available');
      await bare.dispose();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('wires sdk.inbox.push and sdk.projects.list when callbacks are provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-inbox-'));
    try {
      const pushInbox = vi.fn(async () => ({ id: 'inb-1' }));
      const listProjects = vi.fn(async () => [{ id: 'p1', name: 'Alpha', path: '/tmp/a' }]);
      const handle = createPluginApi('demo', dir, { pushInbox, listProjects });
      await expect(handle.api.sdk.inbox.push({ projectId: 'p1', comments: 'hello' })).resolves.toEqual({
        id: 'inb-1'
      });
      expect(pushInbox).toHaveBeenCalledWith({ pluginId: 'demo', projectId: 'p1', comments: 'hello' });
      await expect(handle.api.sdk.projects.list()).resolves.toEqual([
        { id: 'p1', name: 'Alpha', path: '/tmp/a' }
      ]);
      await expect(handle.api.sdk.inbox.push({ projectId: '  ', comments: 'x' })).rejects.toThrow(
        /projectId/
      );
      await expect(handle.api.sdk.inbox.push({ projectId: 'p1', comments: '  ' })).rejects.toThrow(
        /comments/
      );
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.inbox.push({ projectId: 'p', comments: 'hi' })).rejects.toThrow(
        /not available/
      );
      await expect(bare.api.sdk.projects.list()).rejects.toThrow(/not available/);
      await handle.dispose();
      await bare.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gates assistant and inbox reads on runtime availability and plugin lifetime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-read-gates-'));
    const bare = createPluginApi('bare', dir);
    const calls = () => [bare.api.sdk.inbox.search({projectIds:['p1']}), bare.api.sdk.inbox.read({projectIds:['p1'],entryId:'r'}), bare.api.sdk.assistant.complete({instructions:'classify',prompt:'hello'})];
    try {
      await Promise.all(calls().map(call => expect(call).rejects.toThrow('not available')));
      await bare.dispose();
      await Promise.all(calls().map(call => expect(call).rejects.toThrow(/stale/)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('cancels in-flight assistant processes when the plugin is disposed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-assistant-cancel-'));
    let signal: AbortSignal | undefined;
    const run = vi.spyOn(ClaudeCliProvider.prototype, 'run').mockImplementation(args => new Promise((_resolve,reject) => {signal=args.signal;signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
    const handle = createPluginApi('demo',dir,{productContext:{config:{getConfig:()=>({})}} as any});
    try {
      const pending = expect(handle.api.sdk.assistant.complete({instructions:'classify',prompt:'request'})).rejects.toThrow('aborted');
      await handle.dispose(); await pending; expect(signal?.aborted).toBe(true);
    } finally {run.mockRestore();rmSync(dir,{recursive:true,force:true});}
  });

  it('delegates inbox reads to main store and validates assistant input in the product runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-inbox-reader-'));
    const ctx = {toProjects:()=>[{id:'p1',name:'Alpha'}],inbox:{read:vi.fn(async()=>({entries:[{id:'r',ts:1,projectId:'p1',subject:'Review',comments:'Findings',report:true}],hasMore:false}))},inboxRead:{getReadState:async()=>({readIds:{}})}};
    const handle = createPluginApi('demo', dir, {productContext:ctx as any});
    try {
      expect(await handle.api.sdk.inbox.search({projectIds:['p1']})).toMatchObject({entries:[{id:'r',subject:'Review'}]});
      expect(await handle.api.sdk.inbox.read({projectIds:['p1'],entryId:'r'})).toMatchObject({content:'Findings'});
      await expect(handle.api.sdk.assistant.complete({instructions:'',prompt:'invalid'})).rejects.toThrow();
    } finally {await handle.dispose();rmSync(dir,{recursive:true,force:true});}
  });

  it('wires sdk.library list/read/write through productContext', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-library-'));
    const db = openDatabase(join(dir, 'data/zcc.sqlite'));
    upsertHost(db, { id: 'host-1', name: 'Primary', hostKeyHash: 'hash', isPrimary: true });
    const projectPath = join(dir, 'alpha');
    mkdirSync(join(projectPath, '.zcc/library/findings'), { recursive: true });
    writeFileSync(join(projectPath, '.zcc/library/findings/auth.md'), '# Auth\n');
    const runtime = createCommandRuntime({ dataDir: join(dir, 'daemon') });
    try {
      const productContext = {
        db,
        hub: { emit: vi.fn() },
        dataDir: join(dir, 'data'),
        toProjects: () => [{
          id: 'p1',
          name: 'Alpha',
          path: projectPath,
          createdAt: 1,
          lastActiveAt: 1
        }],
        hostHub: {
          resolveHostId: (hostId?: string) => hostId ?? 'host-1',
          callHostOnlineRpc: async (input: { command: unknown }) => dispatchHostCommand(runtime, HostRpcCommandSchema.parse(input.command))
        }
      };
      const handle = createPluginApi('docs', dir, { productContext: productContext as never });
      await expect(handle.api.sdk.library.list({ projectId: 'p1' })).resolves.toEqual([
        expect.objectContaining({ relPath: 'findings/auth.md', scope: 'project', projectId: 'p1' })
      ]);
      await expect(handle.api.sdk.library.read({
        scope: 'project',
        relPath: 'findings/auth.md',
        projectId: 'p1'
      })).resolves.toEqual({ ok: true, content: '# Auth\n', sha256: createHash('sha256').update('# Auth\n').digest('hex') });
      await expect(handle.api.sdk.library.write({
        scope: 'project',
        relPath: 'findings/auth.md',
        projectId: 'p1',
        content: '# Next\n',
        expectedSha256: createHash('sha256').update('# Auth\n').digest('hex')
      })).resolves.toMatchObject({ ok: true, sha256: createHash('sha256').update('# Next\n').digest('hex') });
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.library.list()).rejects.toThrow(/not available/);
      await expect(bare.api.sdk.files.readProject({ path: 'file.ts', source: { kind: 'workspace', projectId: 'p1', environmentId: null, threadId: null } })).rejects.toThrow(/not available/);
      await expect(bare.api.sdk.files.writeProject({ path: 'file.ts', source: { kind: 'workspace', projectId: 'p1', environmentId: null, threadId: null }, content: 'x', expectedSha256: null })).rejects.toThrow(/not available/);
      await handle.dispose();
      await bare.dispose();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wires sdk.threads.get, events.list, and send when callbacks are provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-threads-'));
    try {
      const getThread = vi.fn(async () => ({
        id: 'thr-1',
        projectId: 'p1',
        hostId: 'h1',
        environmentId: 'e1',
        providerId: 'codex',
        status: 'idle'
      }));
      const listThreadEvents = vi.fn(async () => [{ seq: 1, type: 'turn/started', payload: {} }]);
      const sendThread = vi.fn(async () => ({ id: 'thr-1' }));
      const archiveThread = vi.fn(async () => ({ id: 'thr-1' }));
      const forkThread = vi.fn(async () => ({ id: 'thr-2' }));
      const unarchiveThread = vi.fn(async () => ({ id: 'thr-1' }));
      const handle = createPluginApi('demo', dir, {
        getThread,
        listThreadEvents,
        sendThread,
        archiveThread,
        forkThread,
        unarchiveThread
      });
      await expect(handle.api.sdk.threads.get({ threadId: 'thr-1' })).resolves.toMatchObject({
        id: 'thr-1',
        providerId: 'codex'
      });
      await expect(handle.api.sdk.threads.events.list({ threadId: 'thr-1' })).resolves.toEqual([
        { seq: 1, type: 'turn/started', payload: {} }
      ]);
      await expect(handle.api.sdk.threads.send({ threadId: 'thr-1', prompt: 'continue' })).resolves.toEqual({
        id: 'thr-1'
      });
      expect(sendThread).toHaveBeenCalledWith({
        pluginId: 'demo',
        threadId: 'thr-1',
        prompt: 'continue'
      });
      await expect(handle.api.sdk.threads.archive({ threadId: 'thr-1' })).resolves.toEqual({ id: 'thr-1' });
      await expect(handle.api.sdk.threads.fork({ threadId: 'thr-1' })).resolves.toEqual({ id: 'thr-2' });
      await expect(handle.api.sdk.threads.unarchive({ threadId: 'thr-1' })).resolves.toEqual({ id: 'thr-1' });
      expect(archiveThread).toHaveBeenCalledWith({ pluginId: 'demo', threadId: 'thr-1' });
      expect(forkThread).toHaveBeenCalledWith({ pluginId: 'demo', threadId: 'thr-1' });
      expect(unarchiveThread).toHaveBeenCalledWith({ pluginId: 'demo', threadId: 'thr-1' });
      await expect(handle.api.sdk.threads.fork({
        sourceThreadId: 'thr-1',
        sourceSeqEnd: 4,
        visibility: 'hidden',
        agentContextSeed: [{ type: 'text', text: 'seed', mentions: [], visibility: 'agent-only' }]
      })).resolves.toEqual({ id: 'thr-2' });
      expect(forkThread).toHaveBeenCalledWith({
        pluginId: 'demo',
        threadId: 'thr-1',
        sourceSeqEnd: 4,
        visibility: 'hidden',
        agentContextSeed: [{ type: 'text', text: 'seed', mentions: [], visibility: 'agent-only' }]
      });
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.threads.get({ threadId: 'thr-1' })).rejects.toThrow(/not available/);
      await handle.dispose();
      await bare.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wires sdk.threads.list and queuedMessages when callbacks are provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-list-'));
    try {
      const listThreads = vi.fn(async () => [{
        id: 'thr-h',
        projectId: 'p1',
        hostId: 'h1',
        environmentId: 'e1',
        providerId: 'codex',
        status: 'idle',
        originKind: 'fork' as const,
        originPluginId: 'demo',
        visibility: 'hidden' as const,
        archivedAt: null,
        createdAt: 1,
        parentThreadId: 'thr-1'
      }]);
      const listQueuedMessages = vi.fn(async () => [{ id: 'qm-1' }]);
      const createQueuedMessage = vi.fn(async () => ({ id: 'qm-2' }));
      const handle = createPluginApi('demo', dir, {
        listThreads,
        listQueuedMessages,
        createQueuedMessage
      });
      await expect(handle.api.sdk.threads.list({
        includeHidden: true,
        originKind: 'fork',
        originPluginId: 'demo',
        archived: false,
        limit: 100,
        offset: 0
      })).resolves.toHaveLength(1);
      expect(listThreads).toHaveBeenCalledWith({
        pluginId: 'demo',
        includeHidden: true,
        originKind: 'fork',
        originPluginId: 'demo',
        archived: false,
        limit: 100,
        offset: 0
      });
      await expect(handle.api.sdk.threads.queuedMessages.list({ threadId: 'thr-1' })).resolves.toEqual([
        { id: 'qm-1' }
      ]);
      await expect(handle.api.sdk.threads.queuedMessages.create({
        threadId: 'thr-1',
        input: [{ type: 'text', text: 'hi', mentions: [] }],
        senderThreadId: 'thr-h'
      })).resolves.toEqual({ id: 'qm-2' });
      expect(createQueuedMessage).toHaveBeenCalledWith({
        pluginId: 'demo',
        threadId: 'thr-1',
        input: [{ type: 'text', text: 'hi', mentions: [] }],
        senderThreadId: 'thr-h'
      });
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers typed rpc, mention providers, configure, and named cron', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-api-deep-'));
    try {
      const handle = createPluginApi('deep', dir);
      handle.api.rpc.register({} as never, {
        ping: async () => 'pong'
      });
      handle.api.ui.registerMentionProvider({
        id: 'notes',
        label: 'Notes',
        search: (ctx) => [{ id: '1', label: typeof ctx === 'string' ? ctx : ctx.query || 'Note' }],
        resolve: (itemId) => ({ context: `note ${itemId}` })
      });
      expect(handle.mentionProviders).toHaveLength(1);
      expect(handle.mentionProviders[0]?.label).toBe('Notes');
      expect(handle.mentionProviders[0]?.triggers).toEqual(['@']);
      const search = handle.httpRoutes.find((route) => route.path === '/mentions/notes/search');
      expect(search).toBeDefined();
      await expect(
        search!.handler({
          method: 'POST',
          path: '/mentions/notes/search',
          query: {},
          body: { query: 'hi', trigger: '@', projectId: 'p1' }
        })
      ).resolves.toEqual({ json: { items: [{ id: '1', label: 'hi' }] } });
      expect(await handle.mentionProviders[0]!.resolve('1')).toEqual({ context: 'note 1' });
      expect(() =>
        handle.api.ui.registerMentionProvider({ id: 'bad', search: () => [] } as never)
      ).toThrow(/id, label, search, and resolve/);
      handle.api.agents.configure(() => ({ instructions: 'Be brief.' }));
      expect(handle.agentConfigurers).toHaveLength(1);
      expect(await handle.agentConfigurers[0]?.({})).toEqual({ instructions: 'Be brief.' });
      handle.api.background.schedule('tick', '* * * * *', () => undefined);
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers project tab availability with replace-by-tabId semantics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-api-tabavail-'));
    try {
      const handle = createPluginApi('demo', dir);
      handle.api.ui.registerProjectTabAvailability({
        tabId: 'soql',
        evaluate: () => ({ available: true })
      });
      expect(handle.projectTabAvailability).toHaveLength(1);
      expect(handle.projectTabAvailability[0]).toMatchObject({ tabId: 'soql', pluginId: 'demo' });

      handle.api.ui.registerProjectTabAvailability({
        tabId: 'soql',
        evaluate: () => ({ available: false, reason: 'no org connected' })
      });
      expect(handle.projectTabAvailability).toHaveLength(1);
      expect(await handle.projectTabAvailability[0]!.evaluate({ projectId: 'p1' })).toEqual({
        available: false,
        reason: 'no org connected'
      });

      expect(() =>
        handle.api.ui.registerProjectTabAvailability({ tabId: '' } as never)
      ).toThrow(/tabId and evaluate/);
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('named schedules persist last-fired minute and host entries register methods', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-cron-'));
    const hostDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-host-'));
    try {
      const job = vi.fn();
      const handle = createPluginApi('cron', dir);
      handle.api.background.schedule('tick', '* * * * *', job);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(job).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(job).toHaveBeenCalledTimes(1);
      await handle.dispose();

      const hostPath = join(hostDir, 'host.mjs');
      writeFileSync(
        hostPath,
        'export default function setup(api) { api.methods.register("ping", () => ({ ok: true })); }\n'
      );
      const hosted = createPluginApi('hosted', dir, { hostEntryPath: hostPath });
      await expect(hosted.api.host.experimental_call('ping')).resolves.toEqual({ ok: true });
      await expect(hosted.api.host.experimental_client().call('ping')).resolves.toEqual({ ok: true });
      await hosted.dispose();
    } finally {
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('opens a per-plugin sqlite database via storage.database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-db-'));
    try {
      const handle = createPluginApi('dbdemo', dir);
      const database = handle.api.storage.database();
      database.runScript('CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT);');
      database.prepare('INSERT INTO items (id, title) VALUES (?, ?)').run('1', 'Loop');
      expect(database.prepare('SELECT title FROM items WHERE id = ?').get('1')).toEqual({ title: 'Loop' });
      expect(handle.api.storage.database()).toBe(database);
      database.migrate([
        `CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);
         CREATE TRIGGER notes_insert AFTER INSERT ON notes BEGIN
           UPDATE notes SET body = body || '!';
         END;`
      ]);
      database.prepare('INSERT INTO notes (id, body) VALUES (?, ?)').run('1', 'hi');
      expect(database.prepare('SELECT body FROM notes WHERE id = ?').get('1')).toEqual({ body: 'hi!' });
      const counted = database.transaction(() => {
        database.prepare('INSERT INTO items (id, title) VALUES (?, ?)').run('2', 'Two');
        return database.prepare('SELECT COUNT(*) AS count FROM items').get() as { count: number };
      });
      expect(counted.count).toBe(2);
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies sqlite migrations once so ALTER ADD COLUMN survives reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-migrate-'));
    try {
      const handle = createPluginApi('migratedemo', dir);
      const statements = [
        'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);',
        'ALTER TABLE items ADD COLUMN title TEXT NOT NULL DEFAULT "";'
      ];
      handle.api.storage.database().migrate(statements);
      handle.api.storage.database().migrate(statements);
      handle.api.storage.database().prepare('INSERT INTO items (id, title) VALUES (?, ?)').run('1', 'Loop');
      expect(handle.api.storage.database().prepare('SELECT title FROM items WHERE id = ?').get('1')).toEqual({
        title: 'Loop'
      });
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adopts sqlite schemas that already applied ALTER ADD COLUMN without a migration book', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-migrate-adopt-'));
    try {
      const handle = createPluginApi('migrateadopt', dir);
      const database = handle.api.storage.database();
      database.runScript('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);');
      database.runScript('ALTER TABLE items ADD COLUMN title TEXT NOT NULL DEFAULT "";');
      const statements = [
        'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);',
        'ALTER TABLE items ADD COLUMN title TEXT NOT NULL DEFAULT "";'
      ];
      database.migrate(statements);
      database.migrate(statements);
      database.prepare('INSERT INTO items (id, title) VALUES (?, ?)').run('1', 'Adopted');
      expect(database.prepare('SELECT title FROM items WHERE id = ?').get('1')).toEqual({ title: 'Adopted' });
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects changed migrations and rolls back invalid new statements', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-migrate-failure-'));
    const handle = createPluginApi('migration-failure', dir);
    try {
      const db = handle.api.storage.database();
      const first = 'CREATE TABLE items (id TEXT PRIMARY KEY);';
      db.migrate([first]);
      expect(() => db.migrate(['CREATE TABLE items (id INTEGER PRIMARY KEY);'])).toThrow('does not match');
      expect(() => db.migrate([first, 'CREATE TABLE extra (id TEXT);', 'invalid sql'])).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extra'").all()).toEqual([]);
      expect(db.prepare('SELECT id FROM _zcc_migrations').all()).toEqual([{ id: 0 }]);
      db.migrate([first, 'CREATE TABLE extra (id TEXT);']);
      expect(db.prepare('SELECT id FROM _zcc_migrations ORDER BY id').all()).toEqual([{ id: 0 }, { id: 1 }]);
    } finally {
      await handle.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveCreateJiti', () => {
  const create = ((id: string) => ({ import: async () => ({ id }) })) as ReturnType<typeof resolveCreateJiti>;

  it('accepts the named ESM export, CJS default, and default.createJiti shapes', () => {
    expect(resolveCreateJiti({ createJiti: create })).toBe(create);
    expect(resolveCreateJiti({ default: create })).toBe(create);
    expect(resolveCreateJiti({ default: { createJiti: create } })).toBe(create);
    const cjs = Object.assign(create, { createJiti: create });
    expect(resolveCreateJiti(cjs)).toBe(create);
  });

  it('rejects a module with no callable createJiti', () => {
    expect(() => resolveCreateJiti({})).toThrow(/unavailable/);
    expect(() => resolveCreateJiti(null)).toThrow(/unavailable/);
  });

  it('does not destructure createJiti from import("jiti")', () => {
    const source = readFileSync(new URL('./plugin-api.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/const \{ createJiti \} = await import\(['"]jiti['"]\)/);
    expect(source).toContain('resolveCreateJiti');
    expect(source).toContain('jitiRequireIds');
    expect(source).toContain("join(cwd, 'apps', 'server', 'package.json')");
  });

  it('fails when neither import nor require lookup yields createJiti', async () => {
    await expect(loadCreateJiti(async () => ({}), [], null)).rejects.toThrow(/unavailable/);
  });

  it('uses the bundled jiti module when dynamic import and require both miss', async () => {
    const createJiti = await loadCreateJiti(async () => ({}), []);
    expect(typeof createJiti).toBe('function');
  });

  it('finds jiti when createRequire(import.meta.url) is an Electron out/main bundle', async () => {
    const tmp = tmpdir();
    const bundleUrl = pathToFileURL(join(tmp, 'out', 'main', 'server-runtime.js')).href;
    expect(jitiRequireIds('/repo', bundleUrl)).toEqual([
      bundleUrl,
      pathToFileURL('/repo/package.json').href,
      pathToFileURL(join('/repo', 'apps', 'server', 'package.json')).href,
      pathToFileURL(join(tmp, 'package.json')).href
    ]);
    const createJiti = await loadCreateJiti(
      async () => {
        throw new Error('esm import missing in utility process');
      },
      jitiRequireIds(process.cwd(), bundleUrl),
      null
    );
    expect(typeof createJiti).toBe('function');
  });
});

describe('pty harness registration', () => {
  it('accepts a CLI Agent family declaration', () => {
    const handle = createPluginApi('harness-claude', '/tmp');
    const registered = handle.api.agents.experimental_registerPtyHarness({
      id: 'claude',
      displayName: 'Claude Code',
      profiles: [{ id: 'claude', label: 'Claude' }],
      alwaysEnabled: true
    });
    expect(registered.id).toBe('claude');
    expect(() => registered.unregister()).not.toThrow();
  });

  it('rejects a declaration without id or displayName', () => {
    const handle = createPluginApi('harness-claude', '/tmp');
    expect(() =>
      handle.api.agents.experimental_registerPtyHarness({
        id: '',
        displayName: 'Claude Code',
        profiles: []
      })
    ).toThrow(/id and displayName/);
  });
});

describe('importServerFactory', () => {
  it('loads a TypeScript factory when jiti only exposes a default export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-ts-factory-'));
    const entry = join(dir, 'server.ts');
    writeFileSync(
      entry,
      'export default function plugin() { return; }\n'
    );
    try {
      const factory = await importServerFactory(entry);
      expect(typeof factory).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plugin services', () => {
  it('provides an SDK to another plugin through a shared registry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-services-'));
    try {
      const { createPluginServicesRegistry } = await import('@zana-ai/zcc-plugin-sdk/server');
      const registry = createPluginServicesRegistry();
      const alpha = createPluginApi('alpha', join(dir, 'alpha'), { services: registry });
      const beta = createPluginApi('beta', join(dir, 'beta'), { services: registry });
      alpha.api.services.provide({ ping: () => 'ok' });
      expect(beta.api.services.has('alpha')).toBe(true);
      expect(beta.api.services.has('missing')).toBe(false);
      expect(beta.api.services.use<{ ping: () => string }>('alpha').ping()).toBe('ok');
      await alpha.dispose();
      expect(() => beta.api.services.use<{ ping: () => string }>('alpha').ping()).toThrow(
        /unavailable/
      );
      await beta.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agents.registerTool', () => {
  it('converts zod parameters, rejects reserved names, and refuses duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-tools-'));
    try {
      const handle = createPluginApi('demo', dir);
      handle.api.agents.registerTool({
        name: 'echo_tool',
        description: 'Echo',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
        execute: async (input) => input
      });
      expect(handle.agentTools[0]?.inputSchema).toMatchObject({ type: 'object' });
      expect(handle.agentTools[0]?.parse({ q: 'hi' })).toEqual({ ok: true, value: { q: 'hi' } });
      expect(() => handle.api.agents.registerTool({
        name: 'echo_tool',
        description: 'Echo again',
        parameters: { type: 'object' },
        execute: async () => undefined
      })).toThrow(/already registered/);
      expect(() => handle.api.agents.registerTool({
        name: 'inbox_push',
        description: 'shadow',
        parameters: { type: 'object' },
        execute: async () => undefined
      })).toThrow(/built-in ZCC tool/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts inputSchema as a deprecated alias and skips a cross-plugin collision', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-tools-alias-'));
    try {
      const seen: string[] = [];
      const handle = createPluginApi('demo', dir, {
        isAgentToolNameTaken: (name) => (name === 'shared_tool' ? 'other' : undefined),
        onNeedsConfiguration: (message) => seen.push(message)
      });
      handle.api.agents.registerTool({
        name: 'legacy_echo',
        description: 'Echo',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        execute: async (input) => input
      });
      expect(handle.agentTools[0]?.name).toBe('legacy_echo');
      handle.api.agents.registerTool({
        name: 'shared_tool',
        description: 'Taken',
        parameters: { type: 'object' },
        execute: async () => undefined
      });
      expect(handle.agentTools.map((tool) => tool.name)).toEqual(['legacy_echo']);
      expect(seen[0]).toMatch(/already registered by plugin "other"/);
      expect(() => handle.api.agents.registerTool({
        name: 'no_schema',
        description: 'Missing schema',
        execute: async () => undefined
      })).toThrow(/parameters must be a zod schema or a JSON-schema object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sdk.capabilities', () => {
  it('reports native-tool descriptors as available only for a Claude-family thread, and reports project-rpc/interactions/message-admission/lifecycle-delivery as available when wired', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-capabilities-'));
    const db = openDatabase(join(dir, 'data/zcc.sqlite'));
    upsertHost(db, { id: 'h1', name: 'Primary', hostKeyHash: 'hash', isPrimary: true });
    const claudeThread = createConversationThread(db, {
      projectId: 'p1',
      hostId: 'h1',
      providerId: 'claude-code'
    });
    const cursorThread = createConversationThread(db, {
      projectId: 'p1',
      hostId: 'h1',
      providerId: 'acp-cursor'
    });
    try {
      const handle = createPluginApi('demo', dir, {
        productContext: { db, hub: { emit: vi.fn() } } as never,
        hostCall: vi.fn(),
        upsertInteraction: vi.fn()
      });
      const claudeResult = await handle.api.sdk.capabilities.forThread({ threadId: claudeThread.id });
      expect(claudeResult.capabilities).toEqual(
        expect.arrayContaining([
          { id: 'message-admission', available: true },
          { id: 'lifecycle-delivery', available: true },
          { id: 'tool-before-native', available: true },
          { id: 'tool-after-native', available: true },
          { id: 'project-rpc', available: true },
          { id: 'interactions', available: true }
        ])
      );

      const cursorResult = await handle.api.sdk.capabilities.forThread({ threadId: cursorThread.id });
      const cursorNativeTool = cursorResult.capabilities.find((c) => c.id === 'tool-before-native');
      expect(cursorNativeTool).toMatchObject({ available: false });
      expect(cursorNativeTool?.reason).toMatch(/acp-cursor/);

      const executionResult = await handle.api.sdk.capabilities.forExecution({ executionId: 'exec-1' });
      expect(executionResult.capabilities.find((c) => c.id === 'tool-before-native')).toMatchObject({ available: false });
      expect(executionResult.capabilities.find((c) => c.id === 'tool-after-native')).toMatchObject({ available: false });

      await expect(handle.api.sdk.capabilities.forThread({ threadId: '' })).rejects.toThrow(/threadId is required/);
      await expect(handle.api.sdk.capabilities.forExecution({ executionId: '' })).rejects.toThrow(/executionId is required/);
      await handle.dispose();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports project-rpc/interactions as unavailable when no host wiring is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-sdk-capabilities-bare-'));
    try {
      const bare = createPluginApi('bare', dir);
      const result = await bare.api.sdk.capabilities.forExecution({ executionId: 'exec-1' });
      expect(result.capabilities).toEqual(
        expect.arrayContaining([
          { id: 'message-admission', available: false },
          { id: 'lifecycle-delivery', available: false },
          { id: 'project-rpc', available: false },
          { id: 'interactions', available: false }
        ])
      );
      await bare.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('machine plugin host API', () => {
  it('routes schema-validated calls and lifetime notifications without local fallback', async () => {
    const { z } = await import('zod');
    const dir = mkdtempSync(join(tmpdir(), 'plugin-machine-api-'));
    const hostCall = vi.fn().mockResolvedValue('ok');
    const handle = createPluginApi('fixture', dir, { hostCall });
    try {
      const client = handle.api.host.experimental_client({ contract: { ping: { input: z.string(), output: z.string() } } });
      const signal = new AbortController().signal;
      expect(await client.call('ping', 'input', { hostId: 'b', signal, timeoutMs: 50 })).toBe('ok');
      expect(hostCall).toHaveBeenCalledExactlyOnceWith('ping', 'input', 'b', signal, 50);
      await expect(client.call('missing', null)).rejects.toThrow('Unknown');
      await expect(client.call('ping', 3)).rejects.toThrow('validation');
      hostCall.mockResolvedValue(4); await expect(client.call('ping', 'x')).rejects.toThrow('validation');
      const exit = vi.fn(), changed = vi.fn();
      const offExit = client.experimental_onWorkerExit(exit), offSignal = client.experimental_onSignal('changed', changed);
      const identity = { pluginId: 'fixture', generation: 'g1', hostId: 'b' };
      await handle.emitHostEvent({ ...identity, kind: 'plugin.host.worker-exited' });
      await handle.emitHostEvent({ ...identity, kind: 'plugin.host.signal', signal: 'changed', payload: 7 });
      expect(exit).toHaveBeenCalledExactlyOnceWith({ hostId: 'b' });
      expect(changed).toHaveBeenCalledExactlyOnceWith({ hostId: 'b', payload: 7 });
      offExit(); offSignal();
      await handle.emitHostEvent({ ...identity, kind: 'plugin.host.worker-exited' }); expect(exit).toHaveBeenCalledOnce();
      await handle.dispose(); await handle.emitHostEvent({ ...identity, kind: 'plugin.host.signal' });
      expect(() => client.experimental_onWorkerExit(exit)).toThrow('stale');
      const legacy = createPluginApi('compat', dir);
      await expect(legacy.api.host.experimental_client().call('ping', null, { hostId: 'b' })).rejects.toThrow('Selected');
      await legacy.dispose();
    } finally { await handle.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('responsiveness lifecycle contracts', () => {
  it('retains a live service cleanup and accepts services without cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-live-service-'));
    const handle = createPluginApi('fixture', dir), stop = vi.fn();
    try {
      handle.api.background.service('live', () => stop);
      handle.api.background.service('empty', () => undefined);
      await Promise.resolve();
      expect(stop).not.toHaveBeenCalled();
      await handle.dispose();
      expect(stop).toHaveBeenCalledOnce();
    } finally { await handle.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists and deletes persisted keys and delivers settings changes despite a rejected listener', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-storage-lifecycle-'));
    const handle = createPluginApi('fixture', dir);
    try {
      await handle.api.storage.kv.set('a', 1); await handle.api.storage.kv.set('b', 2);
      expect(await handle.api.storage.kv.list()).toEqual(['a', 'b']);
      await handle.api.storage.kv.delete('a'); expect(await handle.api.storage.kv.list('b')).toEqual(['b']);
      const settings = handle.api.settings.define({ flag: { type: 'boolean', label: 'Flag', default: false } });
      const changed = vi.fn();
      settings.onChange(() => { throw Error('broken listener'); }); settings.onChange(changed);
      await handle.setSettings({ flag: true }); expect(changed).toHaveBeenCalledWith({ flag: true });
    } finally { await handle.dispose(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('stops a background service that settles after disposal and contains startup failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-late-service-'));
    const handle = createPluginApi('fixture', dir), late = Promise.withResolvers<() => void>(), stop = vi.fn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      handle.api.background.service('late', () => late.promise);
      handle.api.background.service('failed', async () => { throw Error('startup failed'); });
      await Promise.resolve(); await Promise.resolve();
      await handle.dispose(); late.resolve(stop); await Promise.resolve();
      expect(stop).toHaveBeenCalledOnce(); expect(log).toHaveBeenCalled();
    } finally { await handle.dispose(); log.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('serializes scheduled jobs and suppresses duplicate named runs within a minute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-serial-schedule-'));
    const handle = createPluginApi('fixture', dir), pending = Promise.withResolvers<void>();
    const callbacks: Array<() => void> = [];
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void) => { callbacks.push(fn); return 1 as never; }) as never);
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    const job = vi.fn(() => pending.promise), named = vi.fn(async () => {});
    try {
      handle.api.background.schedule('* * * * *', job);
      handle.api.background.schedule('named', '* * * * *', named);
      callbacks[0](); callbacks[0](); expect(job).toHaveBeenCalledOnce();
      pending.resolve(); await Promise.resolve(); await Promise.resolve();
      callbacks[1](); await vi.waitFor(() => expect(named).toHaveBeenCalledOnce());
      await vi.waitFor(() => { callbacks[1](); expect(named).toHaveBeenCalledOnce(); });
      await handle.dispose(); callbacks[0](); expect(job).toHaveBeenCalledOnce();
    } finally { await handle.dispose(); interval.mockRestore(); clear.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('bounds synchronous factory loops and asynchronous factory startup', async () => {
    const { runFactoryTimeBoxed } = await import('./plugin-api.js');
    await runFactoryTimeBoxed(() => undefined, {} as never, 50);
    await expect(runFactoryTimeBoxed(() => { while (true) {} }, {} as never, 10)).rejects.toThrow(/timed out/);
    await expect(runFactoryTimeBoxed(() => new Promise(() => {}), {} as never, 10)).rejects.toThrow(/timed out/);
  });
});
