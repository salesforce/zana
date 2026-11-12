import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, getConversationThread, upsertHost, type ConversationThreadRow } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

const calls = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn() }));
vi.mock('../services/threads/conversation-create.js', async importActual => ({
  ...await importActual<typeof import('../services/threads/conversation-create.js')>(),
  createConversationFromRequest: calls.create
}));
vi.mock('../services/threads/conversation-lifecycle.js', async importActual => ({
  ...await importActual<typeof import('../services/threads/conversation-lifecycle.js')>(),
  sendConversationTurn: calls.send
}));

let server: ProductServer;
let dataDir: string;
let thread: ConversationThreadRow;
let plugins: {
  status: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  resolveMention: ReturnType<typeof vi.fn>;
};

const userInput = [{ type: 'text', text: 'Explain this page', mentions: [] }];
const pageContext = {
  pluginId: 'notes', panel: 'main', projectId: 'project', view: 'folder with spaces/a.md',
  page: { title: 'Document A', resourceId: 'a', path: 'a.md', mention: { providerId: 'note.page', itemId: 'a' } }
};

function post(path: string, body: unknown) {
  return fetch(`${server.url}api/v1/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
}

function createBody(extra: Record<string, unknown> = {}) {
  return { projectId: 'project', providerId: 'test', input: userInput,
    pluginPanel: { pluginId: 'notes', panel: 'main' }, pageContext, ...extra };
}

beforeEach(async () => {
  calls.create.mockReset();
  calls.send.mockReset();
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-page-context-http-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [
    { id: 'project', name: 'Project', path: dataDir, createdAt: 1, lastActiveAt: 1 }
  ] }));
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  const host = upsertHost(server.ctx.db, { name: 'Page context host', hostKeyHash: 'p'.repeat(64) });
  const environment = createEnvironment(server.ctx.db, { projectId: 'project', hostId: host.id, path: dataDir });
  thread = createConversationThread(server.ctx.db, {
    projectId: 'project', hostId: host.id, environmentId: environment.id,
    providerId: 'test', originPluginId: 'notes', status: 'idle', visibility: 'hidden'
  });
  calls.create.mockResolvedValue(thread);
  calls.send.mockResolvedValue(thread);
  plugins = {
    status: vi.fn(() => 'running'), get: vi.fn(() => ({ name: 'Notes' })),
    resolveMention: vi.fn(async ({ itemId }: { itemId: string }) => ({ ok: true, context: `Canonical snapshot ${itemId}` }))
  };
  server.ctx.plugins = plugins as never;
});

afterEach(async () => {
  await server?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe('page context through product HTTP', () => {
  it('includes only a retrieval reference while preserving the initial user message and origin', async () => {
    const response = await post('threads', createBody());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, thread: { id: thread.id } });
    expect(calls.create).toHaveBeenCalledOnce();
    const input = calls.create.mock.calls[0]![1];
    expect(input).toMatchObject({
      input: ['Explain this page'], originPluginId: 'notes', visibility: 'hidden',
      pluginMetadata: { panelAgent: { panel: 'main' } }
    });
    expect(input.promptInput).toHaveLength(2);
    expect(input.promptInput[0]).toEqual(userInput[0]);
    expect(input.promptInput[1]).toMatchObject({ type: 'text', mentions: [], visibility: 'agent-only' });
    expect(input.promptInput[1].text).toContain('"resourceId":"a"');
    expect(input.promptInput[1].text).toContain('"path":"a.md"');
    expect(input.promptInput[1].text).toContain('"read":{"tool":"page_context_read","arguments":{"pluginId":"notes","providerId":"note.page","itemId":"a"}}');
    expect(input.promptInput[1].text).not.toContain('Canonical snapshot');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
    expect(userInput).toEqual([{ type: 'text', text: 'Explain this page', mentions: [] }]);
    expect(calls.send).not.toHaveBeenCalled();
  });

  it('captures follow-up context before dispatch and refreshes it for another page and Settings', async () => {
    plugins.resolveMention.mockImplementation(() => new Promise(() => {}));
    expect((await post(`threads/${thread.id}/send`, { input: userInput, pageContext, mode: 'queue-if-active' })).status).toBe(200);
    const capturedA = structuredClone(calls.send.mock.calls[0]![2]);
    expect(calls.send.mock.calls[0]![3]).toBe('queue-if-active');
    expect(capturedA[0]).toEqual(userInput[0]);
    expect(capturedA[1].text).toContain('"itemId":"a"');

    const pageB = { ...pageContext, page: { title: 'Document B', resourceId: 'b', mention: { providerId: 'note.page', itemId: 'b' } } };
    expect((await post(`threads/${thread.id}/reply`, { input: userInput, pageContext: pageB, mode: 'steer' })).status).toBe(200);
    expect(calls.send.mock.calls[1]![2][1].text).toContain('"itemId":"b"');
    expect(calls.send.mock.calls[1]![3]).toBe('steer');
    const settings = { pluginId: 'notes', panel: 'main', projectId: 'project', page: { title: 'Settings' } };
    expect((await post(`threads/${thread.id}/send`, { input: userInput, pageContext: settings })).status).toBe(200);
    const settingsInput = calls.send.mock.calls[2]![2];
    expect(settingsInput[1].text).toContain('Settings');
    expect(settingsInput[1].text).not.toContain('"resourceId"');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
    expect(capturedA[1].text).toContain('"resourceId":"a"');
    expect(capturedA[1].text).not.toContain('Document B');
    expect(calls.create).not.toHaveBeenCalled();
  });

  it('leaves ordinary create and send requests unchanged', async () => {
    expect((await post('threads', { projectId: 'project', providerId: 'test', input: userInput })).status).toBe(201);
    expect(calls.create.mock.calls[0]![1].promptInput).toEqual(userInput);
    expect((await post(`threads/${thread.id}/send`, { input: userInput })).status).toBe(200);
    expect(calls.send.mock.calls[0]![2]).toEqual(userInput);
    expect(plugins.status).not.toHaveBeenCalled();
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it('grounds a reopened conversation in its current page without changing its creation origin', async () => {
    const existing = createConversationThread(server.ctx.db, {
      projectId: thread.projectId, hostId: thread.hostId, environmentId: thread.environmentId,
      providerId: 'test', originPluginId: 'other-plugin', status: 'idle', visibility: 'hidden'
    });
    calls.send.mockResolvedValueOnce(existing);
    const response = await post(`threads/${existing.id}/send`, { input: userInput, pageContext });
    expect(response.status).toBe(200);
    expect(calls.send).toHaveBeenCalledOnce();
    expect(calls.send.mock.calls[0]![1]).toBe(existing.id);
    expect(calls.send.mock.calls[0]![2][1].text).toContain('"pluginId":"notes"');
    expect(calls.send.mock.calls[0]![2][1].text).toContain('"itemId":"a"');
    expect(plugins.resolveMention).not.toHaveBeenCalled();
    expect(getConversationThread(server.ctx.db, existing.id)?.originPluginId).toBe('other-plugin');
    expect(calls.create).not.toHaveBeenCalled();
  });

  it.each(['create', 'send'] as const)('rejects invalid context, empty input and forged ownership before %s dispatch', async route => {
    const attempts = [
      { extra: { pageContext: {} }, status: 400, code: 'invalid-page-context' },
      { extra: { pageContext: { ...pageContext, page: { title: 'x'.repeat(161) } } }, status: 400, code: 'invalid-page-context' },
      { extra: { input: undefined }, status: 400, code: 'invalid-input' },
      { extra: { input: { invalid: 'prompt' } }, status: 400, code: 'invalid-input' },
      { extra: { pageContext: { ...pageContext, projectId: 'other-project' } }, status: 403, code: 'page-context-mismatch' },
      ...(route === 'create' ? [{ extra: { pageContext: { ...pageContext, pluginId: 'other-plugin' } }, status: 403, code: 'page-context-mismatch' }] : [])
    ];
    for (const attempt of attempts) {
      const response = route === 'create'
        ? await post('threads', createBody(attempt.extra))
        : await post(`threads/${thread.id}/send`, { input: userInput, pageContext, ...attempt.extra });
      expect(response.status).toBe(attempt.status);
      expect(await response.json()).toMatchObject({ code: attempt.code });
    }
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it.each(['create', 'send'] as const)('rejects unavailable plugins before %s dispatch without fetching content', async route => {
    const submit = () => route === 'create'
      ? post('threads', createBody())
      : post(`threads/${thread.id}/send`, { input: userInput, pageContext });
    plugins.status.mockReturnValueOnce('stopped');
    let response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'plugin-unavailable' });
    expect(plugins.resolveMention).not.toHaveBeenCalled();
    server.ctx.plugins = undefined;
    response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'plugin-unavailable' });
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });

  it.each(['create', 'send'] as const)('keeps %s fast and small even when resource content is missing or large', async route => {
    for (const content of [{ ok: false, error: 'Resource deleted' }, { ok: true, context: 'x'.repeat(60_001) }]) {
      plugins.resolveMention.mockResolvedValue(content);
      const response = route === 'create' ? await post('threads', createBody())
        : await post(`threads/${thread.id}/send`, { input: userInput, pageContext });
      expect(response.status).toBe(route === 'create' ? 201 : 200);
    }
    expect(plugins.resolveMention).not.toHaveBeenCalled();
  });

  it('rejects a missing conversation before resolving resource context', async () => {
    const response = await post('threads/missing/send', { input: userInput, pageContext });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'thread-not-found' });
    expect(plugins.resolveMention).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });
});
