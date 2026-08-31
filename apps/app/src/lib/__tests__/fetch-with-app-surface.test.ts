import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SURFACE_HEADER, fetchWithAppSurface } from '../fetch-with-app-surface.js';

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
