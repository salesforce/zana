import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { createMemoryInboxStore } from '../inbox/inbox-store.js';
import { createMemorySuggestionsStore } from '../suggestions/suggestions-store.js';
import { HOOK_BODY_CAP } from './read-hook-body.js';

describe('notify hook HTTP payloads', () => {
  let server: McpServerHandle;
  afterEach(async () => { await server?.close(); });
  async function boot(callback = vi.fn()) {
    server = await startMcpServer({ inboxStore: createMemoryInboxStore(), suggestionsStore: createMemorySuggestionsStore(), projects: { get: () => null }, onNotifyHook: callback, log: () => {} });
    return { callback, url: `${server.url}/hook/notify/project/session/blocked` };
  }

  it('forwards correlated native payloads with URL identity and preserves empty legacy hooks', async () => {
    const { url, callback } = await boot();
    const body = JSON.stringify({ hook_event_name: 'PermissionRequest', tool_input: { command: 'echo x' } });
    expect((await fetch(url, { method: 'POST', body })).status).toBe(200);
    expect(callback).toHaveBeenLastCalledWith('project', 'session', 'blocked', body);
    await fetch(url, { method: 'POST' });
    expect(callback).toHaveBeenLastCalledWith('project', 'session', 'blocked');
  });

  it('ignores oversized payloads and rejects other methods', async () => {
    const { url, callback } = await boot();
    expect((await fetch(url, { method: 'POST', body: 'x'.repeat(HOOK_BODY_CAP + 1) })).status).toBe(200);
    expect((await fetch(url)).status).toBe(405);
    expect(callback).not.toHaveBeenCalled();
  });

  it('keeps callbacks advisory if a handler throws', async () => {
    const { url } = await boot(vi.fn(() => { throw new Error('bad hook'); }));
    expect(await (await fetch(url, { method: 'POST', body: '{}' })).text()).toBe('ok');
  });
});
