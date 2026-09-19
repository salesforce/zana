import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SURFACE_HEADER, apiJson, fetchWithAppSurface } from '../fetch-with-app-surface.js';

describe('fetchWithAppSurface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stamps the app-surface header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithAppSurface('/api/v1/health');
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get(APP_SURFACE_HEADER)).toBe('web');
  });
});

describe('apiJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'delete'])('marks a bodyless %s as JSON', async (method) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiJson('/threads/thread-1/next-turn/item-1', { method })).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/threads/thread-1/next-turn/item-1');
    expect(init?.method).toBe(method);
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(APP_SURFACE_HEADER)).toBe('web');
  });

  it.each([undefined, 'GET', 'HEAD', 'OPTIONS'])('leaves bodyless %s reads without a content type', async (method) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiJson('/threads', method ? { method } : undefined)).resolves.toBeUndefined();

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('content-type')).toBe(false);
  });

  it('marks request bodies as JSON and preserves their contents', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const body = JSON.stringify({ force: true });

    await apiJson('/threads/thread-1/next-turn/flush', { method: 'POST', body });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(body);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('preserves explicit headers without mutating the caller headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'x-request-id': 'request-1' });

    await apiJson('/threads/thread-1/next-turn/item-1', { method: 'DELETE', headers });

    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sentHeaders.get('content-type')).toBe('application/json; charset=utf-8');
    expect(sentHeaders.get('x-request-id')).toBe('request-1');
    expect(headers.has(APP_SURFACE_HEADER)).toBe(false);
  });

  it.each([
    [{ error: 'rejected', message: 'Cannot remove this message' }, 'Cannot remove this message'],
    [{ error: 'rejected' }, 'rejected'],
    [{}, '409']
  ])('surfaces API errors from %j', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: 409 })));

    await expect(apiJson('/threads/thread-1/next-turn/item-1', { method: 'DELETE' })).rejects.toThrow(message);
  });

  it('falls back to the status when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

    await expect(apiJson('/threads')).rejects.toThrow('503');
  });
});
