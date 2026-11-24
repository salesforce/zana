import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { expect, it, vi } from 'vitest';
import { helpCatalog } from './catalog.js';
import { HelperCatalog } from './catalog-refresh.js';

it('shares one refresh and keeps the last compatible guide available when offline', async () => {
  const { zcc } = createFakePluginHost();
  const revised = { ...helpCatalog, entries: [{ ...helpCatalog.entries[0], text: 'Updated steps.' }] };
  const download = vi.fn(async () => Response.json(revised));
  const catalog = new HelperCatalog(zcc.storage.kv, download);
  expect(await Promise.all([catalog.entries(), catalog.entries()])).toEqual([revised.entries, revised.entries]);
  expect(download).toHaveBeenCalledTimes(1);
  const offline = new HelperCatalog(zcc.storage.kv, vi.fn().mockRejectedValue(new Error('Offline')));
  expect(await offline.entries()).toEqual(revised.entries);
});

it.each([
  () => Response.json({ ...helpCatalog, version: '99.0.0' }),
  () => Response.json({ ...helpCatalog, entries: [{ ...helpCatalog.entries[0], url: 'https://example.org/guide' }] }),
  () => Response.json({ ...helpCatalog, entries: [helpCatalog.entries[0], helpCatalog.entries[0]] }),
  () => new Response('x'.repeat(200_000)),
  () => new Response(null, { status: 404 })
])('uses bundled guides when a download is incompatible or invalid', async response => {
  const { zcc } = createFakePluginHost();
  const catalog = new HelperCatalog(zcc.storage.kv, vi.fn(async () => response()));
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
});
