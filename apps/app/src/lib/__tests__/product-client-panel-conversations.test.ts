// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it('lists a plugin panel\'s conversations, scoped to the panel when given', async () => {
  const rows = [{ id: 't1', title: 'Chat', updatedAt: 2 }];
  const fetch = vi.fn().mockImplementation(async () => Response.json({ threads: rows }));
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.panelConversations('pr/monitor', 'board view')).resolves.toEqual(rows);
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/plugins/pr%2Fmonitor/panel-threads?panel=board+view');
  await product.threads.panelConversations('pr-monitor');
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/plugins/pr-monitor/panel-threads');
});

it('opens a side-panel conversation as a thread', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ thread: { id: 't/1', visibility: 'visible' } }));
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.openAsThread('t/1')).resolves.toEqual({ thread: { id: 't/1', visibility: 'visible' } });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/threads/t%2F1/open-as-thread');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
});
