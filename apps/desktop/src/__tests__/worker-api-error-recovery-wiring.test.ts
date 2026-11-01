import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_API_ERROR_RECOVERY_DEFAULTS as D } from '@zana-ai/zcc-server/services/execution/worker-api-error-recovery';
import {
  createWorkerApiErrorRecovery, routeApiErrorStop, squadEngineOwnsApiErrorStop, workerApiErrorRecoveryEnabled
} from '../worker-api-error-recovery-wiring.js';

const worker = { cohort: { role: 'worker', executionId: 'e1', slotId: 's1' } };
const fence = { claimId: 'c1', claimGeneration: 1 };

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function make(over: { config?: object; overrides?: Record<string, number>; session?: unknown; unit?: unknown } = {}) {
  const deps = {
    getConfig: vi.fn(() => over.config ?? { executionClaimRecoveryObserveEnabled: true, executionClaimRecoveryEnforceEnabled: true }),
    executionService: {
      findWorkerClaim: vi.fn(async () => ({ workUnitId: 'u1', ...fence })),
      redeliverClaim: vi.fn(async () => true),
      blockApiErrorToHuman: vi.fn(async () => true)
    },
    executionStore: {
      get: vi.fn(async () => ({ workUnits: [{ id: 'u0' }, { id: 'u1', apiErrorRecovery: over.unit }] })),
      recordWorkerRecovery: vi.fn(async () => undefined)
    },
    agentStatus: { get: vi.fn(() => 'idle') },
    ptys: { getSession: vi.fn(() => ('session' in over ? over.session : { id: 'w1' })) },
    workerInjector: { deliver: vi.fn(() => true) },
    restarter: { restart: vi.fn(async () => ({ ok: true as const })) },
    override: vi.fn((name: string) => over.overrides?.[name])
  };
  return { deps, engine: createWorkerApiErrorRecovery(deps as never) };
}

describe('workerApiErrorRecoveryEnabled', () => {
  it.each([
    [{}, false],
    [{ executionClaimRecoveryObserveEnabled: true }, false],
    [{ executionClaimRecoveryEnforceEnabled: true }, false],
    [{ executionClaimRecoveryObserveEnabled: true, executionClaimRecoveryEnforceEnabled: true }, true]
  ])('%j -> %s', (config, expected) => {
    expect(workerApiErrorRecoveryEnabled(config)).toBe(expected);
  });
});

describe('squadEngineOwnsApiErrorStop', () => {
  it.each([
    [worker, true, true],
    [worker, false, false],
    [{ cohort: { role: 'orchestrator', executionId: 'e1', slotId: 's1' } }, true, false],
    [{ cohort: { role: 'worker', slotId: 's1' } }, true, false],
    [{ cohort: { role: 'worker', executionId: 'e1' } }, true, false],
    [{}, true, false],
    [undefined, true, false],
    [null, true, false]
  ])('%j enabled=%s -> %s', (session, enabled, expected) => {
    expect(squadEngineOwnsApiErrorStop(session as never, enabled)).toBe(expected);
  });
});

describe('createWorkerApiErrorRecovery', () => {
  it('nudges a live session through the injector after the default delay', async () => {
    const { engine, deps } = make();
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '429' });
    expect(deps.executionStore.recordWorkerRecovery).toHaveBeenCalledWith('e1', expect.objectContaining({ step: 'waiting', slotId: 's1', workUnitId: 'u1', ...fence }));
    await vi.advanceTimersByTimeAsync(D.nudgeDelayMs - 1);
    expect(deps.workerInjector.deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.workerInjector.deliver).toHaveBeenCalledWith('w1', expect.stringContaining('`u1`'));
    expect(deps.executionStore.recordWorkerRecovery).toHaveBeenLastCalledWith('e1', expect.objectContaining({ step: 'nudged' }));
  });

  it('restarts, redelivers and blocks through the service when the nudge starts no turn', async () => {
    const { engine, deps } = make();
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '' });
    await vi.advanceTimersByTimeAsync(D.nudgeDelayMs + D.nudgeTurnMs);
    expect(deps.restarter.restart).toHaveBeenCalledWith('w1');
    expect(deps.executionService.redeliverClaim).toHaveBeenCalledWith('e1', 'u1', fence, 'w1', expect.stringContaining('restarted'));
    await vi.advanceTimersByTimeAsync(D.restartTurnMs);
    expect(deps.executionService.blockApiErrorToHuman).toHaveBeenCalledWith('e1', 'u1', fence);
  });

  it('reads the durable recovery of the unit and skips the nudge when it already nudged', async () => {
    const steps = [{ step: 'nudged', at: 1 }];
    const { engine, deps } = make({ unit: { ...fence, claimId: 'c1', claimGeneration: 1, steps } });
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '' });
    await vi.advanceTimersByTimeAsync(D.restartDelayMs);
    expect(deps.workerInjector.deliver).not.toHaveBeenCalled();
    expect(deps.restarter.restart).toHaveBeenCalled();
  });

  it('does not nudge a session that is gone', async () => {
    const { engine, deps } = make({ session: undefined });
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '' });
    await vi.advanceTimersByTimeAsync(D.nudgeDelayMs);
    expect(deps.workerInjector.deliver).not.toHaveBeenCalled();
  });

  it('is disabled by config and re-reads it per call', async () => {
    const { engine, deps } = make({ config: {} });
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '' });
    expect(deps.executionService.findWorkerClaim).not.toHaveBeenCalled();
  });

  it('applies E2E timing overrides and keeps the defaults for the rest', async () => {
    const { engine, deps } = make({ overrides: { ZCC_WORKER_API_ERROR_NUDGE_MS: 50, ZCC_WORKER_API_ERROR_NUDGE_TURN_MS: 60, ZCC_WORKER_API_ERROR_RESTART_DELAY_MS: 70, ZCC_WORKER_API_ERROR_RESTART_TURN_MS: 80 } });
    expect(deps.override).toHaveBeenCalledTimes(4);
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'rate_limit', text: '' });
    await vi.advanceTimersByTimeAsync(50);
    expect(deps.workerInjector.deliver).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(deps.restarter.restart).toHaveBeenCalled();
    const defaults = make();
    expect(defaults.deps.override).toHaveBeenCalledWith('ZCC_WORKER_API_ERROR_NUDGE_MS');
  });

  it('logs engine errors with and without a cause through console.log', async () => {
    const { engine, deps } = make();
    deps.executionService.findWorkerClaim.mockRejectedValueOnce(new Error('boom'));
    await engine.onApiErrorStop('w1', { executionId: 'e1', slotId: 's1' }, { error: 'x', text: '' });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.any(Error));
  });
});

describe('routeApiErrorStop', () => {
  function route(session: unknown, enabled: boolean) {
    const deps = {
      service: { onApiErrorStop: vi.fn(async () => undefined) },
      recovery: { onApiErrorStop: vi.fn(async () => undefined) },
      enabled: () => enabled,
      agentStatus: { turnFinished: vi.fn(), clearToolsInFlight: vi.fn() },
      logMainError: vi.fn()
    };
    const event = { error: 'rate_limit', text: 't', retryable: true };
    routeApiErrorStop(deps as never, 'w1', session as never, event);
    return { deps, event };
  }

  it('hands a Squad worker to the engine and keeps the resume service out', () => {
    const { deps, event } = route(worker, true);
    expect(deps.agentStatus.turnFinished).toHaveBeenCalledWith('w1');
    expect(deps.agentStatus.clearToolsInFlight).toHaveBeenCalledWith('w1');
    expect(deps.recovery.onApiErrorStop).toHaveBeenCalledWith('w1', { executionId: 'e1', slotId: 's1' }, event);
    expect(deps.service.onApiErrorStop).not.toHaveBeenCalled();
  });

  it.each([
    ['a plain session', {}, true],
    ['a worker while claim recovery is off', worker, false]
  ])('keeps the resume rules for %s', (_name, session, enabled) => {
    const { deps, event } = route(session, enabled);
    expect(deps.agentStatus.turnFinished).toHaveBeenCalledWith('w1');
    expect(deps.service.onApiErrorStop).toHaveBeenCalledWith('w1', event);
    expect(deps.recovery.onApiErrorStop).not.toHaveBeenCalled();
  });

  it('reports an engine rejection instead of throwing', async () => {
    const deps = {
      service: { onApiErrorStop: vi.fn() },
      recovery: { onApiErrorStop: vi.fn(async () => { throw new Error('bad'); }) },
      enabled: () => true,
      agentStatus: { turnFinished: vi.fn(), clearToolsInFlight: vi.fn() },
      logMainError: vi.fn()
    };
    routeApiErrorStop(deps as never, 'w1', worker as never, { error: 'x', text: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.logMainError).toHaveBeenCalledWith('worker-api-error-recovery', expect.any(Error));
  });
});
