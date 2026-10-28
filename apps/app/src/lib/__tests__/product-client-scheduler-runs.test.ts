import { afterEach, expect, it, vi } from 'vitest';
// The shared-owner capability probe is cached per module, so each test loads a fresh client.
const load = async () => { vi.resetModules(); return (await import('../product-client.js')).product; };

afterEach(() => vi.unstubAllGlobals());

const ref = { scheduleId: 's', runId: 'r' };

it('reports run history as unavailable when no shared owner is attached', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sharedProductServices: false })));
  const product = await load();
  const unavailable = { ok: false, code: 'unavailable', message: 'scheduling requires the desktop app' };
  await expect(product.scheduler.queryRuns({})).resolves.toEqual(unavailable);
  await expect(product.scheduler.retryRuns([ref])).resolves.toEqual(unavailable);
  await expect(product.scheduler.dismissRuns([ref])).resolves.toEqual(unavailable);
  await expect(product.scheduler.resumeRun({ scheduleId: 's' })).resolves.toEqual(unavailable);
});

it('keeps resuming a run desktop-only even when a shared owner is attached', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/system/instance') ? Response.json({ sharedProductServices: true }) : Response.json({ ok: true, value: { ok: true, value: 1 } }));
  vi.stubGlobal('fetch', fetchMock);
  const product = await load();
  await expect(product.scheduler.resumeRun({ scheduleId: 's', runId: 'r' })).resolves.toMatchObject({ ok: false, code: 'unavailable' });
  expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/shared-product'))).toBe(false);
});

it('forwards query, retry and dismiss to the shared owner', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/system/instance') ? Response.json({ sharedProductServices: true }) : Response.json({ ok: true, value: { ok: true, value: 1 } }));
  vi.stubGlobal('fetch', fetchMock);
  const product = await load();
  await expect(product.scheduler.dismissRuns([ref])).resolves.toEqual({ ok: true, value: 1 });
  await product.scheduler.queryRuns({ state: 'all' });
  await product.scheduler.retryRuns([ref]);
  const bodies = fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/shared-product')).map(c => JSON.parse((c[1] as RequestInit).body as string));
  expect(bodies).toEqual([
    { method: 'scheduler.dismissRuns', args: [[ref]] },
    { method: 'scheduler.queryRuns', args: [{ state: 'all' }] },
    { method: 'scheduler.retryRuns', args: [[ref]] }
  ]);
});
