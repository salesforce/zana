import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listPluginAppsFromProductServer,
  loopbackProductServerUrl,
  setPluginAppEnabledOnProductServer
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
  });
});
