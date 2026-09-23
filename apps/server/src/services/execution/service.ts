import { isDurableCoordination, isRestfulAgentState, type AgentState, type ExecutionFailureCode, type ExecutionSourceSnapshot, type SessionStats, type SquadBundleWorkflowMetadataV1, type TeamCoordinationMode, type TeamLaunchAuthorizationInputSlot, type TeamLaunchAuthorizationResult, type TeamLaunchRequestInput } from '@zana-ai/zcc-domain/product';
import { createHash } from 'node:crypto';
import { launchDigest } from '../launch/digest.js';
import { EXECUTION_RETENTION_MS, KICKOFF_FAILURE_BLOCK_THRESHOLD, WORK_CLAIM_LEASE_MS, type ActiveClaimCursor, type ExecutionCohortAuthority, type ExecutionDispatchAssignment, type ExecutionEvent, type ExecutionLaunchDisplayV1, type ExecutionLaunchKind, type ExecutionPolicyV1, type ExecutionRecord, type ExecutionWorkUnitInput, type ResolvedModelSnapshotV1 } from './store.js';
import type { createExecutionStore } from './store.js';
import type { ExecutionArtifactRecord, createExecutionArtifactStore } from './artifact-store.js';
import { validateWorkflowPolicyResult, type WorkflowPolicyResultV1 } from './policy-result.js';
import { isResumeGrantTerminal, type createResumeGrantStore } from './resume-grant-store.js';
import type { createExecutionSourceRegistry } from './source-registry.js';
import { buildInboxQuestion } from '../inbox/inbox-question-schema.js';
import type { InboxInput } from '../inbox/inbox-store.js';
import { ExecutionDeadlineWatchdog, executionProgressAnchor } from './deadline-watchdog.js';
import { PlanReadinessWatchdog } from './plan-readiness-watchdog.js';
import { evaluateTeamAdmission, type TeamAdmissionInput, type TeamAdmissionResultV1 } from '../launch/preflight.js';
import { evaluateSlotEligibility } from './routing-policy.js';
import { transitionCircuit, type CircuitState } from './retry-policy.js';
import { usageCursorIdentity, usageRollup, validateStructuredJson, validateStructuredResult, type ExecutionUsageObservationV1, type UsageSampleKind } from './contracts.js';

/** Wall-clock ceiling for a single bounded snapshot read. */
const SNAPSHOT_TIMEOUT_MS = 15_000;
/** Hard cap on event pages walked per snapshot (Rule 5: bound unbounded reads). */
const MAX_SNAPSHOT_EVENT_PAGES = 1_000;
const AUTO_FINALIZE_RETRY_MS = 1_000;
const ROUTE_FACTS_TIMEOUT_MS = 15_000;
const ROUTE_FACTS_CIRCUIT_RESET_MS = 30_000;
const ACTIVE_CLAIM_PAGE_SIZE = 50;
const PROVEN_DEAD_CLAIM_REASON = 'Claim lease expired and assigned Team worker is proven dead';
/**
 * How long a `'coordinator'` self-heal blocker may sit unanswered before the
 * sweep escalates it to a human (inbox + `audience` flip). Generous on purpose:
 * the coordinator wake retries on EVERY idle edge (drainCoordinatorWake), so a
 * coordinator that can self-heal answers well inside this window; only a
 * genuinely stuck/parked coordinator reaches the escalation.
 */
const COORDINATOR_BLOCKER_ESCALATE_MS = 5 * 60_000;
/**
 * How long a coordinator wake may sit unqueued against an `unknown`-state
 * coordinator before it is delivered anyway. A remote/opencode coordinator with
 * no mesh dot resolves to `unknown` permanently, so a hard "wait for restful"
 * block would strand the wake forever; a modest bound clears a transient startup
 * `unknown` first (below the reconcile cadence so the next tick delivers). See
 * {@link SquadExecutionService.drainCoordinatorWake}.
 */
const COORDINATOR_WAKE_UNKNOWN_STALE_MS = 20_000;
const AGENT_DEAD_CLAIM_REASON = 'Claim reclaimed: worker shell/wrapper is alive but its inner agent is dead';
const SILENT_WORKER_CLAIM_REASON = 'Claim lease expired with no worker output for a full lease window';
const STALLED_WORKER_CLAIM_REASON = 'Claim reclaimed: worker alive but produced no output progress within the stall limit';
const DEAD_WORKER_PROCESSES = new Set(['exited', 'spawn-failed', 'canceled']);
const TELEMETRY_GAP_GRACE_SAMPLES = 3;

/**
 * Inner-agent liveness verdict, distinct from the outer `worker.process` shell state.
 * `'dead'` = the wrapper survives but the agent process is gone (a remote-opencode
 * zombie); `'alive'` = the agent is confirmed running; `'unknown'` = no probe / the
 * provider cannot report it, treated as the pre-existing renew-from-state behaviour.
 */
export type WorkerLiveness = 'alive' | 'dead' | 'unknown';

/**
 * Default wall-clock ceiling for a single durable work-unit claim (~20 min, generous).
 *
 * Durable job/structured/freeform workers never call `execution.work.heartbeat` — the worker
 * prompt omits it and an LLM cannot renew a lease mid-turn — so every claim's 90s lease
 * (WORK_CLAIM_LEASE_MS) expires while the worker is still alive. `reconcileActive` then only
 * reclaims a live-but-expired claim when the worker's detected agent-state is restful; a worker
 * stuck 'working'/'unknown' is never reclaimed AND its idle-gated assignment is never flushed
 * → permanent freeze (live run df216947, a 'structured' run frozen 224s past lease at turn 0).
 * The one state-agnostic escape is the wall-clock backstop in `reconcileActive`, but it is dead
 * unless `maxClaimWallClockMs` is set — no host/server default, and the coordinator prompt never
 * sets it. This default revives it so a stuck claim is force-reclaimed regardless of state.
 *
 * Blunt by design: it fires on wall-clock-since-claim regardless of whether the worker ever
 * emitted output, so it is only the LAST resort. The progress-aware {@link
 * DEFAULT_DURABLE_CLAIM_STALL_MS} ceiling below reclaims a silent-but-'working' worker sooner
 * without endangering a streaming one (whose output keeps its lease — and stall clock — fresh).
 */
const DEFAULT_DURABLE_CLAIM_WALL_CLOCK_MS = 20 * 60_000;

/**
 * Default OUTPUT-stall ceiling for a durable work-unit claim (~10 min), tighter than the blunt
 * wall-clock backstop above. Reached only after a claim's lease has ALREADY expired (a full lease
 * window with no worker output) AND the worker is still alive + non-restful — the exact case
 * `reconcileActive` used to renew forever from agent-state, freezing a run behind a stuck worker
 * until the 20-min wall-clock hit (live run b1bd2906: a lone CLAIMED unit, worker alive but not
 * progressing). Measured from `progressAt` (last real output), NOT `claimedAt`, so a worker that
 * streamed then hung is caught 10 min after it went silent, and a still-streaming worker (fresh
 * `progressAt`) is never reclaimed here.
 */
const DEFAULT_DURABLE_CLAIM_STALL_MS = 10 * 60_000;

/**
 * Inject the durable-claim reclaim ceilings (wall-clock backstop + progress-aware stall) into a
 * launch policy for a durable worker-DAG coordination mode (job-team / structured / freeform)
 * when the caller left them unset. Pure: returns the policy unchanged for non-durable
 * (interactive / autonomous chat) modes or when BOTH ceilings are already present, so a
 * caller-set ceiling always wins.
 */
export function withDurableClaimWallClockBackstop(
  mode: TeamCoordinationMode | undefined,
  policy: ExecutionPolicyV1 | undefined
): ExecutionPolicyV1 | undefined {
  if (!isDurableCoordination(mode)) return policy;
  if (policy?.maxClaimWallClockMs !== undefined && policy.maxClaimStallMs !== undefined) return policy;
  const next = { ...(policy ?? {}) };
  if (next.maxClaimWallClockMs === undefined) next.maxClaimWallClockMs = DEFAULT_DURABLE_CLAIM_WALL_CLOCK_MS;
  if (next.maxClaimStallMs === undefined) next.maxClaimStallMs = DEFAULT_DURABLE_CLAIM_STALL_MS;
  return next;
}

function sessionUsageCounters(stats: SessionStats | null): ExecutionUsageObservationV1['cumulative'] {
  return stats?.tokens || stats?.costUsd !== undefined ? {
    ...(stats?.tokens ? {
      inputTokens: stats.tokens.input, outputTokens: stats.tokens.output,
      cacheReadTokens: stats.tokens.cacheRead, cacheWriteTokens: stats.tokens.cacheWrite
    } : {}),
    ...(stats?.costUsd === undefined ? {} : { providerCostUsd: stats.costUsd })
  } : {};
}

function usageCompleteness(stats: SessionStats | null, budget?: { maxTokens?: number; maxUsd?: number }) {
  const requiresCost = budget?.maxUsd !== undefined;
  const requiresTokens = budget?.maxTokens !== undefined;
  return requiresTokens && !stats?.tokens || requiresCost && stats?.costUsd === undefined ? 'partial' as const
    : !stats?.tokens && stats?.costUsd === undefined ? 'unavailable' as const : 'complete' as const;
}

function latestUsageObservation(record: ExecutionRecord, identity: string): ExecutionUsageObservationV1 | undefined {
  let latest: ExecutionUsageObservationV1 | undefined;
  for (const observation of record.usageObservations ?? []) {
    if (usageCursorIdentity(observation) !== identity) continue;
    if (!latest || observation.adapterEpoch > latest.adapterEpoch
      || observation.adapterEpoch === latest.adapterEpoch && observation.sequence > latest.sequence) latest = observation;
  }
  return latest;
}

function matchingUsageObservation(
  record: ExecutionRecord,
  matches: (observation: ExecutionUsageObservationV1) => boolean
): ExecutionUsageObservationV1 | undefined {
  const observations = record.usageObservations ?? [];
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (matches(observations[index])) return observations[index];
  }
  return undefined;
}

export interface ExecutionCohortBinding extends ExecutionCohortAuthority {
  executionId: string;
  projectId: string;
  principalId?: string;
  authorizationId?: string;
}

export interface ExecutionRequestV1 {
  version: 1;
  /** Omitted by legacy callers; current Team backend is default. */
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  teamId: string;
  launchRequestId: string;
  jobTitle?: string;
  objective?: string;
  summary?: string;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: TeamLaunchRequestInput['policy'];
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels?: ResolvedModelSnapshotV1[];
  sourceBundle?: {
    contentRef: string;
    sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>;
  };
  workUnits?: ExecutionWorkUnitInput[];
  coordinationMode?: import('@zana-ai/zcc-domain/product').TeamCoordinationMode;
  origin?: import('@zana-ai/zcc-domain/product').LaunchOrigin;
}

/** @deprecated Use ExecutionRequestV1. Retained for Team backend callers. */
export type SquadExecutionRequestV1 = ExecutionRequestV1;

export interface ExecutionServiceDeps {
  store: ReturnType<typeof createExecutionStore>;
  artifacts: ReturnType<typeof createExecutionArtifactStore>;
  sources?: Pick<ReturnType<typeof createExecutionSourceRegistry>, 'list' | 'read'> & Partial<Pick<ReturnType<typeof createExecutionSourceRegistry>, 'pruneSnapshots'>>;
  authorizeTeamLaunch: (
    callerPrincipalId: string,
    teamId: string,
    projectId: string,
    launchRequestId: string,
    policy: NonNullable<TeamLaunchRequestInput['policy']>,
    slots: TeamLaunchAuthorizationInputSlot[],
    coordinationMode?: ExecutionRequestV1['coordinationMode'],
    admissionDigest?: string
  ) => Promise<{ ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string }> | { ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string };
  launchTeam: (teamId: string, projectId: string, request: TeamLaunchRequestInput) => Promise<{ ok: boolean; code?: string; message?: string }>;
  getTeamLaunch: (callerPrincipalId: string, launchRequestId: string) => Promise<unknown>;
  cancelTeamLaunch: (callerPrincipalId: string, launchRequestId: string) => Promise<{
    ok: boolean;
    code?: string;
    message?: string;
    value?: { canceledSessionIds: string[]; pendingSessionIds: string[] };
  }>;
  revokeTeamAuthorizations?: (authorizationIds: readonly string[]) => void | Promise<void>;
  replyToSession: (sessionId: string, text: string) => boolean;
  /**
   * Idle-gated variant of {@link replyToSession} used ONLY for engine-cascade
   * assignment pushes. The cascade dispatches a newly-ready unit the instant a
   * worker COMPLETES its previous one — but at that instant the worker is still
   * mid-turn (its `execution.work.complete` call hasn't returned), so a raw
   * `reply()` injects the next task into a busy TUI and wedges it. This variant
   * queues the text and flushes it on the worker's next transition INTO idle
   * (delivering immediately when the worker is already idle). Falls back to
   * {@link replyToSession} when the host doesn't wire it (tests / mesh-less).
   */
  deliverToWorker?: (sessionId: string, text: string) => boolean;
  triggerDeliveryDrain?: (sessionId: string) => void;
  logError?: (message: string, error: unknown) => void;
  inbox?: { append: (input: InboxInput) => Promise<unknown> };
  preflightWorkflow?: (teamId: string, workflow: SquadBundleWorkflowMetadataV1) => { ok: boolean; code?: string; message?: string };
  admissionInput?: (projectId: string, request: ExecutionRequestV1) => Promise<TeamAdmissionInput> | TeamAdmissionInput;
  /** Main-owned snapshot resolver. Agent/renderer model claims never authorize routing. */
  resolveTeamModelSnapshots?: (projectId: string, request: Pick<ExecutionRequestV1, 'teamId' | 'slots'>) => Promise<ResolvedModelSnapshotV1[]> | ResolvedModelSnapshotV1[];
  routingEnforcementEnabled?: () => boolean;
  claimRecoveryObserveEnabled?: () => boolean;
  claimRecoveryEnforceEnabled?: () => boolean;
  /** Grace (ms) a durable execution may stay planless before the watchdog fails it. `0`/absent disables. */
  planStartupGraceMs?: () => number;
  /** Main-owned agent status used to detect a live process whose assigned turn ended silently. */
  getAgentState?: (sessionId: string) => AgentState;
  /**
   * Main-owned INNER-agent liveness, distinct from the outer `worker.process` (the
   * shell/tmux wrapper) and from {@link getAgentState} (the OSC/screen status). A
   * remote worker's outer ssh/tmux wrapper stays `process:'running'` after the inner
   * agent (e.g. opencode) exits, and a hook-less/OSC-less harness then reads
   * `getAgentState` as `'unknown'` forever — so `reconcileActive` would RENEW the
   * claim into a zombie while every redispatch re-types the assignment into the
   * surviving bash shell (infinite redeliver-into-dead-shell loop; the remote-opencode
   * stall). This is the ONLY signal that can distinguish "shell alive, agent dead":
   * a provider that can probe its own agent liveness (opencode session list) reports
   * `'dead'`; providers that cannot report `'unknown'`, which is treated exactly like
   * the pre-existing behaviour (renew from state / stall ceilings). Rule 6: the
   * concrete probe lives in the provider + host; core only consumes the verdict.
   */
  getWorkerLiveness?: (sessionId: string) => WorkerLiveness;
  /**
   * Main-owned close of a worker session whose INNER agent is proven `dead` (see
   * {@link getWorkerLiveness}). Reclaiming/releasing the dead claim alone leaves
   * the worker's surviving OUTER shell/tmux wrapper LIVE on the (remote) box — a
   * zombie that burns CPU until app quit→boot. The captured-PID reap and the boot
   * orphan-reap CANNOT catch it: the sentinel PID is the inner agent's and has
   * already exited, while the surviving wrapper shell has a DIFFERENT pid. Only
   * `tmux kill-session` reaps it — routed via the host's `closeExpected`, whose
   * `killRemoteTmux` SIGHUPs the pane (honored by a bare login shell, unlike
   * opencode). Best-effort + main-authoritative: the host maps the id to
   * `PtyManager.closeExpected(sessionId)`; core only asks. Absent in tests /
   * mesh-less — a no-op there keeps existing behaviour.
   */
  closeWorkerSession?: (sessionId: string) => void;
  routeFitObserveEnabled?: () => boolean;
  /** Main-owned TranscriptSource bridge. Renderer and agents cannot submit usage. */
  readSessionStats?: (sessionId: string, options?: { fresh?: boolean }) => Promise<SessionStats | null>;
  resumeGrants?: ReturnType<typeof createResumeGrantStore>;
  hasLivePredecessor?: (projectId: string, ownerPrincipalIds: readonly string[]) => boolean;
  clearResumeToken?: (projectId: string, executionId: string) => void | Promise<void>;
  cacheResumeToken?: (projectId: string, executionId: string, token: string, expiresAt: number) => void | Promise<void>;
  monotonicNow?: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /**
   * E2E-only transient dispatch fault injector. When it returns `true` for an
   * execution, the current assignment batch is released undelivered instead of
   * pushed — reproducing the 0-CLAIMED / all-READY wedge so the
   * {@link redispatchStalled} recovery sweep is exercised end-to-end. Home-gated
   * in host (`ZCC_E2E_STALL_FIRST_DISPATCH` under `ZCC_E2E_HOME`); ABSENT in
   * production, so real dispatch behaviour is byte-unchanged.
   */
  stallFirstDispatch?: (executionId: string) => boolean;
}

function withoutDefaultLaunchKind(request: ExecutionRequestV1): ExecutionRequestV1 {
  if (request.launchKind !== 'team') return request;
  const { launchKind: _launchKind, launchDisplay: _launchDisplay, ...legacyShape } = request;
  return legacyShape;
}

export class ExecutionSnapshotTimeoutError extends Error {
  constructor() {
    super('Snapshot exceeded 15-second budget');
  }
}

interface ExtractedLifecycle {
  orchestratorSessionId?: string;
  orchestratorAuthorizationId?: string;
  workers?: Array<{
    slotId?: string;
    sessionId?: string;
    authorizationId?: string;
    projectId?: string;
    process?: string;
    task?: string;
    exitCode?: number;
    exitSignal?: number;
    exitReason?: string;
  }>;
  launchResult?: {
    failedSlots?: unknown[];
    orchestratorSessionId?: string;
  };
  outcome?: {
    status?: string;
    result?: { ok?: boolean; message?: string };
  };
}

function extractLifecycleInfo(lifecycle: any): ExtractedLifecycle | undefined {
  if (!lifecycle) return undefined;
  const launchResult = lifecycle.launchResult;
  const orchestratorSessionId = launchResult?.orchestratorSessionId || lifecycle.orchestratorSessionId;

  const workers = lifecycle.workers || launchResult?.workers;
  const orchestratorWorker = workers?.find((w: any) => w.slotId === 'orchestrator' || w.slotId?.startsWith('orchestrator:'));
  const orchestratorAuthorizationId = orchestratorWorker?.authorizationId || lifecycle.orchestratorAuthorizationId;

  return {
    orchestratorSessionId,
    orchestratorAuthorizationId,
    workers: lifecycle.workers,
    launchResult: lifecycle.launchResult,
    outcome: lifecycle.outcome
  };
}

/** Per-dependency result char budget spliced into a dependent unit's assignment
 *  text (Rule 5 bound) — a chosen label fits; a whole upstream document won't be
 *  pasted into the task prompt. Mirrors the projection's `MAX_UNIT_RESULT_CHARS`. */
export const MAX_DEP_RESULT_CHARS = 2_048;

/** Summary stamped when the engine auto-finalizes a fully-completed DAG that the
 *  orchestrator never explicitly closed. A later coordinator execution.complete
 *  is a graceful no-op (the record is already terminal), so this is the floor. */
export const AUTO_FINALIZE_SUMMARY = 'All work units completed; execution finalized automatically by the engine.';
export const AUTO_FAIL_SUMMARY = 'All runnable work settled; execution failed automatically by the engine.';
const TERMINAL_SUMMARY_MAX_CHARS = 64 * 1024;
const TERMINAL_SUMMARY_ITEM_MAX_CHARS = 2_048;

export class KeyedColdStartSemaphore {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly permitsPerKey = 1) {
    if (!Number.isInteger(permitsPerKey) || permitsPerKey < 1) throw new Error('invalid semaphore permit count');
  }

  async acquire(
    key: string,
    canceled: () => Promise<boolean> | boolean = () => false,
    timeoutMs = 30_000
  ): Promise<(() => void) | undefined> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      let isCanceled: boolean;
      try {
        isCanceled = await canceled();
      } catch (error) {
        this.wakeNext(key);
        throw error;
      }
      if (isCanceled || Date.now() >= deadline) {
        this.wakeNext(key);
        return undefined;
      }
      const active = this.active.get(key) ?? 0;
      if (active < this.permitsPerKey) {
        this.active.set(key, active + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const nextActive = (this.active.get(key) ?? 1) - 1;
          if (nextActive > 0) this.active.set(key, nextActive); else this.active.delete(key);
          this.wakeNext(key);
        };
      }
      const woke = await new Promise<boolean>((resolve) => {
        const queue = this.waiters.get(key) ?? [];
        let settled = false;
        const wake = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const current = this.waiters.get(key);
          const index = current?.indexOf(wake) ?? -1;
          if (index >= 0) current!.splice(index, 1);
          if (!current?.length) this.waiters.delete(key);
          resolve(false);
        }, Math.max(0, deadline - Date.now()));
        queue.push(wake);
        this.waiters.set(key, queue);
      });
      if (!woke) return undefined;
    }
  }

  private wakeNext(key: string): void {
    this.waiters.get(key)?.shift()?.();
    if (!this.waiters.get(key)?.length) this.waiters.delete(key);
  }
}

/** Pure, bounded terminal assembly from durable execution state and artifact metadata. */
export function deterministicTerminalSummary(record: ExecutionRecord, artifacts: readonly ExecutionArtifactRecord[], events: readonly ExecutionEvent[] = []): string {
  const lines = [
    `# ${record.state === 'FAILED' ? 'Execution failed' : 'Execution completed'}`,
    '',
    `Work units: ${(record.workUnits ?? []).filter((unit) => unit.state === 'COMPLETED').length} completed, ${(record.workUnits ?? []).filter((unit) => unit.state === 'FAILED').length} failed, ${(record.workUnits ?? []).filter((unit) => unit.state === 'SKIPPED').length} skipped.`
  ];
  for (const unit of record.workUnits ?? []) {
    const detail = unit.state === 'FAILED' ? unit.failureCode ?? 'UNKNOWN' : undefined;
    lines.push(`- ${unit.title} [${unit.state}]${detail ? `: ${detail.slice(0, TERMINAL_SUMMARY_ITEM_MAX_CHARS)}` : ''}`);
  }
  if (record.policyResult) lines.push('', `Policy: ${record.policyResult.status} - ${record.policyResult.summary.slice(0, TERMINAL_SUMMARY_ITEM_MAX_CHARS)}`);
  const terminalEvents = events.filter((event) => event.eventType === 'outcome' || event.eventType === 'failure').slice(-20);
  if (terminalEvents.length) {
    lines.push('', 'Events:');
    for (const event of terminalEvents) lines.push(`- ${event.eventType}: ${event.summary.slice(0, TERMINAL_SUMMARY_ITEM_MAX_CHARS)}`);
  }
  if (artifacts.length) {
    lines.push('', 'Artifacts:');
    for (const artifact of artifacts.slice(0, 100)) lines.push(`- ${artifact.name} (${artifact.mediaType}, ${artifact.contentDigest})`);
  }
  return lines.join('\n').slice(0, TERMINAL_SUMMARY_MAX_CHARS);
}

/**
 * Build the "Upstream results" section for a dependent unit's assignment text so
 * a downstream worker INHERITS each COMPLETED direct dependency's result (e.g. a
 * navigation label already chosen by an upstream unit) instead of re-blocking to
 * re-ask the human. The worker's session differs from the upstream unit's and
 * the snapshot historically stripped `result`, so without this a dependent unit
 * had no engine-supported way to read an answered dependency. Returns '' when no
 * direct dependency has a stored result. Pure; exported for unit tests.
 */
export function dependencyResultsSection(record: ExecutionRecord, workUnitId: string): string {
  const unit = record.workUnits?.find((candidate) => candidate.id === workUnitId);
  if (!unit?.dependencies?.length) return '';
  const lines: string[] = [];
  for (const depId of unit.dependencies) {
    const dependency = record.workUnits?.find((candidate) => candidate.id === depId);
    if (dependency?.result === undefined) continue;
    const title = dependency.title ? ` (${dependency.title})` : '';
    lines.push(`- \`${depId}\`${title}: ${dependency.result.slice(0, MAX_DEP_RESULT_CHARS)}`);
  }
  if (!lines.length) return '';
  return `\n\nUpstream results (outputs of your completed dependencies — use these, do NOT re-ask the human for information already decided here):\n${lines.join('\n')}`;
}

export class ExecutionService {
  private readonly starting = new Map<string, number>();
  private readonly bindingTails = new Map<string, Promise<void>>();
  private readonly usageTails = new Map<string, Promise<void>>();
  private readonly usageFlights = new Map<string, Promise<void>>();
  private readonly pendingBindingOwners = new Map<string, string>();
  private readonly mintFlights = new Map<string, Promise<ReturnType<ExecutionService['mintResumeGrantOnce']> extends Promise<infer T> ? T : never>>();
  private readonly autoFinalizeTimers = new Map<string, NodeJS.Timeout>();
  private readonly deadlineWatchdog: ExecutionDeadlineWatchdog;
  private readonly planReadinessWatchdog: PlanReadinessWatchdog;
  private activeClaimCursor?: ActiveClaimCursor;
  private activeReconcileRunning = false;
  private readonly routeFactCircuits = new Map<string, { state: CircuitState; openedAt?: number }>();

  constructor(private readonly deps: ExecutionServiceDeps) {
    this.deadlineWatchdog = new ExecutionDeadlineWatchdog({
      now: deps.now ?? Date.now,
      setTimer: deps.setTimer ?? setTimeout,
      clearTimer: deps.clearTimer ?? clearTimeout,
      onDeadline: async (executionId) => { await this.enforceDeadline(executionId); }
    });
    this.planReadinessWatchdog = new PlanReadinessWatchdog({
      now: deps.now ?? Date.now,
      setTimer: deps.setTimer ?? setTimeout,
      clearTimer: deps.clearTimer ?? clearTimeout,
      graceMs: () => deps.planStartupGraceMs?.() ?? 0,
      onGraceExpired: async (executionId) => { await this.failPlanlessExecution(executionId); }
    });
  }

  async dryRun(projectId: string, request: ExecutionRequestV1): Promise<TeamAdmissionResultV1> {
    const input = await this.resolveAdmissionInput(projectId, await this.withResolvedRouteFacts(projectId, request));
    return evaluateTeamAdmission(input);
  }

  private async evaluateResolvedAdmission(projectId: string, request: ExecutionRequestV1): Promise<TeamAdmissionResultV1> {
    const input = await this.resolveAdmissionInput(projectId, request);
    return evaluateTeamAdmission(input);
  }

  private async withResolvedRouteFacts(projectId: string, request: ExecutionRequestV1): Promise<ExecutionRequestV1> {
    if (!this.deps.resolveTeamModelSnapshots) return request;
    return { ...request, resolvedModels: await this.deps.resolveTeamModelSnapshots(projectId, request) };
  }

  async start(callerPrincipalId: string, projectId: string, request: ExecutionRequestV1): Promise<
    { ok: true; value: ExecutionRecord & { resumeToken?: string; resumeTokenExpiresAt?: number } } | { ok: false; code: string; message: string }
  > {
    if (request.version !== 1 || (request.launchKind !== undefined && request.launchKind !== 'team')
      || !request.teamId?.trim() || !request.launchRequestId?.trim() || !request.slots?.length) {
      return { ok: false, code: 'INVALID', message: 'invalid execution request' };
    }
    let resolvedModels: ResolvedModelSnapshotV1[];
    try {
      resolvedModels = (await this.withResolvedRouteFacts(projectId, request)).resolvedModels ?? [];
    } catch (error) {
      this.deps.logError?.(`Team route facts failed for ${projectId}:${request.launchRequestId}`, error);
      return { ok: false, code: 'ADMISSION_FAILED', message: 'Team route facts could not be evaluated' };
    }
    if (!hasUniqueModelSlots(resolvedModels)) return { ok: false, code: 'INVALID', message: 'duplicate resolved model slot' };
    const resolvedRequest = { ...request, resolvedModels };
    let admission: TeamAdmissionResultV1;
    let issuedAuthorizationIds: string[] = [];
    try {
      admission = await this.evaluateResolvedAdmission(projectId, resolvedRequest);
    } catch (error) {
      this.deps.logError?.(`Team admission input failed for ${projectId}:${request.launchRequestId}`, error);
      return { ok: false, code: 'ADMISSION_FAILED', message: 'Team admission could not be evaluated' };
    }
    if (!admission.ready) {
      const failed = admission.checks.find((check) => check.required && check.status !== 'PASS');
      return { ok: false, code: 'ADMISSION_FAILED', message: failed?.message ?? 'Team admission failed' };
    }
    const jobTitle = deriveJobTitle(request);
    const summary = request.summary?.trim() || undefined;
    const startingKey = `${callerPrincipalId}:${request.launchRequestId}`;
    this.beginStarting(startingKey);
    // Durable worker-DAG runs get a wall-clock reclaim backstop so a worker stuck non-restful
    // (never heartbeats) can't wedge its claim forever. Caller-set ceiling wins (see helper).
    const effectivePolicy = withDurableClaimWallClockBackstop(request.coordinationMode, request.policy);
    let claim;
    try {
      claim = await this.deps.store.claim({
        callerPrincipalId, projectId, teamId: request.teamId, launchKind: request.launchKind ?? 'team',
        ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), jobTitle, summary,
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        ...(request.origin ? { origin: request.origin } : {}),
        launchRequestId: request.launchRequestId,
        request: { version: 1, launchKind: request.launchKind ?? 'team', ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), slots: request.slots, policy: effectivePolicy, workflow: request.workflow, resolvedModels, sourceBundle: request.sourceBundle, objective: request.objective },
        ...(request.workUnits ? { workUnits: request.workUnits } : {}),
        resolvedModels,
        requestDigest: launchDigest({ callerPrincipalId, projectId, request: { ...withoutDefaultLaunchKind(resolvedRequest), jobTitle, summary } })
      });
    } catch (error) {
      this.endStarting(startingKey);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    this.endStarting(startingKey);
    if (claim.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'execution request id reused with changed input' };
    if (claim.outcome === 'replay') {
      const reconciled = await this.reconcile(callerPrincipalId, projectId, claim.record);
      this.deadlineWatchdog.schedule(reconciled);
      this.planReadinessWatchdog.schedule(reconciled);
      if (reconciled.state === 'BLOCKED' || reconciled.state === 'FAILED') {
        return { ok: false, code: reconciled.state, message: `execution is ${reconciled.state.toLowerCase()}` };
      }
      return { ok: true, value: reconciled };
    }
    this.deadlineWatchdog.schedule(claim.record);
    this.planReadinessWatchdog.schedule(claim.record);

    let record: ExecutionRecord;
    let resumeGrant: { token: string; expiresAt: number } | undefined;
    this.beginStarting(claim.record.id);
    try {
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(request.teamId, request.workflow);
        if (!preflight?.ok || !request.workflow.supportedRequestVersions.includes(request.version)) {
          const message = !preflight?.ok
            ? preflight?.message ?? 'workflow profiles are unavailable'
            : 'workflow profile does not support this execution request version';
          const blocked = await this.deps.store.transition(claim.record.id, claim.record.stateVersion, 'BLOCKED', 'warning', message);
          this.endStarting(claim.record.id);
          return { ok: false, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: blocked ? message : 'workflow profile is unavailable' };
        }
      }
      record = await this.deps.store.transition(claim.record.id, claim.record.stateVersion, 'STARTING', 'info', 'Team launch authorized');
    } catch (error) {
      this.endStarting(claim.record.id);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (this.deps.resumeGrants) {
        resumeGrant = await this.deps.resumeGrants.mint({ executionId: claim.record.id, projectId, callerPrincipalId, expiresAt: claim.record.recoveryDeadlineAt });
        await this.deps.cacheResumeToken?.(projectId, claim.record.id, resumeGrant.token, resumeGrant.expiresAt);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failLaunch(record, `Resume grant setup failed: ${message}`);
      this.endStarting(claim.record.id);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message };
    }
    try {
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(request.teamId, request.workflow);
        if (!preflight?.ok) {
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', preflight?.message ?? 'workflow profile is unavailable');
          return { ok: false, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: preflight?.message ?? 'workflow profile is unavailable' };
        }
      }
      const authorization = await this.deps.authorizeTeamLaunch(
        callerPrincipalId, request.teamId, projectId, record.teamLaunchRequestId,
        request.policy ?? {}, request.slots, request.coordinationMode, admission.digest
      );
        if (!authorization.ok) {
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', authorization.message);
          return { ok: false, code: authorization.code, message: authorization.message };
      }
        issuedAuthorizationIds = authorization.value.slots.map((slot) => slot.authorizationId);
        if (!authorization.value.context) {
          await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', 'Team authorization context unavailable');
          return { ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE', message: 'Team authorization context unavailable' };
      }
      record = await this.deps.store.setAuthorizationContext(
        record.id,
        record.stateVersion,
        authorization.value.context,
        launchDigest(authorization.value.context)
      );
      record = await this.deps.store.prepareLaunchIntent(record.id, record.stateVersion, {
        version: 1,
        authorizationContextDigest: record.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask }) => ({
          slotId,
          personaId,
          initialTaskDigest: launchDigest(initialTask)
        }))
      });
      let revalidatedAdmission: TeamAdmissionResultV1;
      try {
        revalidatedAdmission = await this.evaluateResolvedAdmission(projectId, resolvedRequest);
      } catch (error) {
        this.deps.logError?.(`Team admission revalidation failed for ${projectId}:${request.launchRequestId}`, error);
        await this.transitionOrCurrent(record, 'BLOCKED', 'warning', 'Team admission could not be revalidated');
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false, code: 'STALE_PREFLIGHT', message: 'Team admission could not be revalidated' };
      }
      if (!revalidatedAdmission.ready || revalidatedAdmission.digest !== admission.digest) {
        const failed = revalidatedAdmission.checks.find((check) => check.required && check.status !== 'PASS');
        const message = failed?.message ?? 'Team admission changed after authorization';
        await this.transitionOrCurrent(record, 'BLOCKED', 'warning', message);
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false, code: 'STALE_PREFLIGHT', message };
      }
      if (!await this.launchMayProceed(record)) {
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed before Team launch' };
      }
      const launched = await this.deps.launchTeam(request.teamId, projectId, {
        callerPrincipalId, launchRequestId: record.teamLaunchRequestId, slots: authorization.value.slots,
        admissionDigest: authorization.value.admissionDigest,
        policy: request.policy, requirePreauthorization: true, executionId: record.id, executionJobTitle: record.jobTitle,
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        ...(request.origin ? { origin: request.origin } : {}),
        ...(isDurableCoordination(request.coordinationMode) ? { jobContext: {
          objective: request.objective?.trim() || record.jobTitle,
          title: record.jobTitle,
          ...(record.summary ? { summary: record.summary } : {}),
          ...(request.sourceBundle ? { sourceBundle: request.sourceBundle } : {})
        } } : {})
      });
      if (!launched.ok) {
        await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
        await this.transitionOrCurrent(record, 'FAILED', 'error', launched.message ?? 'Team launch failed');
        return { ok: false, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed' };
      }
      if (!await this.launchMayProceed(record)) {
        const current = await this.deps.store.get(record.id);
        if (current?.state === 'COMPLETED') {
          return { ok: true, value: { ...current, ...(resumeGrant ? { resumeToken: resumeGrant.token, resumeTokenExpiresAt: resumeGrant.expiresAt } : {}) } };
        }
        if (current?.state === 'FAILED') {
          return { ok: false, code: 'TEAM_LAUNCH_FAILED', message: current.finalSummary ?? 'execution failed during Team launch' };
        }
        return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed during Team launch' };
      }
      record = await this.transitionOrCurrent(record, 'RUNNING', 'info', 'Team launch started');
      return { ok: true, value: { ...record, ...(resumeGrant ? { resumeToken: resumeGrant.token, resumeTokenExpiresAt: resumeGrant.expiresAt } : {}) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
      const current = await this.failLaunch(record, `Team launch error: ${message}`);
      return current.state === 'FAILED'
        ? { ok: false, code: 'TEAM_LAUNCH_FAILED', message }
        : { ok: false, code: 'TEAM_LAUNCH_STATE_CONFLICT', message: `Team launch failed while execution is ${current.state.toLowerCase()}` };
    } finally {
      this.endStarting(claim.record.id);
    }
  }

  private async resolveAdmissionInput(projectId: string, request: ExecutionRequestV1): Promise<TeamAdmissionInput> {
    if (this.deps.admissionInput) return this.deps.admissionInput(projectId, request);
    return {
      workUnits: request.workUnits,
      requireCompletePlan: isDurableCoordination(request.coordinationMode),
      slotCount: request.slots.length,
      maxSlots: Math.min(request.policy?.maxLaunches ?? 32, 32),
      initialTasks: request.slots.map((slot) => slot.initialTask),
      sourceBytes: request.sourceBundle?.sources.reduce((sum, source) => sum + source.byteSize, 0)
      , slotRoutes: (request.resolvedModels ?? []).map((model) => ({
        slotId: model.slotId, personaId: model.personaId ?? '', provider: model.provider, model: model.model,
        level: model.level, roleOwnedModel: model.roleOwnedModel, capabilities: model.capabilities,
        modalities: model.modalities, maxContextBytes: model.maxContextBytes, health: model.health,
        observedAt: model.observedAt, maxAgeMs: model.maxAgeMs
      }))
    };
  }

  async status(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.reconcile(callerPrincipalId, projectId, record) : undefined;
  }

  async list(callerPrincipalId: string, projectId: string) {
    const records = await this.deps.store.list(callerPrincipalId, projectId);
    return Promise.all(records.map((record) => this.reconcile(callerPrincipalId, projectId, record)));
  }

  async pruneRetainedSources(): Promise<void> {
    try {
      if (!this.deps.sources?.pruneSnapshots) return;
      await this.deps.sources.pruneSnapshots(await this.deps.store.retainedSourceContentRefs(), EXECUTION_RETENTION_MS);
    } catch {
      // Retention cleanup must not block boot or execution control.
    }
  }

  async restoreDeadlines(): Promise<void> {
    const active = await this.deps.store.listActive();
    this.deadlineWatchdog.restore(active);
    this.planReadinessWatchdog.restore(active);
  }

  /** One bounded main-owned recovery page. Lifecycle failure never reclaims work. */
  async reconcileActive(): Promise<void> {
    const observe = this.deps.claimRecoveryObserveEnabled?.() === true;
    const enforce = observe && this.deps.claimRecoveryEnforceEnabled?.() === true;
    if (!observe || this.activeReconcileRunning) return;
    this.activeReconcileRunning = true;
    try {
      const page = await this.deps.store.listActiveClaims(this.activeClaimCursor, ACTIVE_CLAIM_PAGE_SIZE);
      this.activeClaimCursor = page.next;
      const lifecycles = await Promise.all(page.records.map(async (record) => {
        try { return [record, extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId))] as const; }
        catch (error) { this.deps.logError?.(`Execution claim recovery lifecycle read failed for ${record.id}`, error); return [record, undefined] as const; }
      }));
      for (const [record, lifecycle] of lifecycles) {
        if (!lifecycle?.workers) continue;
        const now = (this.deps.now ?? Date.now)();
        const claims: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force?: boolean }[] = [];
        const renewSlots: string[] = [];
        for (const unit of record.workUnits ?? []) {
          if (unit.state !== 'CLAIMED' || !unit.claimId || unit.claimGeneration === undefined || !unit.assignedSlotId) continue;
          // State-agnostic FORCE backstop for a worker that never reports an outcome (run
          // df216947). `force` bypasses the store's lease-expiry floor and the agent-state
          // renewal below, so a worker stuck non-restful with NO progress is reclaimed
          // regardless of state. Measured from the last real OUTPUT progress (`progressAt`,
          // advanced ONLY by host-observed worker output — the agent-state renewal below
          // passes advanceProgress:false), NOT raw `claimedAt`: a worker still emitting output
          // is by definition not stuck. Keying it to claimedAt force-reclaimed a demonstrably-
          // live, streaming worker mid-work the instant it outlived the ceiling and re-
          // dispatched it from zero — so ANY unit that legitimately runs past the ceiling while
          // progressing (verify-upstream: >20min, output bursts every ~4min) churned forever
          // and could never complete (live run 928ff675). A stuck-at-turn-0 worker keeps
          // progressAt==claimedAt, so it still fires here exactly as before (df216947 intact).
          const maxWallClock = record.request.policy?.maxClaimWallClockMs;
          const lastWallClockProgressAt = unit.progressAt ?? unit.claimedAt;
          if (maxWallClock !== undefined && lastWallClockProgressAt !== undefined && now - lastWallClockProgressAt >= maxWallClock) {
            claims.push({ workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, reason: 'Work claim exceeded main-observable wall-clock limit', force: true });
            continue;
          }
          if (unit.leaseExpiresAt === undefined || unit.leaseExpiresAt > now) continue;
          // Lease expired. The host renews the lease from PTY output (renewWorkerLease), but a
          // doc worker is routinely SILENT for a full lease window during a long think/tool
          // phase while still actively working — so an expired lease alone does NOT mean the
          // worker is dead. Reclaiming it there killed live workers and churned finished work
          // (run e531f415). Consult a NON-output liveness signal — the resolved agent state —
          // before reclaiming.
          const worker = lifecycle!.workers!.find((candidate) => candidate.slotId === unit.assignedSlotId && candidate.projectId === record.projectId);
          const proc = worker?.process ?? '';
          if (!worker || DEAD_WORKER_PROCESSES.has(proc)) {
            claims.push({ workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, reason: PROVEN_DEAD_CLAIM_REASON });
            continue;
          }
          // Outer shell/tmux wrapper is alive, but the INNER agent may already be dead
          // (a remote-opencode zombie: `process:'running'`, agent-state stuck 'unknown').
          // A provider that can probe its own agent liveness proves this; reclaim NOW —
          // BEFORE the state/stall/renew logic below — so a dead-agent claim is not
          // renewed into a zombie and its assignment is never re-typed into the surviving
          // shell. `'unknown'`/`'alive'`/unwired ⇒ fall through to the existing behaviour,
          // so the claude-family path is byte-unchanged.
          if (worker.sessionId !== undefined && this.deps.getWorkerLiveness?.(worker.sessionId) === 'dead') {
            claims.push({ workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, reason: AGENT_DEAD_CLAIM_REASON });
            // Reclaiming the claim frees the WORK, but the dead worker's outer
            // shell/tmux wrapper survives as a remote zombie — reap it via the
            // host's tmux-killing close (captured-PID/boot reap can't: that pid
            // is the exited inner agent, not the surviving wrapper).
            this.deps.closeWorkerSession?.(worker.sessionId);
            continue;
          }
          // Worker process alive. Reclaim ONLY if it has gone to REST (idle/done/waiting)
          // without reporting an outcome — it abandoned the claim. If it is non-restful
          // ('working'/'blocked'/'unknown') or its state is unresolved, treat it as alive and
          // RENEW the lease from this signal instead of reclaiming; the wall-clock ceiling
          // above remains the hard stop for a worker that stays non-restful but is truly hung.
          const state = worker.sessionId === undefined
            ? undefined
            : this.deps.getAgentState?.(worker.sessionId);
          if (state !== undefined && isRestfulAgentState(state)) {
            claims.push({ workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, reason: SILENT_WORKER_CLAIM_REASON });
            continue;
          }
          // Worker alive + non-restful, but its lease has expired (a full window with no output).
          // Progress-aware stall ceiling: if it has produced no OUTPUT progress (`progressAt`,
          // never advanced by this agent-state renewal) for `maxClaimStallMs`, reclaim it now
          // instead of renewing forever toward the blunt wall-clock ceiling. A streaming worker
          // keeps its lease fresh and never reaches this branch, so only a truly stuck-but-'working'
          // worker is caught (live run b1bd2906). Falls back to `claimedAt` for a pre-field claim.
          const maxStall = record.request.policy?.maxClaimStallMs;
          const lastProgressAt = unit.progressAt ?? unit.claimedAt;
          if (maxStall !== undefined && lastProgressAt !== undefined && now - lastProgressAt >= maxStall) {
            claims.push({ workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, reason: STALLED_WORKER_CLAIM_REASON });
            continue;
          }
          renewSlots.push(unit.assignedSlotId);
        }
        if (!claims.length && !renewSlots.length) continue;
        if (!enforce) {
          if (claims.length) this.deps.logError?.(`Execution claim recovery observed ${claims.length} proven-dead expired claim(s) for ${record.id}`, new Error(PROVEN_DEAD_CLAIM_REASON));
          continue;
        }
        for (const slotId of renewSlots) {
          // Keep the lease alive from agent-state liveness, but do NOT advance the stall clock —
          // only real worker output (the host path below) counts as progress.
          try { await this.deps.store.renewWorkerLease(record.id, slotId, { advanceProgress: false }); }
          catch (error) { this.deps.logError?.(`Execution claim lease renew from agent state failed for ${record.id}`, error); }
        }
        if (claims.length) {
          const reclaimed = await this.deps.store.reclaimExpiredClaims(record.id, claims);
          const changed = await this.escalateKickoffFailures(reclaimed);
          if (reclaimed.stateVersion !== record.stateVersion || changed) await this.cascadeDispatch(reclaimed.id);
        }
      }
      if (!page.next) this.activeClaimCursor = undefined;
    } finally {
      this.activeReconcileRunning = false;
    }
  }

  /**
   * Recover a wedged durable run. `cascadeDispatch` only fires on work edges
   * (completion / fail / release / reclaim), so a run that dispatched ZERO units
   * on its first attempt — e.g. a transient slot-health UNKNOWN, a lapsed route-
   * fact TTL, or a delivery that all released — has no edge left to re-attempt and
   * parks permanently (observed: run 1aa3cf47, 0 deliveries, coordinator PARKED
   * forever). `PlanReadinessWatchdog` only covers the planless case (it self-
   * removes once units exist), so a fully-planned run has no safety net.
   *
   * This periodic sweep (same cadence as {@link reconcileActive}) re-runs
   * `cascadeDispatch` for any active durable execution that has dispatchable READY
   * units but NOTHING in flight — the wedge signature. "Nothing in flight" is NOT
   * merely "0 CLAIMED": a claim whose worker produced no OUTPUT (`progressAt` never
   * moved past `claimedAt`) for the run's stall window while the coordinator is
   * PARKED is a stranded / never-delivered assignment, not live work (run
   * c33a6715). Those wedged claims are force-reclaimed to READY here (gated behind
   * the claim-recovery flags, same as reconcileActive) and then re-dispatched. A
   * healthy run always has a PROGRESSING claim and is skipped, so the
   * refresh/inventory cost is paid only on genuinely stalled runs; `cascadeDispatch`
   * re-refreshes route facts before dispatching, so the run self-heals as soon as
   * health recovers.
   */
  async redispatchStalled(): Promise<void> {
    let records: ExecutionRecord[];
    try { records = await this.deps.store.listActive(); }
    catch (error) { this.deps.logError?.('Execution stalled-redispatch list failed', error); return; }
    const enforce = this.deps.claimRecoveryObserveEnabled?.() === true
      && this.deps.claimRecoveryEnforceEnabled?.() === true;
    const now = (this.deps.now ?? Date.now)();
    for (const record of records) {
      if (record.state !== 'RUNNING' && record.state !== 'STARTING') continue;
      if (!isDurableCoordination(record.coordinationMode)) continue;
      const units = record.workUnits ?? [];
      if (!units.length) continue; // planless → PlanReadinessWatchdog owns it
      // A CLAIMED unit normally means work is in flight and the run is healthy. But a
      // claim whose worker has produced no OUTPUT — `progressAt` (stamped on claim,
      // advanced ONLY by real worker output, never by agent-state lease renewal) is
      // more than the run's stall window stale — is a stranded / never-delivered (or
      // dead-since-a-single-echo) assignment, NOT work in flight (live run c33a6715: a
      // remote worker sat in standby, board CLAIMED, `deliveries: []`, coordinator
      // PARKED, telemetry gap climbing, so reconcileActive kept renewing the lease from
      // agent-state and only the blunt 10-min stall ceiling could break it — which
      // then re-handed the SAME undelivered slot and re-wedged). Treat the run as busy
      // ONLY when a claim's output is RECENT; otherwise force-reclaim the wedged
      // claims so the unit returns to READY and re-dispatches. Gated behind the same
      // claim-recovery flags as reconcileActive, and only when the coordinator has
      // PARKED (an active coordinator manages its own claims; reconcileActive owns
      // lease-expiry reclaim for the coordinator-active case).
      const stallMs = record.request.policy?.maxClaimStallMs;
      const wedgedClaims: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force: true }[] = [];
      let liveClaim = false;
      for (const unit of units) {
        if (unit.state !== 'CLAIMED') continue;
        // Liveness is RECENCY of output, not "ever output past claim". The old
        // `progressed = progressAt > claimedAt` short-circuit treated ANY output
        // as live — but a bare interactive worker (OpenCode) that only ECHOES the
        // injected assignment paste advances `progressAt` ONCE then goes silent, so
        // `progressed` stayed true forever and this backstop was permanently masked
        // (the dead claim was skipped as "live" every sweep — live run 47823553).
        // Match `reconcileActive`: a claim is live ONLY while its last output is
        // within the stall window; a stale single blip is caught exactly like a
        // never-progressed claim.
        const lastProgressAt = unit.progressAt ?? unit.claimedAt;
        const stalled = stallMs !== undefined && lastProgressAt !== undefined
          && now - lastProgressAt >= stallMs;
        if (enforce && record.coordinatorState === 'PARKED' && stalled
          && unit.claimId !== undefined && unit.claimGeneration !== undefined) {
          wedgedClaims.push({
            workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration,
            reason: STALLED_WORKER_CLAIM_REASON, force: true
          });
        } else {
          liveClaim = true;
        }
      }
      if (liveClaim) continue; // genuinely progressing work in flight
      if (wedgedClaims.length) {
        try {
          const reclaimed = await this.deps.store.reclaimExpiredClaims(record.id, wedgedClaims);
          const changed = await this.escalateKickoffFailures(reclaimed);
          if (reclaimed.stateVersion !== record.stateVersion || changed) await this.cascadeDispatch(reclaimed.id);
        } catch (error) {
          this.deps.logError?.(`Execution stalled-claim reclaim failed for ${record.id}`, error);
        }
        continue;
      }
      if (!units.some((unit) => unit.state === 'READY')) continue; // nothing to dispatch
      await this.cascadeDispatch(record.id);
    }
  }

  /**
   * Kickoff-churn escape hatch. After a reclaim, block any unit that has been
   * reclaimed {@link KICKOFF_FAILURE_BLOCK_THRESHOLD}+ times while its worker never
   * once reported a completed turn (`kickoffFailures`) — otherwise the un-masked
   * backstops above would just keep re-dispatching it down the same broken delivery
   * path forever (a silently-broken run that never completes, which violates the
   * "teams must self-heal, never sit wedged" mandate). Blocking surfaces it on the
   * board / inbox with an actionable HUMAN_BLOCKER instead. Best-effort: the store
   * method throws on every no-op guard (below threshold / already blocked / dup),
   * which is expected and swallowed. Returns true if it blocked ≥1 unit so the
   * caller still cascades (dispatching the run's OTHER ready units; the blocked one
   * is no longer READY so it is skipped).
   */
  private async escalateKickoffFailures(reclaimed: ExecutionRecord): Promise<boolean> {
    let changed = false;
    for (const unit of reclaimed.workUnits ?? []) {
      if ((unit.kickoffFailures ?? 0) < KICKOFF_FAILURE_BLOCK_THRESHOLD) continue;
      if (unit.state === 'BLOCKED' || unit.state === 'COMPLETED' || unit.state === 'FAILED') continue;
      // SELF-HEAL FIRST (the "coordinator reassigns before it asks a person" half of
      // the mandate): try re-homing the churning unit onto a DIFFERENT worker slot it
      // has not been dispatched to yet. A slot-specific delivery failure (a wedged /
      // mis-wired worker) may simply not recur on a fresh peer. Harness-agnostic — the
      // churn signal (`kickoffFailures`, from a never-turned `turnCount`) and the
      // reassignment are core execution state, identical for every harness. Only when
      // EVERY distinct worker slot has been exhausted (or a single-worker team) does
      // the store throw here and we fall through to the human block below.
      try {
        await this.deps.store.reassignKickoffToFreshSlot(reclaimed.id, unit.id);
        changed = true;
        continue; // reassigned to a fresh slot — the caller's cascadeDispatch redispatches it
      } catch (error) {
        // No untried slot / not reassignable → block to a human below.
        this.deps.logError?.(`Execution kickoff-failure reassignment skipped for ${reclaimed.id}/${unit.id}`, error);
      }
      try {
        const updated = await this.deps.store.blockKickoffFailure(reclaimed.id, unit.id);
        changed = true;
        await this.wakeCoordinator(updated, {
          cause: 'HUMAN_BLOCKER',
          message: `HUMAN_BLOCKER: work unit ${unit.id} never started after ${unit.kickoffFailures} dispatch attempts across every worker slot — check the worker terminal or restart the run.`,
          workUnitId: unit.id, stateOrClaimGeneration: updated.state
        });
        // Surface the human blocker on the Inbox too. A HUMAN_BLOCKER that only woke
        // the (parked) coordinator left the user with a "needs you" run and NO inbox
        // message — the exact gap reported live. Mirror the blockWork /
        // escalateStaleCoordinatorBlockers human path so a human-decision blocker
        // ALWAYS produces an actionable inbox entry (a comment-bearing SIGNAL row that
        // links back to the execution + blocker for board resolution).
        const blocker = updated.blockers?.find((candidate) => candidate.workUnitId === unit.id && candidate.audience === 'human' && !candidate.resolved);
        if (blocker) {
          void this.deps.inbox?.append({
            projectId: updated.projectId,
            subject: updated.jobTitle || 'Job Execution Blocked',
            comments: blocker.question,
            executionId: updated.id,
            blockerId: blocker.id
          }).catch((err) => {
            (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))('Failed to append inbox entry for kickoff-failure block', err);
          });
        }
      } catch (error) {
        // Below threshold / already blocked / duplicate → store threw; not an error.
        this.deps.logError?.(`Execution kickoff-failure block skipped for ${reclaimed.id}/${unit.id}`, error);
      }
    }
    return changed;
  }

  dispose(): void {
    this.deadlineWatchdog.dispose();
    this.planReadinessWatchdog.dispose();
    const clearTimer = this.deps.clearTimer ?? clearTimeout;
    for (const timer of this.autoFinalizeTimers.values()) clearTimer(timer);
    this.autoFinalizeTimers.clear();
    this.routeFactCircuits.clear();
  }

  /** Main-only project projection. Never expose through owner-scoped MCP routes. */
  async listProject(projectId: string, before?: number, limit = 50) {
    const page = await this.deps.store.listInProject(projectId, before, limit);
    return {
      records: await Promise.all(page.records.map((record) => this.reconcile(record.callerPrincipalId, projectId, record))),
      hasMore: page.hasMore
    };
  }

  async events(callerPrincipalId: string, projectId: string, executionId: string, after = 0, limit = 100) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.deps.store.eventsInProject(projectId, executionId, after, limit) : { events: [] };
  }

  /**
   * Read a bounded durable snapshot without reconciling Team lifecycle state.
   * Reconciliation may mutate state after a caller deadline, so it remains an
   * explicit operation rather than part of an observer snapshot.
   */
  async snapshot(callerPrincipalId: string, projectId: string, executionId: string, after = 0) {
    const now = this.deps.monotonicNow ?? (() => performance.now());
    const deadline = now() + SNAPSHOT_TIMEOUT_MS;
    const checkDeadline = () => {
      if (now() >= deadline) throw new ExecutionSnapshotTimeoutError();
    };
    checkDeadline();
    const execution = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!execution) return undefined;
    checkDeadline();
    const executions = await this.deps.store.list(callerPrincipalId, projectId);
    checkDeadline();
    return this.readSnapshot(execution, executions, projectId, after, checkDeadline);
  }

  async snapshotBound(binding: ExecutionCohortBinding, after = 0) {
    const now = this.deps.monotonicNow ?? (() => performance.now());
    const deadline = now() + SNAPSHOT_TIMEOUT_MS;
    const checkDeadline = () => {
      if (now() >= deadline) throw new ExecutionSnapshotTimeoutError();
    };
    checkDeadline();
    const execution = await this.getBound(binding);
    if (!execution) return undefined;
    checkDeadline();
    return this.readSnapshot(execution, [execution], binding.projectId, after, checkDeadline);
  }

  private async readSnapshot(execution: ExecutionRecord, executions: ExecutionRecord[], projectId: string, after: number, checkDeadline: () => void) {
    const events = [];
    let cursor = after;
    let truncated = false;
    for (let pageIndex = 0; pageIndex < MAX_SNAPSHOT_EVENT_PAGES; pageIndex += 1) {
      const page = await this.deps.store.eventsInProject(projectId, execution.id, cursor, 100);
      checkDeadline();
      events.push(...page.events);
      if (page.nextSequence === undefined) break;
      cursor = page.nextSequence;
      // Reached the page ceiling with more events pending: report truncation
      // rather than walking an unbounded backlog on the caller's deadline.
      if (pageIndex === MAX_SNAPSHOT_EVENT_PAGES - 1) truncated = true;
    }
    const artifacts = await this.deps.artifacts.list(execution.id, projectId);
    checkDeadline();
    return {
      execution,
      executions,
      events,
      nextAfter: events.at(-1)?.sequence ?? after,
      truncated,
      artifacts: artifacts.slice(0, 100),
      artifactsTruncated: artifacts.length > 100
    };
  }

  async reportEvent(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    input: Parameters<ExecutionServiceDeps['store']['producerEvent']>[1]
  ) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      return { ok: true as const, value: await this.deps.store.producerEvent(record.id, input) };
    } catch (error) {
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async registerPlan(binding: ExecutionCohortBinding, workUnits: ExecutionWorkUnitInput[]) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can register execution plan');
    const result = await this.mutateBound(binding, (record) => this.deps.store.registerPlan(record.id, record.stateVersion, workUnits));
    if (!result.ok) return result;
    this.planReadinessWatchdog.remove(binding.executionId);
    // The coordinator's single authoring WRITE (register) implies dispatch: the
    // host-neutral kickoff removes the separate model `dispatch_ready` call from
    // the critical path (weak models chain tool calls unreliably). dispatchReady
    // assigns only the initially-READY roots and pushes them to workers; units
    // with unmet deps wait for the completion cascade, exactly as before. Safe if
    // the coordinator ALSO calls dispatch_ready — a second pass finds no
    // unassigned READY unit and is a no-op. A dispatch failure (budget/resource)
    // must NOT mask the successful register, so fall back to the register result.
    const dispatched = await this.dispatchReady(binding);
    return dispatched.ok ? dispatched : result;
  }

  async claimWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string) {
    if (binding.role !== 'worker') return deniedBound('coordinator must use execution.work.assign');
    const budget = await this.budgetAdmission(binding.executionId);
    if (!budget.ok) return budget;
    return this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
  }

  async assignWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId: string) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can assign work');
    const budget = await this.budgetAdmission(binding.executionId);
    if (!budget.ok) return budget;
    return this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
  }

  async heartbeatWork(binding: ExecutionCohortBinding, workUnitId: string, claimId: string, claimGeneration: number, turnCount?: number) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can heartbeat work');
    return this.mutateBound(binding, (record) => this.deps.store.heartbeatWork(record.id, record.stateVersion, binding, workUnitId, { claimId, claimGeneration, turnCount }));
  }

  /** Engine-owned claim-lease renewal from observed worker OUTPUT activity (the host wires
   * this off `PtyManager` `'data'` for a cohort worker session). This is what makes the lease
   * a liveness deadline instead of a fixed 90s turn budget: a live, streaming worker keeps its
   * claim fresh so the reconcile sweep never reclaims it as silent, while a hung worker emits
   * nothing and lets the lease expire. Best-effort + never throws — a failed renewal simply
   * lets the lease age toward its normal expiry. Not a cohort-principal call (no binding): the
   * store matches the unit currently CLAIMED by `slotId`. */
  async renewWorkerLease(executionId: string, slotId: string): Promise<void> {
    try {
      // Host-observed worker OUTPUT: advances both the lease and the stall clock (`progressAt`).
      await this.deps.store.renewWorkerLease(executionId, slotId, { advanceProgress: true });
    } catch (error) {
      this.deps.logError?.(`execution worker lease renew failed (execution=${executionId}, slot=${slotId})`, error);
    }
  }

  /** Capture one immutable main-owned transcript usage sample. */
  async observeSessionUsage(executionId: string, sessionId: string, sampleKind: UsageSampleKind): Promise<void> {
    const key = `${executionId}\0${sessionId}`;
    const flightKey = `${key}\0${sampleKind}`;
    const existing = this.usageFlights.get(flightKey);
    if (existing) return existing;
    const flight = this.serializeUsage(key, () => this.captureSessionUsage(executionId, sessionId, sampleKind));
    this.usageFlights.set(flightKey, flight);
    void flight.finally(() => {
      if (this.usageFlights.get(flightKey) === flight) this.usageFlights.delete(flightKey);
    }).catch(() => undefined);
    return flight;
  }

  private async captureSessionUsage(executionId: string, sessionId: string, sampleKind: UsageSampleKind): Promise<void> {
    if (!this.deps.readSessionStats) return;
    const record = await this.deps.store.get(executionId);
    if (!record || isResumeGrantTerminal(record.state)) return;
    let lifecycle: ExtractedLifecycle | undefined;
    try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); } catch (error) {
      this.deps.logError?.(`execution usage lifecycle failed (execution=${executionId}, session=${sessionId}, sample=${sampleKind})`, error);
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.sessionId === sessionId);
    const role = lifecycle?.orchestratorSessionId === sessionId ? 'orchestrator' as const : 'worker' as const;
    const slotId = role === 'orchestrator' ? 'orchestrator' : worker?.slotId ?? 'main:unmapped';
    const unit = role === 'worker' ? record.workUnits?.find((candidate) => candidate.assignedSlotId === slotId && candidate.state === 'CLAIMED') : undefined;
    const resolved = record.resolvedModels.find((candidate) => candidate.slotId === slotId);
    let stats: SessionStats | null = null;
    try { stats = await this.deps.readSessionStats(sessionId, { fresh: sampleKind === 'terminal' }); } catch (error) {
      this.deps.logError?.(`execution usage stats failed (execution=${executionId}, session=${sessionId}, sample=${sampleKind})`, error);
    }
    const provider = resolved?.provider ?? 'unknown';
    const model = stats?.model ?? resolved?.model;
    const routingIdentity = `${slotId}:${provider}:${model ?? 'unknown'}`;
    const cursorKey = usageCursorIdentity({ sessionId, provider, model, routingIdentity });
    const retainedPrevious = latestUsageObservation(record, cursorKey);
    const previous = retainedPrevious ?? record.usageBaseline?.cursors?.find((cursor) => usageCursorIdentity(cursor) === cursorKey);
    const cumulative = sessionUsageCounters(stats);
    const completeness = usageCompleteness(stats, record.request.policy?.usageBudget);
    const duplicate = completeness !== 'complete' || !retainedPrevious ? undefined : matchingUsageObservation(record, (item) => usageCursorIdentity(item) === cursorKey && item.sampleKind === sampleKind
       && item.workUnitId === unit?.id && item.workAttempt === (unit?.attempt ?? 0) && item.claimGeneration === (unit?.claimGeneration ?? 0)
       && JSON.stringify(item.cumulative) === JSON.stringify(cumulative) && item.completeness === completeness);
    const sequence = duplicate?.sequence ?? (previous?.sequence ?? 0) + 1;
    const observation: Omit<ExecutionUsageObservationV1, 'version' | 'delta'> = {
      observationId: duplicate?.observationId ?? `${executionId}:usage:${sessionId}:${sequence}`, executionAttempt: record.attempt, role, slotId, sessionId,
      ...(unit ? { workUnitId: unit.id } : {}), workAttempt: unit?.attempt ?? 0, claimGeneration: unit?.claimGeneration ?? 0,
      adapterEpoch: previous?.adapterEpoch ?? 0, sampleKind, sequence, provider,
      ...(model ? { model } : {}), routingIdentity, cumulative, completeness,
      observedAt: duplicate?.observedAt ?? (this.deps.now ?? Date.now)(), ...(completeness !== 'complete' ? { gap: 'missing' as const } : {})
    };
    await this.deps.store.appendUsageObservation(record.id, observation, { telemetryGapGraceSamples: TELEMETRY_GAP_GRACE_SAMPLES });
  }

  /**
   * Coordinator hands scheduling to the engine: assign every currently-READY work
   * unit to a free worker slot and push the task to each. Called once at kickoff
   * (after the plan is structured); the engine then re-dispatches newly-ready
   * units on each completion edge (see {@link cascadeDispatch}), so the
   * coordinator never relays per-unit assignments.
   */
  async dispatchReady(binding: ExecutionCohortBinding) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can dispatch work');
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    if (record.resourceBlock) return { ok: false as const, code: 'RESOURCE_EXHAUSTED', message: record.resourceBlock.reason };
    const budget = this.checkUsageBudget(record);
    if (budget) return { ok: false as const, code: 'RESOURCE_EXHAUSTED', message: budget };
    // Defensive plan-readiness gate (generic-tool invariant): NEVER trust that a
    // producer registered a plan before dispatching. With no work units the store
    // dispatch is a SILENT no-op (store.ts) — a caller that skipped
    // execution.plan.register would otherwise hang WORKING forever with no signal.
    // Surface it so the coordinator structures a plan first. The cascade path
    // (cascadeDispatch → store.dispatchReady directly) is unaffected: mid-run
    // "nothing READY yet" stays a legitimate no-op, not an error.
    if (!record.workUnits?.length) {
      return invalidBound(new Error('no structured plan to dispatch — register a work DAG with execution.plan.register before execution.work.dispatch_ready'));
    }
    try {
      const routed = await this.refreshRouteFacts(record);
      const { record: updated, assignments } = await this.deps.store.dispatchReady(routed.id, { enforceRouting: this.deps.routingEnforcementEnabled?.() === true });
      await this.pushAssignments(updated, assignments);
      await this.maybeAutoFinalize(updated.id);
      return { ok: true as const, value: updated };
    } catch (error) {
      return invalidBound(error);
    }
  }

  async completeWork(binding: ExecutionCohortBinding, workUnitId: string, result: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false, structuredResult?: unknown) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can complete work');
    if (binding.principalId) {
      try { await this.observeSessionUsage(binding.executionId, binding.principalId, 'outcome'); } catch (error) {
        this.deps.logError?.(`execution usage capture failed for ${binding.executionId}`, error);
      }
    }
    const before = await this.getBound(binding);
    const unit = before?.workUnits?.find((candidate) => candidate.id === workUnitId);
    if (structuredResult !== undefined && unit && !unit.output) return invalidBound(new Error('structuredResult requires a work output declaration'));
    if (unit?.output) {
      const bounded = validateStructuredJson(structuredResult);
      const validation = structuredResult === undefined
        ? { ok: false as const, reason: 'structuredResult is required by work output declaration' }
        : !bounded.ok ? bounded : validateStructuredResult(unit.output, bounded.value);
      if (!validation.ok) {
        if (!claim) return invalidBound(new Error('claim fence required for structured output repair'));
        const canonicalPayload = bounded.ok ? bounded.canonical : `<invalid:${validation.reason}>`;
        const digest = `sha256:${createHash('sha256').update(`${validation.reason}\0${canonicalPayload}`).digest('hex')}`;
        try {
          const repair = await this.deps.store.recordOutputRepair(before!.id, before!.stateVersion, workUnitId, claim, digest);
          if (repair.outcome === 'accepted' && binding.principalId) {
            try { (this.deps.deliverToWorker ?? this.deps.replyToSession)(binding.principalId, `TYPED_OUTPUT_REPAIR: work unit ${workUnitId}: ${validation.reason}`); } catch {}
          }
          if (repair.outcome === 'exhausted') {
            await this.cascadeDispatch(repair.record.id, binding.slotId);
            await this.maybeAutoFinalize(repair.record.id);
            return { ok: false as const, code: 'VALIDATION_FAILED', message: 'structured output repair limit exhausted', value: repair.record };
          }
          return { ok: false as const, code: 'TYPED_OUTPUT_REPAIR', message: validation.reason, value: repair.record };
        } catch (error) { return invalidBound(error); }
      }
    }
    const outcome = await this.mutateBound(binding, (record) => claim
      ? this.deps.store.completeWork(record.id, record.stateVersion, binding, workUnitId, result, claim, requireClaim, structuredResult)
      : this.deps.store.completeWork(record.id, record.stateVersion, binding, workUnitId, result, undefined, requireClaim, structuredResult));
    // Deprioritize the just-completed slot: it's still mid-turn winding down, and
    // idle peers should take the next unit before it. It stays eligible (falls
    // back to it when it's the only free worker), and the idle-gated push keeps a
    // fallback-to-self delivery safe.
    if (outcome.ok) {
      await this.cascadeDispatch(outcome.value.id, binding.slotId);
      await this.maybeAutoFinalize(outcome.value.id);
    }
    return outcome;
  }

  /**
   * Engine-side settlement safety net. When a unit leaves the DAG fully
   * resolved, transition to COMPLETED for all-success or FAILED after all
   * independent work has settled and failed descendants are SKIPPED, without
   * waiting for the orchestrator's execution.complete. Symmetric with
   * auto-dispatch: the engine owns the whole DAG lifecycle, so a run never hangs
   * WORKING because an external orchestrator (which Zana must not depend on —
   * the generic-tool invariant) never finalized. A later coordinator
   * execution.complete is a graceful no-op (record already terminal). Runs the
   * SAME terminal side-effects as a coordinator complete (cleanup + cancel the
   * team launch). Best-effort: never fails the worker's own close, and
   * completeExecution's own guards (incomplete units, unresolved blockers,
   * non-RUNNING state) throw-and-skip here rather than force a bad transition.
   */
  private async maybeAutoFinalize(executionId: string): Promise<void> {
    let terminal: ExecutionRecord;
    try {
      for (let attempt = 0; ; attempt += 1) {
        const record = await this.deps.store.get(executionId);
        if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') return;
        const units = record.workUnits ?? [];
        if (!units.length) return;
        try {
          if (units.every((unit) => unit.state === 'COMPLETED')) {
             const evidence = await this.terminalEvidence(record);
             const summary = deterministicTerminalSummary({ ...record, state: 'COMPLETED' }, evidence.artifacts, evidence.events);
             terminal = await this.deps.store.completeExecution(record.id, record.stateVersion, summary, evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true);
          } else if (units.some((unit) => unit.state === 'FAILED')
            && units.every((unit) => unit.state === 'COMPLETED' || unit.state === 'FAILED' || unit.state === 'SKIPPED')) {
             const evidence = await this.terminalEvidence(record);
             terminal = await this.deps.store.failExecution(record.id, record.stateVersion,
               deterministicTerminalSummary({ ...record, state: 'FAILED' }, evidence.artifacts, evidence.events), evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true);
          } else {
            return;
          }
          break;
        } catch (error) {
          if (attempt === 0 && error instanceof Error && error.message === 'stale execution state') continue;
          throw error;
        }
      }
    } catch (error) {
      console.error(`[execution] auto-finalize failed for ${executionId}`, error);
      this.scheduleAutoFinalize(executionId);
      return;
    }
    try {
      await this.cleanupTerminal(terminal);
      await this.deps.cancelTeamLaunch(terminal.callerPrincipalId, terminal.teamLaunchRequestId);
    } catch (error) {
      console.error(`[execution] auto-finalize cleanup failed for ${executionId}`, error);
    }
  }

  private scheduleAutoFinalize(executionId: string): void {
    if (this.autoFinalizeTimers.has(executionId)) return;
    const setTimer = this.deps.setTimer ?? setTimeout;
    const timer = setTimer(() => {
      this.autoFinalizeTimers.delete(executionId);
      void this.maybeAutoFinalize(executionId);
    }, AUTO_FINALIZE_RETRY_MS) as NodeJS.Timeout;
    this.autoFinalizeTimers.set(executionId, timer);
  }

  private async terminalEvidence(record: ExecutionRecord): Promise<{ artifacts: ExecutionArtifactRecord[]; events: ExecutionEvent[] }> {
    const [artifacts, eventPage] = await Promise.all([
      this.deps.artifacts.list(record.id, record.projectId),
      this.deps.store.eventsInProject(record.projectId, record.id, Math.max(0, (record.lastEventSequence ?? 0) - 100), 100)
    ]);
    return { artifacts: artifacts.filter((artifact) => artifact.attempt === record.attempt).slice(0, 100), events: eventPage.events };
  }

  /**
   * After a unit closes (freeing a slot and satisfying dependents), auto-assign
   * the newly-ready units and push them — the engine schedules the DAG so the
   * coordinator stays out of the per-unit relay. Best-effort: a cascade failure
   * never fails the worker's own close; the next completion (or an explicit
   * coordinator dispatch_ready) re-dispatches.
   */
  private async cascadeDispatch(executionId: string, deprioritizeSlotId?: string): Promise<void> {
    try {
      const existing = await this.deps.store.get(executionId);
      if (!existing) return;
      if (existing.resourceBlock || this.checkUsageBudget(existing)) return;
      const routed = await this.refreshRouteFacts(existing);
      const { record, assignments } = await this.deps.store.dispatchReady(routed.id, {
        ...(deprioritizeSlotId ? { deprioritizeSlotId } : {}), enforceRouting: this.deps.routingEnforcementEnabled?.() === true
      });
      await this.pushAssignments(record, assignments);
      if (this.deps.routingEnforcementEnabled?.() === true) await this.maybeAutoFinalize(record.id);
    } catch { /* best-effort */ }
  }

  private async budgetAdmission(executionId: string) {
    const record = await this.deps.store.get(executionId);
    if (!record) return deniedBound('execution not found for bound cohort');
    const message = record.resourceBlock?.reason ?? this.checkUsageBudget(record);
    return message ? { ok: false as const, code: 'RESOURCE_EXHAUSTED', message } : { ok: true as const, value: record };
  }

  private checkUsageBudget(record: ExecutionRecord): string | undefined {
    const budget = record.request.policy?.usageBudget;
    if (!budget) return;
    const usage = usageRollup(record.usageObservations ?? [], record.usageBaseline);
    const tokens = usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined
      ? undefined
      : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    if (budget.maxTokens !== undefined && tokens !== undefined && tokens >= budget.maxTokens) return `execution token budget exhausted (${tokens}/${budget.maxTokens})`;
    if (budget.maxUsd !== undefined && usage.providerCostUsd !== undefined && usage.providerCostUsd >= budget.maxUsd) return `execution provider cost budget exhausted (${usage.providerCostUsd}/${budget.maxUsd})`;
  }

  private async refreshRouteFacts(record: ExecutionRecord): Promise<ExecutionRecord> {
    if (this.deps.routingEnforcementEnabled?.() !== true || !record.workUnits?.some((unit) => unit.routing)) return record;
    if (!this.deps.resolveTeamModelSnapshots || !routeFactsNeedRefresh(record)) return record;
    const now = this.deps.now ?? Date.now;
    const circuit = this.routeFactCircuits.get(record.id) ?? { state: 'CLOSED' as const };
    const admission = transitionCircuit({ ...circuit, now: now(), resetAfterMs: ROUTE_FACTS_CIRCUIT_RESET_MS });
    if (!admission.allowRequest) return record;
    if (admission.state === 'HALF_OPEN') this.routeFactCircuits.set(record.id, { state: 'HALF_OPEN', openedAt: circuit.openedAt });
    let timeout: NodeJS.Timeout | undefined;
    try {
      const resolvedModels = await Promise.race([
        Promise.resolve(this.deps.resolveTeamModelSnapshots(record.projectId, { teamId: record.teamId, slots: record.request.slots })),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('route facts timed out')), ROUTE_FACTS_TIMEOUT_MS); })
      ]);
      if (!hasUniqueModelSlots(resolvedModels)) throw new Error('duplicate resolved model slot');
      this.routeFactCircuits.delete(record.id);
      return this.deps.store.replaceResolvedModels(record.id, resolvedModels);
    } catch (error) {
      this.deps.logError?.(`Team route facts refresh failed for ${record.id}`, error);
      // Inventory failure is transient and must not fail healthy claimed work.
      this.routeFactCircuits.set(record.id, { state: 'OPEN', openedAt: now() });
      return record;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Resolve each engine assignment's slot to its live worker session and push the
   * task text (same primitive as {@link deliverLegacyMessage}). Best-effort per
   * assignment — a gone session is left for reconcile, not fatal to the batch.
   */
  private async pushAssignments(record: ExecutionRecord, assignments: ExecutionDispatchAssignment[]): Promise<void> {
    if (!assignments.length) return;
    // E2E-only transient fault: release this batch undelivered to reproduce the
    // 0-CLAIMED wedge. Home-gated in host; a no-op in production.
    if (this.deps.stallFirstDispatch?.(record.id) === true) {
      await this.releaseUndeliveredAssignments(record.id, assignments);
      return;
    }
    let lifecycle: ExtractedLifecycle | undefined;
    try {
      lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
    } catch {
      await this.releaseUndeliveredAssignments(record.id, assignments);
      return;
    }
    for (const assignment of assignments) {
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === assignment.slotId && candidate.projectId === record.projectId);
      if (!worker?.sessionId) {
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
        continue;
      }
      // Never DISPATCH to a worker whose process has already terminated. A restart
      // reconciles a prior-run worker to a terminal `process` (`exited`/`spawn-failed`/
      // `canceled`) but RETAINS its `sessionId` (team-lifecycle-store reconcileStartup),
      // so a recovered board can re-dispatch a completed unit to that stale sessionId.
      // The dead session's `reply()` may still be accepted by the surviving PTY (or the
      // agent-state sits at a stale busy value), so the assignment is counted delivered,
      // the worker never heartbeats, and the claim churns dispatch↔lease-reclaim to the
      // run timeout (live run f0f44413: 5/6 units done, 6th reclaimed 3× then timed out).
      // Release instead → coordinator parks (HUMAN_BLOCKER). Deterministic, not a
      // liveness heuristic — a terminal process is authoritative.
      if (worker.process && DEAD_WORKER_PROCESSES.has(worker.process)) {
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
        continue;
      }
      // Never TYPE an assignment into a dead-agent's surviving shell (remote-opencode
      // zombie: outer wrapper alive, inner agent gone — a raw stdin write would be
      // eval'd by the bash prompt). Release instead; the next dispatch/reconcile cycle
      // re-delivers once a healthy worker exists or parks the coordinator. `'unknown'`/
      // `'alive'`/unwired ⇒ deliver as before (claude-family path byte-unchanged).
      if (this.deps.getWorkerLiveness?.(worker.sessionId) === 'dead') {
        // Same dead-agent zombie as the reconcile path: release the assignment
        // AND reap the surviving outer shell/tmux wrapper (host tmux-kill close).
        this.deps.closeWorkerSession?.(worker.sessionId);
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
        continue;
      }
      const unit = record.workUnits?.find((candidate) => candidate.id === assignment.workUnitId);
      const model = record.resolvedModels.find((candidate) => candidate.slotId === assignment.slotId);
      const authorization = record.authorizationContext?.slots.find((candidate) => candidate.slotId === assignment.slotId);
      if (this.deps.routingEnforcementEnabled?.() === true && unit?.routing && authorization) {
        const eligibility = evaluateSlotEligibility(unit.routing, {
          slotId: assignment.slotId, personaId: authorization.personaId, provider: model?.provider, model: model?.model,
          level: model?.level, roleOwnedModel: model?.roleOwnedModel, capabilities: model?.capabilities,
          modalities: model?.modalities, maxContextBytes: model?.maxContextBytes, health: model?.health,
          observedAt: model?.observedAt, maxAgeMs: model?.maxAgeMs
        });
        if (eligibility.status !== 'PASS') {
          await this.releaseUndeliveredAssignments(record.id, [assignment]);
          continue;
        }
      }
      const upstream = dependencyResultsSection(record, assignment.workUnitId);
      const claim = assignment.claimId && assignment.claimGeneration
        ? `\nClaim fence: claimId=${assignment.claimId}; claimGeneration=${assignment.claimGeneration}. Include both in execution.work.heartbeat and every structured work outcome.`
        : '';
      const text = `You are assigned work unit \`${assignment.workUnitId}\`${assignment.title ? ` — ${assignment.title}` : ''}.\nTask: ${assignment.task}${assignment.files?.length ? `\nFile scope: ${assignment.files.join(', ')}` : ''}${upstream}${claim}\n\nClose the unit through exactly one structured outcome: execution.work.complete, execution.work.block, execution.work.fail, or execution.work.release. Do not send routine progress or results to the coordinator.`;
      try {
        // Idle-gated: never inject an assignment into a mid-turn worker (the
        // cascade fires from the worker's own completion, so it is busy). Falls
        // back to the raw reply when the host doesn't wire the idle-gated dep.
        const deliver = this.deps.deliverToWorker ?? this.deps.replyToSession;
        const delivered = deliver(worker.sessionId, text);
        if (delivered) {
          try { this.deps.triggerDeliveryDrain?.(worker.sessionId); } catch { /* nudge best-effort */ }
        } else {
          await this.releaseUndeliveredAssignments(record.id, [assignment]);
        }
      } catch {
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
      }
    }
  }

  private async releaseUndeliveredAssignments(executionId: string, assignments: ExecutionDispatchAssignment[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const record = await this.deps.store.releaseUndelivered(executionId, assignments);
        if (record.coordinatorState === 'PARKED') {
        await this.wakeCoordinator(record, { cause: 'HUMAN_BLOCKER', message: `HUMAN_BLOCKER: ${assignments.length} work assignment(s) could not be delivered; retry dispatch or recover workers.`, stateOrClaimGeneration: record.state });
        }
        return;
      } catch (error) {
        if (attempt === 0) continue;
        console.error(`[execution] failed to release undelivered assignments for ${executionId}`, {
          assignments: assignments.map(({ workUnitId, slotId }) => ({ workUnitId, slotId })), error
        });
      }
    }
  }

  async failWork(binding: ExecutionCohortBinding, workUnitId: string, failure: string, failureCode: ExecutionFailureCode = 'UNKNOWN', claim?: { claimId: string; claimGeneration: number }, requireClaim = false) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can fail work');
    const outcome = await this.mutateBound(binding, (record) => claim
      ? this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, failure, failureCode, claim, requireClaim)
      : this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, failure, failureCode, undefined, requireClaim));
    if (outcome.ok) {
      await this.cascadeDispatch(outcome.value.id, binding.slotId);
      if (failureCode === 'SEMANTIC_CONFLICT' || failureCode === 'POLICY_ESCALATION') {
        await this.wakeCoordinator(outcome.value, { cause: failureCode, message: `${failureCode}: work unit ${workUnitId} requires coordinator resolution.`, workUnitId, stateOrClaimGeneration: String(claim?.claimGeneration ?? outcome.value.state) });
      } else {
        await this.maybeAutoFinalize(outcome.value.id);
      }
    }
    return outcome;
  }

  async blockWork(binding: ExecutionCohortBinding, workUnitId: string, blocker: { id: string; question: string; options?: string[]; audience?: 'human' | 'coordinator' }, claim?: { claimId: string; claimGeneration: number }, requireClaim = false) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can block work');
    const result = await this.mutateBound(binding, (record) => claim
      ? this.deps.store.blockWork(record.id, record.stateVersion, binding, workUnitId, blocker, claim, requireClaim)
      : this.deps.store.blockWork(record.id, record.stateVersion, binding, workUnitId, blocker, undefined, requireClaim));
    if (result.ok) {
      const record = result.value;
      if (blocker.audience === 'coordinator') {
        // Self-heal lane: a worker asking the coordinator for a plan/spec
        // decision it cannot make itself. Wake the coordinator to answer it via
        // execution.work.answer — NO human inbox entry (no human is involved).
        // The wake message is injected verbatim into the coordinator session
        // (drainCoordinatorWake), so it must carry the blockerId the coordinator
        // needs to answer, plus the worker's question.
        await this.wakeCoordinator(record, { cause: 'SEMANTIC_CONFLICT', message: `SEMANTIC_CONFLICT: work unit ${workUnitId} needs a coordinator decision (blockerId=${blocker.id}). Answer with execution.work.answer. Worker asks: ${blocker.question}`, workUnitId, stateOrClaimGeneration: String(claim?.claimGeneration ?? record.state) });
      } else {
        await this.wakeCoordinator(record, { cause: 'HUMAN_BLOCKER', message: `HUMAN_BLOCKER: work unit ${workUnitId} requires human input.`, workUnitId, stateOrClaimGeneration: String(claim?.claimGeneration ?? record.state) });
        // Human blockers must always accept a concrete typed value. Workers may
        // provide useful quick choices, but labels such as "Provide path" are
        // actions rather than answers and cannot resolve the blocker by themselves.
        const questionData = blocker.options
          ? buildInboxQuestion({ options: blocker.options, allowOther: true }, true)
          : {};
        void this.deps.inbox?.append({
          projectId: binding.projectId,
          subject: record.jobTitle || 'Job Execution Blocked',
          comments: blocker.question,
          executionId: record.id,
          blockerId: blocker.id,
          ...questionData
        }).catch((err) => {
          console.error('Failed to append linked inbox entry for execution blocker', err);
        });
      }
    }
    return result;
  }

  /**
   * Coordinator answers a coordinator-directed blocker (audience `'coordinator'`)
   * — the self-heal loop. Reuses the exact owner delivery machinery
   * ({@link enqueueOwnedBlocker}): the answer is enqueued as a PENDING delivery
   * to the blocked worker's slot; the worker pulls it with
   * `execution.delivery.pull` and its `execution.delivery.ack(delivered:true)`
   * atomically resolves the blocker and returns the unit to CLAIMED (see
   * store.ackBlockerDelivery). Authorization diverges from the owner path
   * (`getAuthorizedForControl`): a cohort caller has no `callerPrincipalId`, so
   * this gates on the bound `orchestrator` role plus the blocker's
   * `audience === 'coordinator'`. A `'human'` blocker is rejected — it still
   * needs the owner.
   */
  async answerBlockerByCoordinator(binding: ExecutionCohortBinding, blockerId: string, answer: string) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can answer a coordinator-directed blocker');
    if (!blockerId.trim() || !answer.trim() || Buffer.byteLength(answer, 'utf8') > 16 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker answer request' };
    }
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    if (blocker.audience !== 'coordinator') return deniedBound('blocker requires owner resolution');
    // Deterministic idempotency key: one coordinator answer per blocker. A retry
    // of the same answer replays; a re-block mints a fresh blocker id.
    const clientRequestId = `${record.id}:${blocker.id}:coordinator-answer`;
    return this.enqueueOwnedBlocker(record, record.stateVersion, blocker, clientRequestId, answer, true);
  }

  /**
   * Background sweep: escalate stuck coordinator self-heal blockers to a human.
   * A `'coordinator'` blocker the coordinator never answered — unresolved, no
   * in-flight delivery, older than {@link COORDINATOR_BLOCKER_ESCALATE_MS}, not
   * already escalated — is flipped to `'human'` (store.escalateBlockerToHuman)
   * and surfaced via the SAME human-blocker inbox append as {@link blockWork}.
   * This is the fallback for a parked/stuck coordinator so a run never wedges
   * silently on a self-heal ask the coordinator can't answer. Best-effort and
   * per-blocker isolated (one failure never blocks the rest); idempotent via the
   * store's `escalatedAt` guard. Runs on the same reconcile cadence as
   * {@link reconcileActive}/{@link redispatchStalled} (host.ts reconcile tick).
   */
  async escalateStaleCoordinatorBlockers(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    let active: ExecutionRecord[];
    try {
      active = await this.deps.store.listActive();
    } catch (error) {
      this.deps.logError?.('execution.escalateStaleCoordinatorBlockers list failed', error);
      return;
    }
    for (const record of active) {
      for (const blocker of record.blockers ?? []) {
        if (blocker.resolved || blocker.audience !== 'coordinator' || blocker.escalatedAt !== undefined) continue;
        if (now - blocker.createdAt < COORDINATOR_BLOCKER_ESCALATE_MS) continue;
        // A coordinator answer already in flight → let it land; not stuck.
        if ((record.deliveries ?? []).some((delivery) => delivery.blockerId === blocker.id && (delivery.state === 'PENDING' || delivery.state === 'LEASED'))) continue;
        try {
          await this.deps.store.escalateBlockerToHuman(record.id, blocker.id);
        } catch {
          // Lost a race (resolved / escalated / answered concurrently) — skip.
          continue;
        }
        // Human blockers always accept a concrete typed value; quick choices are
        // an optional add-on. Same shape as blockWork's human path.
        const questionData = blocker.options
          ? buildInboxQuestion({ options: blocker.options, allowOther: true }, true)
          : {};
        void this.deps.inbox?.append({
          projectId: record.projectId,
          subject: record.jobTitle || 'Job Execution Blocked',
          comments: blocker.question,
          executionId: record.id,
          blockerId: blocker.id,
          ...questionData
        }).catch((err) => {
          (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))('Failed to append inbox entry for escalated coordinator blocker', err);
        });
      }
    }
  }

  async releaseWork(binding: ExecutionCohortBinding, workUnitId: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can release work');
    const outcome = await this.mutateBound(binding, (record) => claim
      ? this.deps.store.releaseWork(record.id, record.stateVersion, binding, workUnitId, claim, requireClaim)
      : this.deps.store.releaseWork(record.id, record.stateVersion, binding, workUnitId, undefined, requireClaim));
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id, binding.slotId); // released unit → READY → re-dispatch (prefer an idle peer over the just-released slot)
    return outcome;
  }

  async retryWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string) {
    const admission = await this.budgetAdmission(binding.executionId);
    if (!admission.ok) return admission;
    const outcome = await this.mutateBound(binding, (record) => this.deps.store.retryWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id);
    return outcome;
  }

  async retryWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string, assignedSlotId?: string) {
    const outcome = await this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.retryWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId));
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id);
    return outcome;
  }

  async releaseWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string) {
    let releasedSlotId: string | undefined;
    const outcome = await this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => {
        releasedSlotId = record.workUnits?.find((unit) => unit.id === workUnitId)?.assignedSlotId;
        return this.deps.store.releaseWork(record.id, expectedStateVersion, authority, workUnitId);
      });
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id, releasedSlotId);
    return outcome;
  }

  async reassignWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string, assignedSlotId: string) {
    const outcome = await this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.reassignWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId));
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id);
    return outcome;
  }

  async reportBoundEvent(binding: ExecutionCohortBinding, input: Omit<Parameters<ExecutionServiceDeps['store']['producerEvent']>[1], 'slotId' | 'producerRole'>) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    try { return { ok: true as const, value: await this.deps.store.producerEvent(record.id, { ...input, slotId: binding.slotId, producerRole: binding.role }) }; }
    catch (error) { return invalidBound(error); }
  }

  async putBoundArtifact(binding: ExecutionCohortBinding, name: string, mediaType: string, content: string) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    try {
      const artifact = await this.deps.artifacts.put({ executionId: record.id, attempt: record.attempt, projectId: record.projectId, name, mediaType, content, producerRole: binding.role, producerSlotId: binding.slotId });
      return artifact.outcome === 'conflict' ? { ok: false as const, code: 'CONFLICT', message: 'artifact name already has different content' } : { ok: true as const, value: artifact.record };
    } catch (error) { return invalidBound(error); }
  }

  async listBoundArtifacts(binding: ExecutionCohortBinding) {
    const record = await this.getBound(binding);
    return record ? { ok: true as const, value: await this.deps.artifacts.list(record.id, record.projectId) } : deniedBound('execution not found for bound cohort');
  }

  async listSources(binding: ExecutionCohortBinding, page: { offset?: number; limit?: number }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can read execution sources');
    if (!record.request.sourceBundle || !this.deps.sources) return { ok: false as const, code: 'NOT_FOUND', message: 'execution has no sources' };
    try { return { ok: true as const, value: await this.deps.sources.list(record.request.sourceBundle.contentRef, page, record.request.sourceBundle.sources, async (sources) => {
      await this.deps.store.upgradeSourceBundle(record.id, record.request.sourceBundle!.sources, sources);
    }) }; } catch (error) { return invalidBound(error); }
  }

  async readSource(binding: ExecutionCohortBinding, sourceId: string, page: { offset?: number; maxBytes?: number }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can read execution sources');
    if (!record.request.sourceBundle?.sources.some((source) => source.id === sourceId) || !this.deps.sources) return { ok: false as const, code: 'NOT_FOUND', message: 'execution source not found' };
    try { return { ok: true as const, value: await this.deps.sources.read(record.request.sourceBundle.contentRef, sourceId, page, record.request.sourceBundle.sources, async (sources) => {
      await this.deps.store.upgradeSourceBundle(record.id, record.request.sourceBundle!.sources, sources);
    }) }; } catch (error) { return invalidBound(error); }
  }

  async completeByCoordinatorBinding(binding: ExecutionCohortBinding, correlationExecutionId: string | undefined, summary: string) {
    if (binding.role !== 'orchestrator' || correlationExecutionId && correlationExecutionId !== binding.executionId) return deniedBound('execution not found for bound coordinator');
    if (binding.principalId) await this.observeSessionUsage(binding.executionId, binding.principalId, 'terminal').catch((error) => this.deps.logError?.(`execution usage capture failed for ${binding.executionId}`, error));
    const current = await this.getBound(binding);
    const evidence = current ? await this.terminalEvidence(current) : { artifacts: [], events: [] };
    const result = await this.mutateBound(binding, (record) => this.deps.store.completeExecution(record.id, record.stateVersion, summary, evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true));
    if (result.ok) {
      await this.cleanupTerminal(result.value);
      await this.deps.cancelTeamLaunch(result.value.callerPrincipalId, result.value.teamLaunchRequestId);
    }
    return result;
  }

  async retry(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    let retry: ExecutionRecord;
    this.beginStarting(record.id);
    try {
      retry = await this.deps.store.beginRetry(record.id, expectedStateVersion);
    } catch (error) {
      this.endStarting(record.id);
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'RETRY_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
    }
    const request = retry.request;
    const admissionRequest: ExecutionRequestV1 = {
      ...request,
      teamId: retry.teamId,
      launchRequestId: retry.launchRequestId,
      workUnits: retry.workUnits?.map(({ state: _state, assignedSlotId: _assigned, attempt: _attempt, failureCode: _code, failure: _failure, result: _result, history: _history, ...unit }) => unit),
      coordinationMode: retry.coordinationMode
    };
    let issuedAuthorizationIds: string[] = [];
    try {
      let admission: TeamAdmissionResultV1;
      try {
        admission = await this.dryRun(projectId, admissionRequest);
      } catch (error) {
        this.deps.logError?.(`Team retry admission input failed for ${projectId}:${retry.launchRequestId}`, error);
        const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', 'Team admission could not be evaluated');
        return { ok: false as const, code: 'ADMISSION_FAILED', message: 'Team admission could not be evaluated', value: blocked };
      }
      if (!admission.ready) {
        const failed = admission.checks.find((check) => check.required && check.status !== 'PASS');
        const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', failed?.message ?? 'Team admission failed');
        return { ok: false as const, code: 'ADMISSION_FAILED', message: failed?.message ?? 'Team admission failed', value: blocked };
      }
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(retry.teamId, request.workflow);
        if (!preflight?.ok) {
          const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', preflight?.message ?? 'workflow profile is unavailable');
          return { ok: false as const, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: preflight?.message ?? 'workflow profile is unavailable', value: blocked };
        }
      }
      const authorization = await this.deps.authorizeTeamLaunch(
        retry.callerPrincipalId, retry.teamId, projectId, retry.teamLaunchRequestId,
        request.policy ?? {}, request.slots, retry.coordinationMode, admission.digest
      );
      if (!authorization.ok || !authorization.value.context) {
        if (authorization.ok) {
          issuedAuthorizationIds = authorization.value.slots.map((slot) => slot.authorizationId);
          await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
        }
        const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', authorization.ok ? 'Team authorization context unavailable' : authorization.message);
        return { ok: false as const, code: authorization.ok ? 'AUTHORIZATION_CONTEXT_UNAVAILABLE' : authorization.code, message: authorization.ok ? 'Team authorization context unavailable' : authorization.message, value: blocked };
      }
      issuedAuthorizationIds = authorization.value.slots.map((slot) => slot.authorizationId);
      let current = await this.deps.store.setAuthorizationContext(retry.id, retry.stateVersion, authorization.value.context, launchDigest(authorization.value.context));
      current = await this.deps.store.prepareLaunchIntent(current.id, current.stateVersion, {
        version: 1, authorizationContextDigest: current.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask }) => ({ slotId, personaId, initialTaskDigest: launchDigest(initialTask) }))
      });
      let revalidatedAdmission: TeamAdmissionResultV1;
      try {
        revalidatedAdmission = await this.dryRun(projectId, admissionRequest);
      } catch (error) {
        this.deps.logError?.(`Team retry admission revalidation failed for ${projectId}:${retry.launchRequestId}`, error);
        const blocked = await this.transitionOrCurrent(current, 'BLOCKED', 'warning', 'Team admission could not be revalidated');
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'STALE_PREFLIGHT', message: 'Team admission could not be revalidated', value: blocked };
      }
      if (!revalidatedAdmission.ready || revalidatedAdmission.digest !== admission.digest) {
        const failed = revalidatedAdmission.checks.find((check) => check.required && check.status !== 'PASS');
        const message = failed?.message ?? 'Team admission changed after authorization';
        const blocked = await this.transitionOrCurrent(current, 'BLOCKED', 'warning', message);
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'STALE_PREFLIGHT', message, value: blocked };
      }
      if (!await this.launchMayProceed(current)) {
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed before Team retry launch', value: await this.deps.store.get(current.id) };
      }
      const launched = await this.deps.launchTeam(retry.teamId, projectId, {
        callerPrincipalId: retry.callerPrincipalId, launchRequestId: retry.teamLaunchRequestId,
        slots: authorization.value.slots, policy: request.policy, requirePreauthorization: true, admissionDigest: authorization.value.admissionDigest,
        executionId: retry.id, executionJobTitle: retry.jobTitle,
        ...(retry.coordinationMode ? { coordinationMode: retry.coordinationMode } : {}),
        ...(retry.origin ? { origin: retry.origin } : {}),
        ...(isDurableCoordination(retry.coordinationMode) ? { jobContext: {
          objective: request.objective?.trim() || retry.jobTitle,
          title: retry.jobTitle,
          ...(retry.summary ? { summary: retry.summary } : {}),
          ...(request.sourceBundle ? { sourceBundle: request.sourceBundle } : {})
        } } : {})
      });
      if (!launched.ok) {
        await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
        const failed = await this.failLaunch(current, launched.message ?? 'Team launch failed');
        return { ok: false as const, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed', value: failed };
      }
      if (!await this.launchMayProceed(current)) {
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed during Team retry launch', value: await this.deps.store.get(current.id) };
      }
      return { ok: true as const, value: await this.transitionOrCurrent(current, 'RUNNING', 'info', 'Team retry launch started') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
      return { ok: false as const, code: 'TEAM_LAUNCH_FAILED', message, value: await this.failLaunch(retry, `Team retry launch error: ${message}`) };
    } finally {
      this.endStarting(record.id);
    }
  }

  async putArtifact(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    name: string,
    mediaType: string,
    content: string
  ): Promise<{ ok: true; value: ExecutionArtifactRecord } | { ok: false; code: string; message: string }> {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    try {
      const artifact = await this.deps.artifacts.put({
        executionId: record.id, attempt: record.attempt, projectId, name, mediaType, content
      });
      if (artifact.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'artifact name already has different content' };
      await this.emitOrCurrent(record, 'info', `Artifact recorded: ${artifact.record.name}`);
      return { ok: true, value: artifact.record };
    } catch (error) {
      return { ok: false, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listArtifacts(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.deps.artifacts.list(record.id, projectId) : undefined;
  }

  async readArtifact(callerPrincipalId: string, projectId: string, executionId: string, artifactId: string) {
    const artifacts = await this.listArtifacts(callerPrincipalId, projectId, executionId);
    return artifacts?.find((artifact) => artifact.id === artifactId);
  }

  /** Trusted main-side policy evaluator entrypoint. Never expose through session MCP. */
  async recordPolicyResult(projectId: string, executionId: string, raw: unknown) {
    const record = await this.deps.store.get(executionId);
    if (record?.projectId !== projectId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for project' };
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    const result = validateWorkflowPolicyResult(raw);
    if (!result || result.executionId !== record.id || result.attempt !== record.attempt) {
      return { ok: false as const, code: 'INVALID', message: 'policy result does not bind this execution attempt' };
    }
    try {
      const updated = await this.deps.store.setPolicyResult(record.id, record.stateVersion, result);
      if (result.status === 'BLOCKED' || result.status === 'FAILED') {
        await this.wakeCoordinator(updated, { cause: 'POLICY_ESCALATION', message: `POLICY_ESCALATION: optional policy is ${result.status}.`, stateOrClaimGeneration: updated.state });
      }
      return { ok: true as const, value: updated };
    } catch (error) {
      return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async wakeCoordinator(record: ExecutionRecord, wake: string | Parameters<ExecutionServiceDeps['store']['queueCoordinatorWake']>[1]): Promise<void> {
    const logError = this.deps.logError ?? ((context: string, error: unknown) => console.error(context, error));
    let current: ExecutionRecord;
    try {
      current = await this.deps.store.queueCoordinatorWake(record.id, wake);
    } catch (error) {
      logError(`execution coordinator wake persistence failed for ${record.id}`, error);
      return;
    }
    try {
      const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(current.callerPrincipalId, current.teamLaunchRequestId));
      if (lifecycle?.orchestratorSessionId) {
        await this.drainCoordinatorWake(record.projectId, record.id, lifecycle.orchestratorSessionId);
        this.deps.triggerDeliveryDrain?.(lifecycle.orchestratorSessionId);
      }
    } catch (error) {
      logError(`execution coordinator wake delivery failed for ${record.id}`, error);
    }
  }

  /**
   * Retries a durable coordinator wake after busy/restart loss. Driven by BOTH the
   * host idle-edge hook AND the reconcile-tick poll ({@link drainPendingCoordinatorWakes})
   * — the poll is load-bearing for a remote coordinator that never emits a raw idle edge.
   */
  async drainCoordinatorWake(projectId: string, executionId: string, sessionId: string): Promise<void> {
    try {
      // RISK-1 fix: never wedge a wake into a busy coordinator TUI and ack it away.
      // A definitively-busy state (working/blocked) keeps the wake queued (no reply,
      // no ack) until the coordinator's next at-rest edge. An ambiguous `unknown`
      // state (a meshless remote coordinator, or startup) is delivered once the wake
      // has aged past COORDINATOR_WAKE_UNKNOWN_STALE_MS. When getAgentState is unwired
      // (tests / meshless hosts) the state is undefined → deliver immediately.
      for (let delivered = 0; delivered < 100; delivered += 1) {
        const record = await this.deps.store.getInProject(projectId, executionId);
        const wake = record?.coordinatorWakes?.[0];
        if (!record || !wake) return;
        const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
        if (lifecycle?.orchestratorSessionId !== sessionId) return;
        const state = this.deps.getAgentState?.(sessionId);
        if (state !== undefined && !isRestfulAgentState(state)) {
          // Non-restful. `unknown` is ambiguous — an untracked remote/opencode
          // coordinator (no mesh dot) sits here permanently, so a hard block would
          // strand the wake. Deliver once it has been queued past a short staleness
          // bound (a transient startup `unknown` clears first). Any OTHER non-restful
          // state (working/blocked, or a future busy state) is a live turn: always
          // wait for the at-rest edge so a wake never wedges mid-output.
          if (state !== 'unknown') return;
          if ((this.deps.now ?? Date.now)() - wake.createdAt < COORDINATOR_WAKE_UNKNOWN_STALE_MS) return;
        }
        if (!this.deps.replyToSession(sessionId, wake.message)) return;
        await this.deps.store.acknowledgeCoordinatorWake(record.id, wake.id);
      }
    } catch (error) {
      (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(`execution coordinator wake drain failed for ${executionId}`, error);
    }
  }

  /**
   * Reconcile-driven backstop: re-drain queued coordinator wakes for every active
   * execution. The host idle-edge retry fires only on a raw `idle` edge, which an
   * untracked remote/opencode coordinator (no mesh telemetry) never emits — so
   * without this poll its wake would sit queued forever and the coordinator would
   * park on an unanswered self-heal ask, the exact root cause the escalation
   * fallback only masks. Runs on the same reconcile cadence as
   * {@link escalateStaleCoordinatorBlockers}; delivery stays gated by
   * {@link drainCoordinatorWake} (working/blocked hard-block, `unknown` after the
   * staleness bound). Best-effort and per-record isolated; never throws.
   */
  async drainPendingCoordinatorWakes(): Promise<void> {
    let active: ExecutionRecord[];
    try {
      active = await this.deps.store.listActive();
    } catch (error) {
      this.deps.logError?.('execution.drainPendingCoordinatorWakes list failed', error);
      return;
    }
    for (const record of active) {
      if (!record.coordinatorWakes?.length) continue;
      try {
        const sessionId = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId))?.orchestratorSessionId;
        if (sessionId) await this.drainCoordinatorWake(record.projectId, record.id, sessionId);
      } catch (error) {
        this.deps.logError?.(`execution.drainPendingCoordinatorWakes failed for ${record.id}`, error);
      }
    }
  }

  async stop(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    return this.stopOwned(record, expectedStateVersion);
  }

  async dismiss(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      // Terminal execution history can hide only after its Team teardown has
      // started. Otherwise a failed job card disappears while live workers keep
      // running as orphaned terminal cards.
      const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      const lifecycle = extractLifecycleInfo(rawLifecycle);
      const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      if (!canceled.ok && canceled.code !== 'NOT_FOUND') {
        return {
          ok: false as const,
          code: canceled.code ?? 'CANCEL_FAILED',
          message: canceled.message ?? 'Team cancellation failed'
        };
      }
      await this.deps.store.dismiss(record.id);
      return {
        ok: true as const,
        value: { dismissedSessionIds: lifecycle?.workers?.flatMap((worker) => worker.sessionId ? [worker.sessionId] : []) ?? [] }
      };
    } catch (error) {
      return { ok: false as const, code: 'DISMISS_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async respond(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, response: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, response, false);
  }

  async resume(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, message: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, message, true);
  }

  async respondToBlocker(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string) {
    return this.deliverToBlocker(callerPrincipalId, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message, false);
  }

  async resumeBlocker(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string) {
    return this.deliverToBlocker(callerPrincipalId, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message, true);
  }

  async retryBlockerDelivery(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, deliveryId: string) {
    if (!blockerId.trim() || !deliveryId.trim()) return { ok: false as const, code: 'INVALID', message: 'invalid execution delivery retry request' };
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      return { ok: true as const, value: await this.deps.store.retryBlockerDelivery(record.id, expectedStateVersion, blockerId, deliveryId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async pullDelivery(binding: ExecutionCohortBinding) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    const current = await this.currentCohortIdentity(record, binding);
    if (!current) return deniedBound('execution delivery route is not current');
    try { return { ok: true as const, value: await this.deps.store.pullBlockerDelivery({ ...binding, ...current }) ?? null }; }
    catch (error) { return invalidBound(error); }
  }

  async ackDelivery(binding: ExecutionCohortBinding, deliveryId: string, leaseId: string, result: { delivered: boolean; error?: string }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    const current = await this.currentCohortIdentity(record, binding);
    if (!current) return deniedBound('execution delivery route is not current');
    try {
      const ack = await this.deps.store.ackBlockerDelivery({ ...binding, ...current }, deliveryId, leaseId, result);
      return { ok: true as const, value: {
        deliveryId: ack.delivery.id, blockerId: ack.delivery.blockerId, state: ack.delivery.state,
        resolved: ack.delivery.state === 'DELIVERED', outcome: ack.outcome
      } };
    } catch (error) { return invalidBound(error); }
  }

  /** Only the live Team coordinator can declare a durable job complete. */
  async completeByCoordinator(callerPrincipalId: string, projectId: string, executionId: string, summary: string) {
    if (!summary.trim() || summary.length > 64 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution completion summary' };
    }
    const record = await this.deps.store.getInProject(projectId, executionId);
    if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution is not active' };
    }
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    const isOriginalCoordinator = lifecycle?.orchestratorSessionId === callerPrincipalId;
    const isBoundMonitor = record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId) ?? false;
    if (!isOriginalCoordinator && !isBoundMonitor) {
      return { ok: false as const, code: 'DENIED', message: 'only the Team coordinator can complete this execution' };
    }
    try {
      await this.observeSessionUsage(record.id, callerPrincipalId, 'terminal').catch((error) => this.deps.logError?.(`execution usage capture failed for ${record.id}`, error));
      const current = (await this.deps.store.get(record.id)) ?? record;
      const evidence = await this.terminalEvidence(current);
      const completed = await this.deps.store.completeExecution(current.id, current.stateVersion, summary.trim(), evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true);
      await this.cleanupTerminal(completed);
      await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      return { ok: true as const, value: completed };
    } catch (error) {
      return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Main-only PTY-exit hook. Jobs survive a lost coordinator for monitor recovery. */
  async handleCoordinatorExit(projectId: string, executionId: string, sessionId: string) {
    const record = await this.deps.store.getInProject(projectId, executionId);
    if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') return;
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    if (lifecycle?.orchestratorSessionId !== sessionId) return;
    await this.emitOrCurrent(record, 'warning', 'Coordinator exited; execution remains available for monitor recovery');
  }

  /** Caller validated a consumed handoff; source owner remains bound for lifecycle work. */
  async controlWithHandoff(
    authority: { sourceOwnerSessionId: string; projectId: string; executionId: string },
    action: 'stop' | 'respond' | 'resume',
    expectedStateVersion: number,
    slotId?: string,
    message?: string
  ) {
    const record = await this.getAuthorized(authority.sourceOwnerSessionId, authority.projectId, authority.executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution handoff no longer matches an execution owner' };
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    if (action === 'stop') return this.stopOwned(record, expectedStateVersion);
    if (!slotId || !message) return { ok: false as const, code: 'INVALID', message: 'execution handoff requires slotId and message' };
    return this.deliverOwned(record, expectedStateVersion, slotId, message, action === 'resume');
  }

  private async getAuthorized(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.deps.store.get(executionId);
    return record && record.callerPrincipalId === callerPrincipalId && record.projectId === projectId ? record : undefined;
  }

  private async getBound(binding: ExecutionCohortBinding) {
    return this.deps.store.getInProject(binding.projectId, binding.executionId);
  }

  private async currentCohortIdentity(record: ExecutionRecord, binding: ExecutionCohortBinding): Promise<{ principalId: string; authorizationId?: string } | undefined> {
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    if (binding.role === 'orchestrator') {
      return lifecycle?.orchestratorSessionId && lifecycle.orchestratorSessionId === binding.principalId
        ? { principalId: lifecycle.orchestratorSessionId, ...(lifecycle.orchestratorAuthorizationId ? { authorizationId: lifecycle.orchestratorAuthorizationId } : {}) }
        : undefined;
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === binding.slotId
      && candidate.projectId === record.projectId);
    return worker?.sessionId && worker.sessionId === binding.principalId
      ? { principalId: worker.sessionId, ...(worker.authorizationId ? { authorizationId: worker.authorizationId } : {}) }
      : undefined;
  }

  private async mutateBound(binding: ExecutionCohortBinding, operation: (record: ExecutionRecord) => Promise<ExecutionRecord>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await this.getBound(binding);
      if (!record) return deniedBound('execution not found for bound cohort');
      if (isResumeGrantTerminal(record.state)) return terminalBound(record);
      try { return { ok: true as const, value: await operation(record) }; }
      catch (error) {
        // Bound workers do not choose expectedStateVersion; main reads it for
        // them. Parallel exact claim-fenced outcomes may read same version, so
        // refresh once. Store claimId+generation checks still reject stale work.
        if (attempt === 0 && error instanceof Error && error.message === 'stale execution state') continue;
        return error instanceof Error && /another slot|only coordinator/.test(error.message) ? deniedBound(error.message) : invalidBound(error);
      }
    }
    return invalidBound(new Error('stale execution state'));
  }

  private async mutateOwnedWork(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    operation: (record: ExecutionRecord, authority: ExecutionCohortAuthority) => Promise<ExecutionRecord>
  ) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (!Number.isInteger(expectedStateVersion)) return { ok: false as const, code: 'INVALID', message: 'invalid execution work control request' };
    try {
      return { ok: true as const, value: await operation(record, { role: 'orchestrator', slotId: 'board:owner' }) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async getAuthorizedForControl(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.deps.store.get(executionId);
    return record && record.projectId === projectId
      && (record.callerPrincipalId === callerPrincipalId || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId)) ? record : undefined;
  }

  async resumeBinding(callerPrincipalId: string, projectId: string, executionId: string, token: string) {
    return this.serializeBinding(executionId, async () => {
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (!record || isResumeGrantTerminal(record.state) || !this.deps.resumeGrants) {
        return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
      }
      const pendingOwner = this.pendingBindingOwners.get(executionId);
      const ownerIds = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? []), ...(pendingOwner ? [pendingOwner] : [])];
      if (pendingOwner && pendingOwner !== callerPrincipalId) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
      }
      if (this.deps.hasLivePredecessor?.(projectId, ownerIds)) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
      }
      try {
        await this.deps.resumeGrants.consume({ token, executionId, projectId, effectiveOwnerPrincipalId: callerPrincipalId, generation: record.recoveryGeneration });
        this.pendingBindingOwners.set(executionId, callerPrincipalId);
        const value = await this.deps.store.addEffectiveOwner(executionId, callerPrincipalId);
        this.pendingBindingOwners.delete(executionId);
        return { ok: true as const, value };
      } catch (error) {
        if (this.pendingBindingOwners.get(executionId) === callerPrincipalId) {
          this.pendingBindingOwners.delete(executionId);
        }
        if (error instanceof Error && error.message === 'execution resume grant is not current') {
          return { ok: false as const, code: 'NOT_FOUND', message: error.message };
        }
        return { ok: false as const, code: 'BINDING_TRANSIENT', message: 'execution resume binding could not be persisted; retry with the same token' };
      }
    });
  }

  async rotateRecoveryGrant(projectId: string, executionId: string, expectedStateVersion: number, expectedGeneration: number) {
    return this.serializeBinding(executionId, async () => {
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for project' };
      if (isResumeGrantTerminal(record.state)) return { ok: false as const, code: 'TERMINAL', message: 'execution is terminal' };
      if (record.stateVersion !== expectedStateVersion || (record.recoveryGeneration ?? 0) !== expectedGeneration) {
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state or recovery generation' };
      }
      const owners = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? [])];
      if (this.deps.hasLivePredecessor?.(projectId, owners)) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live coordinator' };
      }
      if (!this.deps.resumeGrants) return { ok: false as const, code: 'NOT_FOUND', message: 'execution recovery is unavailable' };
      try {
        const rotated = await this.deps.resumeGrants.rotate({ executionId, projectId, callerPrincipalId: record.callerPrincipalId, expectedGeneration, expiresAt: record.recoveryDeadlineAt });
        try {
          const value = await this.deps.store.rotateRecoveryGeneration(executionId, expectedStateVersion, expectedGeneration, rotated.generation);
          await this.deps.cacheResumeToken?.(projectId, executionId, rotated.token, rotated.expiresAt);
          return { ok: true as const, value: { ...value, token: rotated.token, expiresAt: rotated.expiresAt, generation: rotated.generation } };
        } catch (error) {
          return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, code: message.includes('stale') ? 'CONFLICT' : 'ROTATE_TRANSIENT', message };
      }
    });
  }

  async mintResumeGrant(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorized(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'DENIED', message: 'caller is not authorized to mint this execution resume grant' };
    const key = `${callerPrincipalId}\u0000${projectId}\u0000${executionId}`;
    const existing = this.mintFlights.get(key);
    if (existing) return existing;
    const flight = this.mintResumeGrantOnce(callerPrincipalId, projectId, executionId);
    this.mintFlights.set(key, flight);
    try { return await flight; } finally { if (this.mintFlights.get(key) === flight) this.mintFlights.delete(key); }
  }

  private async mintResumeGrantOnce(callerPrincipalId: string, projectId: string, executionId: string) {
    return this.serializeBinding(executionId, async () => {
    const record = await this.getAuthorized(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants || isResumeGrantTerminal(record.state)) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
    }
    const owners = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? [])];
    if (this.deps.hasLivePredecessor?.(projectId, owners)) {
      return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
    }
    try {
      const grant = await this.deps.resumeGrants.rotate({ executionId, projectId, callerPrincipalId, expectedGeneration: record.recoveryGeneration ?? 0, expiresAt: record.recoveryDeadlineAt });
      const value = await this.deps.store.rotateRecoveryGeneration(executionId, record.stateVersion, record.recoveryGeneration ?? 0, grant.generation);
      await this.deps.cacheResumeToken?.(projectId, executionId, grant.token, grant.expiresAt);
      return { ok: true as const, value: { ...grant, recoveryGeneration: value.recoveryGeneration } };
    } catch (error) {
      return { ok: false as const, code: 'MINT_TRANSIENT', message: error instanceof Error ? error.message : String(error) };
    }
    });
  }

  async revokeResumeGrant(callerPrincipalId: string, projectId: string, executionId: string, effectiveOwnerPrincipalId?: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    await this.deps.resumeGrants.revoke(executionId, projectId);
    const value = effectiveOwnerPrincipalId ? await this.deps.store.removeEffectiveOwner(executionId, effectiveOwnerPrincipalId) : record;
    return { ok: true as const, value };
  }

  async abandonResumeBinding(projectId: string, executionId: string, effectiveOwnerPrincipalId: string): Promise<void> {
    await this.serializeBinding(executionId, async () => {
      await this.deps.resumeGrants?.revokeBound(executionId, projectId, effectiveOwnerPrincipalId);
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (record?.effectiveOwnerPrincipalIds?.includes(effectiveOwnerPrincipalId)) {
        await this.deps.store.removeEffectiveOwner(executionId, effectiveOwnerPrincipalId);
      }
    });
  }

  private async deliver(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    slotId: string,
    text: string,
    resume: boolean
  ) {
    if (!slotId.trim() || !text.trim() || text.length > 64 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution slot or message' };
    }
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    return this.deliverOwned(record, expectedStateVersion, slotId, text, resume);
  }

  private async deliverToBlocker(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    blockerId: string,
    clientRequestId: string,
    text: string,
    resume: boolean
  ) {
    if (!blockerId.trim() || !clientRequestId.trim() || !text.trim() || Buffer.byteLength(text, 'utf8') > 16 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker delivery request' };
    }
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, clientRequestId, text, resume);
  }

  private async deliverOwned(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    const blockers = record.blockers?.filter((candidate) => !candidate.resolved && candidate.slotId === slotId) ?? [];
    if (blockers.length === 0) {
      // Delivery ack already resolves and resumes blocker work atomically. Some
      // workers still issue the older explicit resume step with the pre-ack
      // version; accept only an exact durable replay, never resend the message.
      const deliveredReplay = resume && record.deliveries?.some((delivery) => {
        if (delivery.state !== 'DELIVERED' || delivery.slotId !== slotId || delivery.payload.text !== text) return false;
        const blocker = record.blockers?.find((candidate) => candidate.id === delivery.blockerId);
        return blocker?.resolved === true && blocker.workUnitId === delivery.workUnitId
          && blocker.slotId === delivery.slotId && blocker.response === text;
      });
      if (deliveredReplay) return { ok: true as const, value: record, replay: true as const };
      if (record.stateVersion !== expectedStateVersion) return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: record };
      return this.deliverLegacyMessage(record, expectedStateVersion, slotId, text, resume);
    }
    if (blockers.length > 1) return { ok: false as const, code: 'CONFLICT', message: 'execution slot has multiple unresolved blockers; select exact blocker' };
    const blocker = blockers[0];
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, `${record.id}:${expectedStateVersion}:${blocker.id}`, text, resume);
  }

  private async enqueueOwnedBlocker(record: ExecutionRecord, expectedStateVersion: number, blocker: NonNullable<ExecutionRecord['blockers']>[number], clientRequestId: string, text: string, resume: boolean) {
    let enqueued: Awaited<ReturnType<ExecutionServiceDeps['store']['enqueueBlockerDelivery']>>;
    try {
      enqueued = await this.deps.store.enqueueBlockerDelivery(record.id, expectedStateVersion, {
        clientRequestId,
        blockerId: blocker.id,
        text
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    let targetSessionId: string | undefined;
    if (blocker.slotId === 'orchestrator' || blocker.slotId.startsWith('orchestrator:')) {
      targetSessionId = lifecycle?.orchestratorSessionId;
    } else {
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === blocker.slotId && candidate.projectId === record.projectId);
      targetSessionId = worker?.sessionId;
    }
    let notified = false;
    try {
      notified = !!targetSessionId && this.deps.replyToSession(targetSessionId, `Execution response pending. Pull with execution.delivery.pull for execution ${record.id}.`);
    } catch {
      notified = false;
    }
    if (targetSessionId) {
      try { this.deps.triggerDeliveryDrain?.(targetSessionId); } catch {}
    }
    return { ok: true as const, pending: true as const, notified, delivery: enqueued.delivery, value: enqueued.record, resumeRequested: resume };
  }

  private async deliverLegacyMessage(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker?.sessionId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution slot not found for caller' };
    if (!this.deps.replyToSession(worker.sessionId, text)) return { ok: false as const, code: 'SESSION_GONE', message: 'execution slot is no longer live' };
    const fenced = await this.fenceCommand(record, expectedStateVersion, resume ? 'Execution resume requested' : 'Execution response requested', slotId);
    if (!fenced.ok) return fenced;
    const current = resume && fenced.value.state === 'BLOCKED'
      ? await this.transitionOrCurrent(fenced.value, 'RUNNING', 'info', `Execution resumed through slot ${slotId}`)
      : await this.emitOrCurrent(fenced.value, 'info', `Message delivered to slot ${slotId}`);
    return { ok: true as const, value: current };
  }

  private async stopOwned(record: ExecutionRecord, expectedStateVersion: number) {
    if (record.state === 'COMPLETED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is already ${record.state.toLowerCase()}` };
    }
    if (record.state === 'FAILED') {
      if (record.stateVersion !== expectedStateVersion) return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: record };
      const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      return canceled.ok
        ? { ok: true as const, value: record, canceled: canceled.value }
        : { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    }
    const fenced = await this.fenceCommand(record, expectedStateVersion, 'Execution stop requested');
    if (!fenced.ok) return fenced;
    const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, fenced.value.teamLaunchRequestId);
    if (!canceled.ok && canceled.code !== 'NOT_FOUND') return { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    const stopped = await this.transitionOrCurrent(fenced.value, 'STOPPED', 'info', 'Execution stopped');
    return { ok: true as const, value: stopped, canceled: canceled.value };
  }

  private async fenceCommand(record: ExecutionRecord, expectedStateVersion: number, summary: string, slotId?: string) {
    try {
      return { ok: true as const, value: await this.deps.store.command(record.id, expectedStateVersion, summary, slotId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        const current = await this.deps.store.get(record.id);
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current };
      }
      throw error;
    }
  }

  private async reconcile(callerPrincipalId: string, projectId: string, record: ExecutionRecord): Promise<ExecutionRecord> {
    if (record.state === 'READY') return record;
    const deadlineMs = record.request.policy?.deadlineMs;
    if (deadlineMs && (this.deps.now ?? Date.now)() >= executionProgressAnchor(record) + deadlineMs
      && record.state !== 'COMPLETED' && record.state !== 'FAILED' && record.state !== 'STOPPED') {
      return this.timeoutExecution(record.id);
    }
    let rawLifecycle: any;
    try {
      rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.launchRequestId);
    } catch {
      // A transient lifecycle read must not turn an active execution into a
      // durable blocker during status/list polling.
      return record;
    }
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    if (!lifecycle || !Array.isArray(lifecycle.workers) || lifecycle.workers.some((worker) => worker.projectId !== projectId)) {
      if (record.state === 'STARTING' && this.starting.has(record.id)) return record;
      if (record.state === 'BLOCKED' || record.state === 'COMPLETED' || record.state === 'STOPPED' || record.state === 'FAILED') return record;
      return this.transitionOrCurrent(record, 'BLOCKED', 'warning', 'Team lifecycle record unavailable or mismatched');
    }
    if (record.state !== 'RUNNING' && record.state !== 'STARTING') return record;
    // launchTeam adds slots sequentially. Renderer polling can therefore observe
    // a partial lifecycle where every worker added so far already exited but the
    // orchestrator has not been added yet. During start(), only promote visible
    // live progress; defer terminal lifecycle conclusions until launch settles.
    if (this.starting.has(record.id)) {
      if (record.state === 'STARTING' && lifecycle.workers.some((worker) =>
        worker.process !== 'exited' && worker.process !== 'spawn-failed' && worker.process !== 'canceled')) {
        return this.transitionOrCurrent(record, 'RUNNING', 'info', 'Team launch recovered from lifecycle record');
      }
      return record;
    }
    if (lifecycle.launchResult?.failedSlots?.length) {
      const details = lifecycle.launchResult.failedSlots
        .map((slot) => {
          if (!slot || typeof slot !== 'object') return '';
          const value = slot as { slotId?: unknown; reason?: unknown };
          const slotId = typeof value.slotId === 'string' ? value.slotId : 'unknown slot';
          const reason = typeof value.reason === 'string' ? value.reason : 'unknown reason';
          return `${slotId}: ${reason}`;
        })
        .filter(Boolean)
        .join('; ');
      return this.transitionOrCurrent(record, 'FAILED', 'error', details || 'One or more Team slots failed to launch');
    }
    if (lifecycle.outcome?.status === 'completed' && lifecycle.outcome.result?.ok === false) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', lifecycle.outcome.result.message ?? 'Team launch failed');
    }
    // Worker-only Teams have no coordinator capable of explicit completion. Keep
    // their established all-worker completion contract; orchestrated jobs require
    // the coordinator's execution.complete call instead.
    if (!lifecycle.orchestratorSessionId && lifecycle.workers.length > 0
      && lifecycle.workers.every((worker) => worker.task === 'caller-reported-complete')) {
      return this.transitionOrCurrent(record, 'COMPLETED', 'info', 'All worker-only Team slots reported complete');
    }
    if (lifecycle.workers.some((worker) => worker.task === 'caller-reported-failed')) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', 'A Team slot reported failure');
    }
    if (lifecycle.workers.length > 0 && lifecycle.workers.every((worker) =>
      worker.process === 'exited' || worker.process === 'spawn-failed' || worker.process === 'canceled')) {
      // Build a self-diagnosing per-slot detail from the exit info captured at the
      // PTY exit event (exit code + provider explanation). Historically this was a
      // generic detail-less line, which is why identical undiagnosable failures
      // recurred. Fall back to the generic text only when no slot carried detail.
      const perSlot = lifecycle.workers
        .map((worker) => {
          const slotId = typeof worker.slotId === 'string' ? worker.slotId : 'unknown slot';
          if (typeof worker.exitReason === 'string' && worker.exitReason.length > 0) {
            return `${slotId}: ${worker.exitReason}`;
          }
          const hasSignal = typeof worker.exitSignal === 'number' && worker.exitSignal > 0;
          if ((typeof worker.exitCode === 'number' && worker.exitCode !== 0) || hasSignal) {
            const sig = hasSignal ? `, signal ${worker.exitSignal}` : '';
            const code = typeof worker.exitCode === 'number' ? worker.exitCode : 'unknown';
            return `${slotId}: exited code ${code}${sig}`;
          }
          return '';
        })
        .filter(Boolean);
      const detail = perSlot.length > 0
        ? `All Team slots exited without completion — ${perSlot.join('; ')}`
        : 'All Team slots exited without completion';
      return this.transitionOrCurrent(record, 'FAILED', 'error', detail);
    }
    if (record.state === 'STARTING' && lifecycle.workers.some((worker) => worker.process !== 'exited' && worker.process !== 'spawn-failed' && worker.process !== 'canceled')) {
      return this.transitionOrCurrent(record, 'RUNNING', 'info', 'Team launch recovered from lifecycle record');
    }
    return record;
  }

  private async transitionOrCurrent(
    record: ExecutionRecord,
    state: ExecutionRecord['state'],
    severity: 'info' | 'warning' | 'error',
    summary: string
  ): Promise<ExecutionRecord> {
    try {
      const updated = await this.deps.store.transition(record.id, record.stateVersion, state, severity, summary);
      if (isResumeGrantTerminal(updated.state)) await this.cleanupTerminal(updated);
      return updated;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(record.id);
      if (!current) throw error;
      return current;
    }
  }

  private beginStarting(executionId: string): void {
    this.starting.set(executionId, (this.starting.get(executionId) ?? 0) + 1);
  }

  private endStarting(executionId: string): void {
    const count = this.starting.get(executionId) ?? 0;
    if (count <= 1) this.starting.delete(executionId);
    else this.starting.set(executionId, count - 1);
  }

  private async serializeBinding<T>(executionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.bindingTails.get(executionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.bindingTails.set(executionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.bindingTails.get(executionId) === tail) this.bindingTails.delete(executionId);
    }
  }

  private async serializeUsage<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.usageTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.usageTails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.usageTails.get(key) === tail) this.usageTails.delete(key);
    }
  }

  private async failLaunch(record: ExecutionRecord, summary: string): Promise<ExecutionRecord> {
    let current = record;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (current.state !== 'STARTING' && current.state !== 'RUNNING') return current;
      try {
        const failed = await this.deps.store.transition(current.id, current.stateVersion, 'FAILED', 'error', summary);
        await this.cleanupTerminal(failed);
        return failed;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
        const refreshed = await this.deps.store.get(current.id);
        if (!refreshed) throw error;
        current = refreshed;
      }
    }
    return current;
  }

  private async emitOrCurrent(record: ExecutionRecord, severity: 'info' | 'warning' | 'error', summary: string): Promise<ExecutionRecord> {
    try {
      return await this.deps.store.event(record.id, record.stateVersion, severity, summary);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(record.id);
      if (!current) throw error;
      return current;
    }
  }

  private async cleanupTerminal(record: ExecutionRecord): Promise<void> {
    this.deadlineWatchdog.remove(record.id);
    this.planReadinessWatchdog.remove(record.id);
    try {
      await this.deps.resumeGrants?.revoke(record.id, record.projectId);
    } catch {
      // Grant and token cleanup are independent best-effort terminal work.
    }
    try {
      await this.deps.clearResumeToken?.(record.projectId, record.id);
    } catch {
      // Token cleanup is best effort; durable grant revocation already closes authority.
    }
  }

  /**
   * Watchdog fire handler. The timer was armed for a FIXED point, but the deadline
   * is measured from the run's last forward progress ({@link executionProgressAnchor}),
   * so re-read the live record before acting: if the run has progressed since the
   * timer armed (idle window not yet elapsed), RE-ARM to the fresh anchor and let it
   * keep running; only when it has genuinely made no progress for a full `deadlineMs`
   * window do we time it out. This is what lets a healthy but slow deep plan complete
   * instead of being guillotined at a fixed total cap. A throw propagates so the
   * watchdog's bounded retry still covers a transient cancel-transport failure.
   */
  private async enforceDeadline(executionId: string): Promise<void> {
    const record = await this.deps.store.get(executionId);
    if (!record) return;
    if (!isResumeGrantTerminal(record.state)) {
      const deadlineMs = record.request.policy?.deadlineMs;
      if (typeof deadlineMs === 'number' && Number.isFinite(deadlineMs) && deadlineMs > 0
        && (this.deps.now ?? Date.now)() < executionProgressAnchor(record) + deadlineMs) {
        this.deadlineWatchdog.schedule(record);
        return;
      }
    }
    await this.timeoutExecution(executionId);
  }

  private async timeoutExecution(executionId: string): Promise<ExecutionRecord> {
    const record = await this.deps.store.get(executionId);
    if (!record) throw new Error('execution not found');
    if (isResumeGrantTerminal(record.state)) {
      if (record.state === 'STOPPED') await this.cancelTimedOutLaunch(record);
      return record;
    }
    let stopped: ExecutionRecord;
    try {
      stopped = await this.deps.store.transition(record.id, record.stateVersion, 'STOPPED', 'warning', 'Execution timed out');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(executionId);
      if (!current) throw error;
      if (!isResumeGrantTerminal(current.state)) this.deadlineWatchdog.schedule(current);
      return current;
    }
    await this.cleanupTerminal(stopped);
    await this.cancelTimedOutLaunch(stopped);
    return stopped;
  }

  /**
   * Grace elapsed with no registered plan. Re-checks at fire time (the record
   * may have gained work units or already gone terminal) before failing the run
   * and cancelling its workers. Mirrors {@link timeoutExecution}'s stale-version
   * re-arm so a concurrent transition just reschedules rather than throwing.
   */
  private async failPlanlessExecution(executionId: string): Promise<void> {
    const record = await this.deps.store.get(executionId);
    if (!record) return;
    if (record.workUnits && record.workUnits.length > 0) return;
    // A prior attempt can transition to FAILED but then die before the cohort is
    // cancelled (cleanupTerminal / cancelTimedOutLaunch threw). On the watchdog's
    // retry the record is already terminal, so re-run the idempotent teardown
    // instead of returning early — otherwise the run stays FAILED with its workers
    // still live. Only THIS watchdog's own FAILED reaches here (any other terminal
    // path removes the timer via cleanupTerminal), so a COMPLETED/STOPPED run is
    // left untouched. Mirrors timeoutExecution's already-terminal re-cancel.
    if (isResumeGrantTerminal(record.state)) {
      if (record.state === 'FAILED') {
        await this.cleanupTerminal(record);
        await this.cancelTimedOutLaunch(record);
      }
      return;
    }
    let failed: ExecutionRecord;
    try {
      failed = await this.deps.store.transition(record.id, record.stateVersion, 'FAILED', 'error', 'No plan registered within startup grace');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(executionId);
      if (current) this.planReadinessWatchdog.schedule(current);
      return;
    }
    await this.cleanupTerminal(failed);
    await this.cancelTimedOutLaunch(failed);
  }

  private async launchMayProceed(record: ExecutionRecord): Promise<boolean> {
    const current = await this.deps.store.get(record.id);
    if (!current) return false;
    const deadlineMs = current.request.policy?.deadlineMs;
    const expired = typeof deadlineMs === 'number'
      && Number.isFinite(deadlineMs)
      && deadlineMs > 0
      && (this.deps.now ?? Date.now)() >= executionProgressAnchor(current) + deadlineMs;
    if (!isResumeGrantTerminal(current.state) && !expired) return true;
    if (expired || current.state === 'STOPPED') {
      try {
        await this.timeoutExecution(current.id);
      } catch {
        // Watchdog owns bounded retry; post-launch fence still prevents RUNNING.
      }
    }
    return false;
  }

  private async cancelTimedOutLaunch(record: ExecutionRecord): Promise<void> {
    const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    if (!canceled.ok) {
      throw new Error(`${canceled.code ?? 'CANCEL_FAILED'}: ${canceled.message ?? 'Team cancellation failed'}`);
    }
    this.deadlineWatchdog.remove(record.id);
  }
}

/** @deprecated Use ExecutionService. Retained for Team backend callers. */
export { ExecutionService as SquadExecutionService };

export function deriveJobTitle(request: Pick<ExecutionRequestV1, 'jobTitle' | 'summary' | 'teamId'>): string {
  const supplied = request.jobTitle?.trim();
  if (supplied) return supplied.slice(0, 240);
  const summary = request.summary?.split('\n', 1)[0]?.trim();
  return (summary || request.teamId).slice(0, 240);
}

function hasUniqueModelSlots(models: readonly ResolvedModelSnapshotV1[]): boolean {
  const slots = new Set<string>();
  for (const model of models) {
    if (!model.slotId?.trim() || !model.provider?.trim() || (model.model !== undefined && !model.model.trim()) || slots.has(model.slotId)) return false;
    slots.add(model.slotId);
  }
  return true;
}

function routeFactsNeedRefresh(record: ExecutionRecord, now = Date.now()): boolean {
  return record.resolvedModels.length === 0 || record.resolvedModels.some((model) =>
    model.observedAt === undefined || model.maxAgeMs === undefined || now < model.observedAt || now - model.observedAt > model.maxAgeMs
  );
}


function deniedBound(message: string) {
  return { ok: false as const, code: 'DENIED', message };
}

function invalidBound(error: unknown) {
  return { ok: false as const, code: error instanceof Error && error.message === 'stale execution state' ? 'CONFLICT' : 'INVALID', message: error instanceof Error ? error.message : String(error) };
}

function terminalBound(record: ExecutionRecord) {
  return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
}
