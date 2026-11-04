import { describe, expect, it, vi } from 'vitest';
import { createLoopbackPluginCommands } from './plugin-commands-loopback.js';

describe('dev plugin command transport', () => {
  it('uses the product server for discovery and preserves CLI argv and scope', async () => {
    const contribution = { cliCommands: [{ pluginId: 'fixture', name: 'fixture' }] };
    const output = { exitCode: 0, stdout: 'SDK works', stderr: '' };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(contribution))
      .mockResolvedValueOnce(Response.json(output));
    const transport = createLoopbackPluginCommands('http://127.0.0.1:8781', fetchImpl);
    await expect(transport.cliContributions()).resolves.toEqual(contribution);
    await expect(transport.runCliCommand('fixture/path', ['run', '--json'], { threadId: 'thread', projectId: 'project', cwd: '/project' })).resolves.toEqual(output);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:8781/api/v1/plugins/contributions');
    expect(String(fetchImpl.mock.calls[1]![0])).toBe('http://127.0.0.1:8781/api/v1/plugins/fixture%2Fpath/cli');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ argv: ['run', '--json'], threadId: 'thread', projectId: 'project', cwd: '/project' }) });
  });

  it.each(['https://example.com', 'file:///tmp/server', 'invalid'])('rejects non-loopback servers: %s', url => {
    expect(() => createLoopbackPluginCommands(url)).toThrow('loopback product server');
  });

  it.each(['enable', 'disable', 'reload', 'update'] as const)('uses authoritative %s and returns its updated installed row', async action => {
    const row = { id: 'fixture/path', enabled: action !== 'disable', status: action === 'disable' ? 'disabled' : 'running' };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, value: true }))
      .mockResolvedValueOnce(Response.json({ plugins: [{ id: 'other' }, row] }));
    const transport = createLoopbackPluginCommands('http://127.0.0.1:8781', fetchImpl);
    await expect(transport[action]!(row.id)).resolves.toEqual(row);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`http://127.0.0.1:8781/api/v1/plugin-apps/fixture%2Fpath/${action}`);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: '{}', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(String(fetchImpl.mock.calls[1]![0])).toBe('http://127.0.0.1:8781/api/v1/plugins');
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it('routes removal and bulk updates without nesting the bulk result', async () => {
    const value = { updated: [], failed: [{ id: 'fixture', message: 'offline' }] };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, value: true }))
      .mockResolvedValueOnce(Response.json({ ok: true, value }));
    const transport = createLoopbackPluginCommands('http://localhost:8781/', fetchImpl);
    await transport.remove!('fixture');
    await expect(transport.updateAll!()).resolves.toEqual(value);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://localhost:8781/api/v1/plugin-apps/fixture/remove');
    expect(String(fetchImpl.mock.calls[1]![0])).toBe('http://localhost:8781/api/v1/plugin-apps/update-all');
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === 'POST' && init.body === '{}')).toBe(true);
  });

  it.each([{}, { plugins: [] }])('reports a missing updated row without repeating the mutation', async snapshot => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, value: true }))
      .mockResolvedValueOnce(Response.json(snapshot));
    const transport = createLoopbackPluginCommands('http://localhost:8781/', fetchImpl);
    await expect(transport.disable!('fixture')).rejects.toThrow('did not return updated plugin');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('propagates lifecycle failure before any snapshot read', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'policy generation unavailable' }, { status: 503 }));
    const transport = createLoopbackPluginCommands('http://localhost:8781/', fetchImpl);
    await expect(transport.disable!('fixture')).rejects.toThrow('policy generation unavailable');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    [{ message: 'plugin stopped' }, 'plugin stopped'],
    [{ error: 'plugin missing' }, 'plugin missing'],
    [{}, 'Plugin host returned 503']
  ])('preserves actionable product-server errors', async (body, message) => {
    const transport = createLoopbackPluginCommands('http://localhost:8781/', vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status: 503 })));
    await expect(transport.runCliCommand('fixture', [])).rejects.toThrow(message);
  });

  it('fails when the server or its JSON response is unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(new Response('not JSON'))
      .mockResolvedValueOnce(new Response(null));
    const transport = createLoopbackPluginCommands('http://127.0.0.1:8781', fetchImpl);
    await expect(transport.cliContributions()).rejects.toThrow('connection refused');
    await expect(transport.cliContributions()).rejects.toThrow(SyntaxError);
    await expect(transport.cliContributions()).rejects.toThrow(SyntaxError);
  });

  it('cancels oversized streaming responses before retaining their bytes', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel
    }));
    const transport = createLoopbackPluginCommands('http://127.0.0.1:8781', vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(transport.cliContributions()).rejects.toThrow('exceeds 1 MB');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
});
