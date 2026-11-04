import { WorkUnitRecoveryGuardError, type RecordWorkerRecoveryInput, type WorkerApiErrorRecovery as DurableRecovery, type WorkerRecoveryStep } from './store.js';

/**
 * Zana's ladder for a Squad engineer whose turn ended on an API error: nudge it, then
 * restart its session, then ask the user. Every collaborator is injected, so the ladder
 * is exercised with fake timers; the durable state lives on the work unit
 * (`apiErrorRecovery`) so each rung is tried once per claim even across turns. The timers are
 * in memory only: after an app restart mid-ladder nothing re-arms them, and once the durable
 * deadline passes the claim falls back to the ordinary lease and reclaim path.
 */
export const WORKER_API_ERROR_RECOVERY_DEFAULTS = {
  nudgeDelayMs: 30000, nudgeTurnMs: 90000, restartDelayMs: 60000, restartTurnMs: 120000
} as const;

/** Slack added to every recovery deadline so the lease sweep never reclaims a claim mid-ladder. */
const DEADLINE_SLACK_MS = 60000;
const RESTFUL_STATES = new Set(['idle', 'done', 'waiting']);
/** The engineer is visibly doing something, so it has recovered; nudging, restarting or blocking it would be wrong. */
const ACTIVE_STATES = new Set(['working', 'blocked']);

export type WorkerRecoveryTimings = { nudgeDelayMs: number; nudgeTurnMs: number; restartDelayMs: number; restartTurnMs: number };
type Fence = { claimId: string; claimGeneration: number };
type Claim = Fence & { workUnitId: string };
type RestartResult = { ok: true } | { ok: false; reason: string; message?: string };
type StepInput = Omit<RecordWorkerRecoveryInput, 'workUnitId' | 'claimId' | 'claimGeneration' | 'slotId'>;
type ApiErrorStop = { error: string; text: string; retryable?: boolean };

export interface WorkerApiErrorRecoveryDeps {
  enabled(): boolean;
  findClaim(executionId: string, slotId: string): Promise<Claim | undefined>;
  getRecovery(executionId: string, workUnitId: string): Promise<DurableRecovery | undefined> | DurableRecovery | undefined;
  record(executionId: string, input: RecordWorkerRecoveryInput): Promise<unknown>;
  getAgentState(sessionId: string): string | undefined;
  nudge(sessionId: string, text: string): Promise<unknown> | unknown;
  restart(sessionId: string): Promise<RestartResult>;
  redeliver(executionId: string, workUnitId: string, fence: Fence, sessionId: string, preface: string): Promise<unknown>;
  blockToHuman(executionId: string, workUnitId: string, fence: Fence): Promise<unknown>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  timings?: WorkerRecoveryTimings;
  log(message: string, error?: unknown): void;
}

interface Session extends Claim {
  executionId: string;
  slotId: string;
  /** In-flight transition: a turn that starts meanwhile is applied when it finishes. */
  busy: boolean;
  turnDuringTransition: boolean;
  restarting: boolean;
  /** The session was relaunched: its first turn may start from an unknown state (the old status was dropped at exit). */
  afterRestart: boolean;
  /** A rung that happened but is not recorded yet: a stop that replaces this session counts it as tried. */
  unrecorded?: 'nudged' | 'restarted';
  /** This session's own continuation is writing `unrecorded` now. */
  recording: boolean;
  /** A replacing stop took over writing `unrecorded`. */
  adopted: boolean;
  timer?: unknown;
  epoch: number;
}

const nudgedStep = (s: Session): StepInput => ({
  step: 'nudged', severity: 'info', summary: `Nudged engineer ${s.slotId} to continue work unit ${s.workUnitId} after an API error`
});
const restartedStep = (s: Session): StepInput => ({
  step: 'restarted', severity: 'info', summary: `Restarted engineer ${s.slotId} after an API error`
});

export class WorkerApiErrorRecovery {
  private readonly sessions = new Map<string, Session>();
  private readonly timings: WorkerRecoveryTimings;
  /** One counter for every session, so a replacement session never reuses an epoch a stale continuation holds. */
  private epochs = 0;

  constructor(private readonly deps: WorkerApiErrorRecoveryDeps) {
    this.timings = deps.timings ?? WORKER_API_ERROR_RECOVERY_DEFAULTS;
  }

  async onApiErrorStop(sessionId: string, cohort: { executionId: string; slotId: string }, event: ApiErrorStop): Promise<void> {
    try {
      if (!this.deps.enabled()) return;
      const claim = await this.deps.findClaim(cohort.executionId, cohort.slotId);
      if (!claim) return;
      const prior = this.sessions.get(sessionId);
      this.drop(sessionId);
      const s: Session = {
        ...claim, executionId: cohort.executionId, slotId: cohort.slotId, busy: true, turnDuringTransition: false,
        restarting: false, afterRestart: false, recording: false, adopted: false, epoch: ++this.epochs
      };
      this.sessions.set(sessionId, s);
      const steps = await this.triedSteps(sessionId, s, prior);
      if (!steps) return;
      await this.climb(sessionId, s, steps, event);
      if (this.sessions.get(sessionId) === s) {
        s.busy = false;
        if (s.turnDuringTransition) await this.resume(sessionId, s);
      }
    } catch (error) {
      this.deps.log(`Worker API-error recovery failed for ${sessionId}`, error);
    }
  }

  onTurnStarted(sessionId: string, priorState: string): void {
    try {
      const s = this.sessions.get(sessionId);
      if (!s || !(RESTFUL_STATES.has(priorState) || (s.afterRestart && priorState === 'unknown'))) return;
      if (s.busy) { s.turnDuringTransition = true; return; }
      void this.resume(sessionId, s);
    } catch (error) {
      this.deps.log(`Worker API-error recovery turn handling failed for ${sessionId}`, error);
    }
  }

  /** Drops a session unless its restart is in flight: the restart itself exits the session. */
  forget(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s?.restarting) return;
    this.drop(sessionId);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.drop(id);
  }

  /**
   * The rungs this claim's recovery has tried; undefined when the claim moved on. A stop can
   * arrive while the previous rung is still in flight (the nudge's own turn, or the restarted
   * session's first turn, failed before that rung was recorded): it counts as tried, and is
   * recorded exactly once, here or by its own continuation if that is already writing it.
   */
  private async triedSteps(sessionId: string, s: Session, prior: Session | undefined): Promise<WorkerRecoveryStep[] | undefined> {
    const recovery = await this.deps.getRecovery(s.executionId, s.workUnitId);
    const steps = recovery && recovery.claimId === s.claimId && recovery.claimGeneration === s.claimGeneration
      ? recovery.steps.map((entry) => entry.step) : [];
    if (!prior || prior.claimId !== s.claimId || prior.claimGeneration !== s.claimGeneration) return steps;
    const rung = prior.unrecorded;
    if (!rung || steps.includes(rung)) return steps;
    steps.push(rung);
    if (prior.recording) return steps;
    prior.adopted = true;
    return await this.record(sessionId, s, rung === 'nudged' ? nudgedStep(s) : restartedStep(s)) ? steps : undefined;
  }

  /**
   * Picks the next rung. A stop without `retryable` (a daemon that does not classify it) is treated
   * as temporary: a permanent error then fails again and ends in the same blocker.
   */
  private async climb(sessionId: string, s: Session, steps: WorkerRecoveryStep[], event: ApiErrorStop): Promise<void> {
    const kind = event.error;
    const base = { errorKind: kind, errorText: event.text, step: 'waiting' as const, severity: 'warning' as const };
    const { nudgeDelayMs, nudgeTurnMs, restartDelayMs, restartTurnMs } = this.timings;
    if (event.retryable === false) {
      const summary = `Engineer ${s.slotId} stopped on an API error Zana does not retry (${kind})`;
      if (await this.record(sessionId, s, { ...base, summary })) await this.block(sessionId, s);
    } else if (steps.includes('restarted')) {
      const summary = `Engineer ${s.slotId} stopped on another API error (${kind}) after Zana restarted it`;
      if (await this.record(sessionId, s, { ...base, summary })) await this.block(sessionId, s);
    } else if (steps.includes('nudged')) {
      const ok = await this.record(sessionId, s, {
        ...base, deadlineAt: this.deps.now() + restartDelayMs + restartTurnMs + DEADLINE_SLACK_MS,
        summary: `Engineer ${s.slotId} stopped on another temporary API error (${kind}); Zana will restart it in ${Math.round(restartDelayMs / 1000)} s`
      });
      if (ok) this.arm(sessionId, s, restartDelayMs, () => this.restartStep(sessionId, s.epoch));
    } else {
      const ok = await this.record(sessionId, s, {
        ...base, detail: event.text,
        deadlineAt: this.deps.now() + nudgeDelayMs + nudgeTurnMs + restartDelayMs + restartTurnMs + DEADLINE_SLACK_MS,
        summary: `Engineer ${s.slotId} stopped on a temporary API error (${kind}); Zana will nudge it in ${Math.round(nudgeDelayMs / 1000)} s`
      });
      if (ok) this.arm(sessionId, s, nudgeDelayMs, () => this.nudgeStep(sessionId, s.epoch));
    }
  }

  private drop(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) this.release(sessionId, s);
  }

  /** Retires one session object: its timer and continuations stop, and it leaves the map only while still mapped. */
  private release(sessionId: string, s: Session): void {
    s.epoch = ++this.epochs;
    if (s.timer !== undefined) this.deps.clearTimer(s.timer);
    s.timer = undefined;
    if (this.sessions.get(sessionId) === s) this.sessions.delete(sessionId);
  }

  private arm(sessionId: string, s: Session, ms: number, fn: () => Promise<void>): void {
    if (s.timer !== undefined) this.deps.clearTimer(s.timer);
    s.epoch = ++this.epochs;
    const epoch = s.epoch;
    s.timer = this.deps.setTimer(() => {
      if (this.sessions.get(sessionId) !== s || s.epoch !== epoch) return;
      s.timer = undefined;
      void fn().catch((error) => this.deps.log(`Worker API-error recovery timer failed for ${sessionId}`, error));
    }, ms);
  }

  private async sameFence(s: Session): Promise<boolean> {
    const claim = await this.deps.findClaim(s.executionId, s.slotId);
    return claim?.claimId === s.claimId && claim.claimGeneration === s.claimGeneration && claim.workUnitId === s.workUnitId;
  }

  /** Records one step; false (and the session released) when the claim moved on. */
  private async record(sessionId: string, s: Session, input: StepInput): Promise<boolean> {
    try {
      await this.deps.record(s.executionId, { ...input, workUnitId: s.workUnitId, claimId: s.claimId, claimGeneration: s.claimGeneration, slotId: s.slotId });
      return true;
    } catch (error) {
      if (error instanceof WorkUnitRecoveryGuardError) { this.release(sessionId, s); return false; }
      throw error;
    }
  }

  /**
   * Records the rung this continuation just tried, even when a new stop replaced the session
   * meanwhile, unless that stop took the record over or the session is gone. True when written.
   */
  private async recordOwnRung(sessionId: string, s: Session, epoch: number, input: StepInput): Promise<boolean> {
    if (s.adopted || this.retired(sessionId, epoch)) { s.unrecorded = undefined; return false; }
    s.recording = true;
    try {
      return await this.record(sessionId, s, input);
    } finally {
      s.recording = false;
      s.unrecorded = undefined;
    }
  }

  private async block(sessionId: string, s: Session): Promise<void> {
    this.release(sessionId, s);
    await this.deps.blockToHuman(s.executionId, s.workUnitId, { claimId: s.claimId, claimGeneration: s.claimGeneration });
  }

  private async resume(sessionId: string, s: Session): Promise<void> {
    this.release(sessionId, s);
    try {
      await this.deps.record(s.executionId, {
        workUnitId: s.workUnitId, claimId: s.claimId, claimGeneration: s.claimGeneration, slotId: s.slotId,
        step: 'resumed', severity: 'info', summary: `Engineer ${s.slotId} resumed work unit ${s.workUnitId} after an API error`
      });
    } catch (error) {
      if (!(error instanceof WorkUnitRecoveryGuardError)) this.deps.log(`Worker API-error recovery resume failed for ${sessionId}`, error);
    }
  }

  private live(sessionId: string, epoch: number): Session | undefined {
    const s = this.sessions.get(sessionId);
    return s && s.epoch === epoch ? s : undefined;
  }

  /** Dropped and not replaced: the session exited or the claim moved on, so nothing is left to record. */
  private retired(sessionId: string, epoch: number): boolean {
    return !this.live(sessionId, epoch) && !this.sessions.has(sessionId);
  }

  /**
   * Common entry of every timer rung: the session must still be this one, the claim fence must hold,
   * and the engineer must not already have started a turn. A turn that began meanwhile (or a worker
   * that is visibly working) counts as resumed. Returns the session only when the rung may act.
   */
  private async enter(sessionId: string, epoch: number): Promise<Session | undefined> {
    const s = this.live(sessionId, epoch);
    if (!s) return undefined;
    s.busy = true;
    if (!await this.sameFence(s)) { this.release(sessionId, s); return undefined; }
    if (!this.live(sessionId, epoch)) return undefined;
    const state = this.deps.getAgentState(sessionId);
    if (s.turnDuringTransition || (state !== undefined && ACTIVE_STATES.has(state))) {
      await this.resume(sessionId, s);
      return undefined;
    }
    return s;
  }

  private async nudgeStep(sessionId: string, epoch: number): Promise<void> {
    const s = await this.enter(sessionId, epoch);
    if (!s) return;
    const state = this.deps.getAgentState(sessionId);
    if (state === undefined || !RESTFUL_STATES.has(state)) {
      // Text typed into an engineer in an unreadable state could land anywhere; a restart needs no resting state.
      this.deps.log(`Worker API-error recovery did not nudge ${sessionId} (state ${state ?? 'unavailable'}); restarting it instead`);
      this.skipToRestart(sessionId, s);
      return;
    }
    s.unrecorded = 'nudged';
    let nudged: unknown = false;
    try {
      nudged = await this.deps.nudge(sessionId, `The previous request failed with a temporary API error. Continue with your current assignment, work unit \`${s.workUnitId}\`.`);
    } catch (error) {
      this.deps.log(`Worker API-error recovery nudge failed for ${sessionId}`, error);
    }
    if (nudged === false) {
      // The text never reached the engineer (no live terminal, or the call failed): go straight to the restart.
      s.unrecorded = undefined;
      if (this.live(sessionId, epoch)) this.skipToRestart(sessionId, s);
      return;
    }
    if (!await this.recordOwnRung(sessionId, s, epoch, nudgedStep(s)) || !this.live(sessionId, epoch)) return;
    s.busy = false;
    if (s.turnDuringTransition) { await this.resume(sessionId, s); return; }
    this.arm(sessionId, s, this.timings.nudgeTurnMs, () => this.restartStep(sessionId, s.epoch));
  }

  private skipToRestart(sessionId: string, s: Session): void {
    s.busy = false;
    this.arm(sessionId, s, 0, () => this.restartStep(sessionId, s.epoch));
  }

  private async restartStep(sessionId: string, epoch: number): Promise<void> {
    const s = await this.enter(sessionId, epoch);
    if (!s) return;
    s.restarting = true;
    let result: RestartResult;
    try {
      result = await this.deps.restart(sessionId);
    } catch (error) {
      result = { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally { s.restarting = false; }
    if (!this.live(sessionId, epoch)) return;
    if (!result.ok) { await this.restartFailed(sessionId, s, `Could not restart engineer ${s.slotId}: ${result.message ?? result.reason}`); return; }
    s.afterRestart = true;
    s.unrecorded = 'restarted';
    let delivered: unknown = false;
    try {
      delivered = await this.deps.redeliver(s.executionId, s.workUnitId, { claimId: s.claimId, claimGeneration: s.claimGeneration }, sessionId,
        'Zana restarted your session after an API error. Continue with this assignment.');
    } catch (error) {
      this.deps.log(`Worker API-error recovery redelivery failed for ${sessionId}`, error);
    }
    if (delivered === false && this.live(sessionId, epoch)) {
      s.unrecorded = undefined;
      await this.restartFailed(sessionId, s, `Restarted engineer ${s.slotId} but could not deliver work unit ${s.workUnitId} again`);
      return;
    }
    // A relaunch can take tens of seconds, so the lease deadline restarts from here.
    if (!await this.recordOwnRung(sessionId, s, epoch, {
      ...restartedStep(s), deadlineAt: this.deps.now() + this.timings.restartTurnMs + DEADLINE_SLACK_MS,
      summary: `Restarted engineer ${s.slotId} after an API error and delivered work unit ${s.workUnitId} again`
    }) || !this.live(sessionId, epoch)) return;
    s.busy = false;
    if (s.turnDuringTransition) { await this.resume(sessionId, s); return; }
    this.arm(sessionId, s, this.timings.restartTurnMs, async () => {
      const entered = await this.enter(sessionId, s.epoch);
      if (entered) await this.block(sessionId, entered);
    });
  }

  /** The restart (or the redelivery after it) did not work: say so, then ask the user while the claim still stands. */
  private async restartFailed(sessionId: string, s: Session, summary: string): Promise<void> {
    if (!await this.record(sessionId, s, { step: 'restart-failed', severity: 'warning', summary })) return;
    if (await this.sameFence(s)) await this.block(sessionId, s); else this.release(sessionId, s);
  }
}
