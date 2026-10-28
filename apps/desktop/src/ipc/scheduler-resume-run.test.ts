import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { SHARED_PRODUCT_METHODS } from '@zana-ai/zcc-contracts/shared-product';
import { registerSchedulerIpc } from './scheduler.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resume: vi.fn(),
  get: vi.fn(), list: vi.fn(), create: vi.fn(),
  listProjects: vi.fn(), realpath: vi.fn(), logMainError: vi.fn()
}));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: {
  scheduler: { get: h.get, on: vi.fn() },
  ptys: { list: h.list },
  createInteractiveTerminal: h.create, logMainError: h.logMainError,
  goals: { on: vi.fn() }, followups: { on: vi.fn() }, feedStore: { on: vi.fn() },
  templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() }
} }));
vi.mock('./shared.js', () => ({
  isExternalId: (id: string) => id.startsWith('external:'),
  externalReject: () => ({ ok: false, code: 'EXTERNAL_RECORD' }), listSchedulesForUi: () => []
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: h.listProjects } }));
vi.mock('../scheduler-resume-run.js', () => ({ resumeScheduledRun: h.resume }));
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), realpathSync: h.realpath }));

beforeEach(() => { vi.resetAllMocks(); h.handlers.clear(); registerSchedulerIpc(); });

const call = (arg: unknown) => h.handlers.get(IPC.scheduler.resumeRun)!(arg) as Promise<unknown>;

describe('scheduler:resumeRun', () => {
  it('stays desktop-only: it starts an interactive terminal, so web and shared clients must not reach it', () => {
    expect([...SHARED_PRODUCT_METHODS.keys()]).not.toContain('scheduler.resumeRun');
    expect([...SHARED_PRODUCT_METHODS.values()]).not.toContain(IPC.scheduler.resumeRun);
  });

  it.each([undefined, 'x', {}, { scheduleId: '' }, { scheduleId: 's', extra: 1 }, { scheduleId: 's', runId: '' }, { scheduleId: 'x'.repeat(257) }])(
    'rejects malformed input %j before main does any work', async (input) => {
      await expect(call(input)).resolves.toMatchObject({ ok: false, code: 'BAD_INPUT' });
      expect(h.resume).not.toHaveBeenCalled();
    });

  it('refuses an externally owned schedule', async () => {
    await expect(call({ scheduleId: 'external:loop' })).resolves.toEqual({ ok: false, code: 'EXTERNAL_RECORD' });
    expect(h.resume).not.toHaveBeenCalled();
  });

  it('hands the validated input to resumeScheduledRun and returns its result', async () => {
    h.resume.mockResolvedValueOnce({ ok: true, value: { session: { id: 'n' }, reused: false } });
    await expect(call({ scheduleId: 's1', runId: 'r1' })).resolves.toEqual({ ok: true, value: { session: { id: 'n' }, reused: false } });
    expect(h.resume).toHaveBeenCalledWith({ scheduleId: 's1', runId: 'r1' }, expect.any(Object));
  });

  it('turns a thrown error into a stable RESUME_FAILED without leaking the exception, and logs it with the ids', async () => {
    h.resume.mockRejectedValueOnce(new Error('ENOENT: /Users/someone/secret/path'));
    const result = await call({ scheduleId: 's1', runId: 'r9' });
    expect(result).toEqual({ ok: false, code: 'RESUME_FAILED', message: "Couldn't reopen this run's conversation. Try again in a moment." });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(h.logMainError).toHaveBeenCalledWith('scheduler resume run (scheduleId=s1, runId=r9)', expect.objectContaining({ message: expect.stringContaining('secret') }));
  });

  it('logs the latest run as "latest" and keeps non-Error throws in the log, not the result', async () => {
    h.resume.mockRejectedValueOnce('odd');
    await expect(call({ scheduleId: 's1' })).resolves.toMatchObject({ ok: false, code: 'RESUME_FAILED' });
    expect(h.logMainError).toHaveBeenCalledWith('scheduler resume run (scheduleId=s1, runId=latest)', 'odd');
  });

  it('builds each dependency from main services at call time', async () => {
    h.resume.mockResolvedValue({ ok: true, value: {} });
    await call({ scheduleId: 's1' });
    const deps = h.resume.mock.calls[0]![1];

    h.get.mockReturnValueOnce({ id: 's1' });
    expect(deps.getTask('s1')).toEqual({ id: 's1' });
    h.get.mockImplementationOnce(() => { throw new Error('schedule not found'); });
    expect(deps.getTask('gone')).toBeUndefined();

    h.listProjects.mockReturnValueOnce([{ id: 'p1' }]);
    expect(deps.listProjects()).toEqual([{ id: 'p1' }]);

    h.list.mockReturnValueOnce([{ id: 'live', status: 'running' }, { id: 'dead', status: 'exited' }]);
    expect(deps.listLiveSessions('p1')).toEqual([{ id: 'live', status: 'running' }]);
    expect(h.list).toHaveBeenCalledWith('p1');

    h.create.mockResolvedValueOnce({ ok: true, value: { id: 'new' } });
    await expect(deps.createInteractiveTerminal({ projectId: 'p1' })).resolves.toEqual({ ok: true, value: { id: 'new' } });

    expect(deps.registrationFor('claude')?.nativeConversationResume).toBeTypeOf('function');
    expect(deps.registrationFor('shell')?.nativeConversationResume).toBeUndefined();

    h.realpath.mockReturnValueOnce('/real');
    expect(deps.realpath('/p')).toBe('/real');
  });
});
