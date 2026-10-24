import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiErrorResume, handleApiErrorStop } from '../api-error-resume-wiring.js';

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
