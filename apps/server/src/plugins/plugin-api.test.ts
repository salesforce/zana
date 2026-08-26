import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPluginApi, validatePluginRequestInput } from './plugin-api.js';

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

  it('opens a per-plugin sqlite database via storage.database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-db-'));
    try {
      const handle = createPluginApi('dbdemo', dir);
      const database = handle.api.storage.database();
      database.runScript('CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT);');
      database.prepare('INSERT INTO items (id, title) VALUES (?, ?)').run('1', 'Loop');
      expect(database.prepare('SELECT title FROM items WHERE id = ?').get('1')).toEqual({ title: 'Loop' });
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
