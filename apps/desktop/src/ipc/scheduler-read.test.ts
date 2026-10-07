import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerSchedulerIpc } from './scheduler.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  get: vi.fn(), reload: vi.fn()
}));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: {
  scheduler: { get: h.get, reload: h.reload, on: vi.fn() },
  goals: { on: vi.fn() }, followups: { on: vi.fn() }, feedStore: { on: vi.fn() },
  templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() }
} }));
vi.mock('./shared.js', () => ({
  isExternalId: (id: string) => id.startsWith('external:'),
  externalReject: () => ({ ok: false, code: 'EXTERNAL_RECORD' }), listSchedulesForUi: () => []
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));
beforeEach(() => { vi.resetAllMocks(); h.handlers.clear(); registerSchedulerIpc(); });

describe.each([[IPC.scheduler.get, 'get'], [IPC.scheduler.reload, 'reload']] as const)('schedule %s authorization', (channel, action) => {
  it.each([undefined, null, 1, '', 'x'.repeat(257)])('rejects malformed id %s before consulting the scheduler', async id => {
    await expect(h.handlers.get(channel)!(id)).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(h[action]).not.toHaveBeenCalled();
  });
  it('rejects an externally owned schedule', async () => {
    await expect(h.handlers.get(channel)!('external:foreign')).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    expect(h[action]).not.toHaveBeenCalled();
  });
  it('returns the authoritative scheduler result and contains both error shapes', async () => {
    h[action].mockResolvedValueOnce({ id: 'owned', name: 'Current' });
    await expect(h.handlers.get(channel)!('owned')).resolves.toEqual({ ok: true, value: { id: 'owned', name: 'Current' } });
    expect(h[action]).toHaveBeenCalledWith('owned');
    h[action].mockRejectedValueOnce(new Error('Missing schedule'));
    await expect(h.handlers.get(channel)!('owned')).resolves.toEqual({ ok: false, code: 'SCHEDULE_FAILED', message: 'Missing schedule' });
    h[action].mockRejectedValueOnce('Unreadable schedule');
    await expect(h.handlers.get(channel)!('owned')).resolves.toEqual({ ok: false, code: 'SCHEDULE_FAILED', message: 'Unreadable schedule' });
  });
});
