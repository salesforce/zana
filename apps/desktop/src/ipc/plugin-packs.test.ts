import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  supervisor: null as Record<string, ReturnType<typeof vi.fn>> | null
}));
vi.mock('./ctx.js', () => ({ ctx: {
  get runtimeSupervisor() { return state.supervisor; },
  safeHandle(channel: string, handler: (...args: unknown[]) => unknown) { state.handlers.set(channel, handler); }
} }));

import { createPluginPacksLoopback, registerPluginPacksIpc } from './plugin-packs.js';

const identity = { marketplaceSource: 'https://catalog.test/marketplace.json', packId: 'essentials' };
const input = { identity, planId: '00000000-0000-4000-8000-000000000001', pluginIds: ['tools'] };
const plan = { identity, planId: input.planId, displayName: 'Essentials', description: 'Useful plugins', members: [] };
const installation = { identity, displayName: 'Essentials', description: 'Useful plugins', createdAt: 1, updatedAt: 1, members: [] };
const paths = ['/api/v1/plugin-packs', '/api/v1/plugin-packs/plan', '/api/v1/plugin-packs/install', '/api/v1/plugin-packs/installed', '/api/v1/plugin-packs/forget'];

beforeEach(() => { state.handlers.clear(); state.supervisor = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('plugin pack desktop IPC', () => {
  it('routes every operation to the authoritative supervised plugin service', async () => {
    state.supervisor = {
      listPluginPacks: vi.fn(async () => []), planPluginPack: vi.fn(async () => plan),
      installPluginPack: vi.fn(async () => installation), listInstalledPluginPacks: vi.fn(async () => [installation]),
      forgetPluginPack: vi.fn(async () => true)
    };
    registerPluginPacksIpc();
    expect(state.handlers.size).toBe(5);
    await expect(state.handlers.get(IPC.pluginPacks.list)!()).resolves.toEqual([]);
    await expect(state.handlers.get(IPC.pluginPacks.plan)!(identity)).resolves.toEqual(plan);
    await expect(state.handlers.get(IPC.pluginPacks.install)!(input)).resolves.toEqual(installation);
    await expect(state.handlers.get(IPC.pluginPacks.listInstalled)!()).resolves.toEqual([installation]);
    await expect(state.handlers.get(IPC.pluginPacks.forget)!(identity)).resolves.toBe(true);
    expect(state.supervisor.planPluginPack).toHaveBeenCalledWith(identity);
    expect(state.supervisor.installPluginPack).toHaveBeenCalledWith(input);
    expect(state.supervisor.forgetPluginPack).toHaveBeenCalledWith(identity);
  });

  it('rejects injected sources, invalid identities and malformed install requests before dispatch', () => {
    state.supervisor = { planPluginPack: vi.fn(), installPluginPack: vi.fn(), forgetPluginPack: vi.fn() };
    registerPluginPacksIpc();
    for (const channel of [IPC.pluginPacks.plan, IPC.pluginPacks.forget]) {
      expect(() => state.handlers.get(channel)!({ ...identity, source: '/private' })).toThrow();
      expect(() => state.handlers.get(channel)!({ ...identity, packId: '../other' })).toThrow();
    }
    for (const bad of [
      { ...input, source: 'git:https://unreviewed.test/plugin' }, { ...input, planId: 'invented' },
      { ...input, pluginIds: ['tools', 'tools'] }, { ...input, identity: { ...identity, hostId: 'other' } }
    ]) expect(() => state.handlers.get(IPC.pluginPacks.install)!(bad)).toThrow();
    for (const method of Object.values(state.supervisor)) expect(method).not.toHaveBeenCalled();
  });

  it('uses product HTTP in development and propagates service failures', async () => {
    vi.stubEnv('ZCC_SERVER_URL', 'http://127.0.0.1:8780');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Reviewed plan expired' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    registerPluginPacksIpc();
    await expect(state.handlers.get(IPC.pluginPacks.install)!(input)).rejects.toThrow('Reviewed plan expired');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8780/api/v1/plugin-packs/install');
  });
});

describe('plugin pack product-loopback fallback', () => {
  it('round-trips raw service bodies with bounded request deadlines', async () => {
    const replies = [[], plan, installation, [installation], true];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(replies.shift())));
    vi.stubGlobal('fetch', fetchMock);
    const api = createPluginPacksLoopback('http://127.0.0.1:8780/');
    await expect(api.list()).resolves.toEqual([]);
    await expect(api.plan(identity)).resolves.toEqual(plan);
    await expect(api.install(input)).resolves.toEqual(installation);
    await expect(api.listInstalled()).resolves.toEqual([installation]);
    await expect(api.forget(identity)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(paths);
    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    for (const [, init] of calls) expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(identity) });
    expect(calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(calls[4][1]).toMatchObject({ method: 'POST', body: JSON.stringify(identity) });
  });

  it('fails explicitly when the plugin service is unavailable', async () => {
    const api = createPluginPacksLoopback(null);
    await expect(api.list()).rejects.toThrow('plugin host is unavailable');
    await expect(api.install(input)).rejects.toThrow('plugin host is unavailable');
  });

  it.each([
    [JSON.stringify({ message: 'Plan changed', error: 'other' }), 'Plan changed'],
    [JSON.stringify({ error: 'Member unavailable' }), 'Member unavailable'],
    [JSON.stringify({ error: 42 }), 'plugin host returned 503'],
    ['not JSON', 'plugin host returned 503']
  ])('retains actionable errors without treating a failed request as an empty catalogue', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 503 })));
    await expect(createPluginPacksLoopback('http://localhost:8780/').list()).rejects.toThrow(message);
  });
});
