import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerSchedulerIpc } from './scheduler.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  queryRuns: vi.fn(), retryRuns: vi.fn(), dismissRuns: vi.fn()
}));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: {
  scheduler: { queryRuns: h.queryRuns, retryRuns: h.retryRuns, dismissRuns: h.dismissRuns, on: vi.fn() },
  safeHandleFromWindow: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  goals: { on: vi.fn() }, followups: { on: vi.fn() }, feedStore: { on: vi.fn() },
  templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() }
} }));
vi.mock('./shared.js', () => ({
  isExternalId: (id: string) => id.startsWith('external:'),
  externalReject: () => ({ ok: false, code: 'EXTERNAL_RECORD' }), listSchedulesForUi: () => []
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));
beforeEach(() => { vi.resetAllMocks(); h.handlers.clear(); registerSchedulerIpc(); });

const call = (channel: string, arg: unknown) => h.handlers.get(channel)!(arg) as Promise<unknown>;
const ref = { scheduleId: 's1', runId: 'r1' };

describe('scheduler:queryRuns', () => {
  it('validates, then returns the manager result', async () => {
    h.queryRuns.mockResolvedValueOnce({ rows: [], total: 0, truncated: false });
    await expect(call(IPC.scheduler.queryRuns, { state: 'all', limit: 10 })).resolves.toEqual({ ok: true, value: { rows: [], total: 0, truncated: false } });
    expect(h.queryRuns).toHaveBeenCalledWith({ state: 'all', limit: 10 });
  });
  it('never sends report text to the renderer', async () => {
    const run = { id: 'r1', at: '2026-01-01T00:00:00Z', result: 'error', report: 'x'.repeat(50_000) };
    h.queryRuns.mockResolvedValueOnce({ rows: [{ scheduleId: 's1', run }], total: 1, truncated: false });
    const out = await call(IPC.scheduler.queryRuns, {}) as { value: { rows: Array<{ run: Record<string, unknown> }> } };
    expect(out.value.rows[0].run).toEqual({ id: 'r1', at: '2026-01-01T00:00:00Z', result: 'error' });
  });
  it('treats a missing query as empty', async () => {
    h.queryRuns.mockResolvedValueOnce({ rows: [], total: 0, truncated: false });
    await expect(call(IPC.scheduler.queryRuns, undefined)).resolves.toMatchObject({ ok: true });
    expect(h.queryRuns).toHaveBeenCalledWith({});
  });
  it.each([{ limit: 9999 }, { bogus: 1 }, 'x', { state: 'nope' }])('rejects malformed query %j', async query => {
    await expect(call(IPC.scheduler.queryRuns, query)).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(h.queryRuns).not.toHaveBeenCalled();
  });
  it('rejects external schedule ids and contains failures', async () => {
    await expect(call(IPC.scheduler.queryRuns, { scheduleIds: ['external:x'] })).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    h.queryRuns.mockRejectedValueOnce(new Error('boom'));
    await expect(call(IPC.scheduler.queryRuns, {})).resolves.toMatchObject({ ok: false, code: 'QUERY_FAILED' });
  });
});

describe.each([
  [IPC.scheduler.retryRuns, 'retryRuns', 50, 'RETRY_FAILED'],
  [IPC.scheduler.dismissRuns, 'dismissRuns', 200, 'DISMISS_FAILED']
] as const)('%s', (channel, action, max, failCode) => {
  it('passes validated refs and returns the result', async () => {
    h[action].mockResolvedValueOnce(2);
    await expect(call(channel, [ref])).resolves.toEqual({ ok: true, value: 2 });
    expect(h[action]).toHaveBeenCalledWith([ref]);
  });
  it('rejects empty, oversized, malformed and external refs before the scheduler', async () => {
    for (const refs of [[], Array(max + 1).fill(ref), [{ scheduleId: 's' }], 'nope', undefined]) {
      await expect(call(channel, refs)).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    }
    await expect(call(channel, [ref, { scheduleId: 'external:x', runId: 'r' }])).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    expect(h[action]).not.toHaveBeenCalled();
  });
  it('accepts exactly the maximum', async () => {
    h[action].mockResolvedValueOnce([]);
    await expect(call(channel, Array(max).fill(ref))).resolves.toMatchObject({ ok: true });
  });
  it('contains manager failures', async () => {
    h[action].mockRejectedValueOnce(new Error('boom'));
    await expect(call(channel, [ref])).resolves.toMatchObject({ ok: false, code: failCode });
  });
});
