/**
 * The observational PostToolUse route `/hook/toolsettled/:projectId/:sessionId`
 * (OBL-011): it answers 204 at once and never lets the handler delay or fail the
 * relay, whatever the handler does or the body size.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryInboxStore, createMemorySuggestionsStore } from '@zana-ai/zcc-server';
import { matchToolSettledHookRoute, startMcpServer, TOOL_SETTLED_BODY_MAX_BYTES, type McpServerHandle } from './mcp-server.js';

describe('tool-settled route', () => {
  let handle: McpServerHandle | null = null;
  afterEach(async () => {
    await handle?.close();
    handle = null;
  });
  const boot = async (hook?: Parameters<typeof startMcpServer>[0]['onNativeToolSettledHook'], log = vi.fn()) => {
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => null },
      onNativeToolSettledHook: hook,
      log
    });
    return handle;
  };
  const post = (h: McpServerHandle, body: string, method = 'POST') =>
    fetch(`${h.url}/hook/toolsettled/proj%201/sess-A`, { method, body: method === 'POST' ? body : undefined });

  it('matches only the settled path and decodes ids', () => {
    expect(matchToolSettledHookRoute('/hook/toolsettled/proj%201/sess-A')).toEqual({ projectId: 'proj 1', sessionId: 'sess-A' });
    expect(matchToolSettledHookRoute('/hook/nativetool/p/s')).toBeNull();
    expect(matchToolSettledHookRoute('/hook/toolsettled/%E0%A4%A/s')).toBeNull();
    expect(matchToolSettledHookRoute(undefined)).toBeNull();
  });

  it('answers 204 immediately while a hung handler is still pending', async () => {
    const hook = vi.fn(() => new Promise<void>(() => undefined));
    const h = await boot(hook);
    const res = await post(h, '{"a":1}');
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith('proj 1', 'sess-A', '{"a":1}'));
  });

  it('answers 204 with no handler, and logs a handler failure without its message', async () => {
    expect((await post(await boot(), '{}')).status).toBe(204);
    await handle?.close();
    const log = vi.fn();
    const h = await boot(async () => { throw new Error('tool-output-secret'); }, log);
    expect((await post(h, '{}')).status).toBe(204);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[mcp] tool-settled-hook handler failed'));
    expect(JSON.stringify(log.mock.calls)).not.toContain('tool-output-secret');
  });

  it('drops an oversize body but still answers 204', async () => {
    const hook = vi.fn();
    const h = await boot(hook);
    const res = await post(h, 'x'.repeat(TOOL_SETTLED_BODY_MAX_BYTES + 10));
    expect(res.status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hook).not.toHaveBeenCalled();
  });

  it('rejects non-POST', async () => {
    expect((await post(await boot(), '', 'GET')).status).toBe(405);
  });
});
