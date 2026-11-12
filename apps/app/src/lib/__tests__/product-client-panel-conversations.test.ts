// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it('carries page snapshots independently on initial and follow-up requests', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ ok: true, thread: { id: 't1' } }));
  vi.stubGlobal('fetch', fetch);
  const pageContext = { pluginId: 'notes', panel: 'main', page: { title: 'Document A', resourceId: 'a' } };
  await product.threads.create({ projectId: 'p1', providerId: 'codex', input: [{ type: 'text', text: 'Explain' }], pageContext });
  expect(JSON.parse(fetch.mock.calls[0][1].body).pageContext).toEqual(pageContext);
  const next = { ...pageContext, page: { title: 'Settings' } };
  await product.threads.send('t1', [{ type: 'text', text: 'Help' }], 'queue-if-active', { pageContext: next });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ mode: 'queue-if-active', pageContext: next });
  await product.threads.send('t1', 'Ordinary follow-up');
  expect(JSON.parse(fetch.mock.calls[2][1].body)).not.toHaveProperty('pageContext');
  await product.threads.create({ projectId: 'p2', providerId: 'codex', input: [{ type: 'text', text: 'Ordinary conversation' }] });
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ projectId: 'p2', providerId: 'codex', input: [{ type: 'text', text: 'Ordinary conversation' }] });
});

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

it('sends project and view filters without losing path characters', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ threads: [] }));
  vi.stubGlobal('fetch', fetch);
  await product.threads.panelConversations('studio', 'agentforce', { projectId: 'p/1', view: 'force-app/Support.agent' });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/plugins/studio/panel-threads?panel=agentforce&projectId=p%2F1&view=force-app%2FSupport.agent');
  await product.threads.panelConversations('studio', undefined, { view: '' });
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/plugins/studio/panel-threads?view=');
});
