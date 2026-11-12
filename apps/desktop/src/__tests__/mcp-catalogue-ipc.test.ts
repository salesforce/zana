import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const handlers = new Map<string, (...args: any[]) => Promise<unknown> | unknown>();
const logged = vi.fn();

async function load() {
  vi.resetModules();
  handlers.clear();
  const { bindIpcCtx } = await import('../ipc/ctx.js');
  bindIpcCtx({
    safeHandle: (channel: string, handler: (...a: any[]) => any, onError: (e: unknown, ...a: any[]) => unknown) => {
      handlers.set(channel, async (...args: any[]) => {
        try { return await handler(...args); } catch (e) { logged(e); return onError(e, ...args); }
      });
    }
  } as any);
  return import('../ipc/mcp-catalogue.js');
}

const good = {
  entries: [
    { key: 'zcc-inbox', source: 'user', available: true },
    { key: 'plugin:a/b', source: 'plugin', available: true },
    { key: 'gh', source: 'user', available: false, reason: 'credentials-stripped' }
  ],
  notes: ['project .mcp.json is unreadable, malformed or oversized; project servers unavailable']
};

describe('mcp catalogue IPC', () => {
  beforeEach(() => logged.mockClear());

  it('returns the validated catalogue', async () => {
    const { readMcpCatalogue } = await load();
    expect(readMcpCatalogue(() => good)).toEqual({ ok: true, value: good });
  });

  it('maps a host error to a clean failure without leaking the message', async () => {
    const { readMcpCatalogue } = await load();
    const r = readMcpCatalogue(() => { throw new Error('ENOENT /Users/secret/.claude.json'); });
    expect(r).toEqual({ ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'MCP server catalogue is unavailable' });
  });

  it.each([null, 'x', [], { entries: 'no', notes: [] }, { entries: [] }])('rejects malformed result %j', async (bad) => {
    const { readMcpCatalogue } = await load();
    expect(readMcpCatalogue(() => bad)).toMatchObject({ ok: false, code: 'MCP_CATALOGUE_INVALID' });
  });

  it('rejects an oversize catalogue', async () => {
    const { readMcpCatalogue } = await load();
    const entries = Array.from({ length: 257 }, (_, i) => ({ key: `s${i}`, source: 'user', available: true }));
    expect(readMcpCatalogue(() => ({ entries, notes: [] }))).toMatchObject({ ok: false, code: 'MCP_CATALOGUE_INVALID' });
    expect(readMcpCatalogue(() => ({ entries: [], notes: Array(65).fill('n') }))).toMatchObject({ ok: false });
    expect(readMcpCatalogue(() => ({ entries: [{ key: 'k'.repeat(513), source: 'user', available: true }], notes: [] }))).toMatchObject({ ok: false });
  });

  it('never lets commands, args, env or urls through (strict entries)', async () => {
    const { readMcpCatalogue } = await load();
    for (const extra of [{ command: 'node' }, { args: ['x'] }, { env: { TOKEN: 't' } }, { url: 'https://x' }]) {
      const r = readMcpCatalogue(() => ({ entries: [{ key: 'a', source: 'user', available: true, ...extra }], notes: [] }));
      expect(r).toMatchObject({ ok: false, code: 'MCP_CATALOGUE_INVALID' });
    }
  });

  it('rejects a name or source outside the contract', async () => {
    const { readMcpCatalogue } = await load();
    expect(readMcpCatalogue(() => ({ entries: [{ key: '', source: 'user', available: true }], notes: [] }))).toMatchObject({ ok: false });
    expect(readMcpCatalogue(() => ({ entries: [{ key: 'a', source: 'renderer', available: true }], notes: [] }))).toMatchObject({ ok: false });
  });

  it('registers one handler on mcp:catalogue and ignores renderer-supplied arguments', async () => {
    const mod = await load();
    mod.registerMcpCatalogueIpc();
    expect([...handlers.keys()]).toEqual([IPC.mcp.catalogue]);
    const h = handlers.get(IPC.mcp.catalogue)!;
    // Path / projectId / name injection: arguments are dropped, never forwarded or resolved.
    const r = (await h('/etc', '../../..', { projectId: 'nope', name: 'unregistered' })) as any;
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('unregistered');
    expect(JSON.stringify(r)).not.toContain('/etc');
    for (const e of r.value.entries) expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(['available', 'key', 'source']));
  });

  it('the handler error fallback is a clean MCP_CATALOGUE_FAILED without the thrown message', async () => {
    vi.resetModules();
    let fallback: ((e: unknown) => unknown) | undefined;
    const { bindIpcCtx } = await import('../ipc/ctx.js');
    bindIpcCtx({ safeHandle: (_c: string, _h: unknown, onError: (e: unknown) => unknown) => { fallback = onError; } } as any);
    const mod = await import('../ipc/mcp-catalogue.js');
    mod.registerMcpCatalogueIpc();
    expect(fallback?.(new Error('/Users/secret'))).toEqual({
      ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'MCP server catalogue is unavailable'
    });
  });

  it('is registered once by registerIpcFamilies, not per window', async () => {
    const { readFileSync } = await import('node:fs');
    const reg = readFileSync(new URL('../ipc/register.ts', import.meta.url), 'utf8');
    expect(reg.match(/registerMcpCatalogueIpc\(\)/g)).toHaveLength(1);
    const host = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
    expect(host).not.toContain('registerMcpCatalogueIpc');
  });
});
