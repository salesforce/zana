import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiErrorProducerLookup, createApiErrorDispatchCtx, createApiErrorResume, handleApiErrorStop } from '../api-error-resume-wiring.js';

const config = (enabled = true) => ({
  apiErrorResume: {
    enabled, maxPerWindow: 3, windowMinutes: 15,
    rules: [{ id: 'r1', match: 'overloaded', matchMode: 'contains' as const, message: 'continue', delaySeconds: 5, enabled: true }]
  }
});

function make(over: { suppress?: boolean; cfg?: () => unknown } = {}) {
  const session = { projectId: 'p', title: 'T', status: 'running', lastInputAt: 1 };
  const deps = {
    getConfig: vi.fn(over.cfg ?? (() => config())) as never,
    ptys: { getSession: vi.fn(() => session), reply: vi.fn(() => true) },
    agentStatus: { get: vi.fn(() => 'idle'), markBlocked: vi.fn(), turnFinished: vi.fn(), clearToolsInFlight: vi.fn() },
    inboxStore: { append: vi.fn(async () => undefined) },
    suppressesInteractiveBlocked: vi.fn(() => over.suppress ?? false),
    logMainError: vi.fn()
  };
  return deps;
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('createApiErrorResume', () => {
  it('reads the config at call time and resumes through ptys.reply', async () => {
    const deps = make();
    const getConfig = deps.getConfig as unknown as ReturnType<typeof vi.fn>;
    getConfig.mockReturnValue({});
    const service = createApiErrorResume(deps);
    await service.onApiErrorStop('s1', { error: 'x', text: 'Overloaded' });
    expect(deps.ptys.reply).not.toHaveBeenCalled();
    getConfig.mockReturnValue(config());
    await service.onApiErrorStop('s1', { error: 'x', text: 'Overloaded' });
    vi.advanceTimersByTime(5000);
    expect(deps.ptys.reply).toHaveBeenCalledWith('s1', 'continue');
  });
  it('marks needs-you at the cap unless the session is a headless worker', async () => {
    for (const suppress of [false, true]) {
      const deps = make({ suppress });
      deps.getConfig = (() => ({ apiErrorResume: { ...config().apiErrorResume, maxPerWindow: 1 } })) as never;
      const service = createApiErrorResume(deps);
      await service.onApiErrorStop('s1', { error: '', text: 'overloaded' });
      vi.advanceTimersByTime(5000);
      await service.onApiErrorStop('s1', { error: '', text: 'overloaded' });
      expect(deps.agentStatus.markBlocked).toHaveBeenCalledTimes(suppress ? 0 : 1);
      expect(deps.inboxStore.append).toHaveBeenCalledTimes(1);
    }
  });
  it('logs inbox failures and a missing session', async () => {
    const deps = make();
    deps.inboxStore.append = vi.fn(async () => { throw new Error('disk'); });
    deps.getConfig = (() => ({ apiErrorResume: { ...config().apiErrorResume, maxPerWindow: 1 } })) as never;
    const service = createApiErrorResume(deps);
    await service.onApiErrorStop('s1', { error: '', text: 'overloaded' });
    vi.advanceTimersByTime(5000);
    await service.onApiErrorStop('s1', { error: '', text: 'overloaded' });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.logMainError).toHaveBeenCalledWith('api-error-resume pushInbox', expect.any(Error));
    deps.ptys.getSession.mockReturnValue(null as never);
    await service.onApiErrorStop('gone', { error: '', text: 'overloaded' });
  });
});

describe('handleApiErrorStop', () => {
  it('ends the turn, clears tools, then hands over to the service', () => {
    const deps = make();
    const order: string[] = [];
    deps.agentStatus.turnFinished.mockImplementation(() => { order.push('turnFinished'); });
    deps.agentStatus.clearToolsInFlight.mockImplementation(() => { order.push('clear'); });
    const service = { onApiErrorStop: vi.fn(async () => { order.push('service'); }) };
    handleApiErrorStop({ ...deps, service: service as never }, 's1', { error: 'e', text: 't' });
    expect(order).toEqual(['turnFinished', 'clear', 'service']);
    expect(service.onApiErrorStop).toHaveBeenCalledWith('s1', { error: 'e', text: 't' });
  });
  it('logs a rejected service call', async () => {
    const deps = make();
    const service = { onApiErrorStop: vi.fn(async () => { throw new Error('boom'); }) };
    handleApiErrorStop({ ...deps, service: service as never }, 's1', { error: 'e', text: 't' });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.logMainError).toHaveBeenCalledWith('api-error-resume', expect.any(Error));
  });
});

describe('handleApiErrorStop without a resume service', () => {
  it('still ends the turn and calls nothing else', () => {
    const agentStatus = { turnFinished: vi.fn(), clearToolsInFlight: vi.fn() };
    const logMainError = vi.fn();
    handleApiErrorStop({ agentStatus, logMainError }, 's1', { error: 'x', text: 'y' });
    expect(agentStatus.turnFinished).toHaveBeenCalledWith('s1');
    expect(agentStatus.clearToolsInFlight).toHaveBeenCalledWith('s1');
    expect(logMainError).not.toHaveBeenCalled();
  });
});

describe('createApiErrorDispatchCtx', () => {
  const event = { error: 'overloaded', text: 'x' } as never;
  it('is live only for a session that exists and has not exited', () => {
    const sessions: Record<string, { status: string }> = { a: { status: 'running' }, b: { status: 'exited' } };
    const ctx = createApiErrorDispatchCtx({ ptys: { getSession: (id) => sessions[id] }, onTurnFailed: vi.fn(), routeStop: vi.fn() });
    expect([ctx.isLive('a'), ctx.isLive('b'), ctx.isLive('gone')]).toEqual([true, false, false]);
  });
  it('routes a stop for a live session, and drops one for a gone session', () => {
    const routeStop = vi.fn();
    const onTurnFailed = vi.fn();
    const ctx = createApiErrorDispatchCtx({ ptys: { getSession: (id) => (id === 'a' ? { status: 'running' } : undefined) }, onTurnFailed, routeStop });
    ctx.route('a', event);
    ctx.route('gone', event);
    ctx.onTurnFailed('a');
    expect(routeStop).toHaveBeenCalledTimes(1);
    expect(routeStop).toHaveBeenCalledWith('a', { status: 'running' }, event);
    expect(onTurnFailed).toHaveBeenCalledWith('a');
  });
  it('runs and clears timers and logs with or without an error', () => {
    const ctx = createApiErrorDispatchCtx({ ptys: { getSession: () => undefined }, onTurnFailed: vi.fn(), routeStop: vi.fn() });
    const fn = vi.fn();
    const keep = ctx.setTimer(fn, 100);
    const drop = ctx.setTimer(fn, 100);
    ctx.clearTimer(drop);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    void keep;
    const log = vi.spyOn(console, 'log');
    ctx.log('plain');
    ctx.log('with error', new Error('boom'));
    expect(log).toHaveBeenNthCalledWith(1, 'plain');
    expect(log).toHaveBeenNthCalledWith(2, 'with error', expect.any(Error));
  });
  it('sends an error to the host error logger when one is given', () => {
    const logError = vi.fn();
    const log = vi.spyOn(console, 'log').mockClear();
    const ctx = createApiErrorDispatchCtx({ ptys: { getSession: () => undefined }, onTurnFailed: vi.fn(), routeStop: vi.fn(), logError });
    ctx.log('with error', new Error('boom'));
    ctx.log('plain');
    expect(logError).toHaveBeenCalledWith('with error', expect.any(Error));
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('apiErrorProducerLookup', () => {
  it('finds the producer through a live session, then a remembered one, else nothing', () => {
    const producer = { quietMs: 1, markTurnStart: vi.fn(), check: vi.fn(), release: vi.fn() };
    const producerForProfile = vi.fn((profile: string) => (profile === 'codex' ? producer : undefined));
    const lookup = apiErrorProducerLookup({
      ptys: { getSession: (id) => (id === 'live' ? { profile: 'codex' } : undefined), getRememberedSession: (id) => (id === 'old' ? { profile: 'claude' } : undefined) },
      producerForProfile
    });
    expect(lookup('live')).toBe(producer);
    expect(lookup('old')).toBeUndefined();
    expect(lookup('none')).toBeUndefined();
    expect(producerForProfile).toHaveBeenCalledWith('claude');
  });
});
