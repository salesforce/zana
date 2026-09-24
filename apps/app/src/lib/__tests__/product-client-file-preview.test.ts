import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, 'project /#?'])('sends the optional project scope without changing the file path (%s)', async (projectId) => {
  const file = { path: '.zcc/report #1.md', relPath: '.zcc/report #1.md', content: '# Preview', encoding: 'utf8', contentType: null };
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(file));
  vi.stubGlobal('fetch', fetchMock);

  await expect(product.threads.hostFileContent('session /1', file.path, projectId)).resolves.toEqual(file);
  const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
  expect(url.pathname).toBe('/api/v1/threads/session%20%2F1/host-files/content');
  expect(url.searchParams.get('path')).toBe(file.path);
  expect(url.searchParams.get('projectId')).toBe(projectId ?? null);
});
