/**
 * Host wiring for Squad worker API-error recovery (issue #416). Kept out of
 * host.ts so the collaborators are injectable and unit-testable; host.ts only
 * constructs the engine and forwards events.
 */
import {
  WORKER_API_ERROR_RECOVERY_DEFAULTS,
  WorkerApiErrorRecovery,
  type WorkerApiErrorRecoveryDeps
} from '@zana-ai/zcc-server/services/execution/worker-api-error-recovery';
import type { ApiErrorResumeService } from '@zana-ai/zcc-server/services/followups/api-error-resume';
import { handleApiErrorStop, type ApiErrorResumeWiringDeps } from './api-error-resume-wiring.js';

type Fence = { claimId: string; claimGeneration: number };

export interface WorkerApiErrorRecoveryWiringDeps {
  getConfig: () => { executionClaimRecoveryObserveEnabled?: boolean; executionClaimRecoveryEnforceEnabled?: boolean };
  executionService: {
    findWorkerClaim: WorkerApiErrorRecoveryDeps['findClaim'];
    redeliverClaim: (executionId: string, workUnitId: string, fence: Fence, sessionId: string, preface: string) => Promise<boolean>;
    blockApiErrorToHuman: (executionId: string, workUnitId: string, fence: Fence) => Promise<boolean>;
  };
  executionStore: {
    get: (executionId: string) => Promise<{ workUnits?: Array<{ id: string; apiErrorRecovery?: unknown }> } | undefined>;
    recordWorkerRecovery: WorkerApiErrorRecoveryDeps['record'];
  };
  agentStatus: { get: (sessionId: string) => string };
  ptys: { getSession: (sessionId: string) => unknown };
  workerInjector: { deliver: (sessionId: string, text: string) => boolean };
  restarter: { restart: WorkerApiErrorRecoveryDeps['restart'] };
  /** E2E-only timing override by env name; undefined keeps the production default. */
  override: (name: string) => number | undefined;
}

/** True while the durable claim-recovery sweep is enforced: the ladder relies on its lease renewal. */
export function workerApiErrorRecoveryEnabled(config: ReturnType<WorkerApiErrorRecoveryWiringDeps['getConfig']>): boolean {
  return config.executionClaimRecoveryObserveEnabled === true && config.executionClaimRecoveryEnforceEnabled === true;
}

export function createWorkerApiErrorRecovery(deps: WorkerApiErrorRecoveryWiringDeps): WorkerApiErrorRecovery {
  const d = WORKER_API_ERROR_RECOVERY_DEFAULTS;
  return new WorkerApiErrorRecovery({
    enabled: () => workerApiErrorRecoveryEnabled(deps.getConfig()),
    findClaim: (executionId, slotId) => deps.executionService.findWorkerClaim(executionId, slotId),
    getRecovery: async (executionId, workUnitId) => {
      const record = await deps.executionStore.get(executionId);
      return record?.workUnits?.find((unit) => unit.id === workUnitId)?.apiErrorRecovery as never;
    },
    record: (executionId, input) => deps.executionStore.recordWorkerRecovery(executionId, input),
    getAgentState: (sessionId) => deps.agentStatus.get(sessionId),
    nudge: (sessionId, text) => (deps.ptys.getSession(sessionId) ? deps.workerInjector.deliver(sessionId, text) : false),
    restart: (sessionId) => deps.restarter.restart(sessionId),
    redeliver: (executionId, workUnitId, fence, sessionId, preface) =>
      deps.executionService.redeliverClaim(executionId, workUnitId, fence, sessionId, preface),
    blockToHuman: (executionId, workUnitId, fence) => deps.executionService.blockApiErrorToHuman(executionId, workUnitId, fence),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    timings: {
      nudgeDelayMs: deps.override('ZCC_WORKER_API_ERROR_NUDGE_MS') ?? d.nudgeDelayMs,
      nudgeTurnMs: deps.override('ZCC_WORKER_API_ERROR_NUDGE_TURN_MS') ?? d.nudgeTurnMs,
      restartDelayMs: deps.override('ZCC_WORKER_API_ERROR_RESTART_DELAY_MS') ?? d.restartDelayMs,
      restartTurnMs: deps.override('ZCC_WORKER_API_ERROR_RESTART_TURN_MS') ?? d.restartTurnMs
    },
    log: (line, error) => (error === undefined ? console.log(line) : console.log(line, error))
  });
}

type SessionLike = { cohort?: { role?: string; executionId?: string; slotId?: string } } | null | undefined;

/** A live Squad worker with a bound slot is recovered by the engine, not by the generic resume rules. */
export function squadEngineOwnsApiErrorStop(session: SessionLike, enabled: boolean): boolean {
  const cohort = session?.cohort;
  return enabled && cohort?.role === 'worker' && !!cohort.executionId && !!cohort.slotId;
}

export interface RouteApiErrorStopDeps extends Pick<ApiErrorResumeWiringDeps, 'agentStatus' | 'logMainError'> {
  service: ApiErrorResumeService;
  recovery: Pick<WorkerApiErrorRecovery, 'onApiErrorStop'>;
  enabled: () => boolean;
}

/** Ends the turn like a Stop, then hands the error to the engine for a Squad worker, else to the resume rules. */
export function routeApiErrorStop(
  deps: RouteApiErrorStopDeps,
  sessionId: string,
  session: SessionLike,
  event: { error: string; text: string; retryable?: boolean }
): void {
  if (!squadEngineOwnsApiErrorStop(session, deps.enabled())) {
    handleApiErrorStop(deps, sessionId, event);
    return;
  }
  handleApiErrorStop({ agentStatus: deps.agentStatus, logMainError: deps.logMainError }, sessionId, event);
  const cohort = session!.cohort!;
  void deps.recovery.onApiErrorStop(sessionId, { executionId: cohort.executionId!, slotId: cohort.slotId! }, event)
    .catch((err) => deps.logMainError('worker-api-error-recovery', err));
}
