import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listPluginAppsFromProductServer,
  loopbackProductServerUrl,
  setPluginAppEnabledOnProductServer,
  checkPluginUpdatesFromProductServer,
  applyPluginUpdateOnProductServer,
  callPluginRpcOnProductServer,
  getPluginSettingsFromProductServer,
  setPluginSettingsOnProductServer
} from './plugin-apps-loopback.js';

const snapshot = {
  id: 'docs',
  name: 'Docs',
  description: 'library',
  icon: 'Library',
  enabled: true,
  provenance: 'builtin' as const,
  status: 'running' as const,
  appUrl: '/plugins/docs/app.js',
  projectTab: { label: 'Library', global: true }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loopbackProductServerUrl', () => {
  it('accepts loopback http(s) and rejects other hosts', () => {
    expect(loopbackProductServerUrl({ ZCC_SERVER_URL: 'http://127.0.0.1:8780' })).toBe(
      'http://127.0.0.1:8780/'
    );
    expect(loopbackProductServerUrl({ ZCC_SERVER_URL: 'http://localhost:8780/' })).toBe(
      'http://localhost:8780/'
    );
    expect(loopbackProductServerUrl({ ZCC_SERVER_URL: 'https://example.test/api' })).toBeNull();
    expect(loopbackProductServerUrl({})).toBeNull();
  });
});

describe('plugin-apps product-server fallback', () => {
  it('lists redacted snapshots from GET /api/v1/plugin-apps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ apps: [snapshot, { id: 'bad' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    );
    await expect(
      listPluginAppsFromProductServer('http://127.0.0.1:8780/')
    ).resolves.toEqual([snapshot]);
  });

  it('returns empty when the product server is unset or errors', async () => {
    await expect(listPluginAppsFromProductServer(null)).resolves.toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    await expect(
      listPluginAppsFromProductServer('http://127.0.0.1:8780/')
    ).resolves.toEqual([]);
  });

  it('POSTs enable/disable and maps failures', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/enable')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ error: 'plugin not installed: missing' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      setPluginAppEnabledOnProductServer('docs', true, 'http://127.0.0.1:8780/')
    ).resolves.toEqual({ ok: true, value: true });
    await expect(
      setPluginAppEnabledOnProductServer('missing', false, 'http://127.0.0.1:8780/')
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/plugin-apps/docs/enable');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  });

  it('GETs catalog updates and POSTs apply', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/updates')) {
        return new Response(
          JSON.stringify({
            updates: [{ id: 'docs', current: '1.0.0', available: '1.1.0', marketplace: 'official' }]
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/docs/update')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ error: 'plugin not installed: missing' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      checkPluginUpdatesFromProductServer('http://127.0.0.1:8780/')
    ).resolves.toEqual([
      { id: 'docs', current: '1.0.0', available: '1.1.0', marketplace: 'official' }
    ]);
    await expect(
      applyPluginUpdateOnProductServer('docs', 'http://127.0.0.1:8780/')
    ).resolves.toEqual({ ok: true, value: true });
    await expect(
      applyPluginUpdateOnProductServer('missing', 'http://127.0.0.1:8780/')
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/plugin-apps/updates');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/v1/plugin-apps/docs/update');
  });

  it('POSTs plugin RPC and maps host errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pr-monitor/rpc')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
        if (body.method === 'badge') {
          return new Response(JSON.stringify({ value: { count: 2 } }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'unknown rpc pr-monitor.missing' }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: 'plugin host is unavailable' }), { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      callPluginRpcOnProductServer('pr-monitor', 'badge', undefined, 'http://127.0.0.1:8780/')
    ).resolves.toEqual({ count: 2 });
    await expect(
      callPluginRpcOnProductServer('pr-monitor', 'missing', undefined, 'http://127.0.0.1:8780/')
    ).rejects.toThrow(/unknown rpc pr-monitor.missing/);
    await expect(callPluginRpcOnProductServer('pr-monitor', 'badge')).rejects.toThrow(
      /plugin host is unavailable/
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/plugin-apps/pr-monitor/rpc');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'badge' })
    });
  });

  it('GETs and POSTs plugin settings', async () => {
    const snapshot = {
      descriptors: { token: { type: 'string', label: 'Token' } },
      values: { token: 'secret' }
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pr-monitor/settings') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(snapshot), { status: 200 });
      }
      if (url.endsWith('/pr-monitor/settings') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ...snapshot, values: { token: 'next' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'plugin not running: missing' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getPluginSettingsFromProductServer('pr-monitor', 'http://127.0.0.1:8780/')
    ).resolves.toEqual(snapshot);
    await expect(
      getPluginSettingsFromProductServer('missing', 'http://127.0.0.1:8780/')
    ).resolves.toEqual({ descriptors: {}, values: {} });
    await expect(
      setPluginSettingsOnProductServer('pr-monitor', { token: 'next' }, 'http://127.0.0.1:8780/')
    ).resolves.toMatchObject({ values: { token: 'next' } });
    await expect(
      setPluginSettingsOnProductServer('missing', { token: 'next' }, 'http://127.0.0.1:8780/')
    ).rejects.toThrow(/plugin not running: missing/);
    await expect(getPluginSettingsFromProductServer('pr-monitor')).resolves.toEqual({
      descriptors: {},
      values: {}
    });
    await expect(setPluginSettingsOnProductServer('pr-monitor', { token: 'next' })).rejects.toThrow(
      /plugin host is unavailable/
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/plugin-apps/pr-monitor/settings');
  });
});
