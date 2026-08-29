import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPluginApi, importServerFactory, resolveCreateJiti, validatePluginRequestInput } from './plugin-api.js';

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
      handle.api.http.route('GET', '/ping', () => ({ json: { ok: true } }));
      expect(handle.httpRoutes[0]?.path).toBe('/ping');
      handle.api.agents.registerTool({
        name: 'echo',
        description: 'Echo',
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
      const bare = createPluginApi('bare', dir);
      await expect(bare.api.sdk.threads.get({ threadId: 'thr-1' })).rejects.toThrow(/not available/);
      await handle.dispose();
      await bare.dispose();
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
      expect(job).toHaveBeenCalledTimes(1);
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
      await handle.dispose();
    } finally {
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
