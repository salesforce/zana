import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerSchedulerIpc } from './scheduler.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fallbacks: new Map<string, () => unknown>(),
  get: vi.fn(), reload: vi.fn(), runNow: vi.fn(), preview: vi.fn(), reviewed: vi.fn()
}));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: {
  scheduler: { get: h.get, reload: h.reload, runNow: h.runNow, on: vi.fn() },
  safeHandleFromWindow: (channel: string, handler: (...args: unknown[]) => unknown, fallback: () => unknown) => {
    h.handlers.set(channel, handler);
    h.fallbacks.set(channel, fallback);
  },
  previewScheduledTeamLaunch: h.preview, runReviewedScheduledTeamNow: h.reviewed,
  goals: { on: vi.fn() }, followups: { on: vi.fn() }, feedStore: { on: vi.fn() },
  templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() }
} }));
vi.mock('./shared.js', () => ({
  isExternalId: (id: string) => id.startsWith('external:'),
  externalReject: () => ({ ok: false, code: 'EXTERNAL_RECORD' }), listSchedulesForUi: () => []
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));
beforeEach(() => { vi.resetAllMocks(); h.handlers.clear(); h.fallbacks.clear(); registerSchedulerIpc(); });

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

describe('Team schedule review IPC', () => {
  const window = { id: 7 };
  it('issues a caller-bound preview then consumes exact schedule and token', async () => {
    h.preview.mockResolvedValueOnce({ previewToken: 'opaque', fingerprint: 'f' });
    await expect(h.handlers.get(IPC.scheduler.previewTeamLaunch)!(window, 'team')).resolves.toEqual({ ok: true, value: { previewToken: 'opaque', fingerprint: 'f' } });
    expect(h.preview).toHaveBeenCalledWith('team', 7);
    h.reviewed.mockResolvedValueOnce({ id: 'team' });
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!(window, 'team', 'opaque')).resolves.toEqual({ ok: true, value: { id: 'team' } });
    expect(h.reviewed).toHaveBeenCalledWith('team', 'opaque', 7);
  });
  it('rejects malformed input and direct Team runs before scheduler launch', async () => {
    await expect(h.handlers.get(IPC.scheduler.previewTeamLaunch)!({ id: 7 }, '')).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!({ id: 7 }, 'team', '')).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    h.get.mockReturnValueOnce({ id: 'team', kind: 'team' });
    await expect(h.handlers.get(IPC.scheduler.runNow)!('team')).resolves.toMatchObject({ ok: false, code: 'REVIEW_REQUIRED' });
    expect(h.runNow).not.toHaveBeenCalled();
  });

  it('rejects externally owned reviews and converts preview/run failures into stable results', async () => {
    await expect(h.handlers.get(IPC.scheduler.previewTeamLaunch)!(window, 'external:team')).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!(window, 'external:team', 'token')).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.reviewed).not.toHaveBeenCalled();

    h.preview.mockRejectedValueOnce(new Error('preview expired'));
    await expect(h.handlers.get(IPC.scheduler.previewTeamLaunch)!(window, 'team')).resolves.toEqual({ ok: false, code: 'PREVIEW_FAILED', message: 'preview expired' });
    h.reviewed.mockRejectedValueOnce('token stale');
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!(window, 'team', 'token')).resolves.toEqual({ ok: false, code: 'RUN_FAILED', message: 'token stale' });
  });

  it('runs non-Team schedules and preserves both native and non-native review errors', async () => {
    h.get.mockReturnValueOnce({ id: 'personal', kind: 'task' });
    h.runNow.mockResolvedValueOnce({ id: 'personal' });
    await expect(h.handlers.get(IPC.scheduler.runNow)!('personal')).resolves.toEqual({ ok: true, value: { id: 'personal' } });
    h.get.mockImplementationOnce(() => { throw new Error('scheduler stopped'); });
    await expect(h.handlers.get(IPC.scheduler.runNow)!('personal')).resolves.toEqual({ ok: false, code: 'RUN_FAILED', message: 'Error: scheduler stopped' });

    h.preview.mockRejectedValueOnce('preview unavailable');
    await expect(h.handlers.get(IPC.scheduler.previewTeamLaunch)!(window, 'team')).resolves.toEqual({ ok: false, code: 'PREVIEW_FAILED', message: 'preview unavailable' });
    h.reviewed.mockRejectedValueOnce(new Error('review expired'));
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!(window, 'team', 'token')).resolves.toEqual({ ok: false, code: 'RUN_FAILED', message: 'review expired' });
  });

  it('rejects oversized review tokens and supplies safe window-unavailable fallbacks', async () => {
    await expect(h.handlers.get(IPC.scheduler.runReviewedTeamNow)!(window, 'team', 'x'.repeat(257))).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(h.reviewed).not.toHaveBeenCalled();
    expect(h.fallbacks.get(IPC.scheduler.previewTeamLaunch)!()).toEqual({ ok: false, code: 'PREVIEW_FAILED', message: 'Launch preview unavailable' });
    expect(h.fallbacks.get(IPC.scheduler.runReviewedTeamNow)!()).toEqual({ ok: false, code: 'RUN_FAILED', message: 'Reviewed launch unavailable' });
  });
});
