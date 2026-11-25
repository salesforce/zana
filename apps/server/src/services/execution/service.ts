import { DEFAULT_CLAIM_OUTPUT_CEILING_MS, DEFAULT_CLAIM_STALL_MS, DEFAULT_CLAIM_WALL_CLOCK_MS, isDurableCoordination, isOrchestratorSlotId, isRestfulAgentState, validateSquadExecutionTarget, type SquadExecutionTargetSelector, type AgentState, type ExecutionFailureCode, type ExecutionSourceSnapshot, type SessionStats, type SquadBundleWorkflowMetadataV1, type TeamAvailabilityUnknown, type TeamCoordinationMode, type TeamLaunchAuthorizationInputSlot, type TeamLaunchAuthorizationResult, type TeamLaunchRequestInput, type TeamRequirementFailure } from '@zana-ai/zcc-domain/product';
import { squadLaunchTextProblem } from '@zana-ai/zcc-domain/squad-proposal';
import { fitRecoveryObjective } from './recovery-objective.js';
import { createHash } from 'node:crypto';
import { confineAndHashClaimWrite, captureBaseline, buildUnitCheckpoint, MAX_RESTORE_ATTEMPTS, type UnitCheckpoint, type GitRunner } from './unit-checkpoints.js';
import { launchDigest } from '../launch/digest.js';
import { singleSeatOf, capableSeats, EXECUTION_RETENTION_MS, boundReason, formatFailedSlots, unitSlotEligibility, levelCheckSkipped, type ExecutionRoutingPolicyV1, assignmentRequirementFailures, LOOP_LIMIT_BLOCKER_PREFIX, KICKOFF_FAILURE_BLOCK_THRESHOLD, isTerminalExecutionState, isWorkerRecoveryLive, NO_PROGRESS_CLAIM_REASON, WORK_CLAIM_LEASE_MS, WorkUnitRecoveryGuardError, executionReportTarget, type ActiveClaimCursor, type ExecutionCohortAuthority, type ExecutionDispatchAssignment, type ExecutionEvent, type ExecutionLaunchDisplayV1, type ExecutionLaunchKind, type ExecutionPolicyV1, type ExecutionRecord, type ExecutionWorkUnitInput, type RetainedRecoveryMode, type ResolvedModelSnapshotV1 } from './store.js';
import { VisibilityNoticeState, IDLE_CAPACITY_NOTICE_MS, HEARTBEAT_WARN_MS, formatWait, resolveBlockerReminderMs, blockerWaitStart, workerNoticeLabel, blockerWaiter, unitNoticeName } from './visibility-notices.js';
import { timeoutRecoveryBlockReason } from './timeout-recovery-policy.js';
import type { createExecutionStore } from './store.js';
import type { ExecutionArtifactRecord, createExecutionArtifactStore } from './artifact-store.js';
import { isResumeGrantTerminal, type createResumeGrantStore } from './resume-grant-store.js';
import type { createExecutionSourceRegistry } from './source-registry.js';
import { assessScopeWidening, buildSplitChild, confirmSplitPrompt, splitChildId, splitDeliveryNote } from './scope-resplit.js';
import { blockerCardSubject, humanBlockerDenial } from './human-blocker-denial.js';
import { buildInboxQuestion } from '../inbox/inbox-question-schema.js';
import type { InboxEntry, InboxInput } from '../inbox/inbox-store.js';
import { BLOCKED_WAIT_WARN_LEAD_MS, DEADLINE_RECHECK_FLOOR_MS, ExecutionDeadlineWatchdog, claimOutputLive, deadlineTimings, nextDeadlineAt } from './deadline-watchdog.js';
import { ParkedWorkerHolds } from './parked-worker-hold.js';
import { PlanReadinessWatchdog, type PlanReadinessExpiryReason } from './plan-readiness-watchdog.js';
import { evaluateTeamAdmission, type TeamAdmissionInput, type TeamAdmissionResultV1 } from '../launch/preflight.js';
import { recycleDecision } from './idle-gated-injector.js';
import { transitionCircuit, type CircuitState } from './retry-policy.js';
import { usageCursorIdentity, usageRollup, validateStructuredJson, validateStructuredResult, workCheckReferences, validResolvedChecks, type ExecutionResolvedCheckV1, type ExecutionCheckResultV1, type ExecutionUsageObservationV1, type UsageSampleKind, type ExecutionResolvedLaunchV1 } from './contracts.js';
import { CoordinatorWakeConfirmations, type CoordinatorWakeConfirmation, type PendingWakeConfirmation } from './coordinator-wake-confirmation.js';
import { buildFeedbackPrompt, toEnvelope } from './retry-feedback.js';

/** Wall-clock ceiling for a single bounded snapshot read. */
const SNAPSHOT_TIMEOUT_MS = 15_000;
/** Bounded wait for a dead seat's old session to exit before it is respawned. */
const OLD_SESSION_EXIT_WAIT_MS = 5_000;
/** Hard cap on event pages walked per snapshot (Rule 5: bound unbounded reads). */
const MAX_SNAPSHOT_EVENT_PAGES = 1_000;
const AUTO_FINALIZE_RETRY_MS = 1_000;
const ROUTE_FACTS_TIMEOUT_MS = 15_000;
const ROUTE_FACTS_CIRCUIT_RESET_MS = 30_000;
const ACTIVE_CLAIM_PAGE_SIZE = 50;
/** Worker-reported failure codes of a never-started claim that are retried (blocker / contract / routing codes never are). */
const NO_START_RETRY_CODES: ReadonlySet<ExecutionFailureCode> = new Set<ExecutionFailureCode>(['UNKNOWN', 'WORK_FAILED', 'TRANSIENT', 'RESOURCE_EXHAUSTED']);
/** What a run warning is about; the host posts one Inbox row per run, slot, kind and ref. */
export type ExecutionRunWarningKind = 'worker-exit' | 'worker-no-turn' | 'worker-respawn' | 'worker-idle' | 'worker-heartbeat' | 'blocker-reminder' | 'unit-checkpoint';
const NO_START_MARKER = 'worker reported no-start failure: ';
/** Pause before a never-started claim is retried, so a seat that just failed to boot is not hammered. */
export const NO_START_RETRY_PAUSE_MS = 30_000;
/** Strip timestamps, uuids, run ids and numbers so a repeated failure compares equal. */
function normalizeFailureText(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<ts>').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replace(/\b(?:exec|execution|run)[-_][\w-]+/gi, '<id>').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
}
const PROVEN_DEAD_CLAIM_REASON = NO_PROGRESS_CLAIM_REASON.PROVEN_DEAD;
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
const AGENT_DEAD_CLAIM_REASON = NO_PROGRESS_CLAIM_REASON.AGENT_DEAD;
const SILENT_WORKER_CLAIM_REASON = NO_PROGRESS_CLAIM_REASON.SILENT;
const STALLED_WORKER_CLAIM_REASON = NO_PROGRESS_CLAIM_REASON.STALLED;
const DEAD_WORKER_PROCESSES = new Set(['exited', 'spawn-failed', 'canceled']);
/** Own rate limit of the owner's `execution_slot_restart`: one restart per slot per minute (does not use the respawn cap). */
export const OWNER_RESTART_MIN_INTERVAL_MS = 60_000;
const TELEMETRY_GAP_GRACE_SAMPLES = 3;
class NamedCheckAdmissionError extends Error {}
const MAX_NAMED_CHECK_FAILURE_OUTPUT_CHARS = 4_000;

class NamedCheckFailureError extends Error {
  constructor(reference: string, readonly receipt?: ExecutionCheckResultV1) {
    super(`CHECK_FAILED: ${reference}`);
  }
}

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
 * A claim holds a 5-minute lease (WORK_CLAIM_LEASE_MS). A worker keeps it alive by calling
 * `execution.work.heartbeat` with its claim fence; a cohort heartbeat only moves the progress
 * clock when its `turnCount` rises or the lease is nearly spent, so the assignment text tells
 * the worker to heartbeat every 2-3 minutes during a command that can run longer than 3 minutes,
 * with `turnCount` one higher each time. Without that, a long E2E or coverage run goes silent.
 * `reconcileActive` reclaims a live-but-expired claim when the worker's detected agent-state is
 * restful, or by the progress-aware {@link DEFAULT_DURABLE_CLAIM_STALL_MS} ceiling (10 min);
 * a worker stuck 'working'/'unknown' would otherwise never be reclaimed and its idle-gated
 * assignment never flushed → permanent freeze (live run df216947, a 'structured' run frozen
 * 224s past lease at turn 0). The one state-agnostic escape is the wall-clock backstop in
 * `reconcileActive`, dead unless `maxClaimWallClockMs` is set — no host/server default, and the
 * coordinator prompt never sets it. This default revives it so a stuck claim is force-reclaimed
 * regardless of state.
 *
 * Blunt by design: it fires on wall-clock-since-claim regardless of whether the worker ever
 * emitted output, so it is only the LAST resort. The progress-aware {@link
 * DEFAULT_DURABLE_CLAIM_STALL_MS} ceiling below reclaims a silent-but-'working' worker sooner
 * without endangering a streaming one (whose output keeps its lease — and stall clock — fresh).
 */
const DEFAULT_DURABLE_CLAIM_WALL_CLOCK_MS = DEFAULT_CLAIM_WALL_CLOCK_MS;

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
export const DEFAULT_DURABLE_CLAIM_STALL_MS = DEFAULT_CLAIM_STALL_MS;

/**
 * Default ceiling (30 min) for a durable claim whose worker keeps producing output but sends no turn
 * heartbeat and changes no file. Output only renews the lease; `progressAt` moves on a turn or a file
 * change, so this is the only clock for such a claim (it is exempt from the 10 min stall and 20 min wall
 * clock). Configurable per run (`maxClaimOutputOnlyMs`) and per Squad (`claimOutputCeilingMs`).
 */
export const DEFAULT_DURABLE_CLAIM_OUTPUT_CEILING_MS = DEFAULT_CLAIM_OUTPUT_CEILING_MS;


/**
 * Inject the durable-claim reclaim ceilings (wall-clock backstop + progress-aware stall) into a
 * launch policy for a durable worker-DAG coordination mode (job-team / structured / freeform)
 * when the caller left them unset. Pure: returns the policy unchanged for non-durable
 * (interactive / autonomous chat) modes or when BOTH ceilings are already present, so a
 * caller-set ceiling always wins.
 */
/** Bounded re-read loop for the post-cancel STOPPED write; each miss means another actor advanced the record. */
const MAX_STOP_TRANSITION_ATTEMPTS = 8;
/** Bounded re-read loop while failLaunch lands FAILED against members bumping stateVersion mid-launch. */
const MAX_FAIL_LAUNCH_ATTEMPTS = 10;
/** Retention cap for the in-memory dedupe sets of worker warnings (no-turn and worker-exit). */
const MAX_WORKER_WARNING_KEYS = 512;

export function withDurableClaimWallClockBackstop(
  mode: TeamCoordinationMode | undefined,
  policy: ExecutionPolicyV1 | undefined
): ExecutionPolicyV1 | undefined {
  if (!isDurableCoordination(mode)) return policy;
  if (policy?.maxClaimWallClockMs !== undefined && policy.maxClaimStallMs !== undefined && policy.maxClaimOutputOnlyMs !== undefined) return policy;
  const next = { ...(policy ?? {}) };
  if (next.maxClaimWallClockMs === undefined) next.maxClaimWallClockMs = DEFAULT_DURABLE_CLAIM_WALL_CLOCK_MS;
  if (next.maxClaimStallMs === undefined) next.maxClaimStallMs = DEFAULT_DURABLE_CLAIM_STALL_MS;
  if (next.maxClaimOutputOnlyMs === undefined) next.maxClaimOutputOnlyMs = DEFAULT_DURABLE_CLAIM_OUTPUT_CEILING_MS;
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
  /** Explicit API override. Undefined defers to project then Team defaults. */
  worktree?: boolean;
  /** Terminal disposition for an execution-owned shared worktree. */
  onComplete?: 'leave' | 'merge' | 'delete';
  push?: boolean;
  checks?: readonly string[];
  failurePolicyDefault?: 'fail-run';
  /** Parsed provided-plan declarations; distinct from explicit launch overrides. */
  planLaunch?: import('./portable-plan.js').LaunchDeclarations;
    /** Opt-in terminal inbox notice for runs without an owner report target. */
    completionInboxNotice?: boolean;
  /**
   * Trusted selector for an existing user-owned target (main resolves it; never a raw path).
   * Rules: {@link validateSquadExecutionTarget}.
   */
    target?: SquadExecutionTargetSelector;
}

/** @deprecated Use ExecutionRequestV1. Retained for Team backend callers. */
export type SquadExecutionRequestV1 = ExecutionRequestV1;

export interface ExecutionAssignmentCorrelation {
  executionId: string;
  assignmentId: string;
  idempotencyKey: string;
}

function assignmentCorrelation(executionId: string, claim: { claimId?: string; claimGeneration?: number }): ExecutionAssignmentCorrelation | undefined {
  if (!claim.claimId || claim.claimGeneration === undefined) return;
  return { executionId, assignmentId: claim.claimId, idempotencyKey: `${executionId}:${claim.claimId}:${claim.claimGeneration}` };
}

/** How a recycle ended: the new session to deliver to, no session (`final` when the seat will never start), or `declined` when nothing could recycle it and the unit stays with the current session. */
export interface RecycleOutcome { sessionId?: string; final?: true; declined?: true }

export type DeferredWorkerSpawnResult = { ok: true; sessionId: string } | { ok: false; message: string; retryable?: true };

export interface ExecutionServiceDeps {
  /** Per-unit checkpoints (claim baseline, patches, guarded restore of a failed unit). Absent = on; `false` = off. */
  unitCheckpointsEnabled?: () => boolean;
  /** Test seam replacing the git child process used by unit checkpoints. */
  checkpointGit?: GitRunner;
  resolveNamedChecks?: (projectId: string, references: readonly string[]) => ExecutionResolvedCheckV1[] | Promise<ExecutionResolvedCheckV1[]>;
  /** Execute only record.resolvedChecks, never resolve current settings. */
  runNamedCheck?: (record: ExecutionRecord, reference: string, signal?: AbortSignal) => Promise<ExecutionCheckResultV1>;
  listNamedCheckNames?: (projectId: string) => readonly string[] | Promise<readonly string[]>;
  /** Trusted host resolves distinct launch/plan/Squad/default rungs; invoked only for a new claim. */
  resolveLaunchOptions?: (projectId: string, request: ExecutionRequestV1) => ExecutionResolvedLaunchV1 | Promise<ExecutionResolvedLaunchV1>;
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
    admissionDigest?: string,
    nativeRecovery?: NonNullable<ExecutionRecord['nativeRecoverySnapshots']>
  ) => Promise<{ ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string }> | { ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string };
  launchTeam: (teamId: string, projectId: string, request: TeamLaunchRequestInput) => Promise<{ ok: boolean; code?: string; message?: string; value?: { failedSlots?: unknown[] } }>;
  getTeamLaunch: (callerPrincipalId: string, launchRequestId: string) => Promise<unknown>;
  cancelTeamLaunch: (callerPrincipalId: string, launchRequestId: string, opts?: { retainOrchestrator?: boolean }) => Promise<{
    ok: boolean;
    code?: string;
    message?: string;
    value?: { canceledSessionIds: string[]; pendingSessionIds: string[]; lifecycleState?: string };
  }>;
  /** Bounded wait for sessions that are still closing after a cancel. Defaults to 4 checks 300ms apart. */
  cancelSettle?: { attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  revokeTeamAuthorizations?: (authorizationIds: readonly string[]) => void | Promise<void>;
  replyToSession: (sessionId: string, text: string) => boolean | Promise<boolean>;
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
  deliverToWorker?: (sessionId: string, text: string) => boolean | Promise<boolean>;
  /** Receipt-aware transport. Only rejection proves an assignment was not accepted. */
  deliverAssignment?: (workerSessionId: string, text: string, correlation: ExecutionAssignmentCorrelation) =>
    Promise<{ state: 'accepted' | 'completed' | 'uncertain' | 'rejected' }>;
  /**
   * Start a seat that was left closed at launch (`startOnDemand`). Resolves with the new
   * session id, or a failure message; the engine then delivers the assignment or releases it.
   */
  spawnDeferredWorker?: (recordId: string, slotId: string) => Promise<DeferredWorkerSpawnResult>;
  /**
   * Start a new session for a worker slot whose session is over, from the launch-time snapshot (coordinator
   * respawn). The host owns every commit (closing check, once-only claim, bind) and must refuse a run that is
   * closing. `reason` is a stable code; `message` is shown to the coordinator.
   */
  respawnWorker?: (recordId: string, slotId: string) => Promise<{ ok: true; sessionId: string } | { ok: false; reason: string; message: string; committed?: true }>;
  /** Per-slot respawn cap; defaults to {@link DEFAULT_WORKER_RESPAWN_CAP}. */
  workerRespawnCap?: number;
  /**
   * Owner-initiated restart of one worker slot, through the same host paths as the UI card Restart (#837): an exited
   * seat is respawned, a live session is relaunched in place, both behind the launch-closing fences. It does NOT use
   * the coordinator's per-slot respawn budget; the engine rate-limits owner restarts itself.
   */
  restartWorker?: (recordId: string, slotId: string) => Promise<{ ok: true; sessionId: string; mode: 'respawned' | 'restarted' } | { ok: false; reason: string; message: string }>;
  /**
   * Replace a seat's finished session with a fresh one and deliver the assignment to it (#579). Not awaited by
   * the engine: the worker's own completion call is still waiting on the dispatch that hands over the entry.
   * Failures are the host's to settle (a failed respawn releases the assignment undelivered).
   */
  recycleSeat?: (recordId: string, slotId: string, assignment: ExecutionDispatchAssignment) => Promise<RecycleOutcome | void>;
  /** Record that a unit was accepted by a seat's current session (#579); feeds the lifecycle `deliveredUnitCount`. */
  recordUnitDelivered?: (recordId: string, slotId: string) => Promise<void>;
  /** Messages queued for a session by the idle-gated injector (#579): a session with any is never closed. */
  queuedForSession?: (sessionId: string) => number;
  /** Project a runtime receipt only after authenticated work completion is durable. */
  onWorkSettled?: (correlation: ExecutionAssignmentCorrelation & { workerSessionId: string }) => void | Promise<void>;
  triggerDeliveryDrain?: (sessionId: string) => void;
  logError?: (message: string, error: unknown) => void;
  /**
   * Hold (epoch-ms `retainUntilMs`) or release (`null`) a parked worker's live session against the host's idle
   * sweep. The hold self-expires, so a missed release cannot pin the session. Failures are logged by the caller.
   */
  retainParkedWorker?: (record: ExecutionRecord, sessionId: string, retainUntilMs: number | null) => Promise<void>;
  /** Called once when a human-audience blocker is created. Failures are logged and never fail the engine. */
  onHumanBlocker?: (record: ExecutionRecord, blocker: NonNullable<ExecutionRecord['blockers']>[number]) => void | Promise<void>;
  /**
   * Called after a worker warning (non-zero exit or no turn) is recorded on the run, so the host can post an
   * Inbox row. Failures are logged and never fail the engine.
   */
  onRunWarning?: (record: ExecutionRecord, warning: { slotId: string; summary: string; kind: ExecutionRunWarningKind; ref?: string }) => void | Promise<void>;
  /** Wait before an unanswered human blocker is surfaced once more; 0 disables, undefined uses the default (30 min). */
  blockerReminderMs?: () => number | undefined;
  /** Persona display name, so worker notices use the same label as the Agents board. */
  personaName?: (personaId: string) => string | undefined;
  /** Overrides of the idle-capacity (READY with an idle seat) and stale-heartbeat (CLAIMED) notice windows; E2E shortens them. */
  idleNoticeWindowMs?: () => number | undefined;
  heartbeatWarnWindowMs?: () => number | undefined;
  /**
   * How long a claimed worker may take no turn and emit no output before the run is warned. Defaults to the run's
   * claim stall limit; E2E shortens it through host config.
   */
  noTurnWarnWindowMs?: () => number | undefined;
  inbox?: { append: (input: InboxInput) => Promise<InboxEntry>; appendOnce?: (input: InboxInput) => Promise<InboxEntry> };
  preflightWorkflow?: (teamId: string, workflow: SquadBundleWorkflowMetadataV1) => { ok: boolean; code?: string; message?: string };
  /** Trusted total slot count of the record's team; enables the all-slots-restorable gate. */
  resolveExactNativeRecoveryTotalSlots?: (record: ExecutionRecord) => number | undefined;
  /** Trusted host resolver; filters retained snapshots against current Team slots. */
  resolveExactNativeRecoverySnapshots?: (record: ExecutionRecord) => NonNullable<ExecutionRecord['nativeRecoverySnapshots']>;
  admissionInput?: (projectId: string, request: ExecutionRequestV1) => Promise<TeamAdmissionInput> | TeamAdmissionInput;
  /**
   * Main-owned consent gate for corrections to a rejected supplied plan. This is
   * checked here, rather than only in a handoff caller, so coordinator MCP calls
   * and host-side file handoffs share the same authority boundary.
   */
  authorizePlanRegistration?: (record: ExecutionRecord, workUnits: readonly ExecutionWorkUnitInput[], submitter?: ExecutionCohortBinding) =>
    Promise<{ ok: true } | { ok: false; message: string }> | { ok: true } | { ok: false; message: string };
  /** Main-owned snapshot resolver. Agent/renderer model claims never authorize routing. */
  resolveTeamModelSnapshots?: (projectId: string, request: Pick<ExecutionRequestV1, 'teamId' | 'slots'>) => Promise<ResolvedModelSnapshotV1[]> | ResolvedModelSnapshotV1[];
  /** Main-only checkout preparation after execution identity is durable but before any slot spawns. */
  prepareSquadWorktree?: (record: ExecutionRecord, request: ExecutionRequestV1) => Promise<ExecutionRecord>;
  /** Main-only reviewed generated-worktree base captured atomically with execution claim. */
  resolveReviewedSquadWorktreeBase?: (projectId: string, request: ExecutionRequestV1) => Promise<ExecutionRecord['reviewedSquadWorktreeBase']> | ExecutionRecord['reviewedSquadWorktreeBase'];
  /**
   * Host-owned serialization for retained execution lifecycle effects. The generic
   * service invokes it before advancing a retained run into its next generation,
   * so delete/instruct/teardown cannot act on a checkout between authorization
   * and the state-version fence. Unwired deployments retain normal store CAS.
   */
  withExecutionLifecycleLock?: <T>(executionId: string, run: () => Promise<T>) => Promise<T>;
  /** Reject retained-worktree resume while a normal follow-up agent owns it. */
  mayResumeRetainedWorktree?: (executionId: string) => boolean;
  onTerminal?: (record: ExecutionRecord) => Promise<void> | void;
  /** The gate result recorded on a new run at launch (`routingPolicy`); dispatch then reads the record, never the live Squad. */
  resolveRoutingPolicy?: (projectId: string, request: Pick<ExecutionRequestV1, 'teamId' | 'slots'>, resolvedModels: readonly ResolvedModelSnapshotV1[]) => ExecutionRoutingPolicyV1 | undefined;
  routingEnforcementEnabled?: (record: ExecutionRecord) => boolean;
  /** True when routing was requested, even if current facts cannot enforce it yet. */
  routingEnforcementRequested?: (record: ExecutionRecord) => boolean;
  claimRecoveryObserveEnabled?: () => boolean;
  claimRecoveryEnforceEnabled?: () => boolean;
  /** Grace (ms) a durable execution may stay planless before the watchdog fails it. `0`/absent disables. */
  planStartupGraceMs?: () => number;
  /**
   * True while a human plan-correction decision is open for the execution. The
   * planless watchdog pauses while it holds (fresh grace on resolution, 24h
   * absolute cap). Throw/reject = not open. Absent = never paused.
   */
  isPlanCorrectionOpen?: (executionId: string) => boolean | Promise<boolean>;
  /** Main-owned agent status used to detect a live process whose assigned turn ended silently. */
  getAgentState?: (sessionId: string) => AgentState;
  /**
   * True when main feeds this session's agent-status edges into
   * {@link SquadExecutionService.observeCoordinatorState}, so a confirmation-required
   * wake can wait for consumption evidence. Absent/false = acknowledge on write.
   */
  confirmsWakeConsumption?: (sessionId: string) => boolean;
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
  /**
   * Resolves true once the session is gone (exited / unknown), false when it is still present after `timeoutMs`.
   * Lets a respawn wait for the old session's shell to be reaped so it cannot act after the replacement starts.
   * Absent in tests / mesh-less hosts: the respawn then proceeds without waiting.
   */
  waitForWorkerSessionExit?: (sessionId: string, timeoutMs: number) => Promise<boolean>;
  routeFitObserveEnabled?: () => boolean;
  /** Main-owned TranscriptSource bridge. Renderer and agents cannot submit usage. */
  readSessionStats?: (sessionId: string, options?: { fresh?: boolean }) => Promise<SessionStats | null>;
  resumeGrants?: ReturnType<typeof createResumeGrantStore>;
  hasLivePredecessor?: (projectId: string, ownerPrincipalIds: readonly string[]) => boolean;
  /**
   * Main-owned registered-project check (Rule 1). An owner-scoped execution
   * whose `projectId` never resolved to a registered project (agent launched
   * from an unregistered directory, so the id is bogus) is rejected at
   * {@link ExecutionService.start} BEFORE any durable claim or worker spawn —
   * otherwise workers get no authenticated route / MCP injection and churn to a
   * silent timeout. Absent in tests / mesh-less keeps existing behaviour.
   */
  isRegisteredProject?: (projectId: string) => boolean;
  clearResumeToken?: (projectId: string, executionId: string) => void | Promise<void>;
  cacheResumeToken?: (projectId: string, executionId: string, token: string, expiresAt: number) => void | Promise<void>;
  monotonicNow?: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /** Pause before a no-start retry (default {@link NO_START_RETRY_PAUSE_MS}); 0 disables it. Uses `setTimer` / `clearTimer`. */
  noStartRetryPauseMs?: number;
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
  /** Lifecycle record id; the deferred-seat spawner is keyed by it. */
  recordId?: string;
  orchestratorSessionId?: string;
  orchestratorAuthorizationId?: string;
  retainOrchestrator?: boolean;
  workers?: Array<{
    slotId?: string;
    sessionId?: string;
    authorizationId?: string;
    projectId?: string;
    process?: string;
    /** Set on a seat that starts on demand (it may have no session). */
    onDemand?: true;
    /** Set while the seat waits for the session of a coordinator-requested respawn. */
    respawned?: 'on-demand' | 'normal';
    /** Units the current session accepted; present only for a seat that starts a fresh session per unit (#579). */
    deliveredUnitCount?: number;
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

/** The lifecycle record id when the slot's worker counts delivered units (a seat on a fresh session per unit), else undefined. */
function countedRecordId(record: ExecutionRecord, lifecycle: ExtractedLifecycle | undefined, slotId: string): string | undefined {
  const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
  return worker?.deliveredUnitCount === undefined ? undefined : lifecycle?.recordId;
}

function extractLifecycleInfo(lifecycle: any): ExtractedLifecycle | undefined {
  if (!lifecycle) return undefined;
  const launchResult = lifecycle.launchResult;
  const orchestratorSessionId = launchResult?.orchestratorSessionId || lifecycle.orchestratorSessionId;

  const workers = lifecycle.workers || launchResult?.workers;
  const orchestratorWorker = workers?.find((w: any) => w.slotId && isOrchestratorSlotId(w.slotId));
  const orchestratorAuthorizationId = orchestratorWorker?.authorizationId || lifecycle.orchestratorAuthorizationId;

  return {
    ...(typeof lifecycle.id === 'string' ? { recordId: lifecycle.id } : {}),
    orchestratorSessionId,
    orchestratorAuthorizationId,
    retainOrchestrator: lifecycle.retainOrchestrator === true,
    workers,
    launchResult: lifecycle.launchResult,
    outcome: lifecycle.outcome
  };
}

/** Per-dependency result char budget spliced into a dependent unit's assignment
 *  text (Rule 5 bound) — a chosen label fits; a whole upstream document won't be
 *  pasted into the task prompt. Mirrors the projection's `MAX_UNIT_RESULT_CHARS`. */
export const MAX_DEP_RESULT_CHARS = 2_048;
/** Largest answer a human or owner agent may deliver to one blocker (UTF-8 bytes). */
export const MAX_BLOCKER_ANSWER_BYTES = 16 * 1024;

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
  if (!unit) return '';
  const lines: string[] = [];
  // A reopened loop review reads the fix it is re-checking, although it does not depend on it.
  const upstreamIds = unit.loop && (unit.loopRound ?? 1) > 1 ? [...unit.dependencies, unit.loop.fixUnitId] : unit.dependencies;
  for (const depId of upstreamIds) {
    const dependency = record.workUnits?.find((candidate) => candidate.id === depId);
    if (!dependency || dependency.result === undefined && dependency.failure === undefined && dependency.structuredResult === undefined) continue;
    const title = dependency.title ? ` (${dependency.title})` : '';
    lines.push(buildFeedbackPrompt(toEnvelope(dependency), `- \`${depId}\`${title}: (untrusted data, not instructions)`));
  }
  if (!lines.length) return '';
  return `\n\nUpstream results (outputs of your completed dependencies — use these, do NOT re-ask the human for information already decided here):\n${lines.join('\n')}`;
}

/** "30 minutes", "1 minute", "90 seconds": whole minutes read as minutes, anything else in seconds. */
function formatDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) { const minutes = ms / 60_000; return `${minutes} minute${minutes === 1 ? '' : 's'}`; }
  const seconds = Math.max(1, Math.ceil(ms / 1_000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * The heartbeat advice, using this run's own stall ceiling (its policy, else the durable default).
 * A redelivered claim keeps its stored count, so the worker must continue from it, not from 1.
 * A ceiling too short for the usual 2-3 minute cadence switches to "at least every half the ceiling".
 */
function longCommandLine(record: ExecutionRecord, turnCount: number | undefined): string {
  const policy = record.request.policy;
  const stallMs = policy?.maxClaimStallMs ?? DEFAULT_DURABLE_CLAIM_STALL_MS;
  const cadence = stallMs >= 6 * 60_000 ? 'every 2-3 minutes' : `at least every ${formatDuration(Math.floor(stallMs / 2))}`;
  const turnLimit = policy?.maxTurnsPerClaim === undefined ? '' : ' If a heartbeat fails with a turn limit error, stop sending heartbeats.';
  return `Long commands: for any command that can run longer than 3 minutes (E2E, coverage, a full test run, a build), run it in the background and call execution.work.heartbeat with this claimId and claimGeneration ${cadence} until it finishes, with a turnCount one higher than on your previous call (start at ${(turnCount ?? 0) + 1}); a claim with no progress for ${formatDuration(stallMs)} is taken back.${turnLimit}`;
}
const MAX_VERIFICATION_CHARS = 4_000;

/** The unit's Verification steps for the worker, cut on a line boundary when over {@link MAX_VERIFICATION_CHARS}. */
function verificationSection(steps: string[] | undefined): string {
  const lines = (steps ?? []).map((step) => step.trim()).filter(Boolean).map((step) => `- ${step}`);
  if (!lines.length) return '';
  const header = '\nVerification (run these before you complete the unit):';
  let section = header;
  for (const line of lines) {
    if (section.length + 1 + line.length > MAX_VERIFICATION_CHARS) return `${section}\n- … (truncated)`;
    section += `\n${line}`;
  }
  return section;
}

const LOOP_VERDICT_LINE = '\nThis unit is a review loop: pass structuredResult { "verdict": "PASS" | "CHANGES" } to execution.work.complete.';

/** The text a worker receives for an assignment; shared by first delivery and recovery redelivery. */
export function assignmentText(record: ExecutionRecord, assignment: ExecutionDispatchAssignment): string {
  const loopVerdict = record.workUnits?.find((candidate) => candidate.id === assignment.workUnitId)?.loop ? LOOP_VERDICT_LINE : '';
  const upstream = `${dependencyResultsSection(record, assignment.workUnitId)}${loopVerdict}`;
  const feedback = buildFeedbackPrompt(record.workUnits?.find((unit) => unit.id === assignment.workUnitId)?.retryFeedback);
  const claim = assignment.claimId && assignment.claimGeneration
    ? `\nClaim fence: claimId=${assignment.claimId}; claimGeneration=${assignment.claimGeneration}. Include both in execution.work.heartbeat and every structured work outcome.\n${longCommandLine(record, assignment.turnCount)}`
    : '';
  return `You are assigned work unit \`${assignment.workUnitId}\`${assignment.title ? ` — ${assignment.title}` : ''}.\nTask: ${assignment.task}${assignment.files?.length ? `\nFile scope: ${assignment.files.join(', ')}` : ''}${verificationSection(assignment.verification)}${upstream}${feedback ? `\n\n${feedback}` : ''}${claim}\n\nClose the unit through exactly one structured outcome: execution.work.complete, execution.work.block, execution.work.fail, or execution.work.release. Do not send routine progress or results to the coordinator.`;
}

/** Build renderer-safe, resolved capability gaps from admission checks before any execution is claimed. */
export function requirementFailureFromAdmission(
  workUnits: readonly ExecutionWorkUnitInput[] | undefined,
  admission: TeamAdmissionResultV1
): TeamRequirementFailure | undefined {
  const failures = (workUnits ?? []).flatMap((unit) => {
    const unavailable = (code: 'SKILL_AVAILABLE' | 'MCP_AVAILABLE') =>
      admission.checks
        .filter((check) => check.code === code && check.subject === unit.id && check.required && check.status !== 'PASS')
        .flatMap((check) => check.unavailable ?? []);
    const missingSkills = unavailable('SKILL_AVAILABLE');
    const missingMcpServers = unavailable('MCP_AVAILABLE');
    return missingSkills.length || missingMcpServers.length
      ? [{ id: unit.id, title: unit.title, missingSkills, missingMcpServers }]
      : [];
  });
  return failures.length ? { workUnits: failures } : undefined;
}

export function availabilityUnknownFromAdmission(admission: TeamAdmissionResultV1): TeamAvailabilityUnknown | undefined {
  return admission.availabilityUnknown ? { failedSources: [...admission.availabilityUnknown.failedSources] } : undefined;
}

const MAX_PLAN_CORRECTION_STOP_ATTEMPTS = 5;

/** Freeform and legacy `job-team` runs continue past a failed worker slot with a warning; other modes fail. */
function warnOnlyOnFailedSlots(mode: TeamCoordinationMode | undefined): boolean {
  return mode === 'freeform' || mode === 'job-team';
}

/** Claude tools whose call writes the file named by `file_path` / `notebook_path`. Bash writes are not visible here. */
const CLAIM_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Path a worker write tool named, or undefined for a non-write tool or a malformed input. */
export function claimWritePath(toolName: unknown, input: unknown): string | undefined {
  if (typeof toolName !== 'string' || !CLAIM_WRITE_TOOLS.has(toolName) || !input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const raw = toolName === 'NotebookEdit' ? record.notebook_path : record.file_path;
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 4_096 && !raw.includes('\0') ? raw : undefined;
}

export { confineAndHashClaimWrite };

export class ExecutionService {
  private runCheckCompletions = new Map<string, { controller: AbortController; pending: Promise<readonly string[]> }>();
  private checkCompletions = new Map<string, { executionId: string; workUnitId: string; claimId?: string; claimGeneration?: number; controller: AbortController; running?: Promise<ExecutionCheckResultV1>; pending: ReturnType<ExecutionService['completeWorkChecked']> }>();
  private readonly starting = new Map<string, number>();
  private readonly bindingTails = new Map<string, Promise<void>>();
  private readonly usageTails = new Map<string, Promise<void>>();
  private readonly usageFlights = new Map<string, Promise<void>>();
  private readonly pendingBindingOwners = new Map<string, string>();
  /** Last owner restart per `executionId:slotId` (the own rate limit of `execution_slot_restart`); pruned on every insert. */
  private readonly ownerRestartAt = new Map<string, number>();
  private readonly mintFlights = new Map<string, Promise<ReturnType<ExecutionService['mintResumeGrantOnce']> extends Promise<infer T> ? T : never>>();
  private readonly autoFinalizeTimers = new Map<string, NodeJS.Timeout>();
  private readonly deadlineWatchdog: ExecutionDeadlineWatchdog;
  private readonly planReadinessWatchdog: PlanReadinessWatchdog;
  private readonly parkedHolds: ParkedWorkerHolds;
  private activeClaimCursor?: ActiveClaimCursor;
  private activeReconcileRunning = false;
  /** Claims already warned as taking no turn (`executionId:unitId:claimId`), bounded so it cannot grow without limit. */
  private readonly noTurnWarned = new Set<string>();
  private readonly exitWarned = new Set<string>();
  /** Idle-capacity, stale-heartbeat and blocker-reminder dedupe; holds no timer and is dropped with the run. */
  private readonly visibility = new VisibilityNoticeState();
  /** Worker slots with a respawn in flight (`executionId:slotId`); a second concurrent call refuses. */
  private readonly respawning = new Set<string>();
  private readonly routeFactCircuits = new Map<string, { state: CircuitState; openedAt?: number }>();
  private readonly wakeConfirmations: CoordinatorWakeConfirmations;

  constructor(private readonly deps: ExecutionServiceDeps) {
    this.parkedHolds = new ParkedWorkerHolds({
      now: deps.now ?? Date.now,
      load: (executionId) => deps.store.get(executionId),
      retain: (record, slotId, until) => this.retainParkedWorker(record, slotId, until),
      ...(deps.logError ? { logError: deps.logError } : {})
    });
    this.wakeConfirmations = new CoordinatorWakeConfirmations({
      setTimer: deps.setTimer ?? setTimeout,
      clearTimer: deps.clearTimer ?? clearTimeout,
      onExpire: (entry) => { void this.expireCoordinatorWake(entry); }
    });
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
      ...(deps.isPlanCorrectionOpen ? { isSuspended: deps.isPlanCorrectionOpen } : {}),
      onGraceExpired: async (executionId, reason) => { await this.failPlanlessExecution(executionId, reason); }
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

  async start(
    callerPrincipalId: string, projectId: string, request: ExecutionRequestV1,
    opts?: { proposal?: ExecutionRecord['proposal']; reportTo?: ExecutionRecord['reportTo'] }
  ): Promise<
    { ok: true; value: ExecutionRecord & { resumeToken?: string; resumeTokenExpiresAt?: number } }
    | { ok: false; code: string; message: string; requirementFailure?: TeamRequirementFailure; availabilityUnknown?: TeamAvailabilityUnknown }
  > {
    if ('resolvedLaunch' in request || 'resolveLaunchOptions' in request || 'resolvedChecks' in request || 'resolveNamedChecks' in request) return { ok: false, code: 'INVALID', message: 'launch snapshots are host-owned' };
    if (request.version !== 1 || (request.launchKind !== undefined && request.launchKind !== 'team')
      || !request.teamId?.trim() || !request.launchRequestId?.trim() || !request.slots?.length) {
      return { ok: false, code: 'INVALID', message: 'invalid execution request' };
    }
    // An invalid or conflicting target selector rejects before any durable state:
    // there is never a fallback to a generated worktree.
    const targetCheck = validateSquadExecutionTarget(request);
    if (!targetCheck.ok) return { ok: false, code: 'INVALID', message: targetCheck.message };
    // Fail fast on an unregistered owner project. A `projectId` that never
    // resolved to a registered project can still reach here (the MCP route
    // parses it straight from the URL and validates only that the calling
    // session is live — mcp-server.ts), but its workers would get no
    // authenticated route / OPENCODE_CONFIG_CONTENT injection and churn to a
    // timeout. Reject before beginStarting/store.claim so no durable state or
    // worker is created (Rule 1: main authorizes only registered projects).
    if (this.deps.isRegisteredProject && !this.deps.isRegisteredProject(projectId)) {
      return { ok: false, code: 'UNKNOWN_PROJECT', message: 'owner project is not registered' };
    }
    const textProblem = squadLaunchTextProblem({ goal: request.objective, summary: request.summary?.trim() || undefined });
    if (textProblem) return { ok: false, code: textProblem.code, message: textProblem.message };
    let resolvedModels: ResolvedModelSnapshotV1[];
    try {
      resolvedModels = (await this.withResolvedRouteFacts(projectId, request)).resolvedModels ?? [];
    } catch (error) {
      this.deps.logError?.(`Team route facts failed for ${projectId}:${request.launchRequestId}`, error);
      // Only an error that declares fixed user-safe text is shown; anything else may carry detail.
      const safe = (error as { safeMessage?: unknown } | null)?.safeMessage;
      return { ok: false, code: 'ADMISSION_FAILED', message: typeof safe === 'string' && safe ? safe : 'Team route facts could not be evaluated' };
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
      // Only skill/MCP read failures are availability problems; any other blocking
      // check (slot capacity, DAG, budgets, routing) is the real admission error.
      const onlyCapabilityBlockers = admission.checks
        .filter((check) => check.required && check.status !== 'PASS')
        .every((check) => check.code === 'SKILL_AVAILABLE' || check.code === 'MCP_AVAILABLE');
      const availabilityUnknown = onlyCapabilityBlockers ? availabilityUnknownFromAdmission(admission) : undefined;
      const requirementFailure = requirementFailureFromAdmission(request.workUnits, admission);
      return availabilityUnknown
        ? { ok: false, code: 'CAPABILITY_AVAILABILITY_UNKNOWN', message: 'Project capability availability could not be verified', availabilityUnknown }
        : requirementFailure
        ? { ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: failed?.message ?? 'Team requirements are unavailable', requirementFailure }
        : { ok: false, code: 'ADMISSION_FAILED', message: failed?.message ?? 'Team admission failed' };
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
      const reviewedSquadWorktreeBase = await this.deps.resolveReviewedSquadWorktreeBase?.(projectId, request);
      const routingPolicy = this.deps.resolveRoutingPolicy?.(projectId, request, resolvedModels);
      claim = await this.deps.store.claim({
        callerPrincipalId, projectId, teamId: request.teamId, launchKind: request.launchKind ?? 'team',
        ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), jobTitle, summary,
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        ...(request.origin ? { origin: request.origin } : {}),
        ...(opts?.proposal ? { proposal: opts.proposal } : {}),
        ...(opts?.reportTo ? { reportTo: opts.reportTo } : {}),
        ...(reviewedSquadWorktreeBase ? { reviewedSquadWorktreeBase } : {}),
        launchRequestId: request.launchRequestId,
        resolveNamedChecks: (launch) => this.resolveChecks(projectId, [...(request.workUnits ?? []).flatMap(unit => unit.checks ?? []), ...launch.checks.value]),
        ...(this.deps.resolveLaunchOptions ? { resolveLaunchOptions: () => this.deps.resolveLaunchOptions!(projectId, request) } : {}),
        request: { version: 1, launchKind: request.launchKind ?? 'team', ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), slots: request.slots, policy: effectivePolicy, workflow: request.workflow, resolvedModels, sourceBundle: request.sourceBundle, objective: request.objective, ...(request.checks === undefined && request.planLaunch?.checks === undefined ? {} : { checks: request.checks ?? request.planLaunch?.checks }), ...(request.worktree === undefined ? {} : { worktree: request.worktree }), ...(request.onComplete === undefined ? {} : { onComplete: request.onComplete }), ...(request.target === undefined ? {} : { target: request.target }), completionInboxNotice: request.completionInboxNotice === true },
        ...(request.workUnits ? { workUnits: request.workUnits } : {}),
        resolvedModels,
        ...(routingPolicy ? { routingPolicy } : {}),
        requestDigest: launchDigest({ callerPrincipalId, projectId, request: { ...withoutDefaultLaunchKind(resolvedRequest), jobTitle, summary } })
      });
    } catch (error) {
      this.endStarting(startingKey);
      return { ok: false, code: error instanceof NamedCheckAdmissionError ? 'ADMISSION_FAILED' : 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
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
      // Preparing a managed worktree touches project activity. Authorize after it
      // so the preissued launch bindings fence the post-preparation store state.
      if (this.deps.prepareSquadWorktree) {
        record = await this.deps.prepareSquadWorktree(record, request);
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
        launchDigest(authorization.value.context),
        authorization.value.resolvedTransport
      );
      record = await this.deps.store.prepareLaunchIntent(record.id, record.stateVersion, {
        version: 1,
        authorizationContextDigest: record.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask, automatedSkillIds }) => ({
          slotId,
          personaId,
          initialTaskDigest: launchDigest(initialTask),
          ...(automatedSkillIds === undefined ? {} : { automatedSkillIds })
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
        ...(request.worktree === undefined ? {} : { worktree: request.worktree }),
        ...(request.onComplete === undefined ? {} : { onComplete: request.onComplete }),
        ...(request.target === undefined ? {} : { target: request.target }),
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
        await this.failLaunch(record, launched.message ?? 'Team launch failed');
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
      const failedStart = await this.settleFailedSlots(record, launched.value?.failedSlots ?? [], issuedAuthorizationIds);
      if (failedStart) {
        return failedStart.state === 'FAILED'
          ? { ok: false, code: 'TEAM_LAUNCH_FAILED', message: failedStart.failureReason ?? 'One or more Team slots failed to launch' }
          : { ok: false, code: 'TEAM_LAUNCH_STATE_CONFLICT', message: `Team launch failed while execution is ${failedStart.state.toLowerCase()}` };
      }
      record = await this.promoteStartingToRunning(record, 'Team launch started');
      return { ok: true, value: { ...record, ...(resumeGrant ? { resumeToken: resumeGrant.token, resumeTokenExpiresAt: resumeGrant.expiresAt } : {}) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
      // Seats this launch request already started must not outlive the failed run. failLaunch cancels the
      // launch when it writes the FAILED transition; only when that write itself throws does this path cancel
      // directly, so a launch is never cancelled by two callers for one failure. A failed close never masks
      // the launch error.
      let current: ExecutionRecord;
      try {
        current = await this.failLaunch(record, `Team launch error: ${message}`);
      } catch (failError) {
        await this.cancelBestEffort(record, `execution ${record.id} launch cleanup`);
        throw failError;
      }
      return current.state === 'FAILED'
        ? { ok: false, code: message === 'TARGET_UNAVAILABLE' ? 'TARGET_UNAVAILABLE' : 'TEAM_LAUNCH_FAILED', message }
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
        slotId: model.slotId, personaId: model.personaId ?? '', label: model.label, provider: model.provider, model: model.model,
        level: model.level, roleOwnedModel: model.roleOwnedModel, capabilities: model.capabilities,
        modalities: model.modalities, maxContextBytes: model.maxContextBytes, health: model.health,
        observedAt: model.observedAt, maxAgeMs: model.maxAgeMs,
        ...(model.skillAllowlist === undefined ? {} : { skillAllowlist: model.skillAllowlist }),
        ...(model.mcpServers === undefined ? {} : { mcpServers: model.mcpServers })
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
    for (const record of active) this.syncParkedHolds(record.id, { restore: true });
  }

  private async retainParkedWorker(record: ExecutionRecord, slotId: string, retainUntilMs: number | null): Promise<void> {
    if (!this.deps.retainParkedWorker) return;
    const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
    const sessionId = isOrchestratorSlotId(slotId)
      ? lifecycle?.orchestratorSessionId
      : lifecycle?.workers?.find((worker: { slotId?: string; projectId?: string }) => worker.slotId === slotId && worker.projectId === record.projectId)?.sessionId;
    if (sessionId) await this.deps.retainParkedWorker(record, sessionId, retainUntilMs);
  }

  async flushBlockerNotices(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    const records = await this.deps.store.listPendingNotices();
    for (const record of records) {
      for (const intent of record.noticeIntents ?? []) {
        if (intent.status === 'ACKNOWLEDGED' || intent.nextAttemptAt > now) continue;
        const blocker = record.blockers?.find((candidate) => candidate.id === intent.blockerId && !candidate.resolved);
        if (!blocker) {
          await this.deps.store.cancelNotice(record.id, intent.key);
          continue;
        }
        try {
          await this.appendHumanBlockerNotice(record, blocker, blocker.options ? buildInboxQuestion({ options: blocker.options, allowOther: true }, true) : {});
        } catch (error) {
          const deferred = await this.deps.store.deferNotice(record.id, intent.key);
          const updated = deferred.noticeIntents?.find((candidate) => candidate.key === intent.key);
          this.deps.logError?.(`execution blocker notice delivery deferred execution=${record.id} blocker=${intent.blockerId} notice=${intent.key} attempts=${updated?.attempts ?? intent.attempts} retryAt=${updated?.nextAttemptAt ?? now}`, error);
        }
      }
    }
  }

  /**
   * Classify ONE claimed unit whose lifecycle is known during {@link reconcileActive}:
   * decide whether its claim should be force/soft-reclaimed (`claim`, with a reason),
   * its lease renewed from agent-state liveness (`renewSlot`), or nothing done. When
   * the inner agent is proven dead the outer shell must also be reaped (`closeSessionId`).
   * Pure w.r.t. store state — the caller applies the batched reclaim / renew / close.
   *
   * Ordering of the checks is load-bearing (each cites a live run it fixed):
   * 1. State-agnostic FORCE wall-clock backstop for a worker that never reports an
   *    outcome (run df216947). `force` bypasses the store's lease-expiry floor and the
   *    agent-state renewal, so a worker stuck non-restful with NO progress is reclaimed
   *    regardless of state. Measured from the last real OUTPUT progress (`progressAt`,
   *    advanced ONLY by host-observed worker output — agent-state renewal passes
   *    advanceProgress:false), NOT raw `claimedAt`: a worker still emitting output is by
   *    definition not stuck. Keying it to claimedAt force-reclaimed a demonstrably-live,
   *    streaming worker mid-work the instant it outlived the ceiling and re-dispatched it
   *    from zero — so ANY unit that legitimately runs past the ceiling while progressing
   *    (verify-upstream: >20min, output bursts every ~4min) churned forever and could
   *    never complete (live run 928ff675). A stuck-at-turn-0 worker keeps
   *    progressAt==claimedAt, so it still fires here exactly as before (df216947 intact).
    * 2. No worker / dead outer process → force reclaim immediately. A fresh persisted
    *    lease is only liveness evidence while its holder still exists; waiting for it to
    *    expire after a terminal stop strands the work for up to one lease window.
    * 3. Outer shell alive but INNER agent proven dead by provider liveness (remote-opencode
    *    zombie: `process:'running'`, agent-state stuck 'unknown') → reclaim NOW, before the
    *    state/stall/renew logic, so a dead-agent claim is not renewed into a zombie, and
    *    reap the surviving shell. `'unknown'`/`'alive'`/unwired ⇒ fall through, so the
    *    claude-family path is byte-unchanged.
    * 4. Lease not yet expired → skip. The host renews the lease from PTY output, but a
    *    doc worker is routinely SILENT for a full lease window during a long think/tool
    *    phase while still actively working — an expired lease alone does NOT mean dead.
    * 5. Worker alive + RESTFUL (idle/done/waiting) without an outcome → it abandoned the
   *    claim; reclaim. Non-restful/unresolved ⇒ renew instead.
   * 6. Worker alive + non-restful but no OUTPUT progress for `maxClaimStallMs` → reclaim
   *    (a streaming worker keeps its lease fresh and never reaches here — live run b1bd2906).
   * 7. Otherwise renew the lease from agent-state liveness.
   */
  private classifyExpiredClaim(
    record: ExecutionRecord,
    unit: NonNullable<ExecutionRecord['workUnits']>[number],
    lifecycle: NonNullable<ExtractedLifecycle>,
    now: number
  ): { claim?: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force?: boolean }; renewSlot?: string; closeSessionId?: string } {
    if (unit.state !== 'CLAIMED' || !unit.claimId || unit.claimGeneration === undefined || !unit.assignedSlotId) return {};
    const claimOf = (reason: string, force?: boolean) => ({
      workUnitId: unit.id, claimId: unit.claimId!, claimGeneration: unit.claimGeneration!, reason, ...(force ? { force } : {})
    });
    // Clock model: a claim with output inside its output lease is exempt from the stall and wall-clock limits
    // and has only the output-only ceiling on `progressAt` (checked below, before the lease gate, whatever
    // the coordinator state); a claim without recent output keeps the wall clock and the stall limit.
    const outputLive = claimOutputLive(unit, now);
    const maxWallClock = record.request.policy?.maxClaimWallClockMs;
    const lastWallClockProgressAt = unit.progressAt ?? unit.claimedAt;
    if (!outputLive && maxWallClock !== undefined && lastWallClockProgressAt !== undefined && now - lastWallClockProgressAt >= maxWallClock) {
      return { claim: claimOf(NO_PROGRESS_CLAIM_REASON.WALL_CLOCK, true) };
    }
    const worker = lifecycle.workers!.find((candidate) => candidate.slotId === unit.assignedSlotId && candidate.projectId === record.projectId);
    const proc = worker?.process ?? '';
    if (!worker || DEAD_WORKER_PROCESSES.has(proc)) return { claim: claimOf(PROVEN_DEAD_CLAIM_REASON, true) };
    if (worker.sessionId !== undefined && this.deps.getWorkerLiveness?.(worker.sessionId) === 'dead') {
      return { claim: claimOf(AGENT_DEAD_CLAIM_REASON, true), closeSessionId: worker.sessionId };
    }
    const ceiling = record.request.policy?.maxClaimOutputOnlyMs ?? DEFAULT_DURABLE_CLAIM_OUTPUT_CEILING_MS;
    if (outputLive && lastWallClockProgressAt !== undefined && now - lastWallClockProgressAt >= ceiling) {
      return { claim: claimOf(STALLED_WORKER_CLAIM_REASON, true) };
    }
    if (unit.leaseExpiresAt === undefined || unit.leaseExpiresAt > now) return {};
    const state = worker.sessionId === undefined ? undefined : this.deps.getAgentState?.(worker.sessionId);
    // Zana is recovering this worker from an API error (nudge, restart): keep the claim until its deadline.
    if (isWorkerRecoveryLive(unit, now)) {
      return { renewSlot: unit.assignedSlotId };
    }
    if (state !== undefined && isRestfulAgentState(state)) return { claim: claimOf(SILENT_WORKER_CLAIM_REASON) };
    const maxStall = record.request.policy?.maxClaimStallMs;
    const lastProgressAt = unit.progressAt ?? unit.claimedAt;
    if (!outputLive && maxStall !== undefined && lastProgressAt !== undefined && now - lastProgressAt >= maxStall) {
      return { claim: claimOf(STALLED_WORKER_CLAIM_REASON) };
    }
    return { renewSlot: unit.assignedSlotId };
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
        const now = (this.deps.now ?? Date.now)();
        await this.warnNoTurnWorkers(record, lifecycle, now);
        if (!lifecycle?.workers) continue;
        const claims: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force?: boolean }[] = [];
        const renewSlots: string[] = [];
        for (const unit of record.workUnits ?? []) {
          const outcome = this.classifyExpiredClaim(record, unit, lifecycle!, now);
          if (outcome.claim) claims.push(outcome.claim);
          // Reclaiming the claim frees the WORK, but a dead worker's outer shell/tmux
          // wrapper survives as a remote zombie — reap it via the host's tmux-killing
          // close (captured-PID/boot reap can't: that pid is the exited inner agent).
          if (outcome.closeSessionId !== undefined) this.deps.closeWorkerSession?.(outcome.closeSessionId);
          if (outcome.renewSlot !== undefined) renewSlots.push(outcome.renewSlot);
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

  /** Records the run warning and offers it to the host (Inbox). Never throws: a warning must not break recovery. */
  private async raiseWorkerWarning(record: ExecutionRecord, slotId: string, summary: string, kind: ExecutionRunWarningKind, ref?: string): Promise<boolean> {
    const bounded = boundReason(summary);
    try {
      await this.deps.store.warning(record.id, { slotId, summary: bounded });
    } catch (error) {
      this.deps.logError?.(`Worker warning failed for ${record.id}`, error);
      return false;
    }
    try {
      await this.deps.onRunWarning?.(record, { slotId: boundReason(slotId, 120), summary: bounded, kind, ...(ref ? { ref: boundReason(ref, 200) } : {}) });
    } catch (error) {
      this.deps.logError?.(`Worker warning delivery failed for ${record.id}`, error);
    }
    return true;
  }

  /**
   * Visibility sweep (reconcile cadence): one notice per claim for a `READY` unit that waits while a seat is
   * idle, or a `CLAIMED` unit with no output progress; and one reminder per human blocker that waits. Extends
   * {@link raiseWorkerWarning}; holds no timer, and a run that ended drops its state. Never throws.
   */
  async sweepVisibility(): Promise<void> {
    const now = (this.deps.now ?? Date.now)();
    let active: ExecutionRecord[];
    try { active = await this.deps.store.listActive(); }
    catch (error) { this.deps.logError?.('execution.sweepVisibility list failed', error); return; }
    this.visibility.retainRuns(new Set(active.map((record) => record.id)));
    for (const record of active) {
      try {
        await this.noticeUnitVisibility(record, now);
        await this.remindHumanBlockers(record, now);
      } catch (error) {
        this.deps.logError?.(`execution.sweepVisibility failed for ${record.id}`, error);
      }
    }
  }

  private async noticeUnitVisibility(record: ExecutionRecord, now: number): Promise<void> {
    const idleWindow = this.deps.idleNoticeWindowMs?.() ?? IDLE_CAPACITY_NOTICE_MS;
    const heartbeatWindow = this.deps.heartbeatWarnWindowMs?.() ?? HEARTBEAT_WARN_MS;
    const live = new Set<string>();
    let lifecycle: ExtractedLifecycle | undefined;
    let lifecycleRead = false;
    const readLifecycle = async (): Promise<ExtractedLifecycle | undefined> => {
      if (lifecycleRead) return lifecycle;
      lifecycleRead = true;
      try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); }
      catch (error) { this.deps.logError?.(`Execution visibility lifecycle read failed for ${record.id}`, error); }
      return lifecycle;
    };
    const units = record.workUnits ?? [];
    const busySlots = new Set(units.filter((unit) => unit.state === 'CLAIMED' && unit.assignedSlotId).map((unit) => unit.assignedSlotId!));
    for (const unit of units) {
      if (unit.state === 'READY') {
        // READY means every dependency is done; the clock starts when this sweep first sees the unit READY at this
        // claim generation, so a retry pause or a reclaim restarts it.
        const key = `ready:${unit.id}:${unit.claimGeneration ?? 0}`;
        live.add(key);
        const seen = this.visibility.observe(record.id, key, now);
        if (!seen || seen.noticed || now - seen.since < idleWindow) continue;
        // Only a seat that could actually take this unit (requirements, routing) counts as idle capacity.
        // A record without a seat roster (legacy) cannot say who is capable, so it keeps the unfiltered behavior.
        const capable = record.authorizationContext?.slots?.length
          ? new Set(capableSeats(record, unit, this.deps.routingEnforcementEnabled?.(record) === true).map((seat) => seat.slotId)) : undefined;
        const idle = (await readLifecycle())?.workers?.find((worker) => worker.slotId && worker.projectId === record.projectId && (!capable || capable.has(worker.slotId))
          && !isOrchestratorSlotId(worker.slotId) && !!worker.process && !DEAD_WORKER_PROCESSES.has(worker.process) && !busySlots.has(worker.slotId));
        if (!idle?.slotId) continue;
        seen.noticed = true;
        await this.raiseWorkerWarning(record, idle.slotId, `${workerNoticeLabel(record, idle.slotId, this.deps.personaName)} is idle while unit ${unitNoticeName(unit)} has been ready for ${formatWait(now - seen.since)}. Open the Squad on the Agents board; if the unit stays unclaimed, ask the owner to assign it or restart the run.`, 'worker-idle', `${unit.id}:${unit.claimGeneration ?? 0}`);
      } else if (unit.state === 'CLAIMED' && unit.claimId && unit.assignedSlotId) {
        const key = `claim:${unit.id}:${unit.claimId}`;
        live.add(key);
        const last = unit.progressAt ?? unit.claimedAt;
        if (last === undefined || now - last < heartbeatWindow || isWorkerRecoveryLive(unit, now)) continue;
        const seen = this.visibility.observe(record.id, key, now);
        if (!seen || seen.noticed) continue;
        const worker = (await readLifecycle())?.workers?.find((candidate) => candidate.slotId === unit.assignedSlotId && candidate.projectId === record.projectId);
        // A worker that already exited is reported by its exit warning, not as a quiet heartbeat.
        if (worker && DEAD_WORKER_PROCESSES.has(worker.process ?? '')) continue;
        seen.noticed = true;
        await this.raiseWorkerWarning(record, unit.assignedSlotId, `${workerNoticeLabel(record, unit.assignedSlotId, this.deps.personaName)} has been silent for ${formatWait(now - last)} on unit ${unitNoticeName(unit)}. Open its terminal on the Agents board; if it stays silent, restart that worker or stop the Squad.`, 'worker-heartbeat', `${unit.id}:${unit.claimId}`);
      }
    }
    this.visibility.retainOnly(record.id, live);
  }

  private async remindHumanBlockers(record: ExecutionRecord, now: number): Promise<void> {
    const open = (record.blockers ?? []).filter((blocker) => !blocker.resolved && blocker.audience !== 'coordinator');
    this.visibility.retainReminded(record.id, new Set(open.map((blocker) => blocker.id)));
    const reminderMs = resolveBlockerReminderMs(this.deps.blockerReminderMs?.());
    if (reminderMs === 0) return;
    for (const blocker of open) {
      const waited = now - blockerWaitStart(blocker);
      if (waited < reminderMs || !this.visibility.markReminded(record.id, blocker.id)) continue;
      const delivered = await this.raiseWorkerWarning(record, blocker.slotId, `${blockerWaiter(record, blocker.slotId, this.deps.personaName)} has waited ${formatWait(waited)} for your answer on unit ${unitNoticeName(record.workUnits?.find((u) => u.id === blocker.workUnitId) ?? { id: blocker.workUnitId })} in "${record.jobTitle}". Open the Squad on the Agents board and answer the blocker.`, 'blocker-reminder', `${blocker.workUnitId}:${blocker.id}`);
      if (!delivered) this.visibility.unmarkReminded(record.id, blocker.id);
    }
  }

  /** A seat that started on demand and never had work is idle, not failed: only assigned or claimed seats warn. */
  private slotHasAssignment(record: ExecutionRecord, worker: { slotId?: string; onDemand?: true }): boolean {
    if (!worker.onDemand) return true;
    return (record.workUnits ?? []).some((unit) => unit.assignedSlotId === worker.slotId || unit.claimedBy?.slotId === worker.slotId);
  }

  private evictOldest(keys: Set<string>): void {
    while (keys.size > MAX_WORKER_WARNING_KEYS) keys.delete(keys.values().next().value as string);
  }

  /** Warns once for a worker that exited with a non-zero code or by signal; a clean exit or a user stop is silent. */
  private async warnWorkerExit(record: ExecutionRecord, worker: NonNullable<ExtractedLifecycle['workers']>[number]): Promise<void> {
    if (worker.process !== 'exited' || !worker.slotId || !this.slotHasAssignment(record, worker)) return;
    const crashed = worker.exitCode !== undefined ? worker.exitCode !== 0 : worker.exitSignal !== undefined && worker.exitSignal !== 0;
    if (!crashed) return;
    const how = worker.exitCode !== undefined ? `exited with code ${worker.exitCode}` : `was stopped by signal ${worker.exitSignal}`;
    const why = worker.exitReason ? `: ${worker.exitReason}` : '';
    const key = `${record.id}:${worker.slotId}:${worker.sessionId ?? ''}`;
    if (this.exitWarned.has(key)) return;
    this.exitWarned.add(key);
    this.evictOldest(this.exitWarned);
    await this.raiseWorkerWarning(record, worker.slotId, `Worker ${worker.slotId} ${how}${why}`, 'worker-exit');
  }

  /**
   * Warns once per claim whose worker has reported no turn and produced no output for the window since it was
   * claimed. A worker proven dead is skipped (its exit warns); a claim that is progressing never warns.
   */
  private async warnNoTurnWorkers(record: ExecutionRecord, lifecycle: ExtractedLifecycle | undefined, now: number): Promise<void> {
    const windowOverride = this.deps.noTurnWarnWindowMs?.();
    const stallWindow = record.request.policy?.maxClaimStallMs ?? DEFAULT_DURABLE_CLAIM_STALL_MS;
    for (const unit of record.workUnits ?? []) {
      if (unit.state !== 'CLAIMED' || !unit.claimId || !unit.assignedSlotId || unit.claimedAt === undefined) continue;
      if ((unit.turnCount ?? 0) > 0 || (unit.progressAt ?? unit.claimedAt) > unit.claimedAt) continue;
      // Same clock as the reclaim: a claim that is still printing output is only reclaimed at the output-only ceiling, so warn then.
      const window = windowOverride ?? (claimOutputLive(unit, now) ? (record.request.policy?.maxClaimOutputOnlyMs ?? DEFAULT_DURABLE_CLAIM_OUTPUT_CEILING_MS) : stallWindow);
      if (now - unit.claimedAt < window) continue;
      const slotId = unit.assignedSlotId;
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
      if (worker && DEAD_WORKER_PROCESSES.has(worker.process ?? '')) continue;
      const key = `${record.id}:${unit.id}:${unit.claimId}`;
      if (this.noTurnWarned.has(key)) continue;
      this.noTurnWarned.add(key);
      this.evictOldest(this.noTurnWarned);
      await this.raiseWorkerWarning(record, slotId, `Worker ${slotId} has taken no turn for ${formatDuration(window)} after it was assigned work`, 'worker-no-turn');
    }
  }

  /**
   * Recover one worker claim immediately after main records its terminal PTY state.
   * This deliberately does not share {@link reconcileActive}'s in-flight guard:
   * an exit during a periodic sweep must not leave a fresh claim stranded until a
   * later timer tick.
   */
  async recoverExitedWorker(executionId: string, slotId: string): Promise<void> {
    const record = await this.deps.store.get(executionId);
    if (!record || isResumeGrantTerminal(record.state)) return;
    let lifecycle: ExtractedLifecycle | undefined;
    try {
      lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
    } catch (error) {
      this.deps.logError?.(`Execution worker-exit lifecycle read failed for ${record.id}`, error);
      return;
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker || !DEAD_WORKER_PROCESSES.has(worker.process ?? '')) return;
    await this.warnWorkerExit(record, worker);
    const unit = record.workUnits?.find((candidate) => candidate.state === 'CLAIMED' && candidate.assignedSlotId === slotId);
    if (!unit?.claimId || unit.claimGeneration === undefined) return;
    const reclaimed = await this.deps.store.reclaimExpiredClaims(record.id, [{
      workUnitId: unit.id,
      claimId: unit.claimId,
      claimGeneration: unit.claimGeneration,
      reason: PROVEN_DEAD_CLAIM_REASON,
      force: true
    }]);
    const changed = await this.escalateKickoffFailures(reclaimed);
    if (reclaimed.stateVersion !== record.stateVersion || changed) await this.cascadeDispatch(reclaimed.id);
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
  /**
   * Classify a durable record's CLAIMED units into force-reclaimable "wedged"
   * claims vs. a genuinely live claim. A CLAIMED unit normally means work is in
   * flight and the run is healthy. But a claim whose worker has produced no OUTPUT
   * — `progressAt` (stamped on claim, advanced ONLY by real worker output, never by
   * agent-state lease renewal) is more than the run's stall window stale — is a
   * stranded / never-delivered (or dead-since-a-single-echo) assignment, NOT work in
   * flight (live run c33a6715: a remote worker sat in standby, board CLAIMED,
   * `deliveries: []`, coordinator PARKED, telemetry gap climbing, so reconcileActive
   * kept renewing the lease from agent-state and only the blunt 10-min stall ceiling
   * could break it — which then re-handed the SAME undelivered slot and re-wedged).
   * Treat the run as busy ONLY when a claim's output is RECENT; otherwise mark the
   * wedged claims for force-reclaim so the unit returns to READY and re-dispatches.
   * Gated behind the same claim-recovery flags as reconcileActive, and only when the
   * coordinator has PARKED (an active coordinator manages its own claims;
   * reconcileActive owns lease-expiry reclaim for the coordinator-active case).
   *
   * Liveness is RECENCY of output, not "ever output past claim". The old
   * `progressed = progressAt > claimedAt` short-circuit treated ANY output as live —
   * but a bare interactive worker (OpenCode) that only ECHOES the injected assignment
   * paste advances `progressAt` ONCE then goes silent, so `progressed` stayed true
   * forever and this backstop was permanently masked (the dead claim was skipped as
   * "live" every sweep — live run 47823553). A claim is live ONLY while its last
   * output is within the stall window; a stale single blip is caught exactly like a
   * never-progressed claim.
   */
  private classifyStalledClaims(record: ExecutionRecord, now: number, enforce: boolean): {
    wedgedClaims: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force: true }[];
    liveClaim: boolean;
  } {
    const stallMs = record.request.policy?.maxClaimStallMs;
    const wedgedClaims: { workUnitId: string; claimId: string; claimGeneration: number; reason: string; force: true }[] = [];
    let liveClaim = false;
    for (const unit of record.workUnits ?? []) {
      if (unit.state !== 'CLAIMED') continue;
      const lastProgressAt = unit.progressAt ?? unit.claimedAt;
      // progressAt can predate the API error, so an active recovery before its deadline is live, not wedged.
      const recovering = isWorkerRecoveryLive(unit, now);
      const stalled = !recovering && stallMs !== undefined && lastProgressAt !== undefined
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
    return { wedgedClaims, liveClaim };
  }

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
      const { wedgedClaims, liveClaim } = this.classifyStalledClaims(record, now, enforce);
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
      // Per-execution isolation: a cascadeDispatch rejection for one run must NOT
      // abort the sweep and starve every later stalled run (a persistently-failing
      // record first in the list would otherwise block recovery of all the rest).
      try {
        await this.cascadeDispatch(record.id);
      } catch (error) {
        this.deps.logError?.(`Execution stalled-redispatch dispatch failed for ${record.id}`, error);
      }
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
    if (!isDurableCoordination(reclaimed.coordinationMode)) return false;
    for (const unit of reclaimed.workUnits ?? []) {
      if (!(unit.noProgressSlots ?? []).some((entry) => entry.executionAttempt === reclaimed.attempt)) continue;
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
        await this.deps.store.reassignKickoffToFreshSlot(reclaimed.id, unit.id, { enforceRouting: this.deps.routingEnforcementEnabled?.(reclaimed) === true, ...await this.deferredDispatchOpts(reclaimed) });
        changed = true;
        continue; // reassigned to a fresh slot — the caller's cascadeDispatch redispatches it
      } catch (error) {
        if (!(error instanceof WorkUnitRecoveryGuardError)) {
          // A genuine store/persistence failure — NOT a no-op guard. Surface it and
          // do NOT fall through to a human block: the same broken store would fail
          // that write too, and masking it as "skipped" would hide a churning unit
          // that silently never reassigned OR blocked (finding-driven distinction).
          this.deps.logError?.(`Execution kickoff-failure reassignment FAILED (persistence) for ${reclaimed.id}/${unit.id}`, error);
          continue;
        }
        // Guard rejection: no untried slot / not reassignable → block to a human below.
        this.deps.logError?.(`Execution kickoff-failure reassignment skipped for ${reclaimed.id}/${unit.id}`, error);
      }
      // #789: a role with ONE capable seat has no fresh slot to move to. Retry that seat once (and respawn it
      // when its session is gone) before a person is asked. Roles with 2+ capable seats never get here: they
      // were reassigned above, or have exhausted every seat and block.
      if (await this.recoverSingleSeat(reclaimed, unit)) { changed = true; continue; }
      if (await this.blockKickoffToHuman(reclaimed, unit)) changed = true;
    }
    return changed;
  }

  /**
   * Single-seat recovery for {@link escalateKickoffFailures}. Combined per-unit cap, per execution attempt:
   * one same-seat retry AND one respawn (a respawn that succeeds also counts as the retry), on top of the
   * unit's one STALLED READY-retry (store `reclaimExpiredClaims`) and the `kickoffFailures` threshold
   * (`KICKOFF_FAILURE_BLOCK_THRESHOLD`, never-turned claims). Whatever is spent, the next failure blocks to a
   * human. A dead seat (PROVEN_DEAD / AGENT_DEAD) is respawned through {@link respawnSlot} (lifecycle fences and
   * per-slot cap apply). Behind the claim-recovery Enforce flag, like the reclaim that led here.
   * Returns true when the unit was re-dispatched on its seat (the caller cascades).
   */
  private async recoverSingleSeat(reclaimed: ExecutionRecord, unit: NonNullable<ExecutionRecord['workUnits']>[number]): Promise<boolean> {
    if (this.deps.claimRecoveryEnforceEnabled?.() !== true) return false;
    const enforceRouting = this.deps.routingEnforcementEnabled?.(reclaimed) === true;
    const seat = singleSeatOf(reclaimed, unit, enforceRouting);
    if (!seat) return false;
    const dead = seat.reason === PROVEN_DEAD_CLAIM_REASON || seat.reason === AGENT_DEAD_CLAIM_REASON;
    try {
      if (dead && seat.seatRecovery?.respawned === undefined) {
        // Spend the respawn durably BEFORE running it. If this throws (unit no longer READY, persistence error) no
        // respawn happens; if the settle below throws, the reservation still stands, so a second respawn can never follow.
        await this.deps.store.recordSeatRecovery(reclaimed.id, unit.id, { kind: 'respawn-intent' }, { enforceRouting });
        await this.quiesceOldSession(reclaimed, seat.slotId);
        const outcome = await this.respawnSlot(reclaimed, seat.slotId);
        if (!outcome.ok) this.deps.logError?.(`Execution single-seat respawn failed for ${reclaimed.id}/${seat.slotId}: ${outcome.code}`, new Error(outcome.message));
        await this.deps.store.recordSeatRecovery(reclaimed.id, unit.id, { kind: 'respawn', ok: outcome.ok }, { enforceRouting });
        return outcome.ok;
      }
      if (seat.seatRecovery?.retried) return false;
      await this.deps.store.recordSeatRecovery(reclaimed.id, unit.id, { kind: 'retry' }, { enforceRouting });
      return true;
    } catch (error) {
      if (!(error instanceof WorkUnitRecoveryGuardError)) this.deps.logError?.(`Execution single-seat recovery FAILED (persistence) for ${reclaimed.id}/${unit.id}`, error);
      return false;
    }
  }

  /**
   * Before a dead seat is respawned: close the old session (idempotent) and wait, bounded, until it has exited, so a
   * shell that outlived its agent cannot act after the replacement starts. On timeout or error it logs and proceeds
   * (the claim fence in the store still drops the old session's late signals).
   */
  private async quiesceOldSession(record: ExecutionRecord, slotId: string): Promise<void> {
    const wait = this.deps.waitForWorkerSessionExit;
    try {
      const { sessionId } = await this.slotSessionState(record, slotId);
      if (!sessionId) return;
      this.deps.closeWorkerSession?.(sessionId);
      if (!wait) return;
      const exited = await wait(sessionId, OLD_SESSION_EXIT_WAIT_MS);
      if (!exited) this.deps.logError?.(`Old session of ${record.id}/${slotId} still present after ${OLD_SESSION_EXIT_WAIT_MS}ms; respawning anyway`, new Error('old session exit wait timed out'));
    } catch (error) {
      this.deps.logError?.(`Old session of ${record.id}/${slotId} could not be quiesced before respawn`, error);
    }
  }

  /**
   * No-start retry. A worker-reported failure of a claim that never started (no turn, no file change) and that is
   * not a blocker/contract/validation failure is treated as a kickoff failure rather than a terminal one: the claim
   * is reclaimed as STALLED (never-started path, so `kickoffFailures` is bumped and the seat is recorded in
   * `noProgressSlots`) and {@link escalateKickoffFailures} reassigns / retries the seat / respawns it, then blocks
   * to a human at KICKOFF_FAILURE_BLOCK_THRESHOLD. Same budget as every other kickoff failure: no parallel counter.
   * A repeat of the previous failure text (timestamps and ids stripped) is not retried, so a deterministic failure
   * fails normally. Returns true when the claim was recovered here.
   */
  private async retryNoStartFailure(binding: ExecutionCohortBinding, workUnitId: string, failure: string, failureCode: ExecutionFailureCode, claim: { claimId: string; claimGeneration: number } | undefined, structuredResult: unknown): Promise<{ recovered: boolean; failure?: string }> {
    if (!NO_START_RETRY_CODES.has(failureCode) || structuredResult !== undefined || this.deps.claimRecoveryEnforceEnabled?.() !== true) return { recovered: false };
    try {
      const first = await this.noStartRetryCandidate(binding, workUnitId, failure, claim);
      if (first.kind === 'no') return { recovered: false };
      if (first.kind === 'failed-again') return { recovered: false, failure: first.failure };
      // Pause, then re-check: the claim may have moved on (or the run ended) while the seat settled.
      if (!await this.pauseBeforeNoStartRetry()) return { recovered: false };
      const second = await this.noStartRetryCandidate(binding, workUnitId, failure, claim);
      if (second.kind === 'failed-again') return { recovered: false, failure: second.failure };
      if (second.kind !== 'retry') return { recovered: false };
      const reclaimed = await this.deps.store.reclaimExpiredClaims(second.recordId, [{
        workUnitId, claimId: second.claimId, claimGeneration: second.claimGeneration, reason: NO_PROGRESS_CLAIM_REASON.STALLED, force: true,
        detail: `${NO_START_MARKER}${second.normalized}`
      }]);
      await this.escalateKickoffFailures(reclaimed);
      await this.cascadeDispatch(reclaimed.id);
      return { recovered: true };
    } catch (error) {
      this.deps.logError?.(`Execution no-start retry failed for ${binding.executionId}/${workUnitId}`, error);
      return { recovered: false };
    }
  }

  /**
   * Whether a worker-reported failure of `workUnitId` may be retried as a no-start kickoff failure. `failed-again`
   * means a no-start retry already ran for this unit and it failed again (same text, or the kickoff budget is spent):
   * the unit then fails with a reason naming it as `id: title`.
   */
  private async noStartRetryCandidate(binding: ExecutionCohortBinding, workUnitId: string, failure: string, claim: { claimId: string; claimGeneration: number } | undefined):
    Promise<{ kind: 'no' } | { kind: 'failed-again'; failure: string } | { kind: 'retry'; recordId: string; claimId: string; claimGeneration: number; normalized: string }> {
    const record = await this.deps.store.get(binding.executionId);
    const unit = record?.workUnits?.find((candidate) => candidate.id === workUnitId);
    if (!record || !unit || !isDurableCoordination(record.coordinationMode) || unit.state !== 'CLAIMED' || unit.assignedSlotId !== binding.slotId) return { kind: 'no' };
    if (unit.claimId === undefined || unit.claimGeneration === undefined) return { kind: 'no' };
    if (claim && (claim.claimId !== unit.claimId || claim.claimGeneration !== unit.claimGeneration)) return { kind: 'no' };
    if ((unit.turnCount ?? 0) > 0 || unit.lastTurnAt !== undefined || (unit.touched?.length ?? 0) > 0) return { kind: 'no' };
    if (record.blockers?.some((blocker) => !blocker.resolved && blocker.workUnitId === workUnitId)) return { kind: 'no' };
    const normalized = normalizeFailureText(failure);
    const previous = [...unit.history].reverse().find((entry) => entry.action === 'released' && entry.detail?.includes(NO_START_MARKER));
    const label = unit.title ? `${unit.id}: ${unit.title}` : unit.id;
    const failedAgain = (reason: string) => ({ kind: 'failed-again' as const, failure: `No-start retry of work unit ${label} failed (${reason}): ${failure}`.slice(0, 2_000) });
    if ((unit.kickoffFailures ?? 0) >= KICKOFF_FAILURE_BLOCK_THRESHOLD) return previous ? failedAgain('retry budget spent') : { kind: 'no' };
    if (previous?.detail?.endsWith(`${NO_START_MARKER}${normalized}`)) return failedAgain('same failure as the previous attempt');
    return { kind: 'retry', recordId: record.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration, normalized };
  }

  /** Bounded pause before a no-start retry. Resolves false when the service is disposed meanwhile (timer released). */
  private pauseBeforeNoStartRetry(): Promise<boolean> {
    const ms = this.deps.noStartRetryPauseMs ?? NO_START_RETRY_PAUSE_MS;
    if (this.disposed) return Promise.resolve(false);
    if (ms <= 0) return Promise.resolve(true);
    const setTimer: (fn: () => void, ms: number) => NodeJS.Timeout = this.deps.setTimer ?? setTimeout;
    const clearTimer: (timer: NodeJS.Timeout) => void = this.deps.clearTimer ?? clearTimeout;
    return new Promise<boolean>((resolve) => {
      const pause = { cancel: () => { clearTimer(timer); this.noStartPauses.delete(pause); resolve(false); } };
      const timer = setTimer(() => { this.noStartPauses.delete(pause); resolve(!this.disposed); }, Math.min(ms, NO_START_RETRY_PAUSE_MS));
      (timer as { unref?: () => void }).unref?.();
      this.noStartPauses.add(pause);
    });
  }

  /** Fire-and-forget `onHumanBlocker`; a throwing or rejecting hook is logged, never propagated. */
  private fireHumanBlocker(record: ExecutionRecord, blocker: NonNullable<ExecutionRecord['blockers']>[number]): void {
    const hook = this.deps.onHumanBlocker;
    if (!hook) return;
    const report = (error: unknown) => (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(`execution human blocker hook failed for ${record.id}/${blocker.id}`, error);
    try { void Promise.resolve(hook(record, blocker)).catch(report); } catch (error) { report(error); }
  }

  /**
   * Human-escalation half of {@link escalateKickoffFailures}: block the churning
   * unit to a HUMAN_BLOCKER, wake the (parked) coordinator, and mirror the blocker
   * onto the Inbox so a "needs you" run ALWAYS produces an actionable inbox entry (a
   * comment-bearing SIGNAL row that links back to the execution + blocker for board
   * resolution — a HUMAN_BLOCKER that only woke the coordinator left NO inbox
   * message, the exact gap reported live). Returns true iff the unit was blocked.
   * A no-op guard (below threshold / already blocked / duplicate) returns false
   * quietly; a genuine persistence failure is surfaced (NOT swallowed as "skipped")
   * so a churning unit left neither reassigned nor blocked is visible.
   */
  private async blockKickoffToHuman(reclaimed: ExecutionRecord, unit: NonNullable<ExecutionRecord['workUnits']>[number]): Promise<boolean> {
    return this.blockUnitToHuman(reclaimed.id, unit.id, () => this.deps.store.blockKickoffFailure(reclaimed.id, unit.id, undefined, { enforceRouting: this.deps.routingEnforcementEnabled?.(reclaimed) === true }),
      `NO_PROGRESS_EXHAUSTED: work unit ${unit.id} made no progress after attempts across every eligible worker slot — check the worker terminal or restart the run.`,
      'kickoff-failure block');
  }

  /**
   * A Squad worker stopped on an API error and Zana's recovery is exhausted (or the
   * error is permanent): block the unit to a human, then re-dispatch whatever is ready.
   */
  async blockApiErrorToHuman(executionId: string, workUnitId: string, fence: { claimId: string; claimGeneration: number }): Promise<boolean> {
    const blocked = await this.blockUnitToHuman(executionId, workUnitId, () => this.deps.store.blockKickoffFailure(executionId, workUnitId, fence),
      `NO_PROGRESS_EXHAUSTED: work unit ${workUnitId} stopped after an API error and did not recover — check the worker terminal or restart the run.`,
      'API-error block');
    if (blocked) await this.cascadeDispatch(executionId);
    return blocked;
  }

  /** The CLAIMED unit currently assigned to a slot, with its claim fence. */
  async findWorkerClaim(executionId: string, slotId: string): Promise<{ workUnitId: string; claimId: string; claimGeneration: number } | undefined> {
    const record = await this.deps.store.get(executionId);
    const unit = record?.workUnits?.find((candidate) => candidate.state === 'CLAIMED' && candidate.assignedSlotId === slotId);
    if (!unit || !unit.claimId || unit.claimGeneration === undefined) return undefined;
    return { workUnitId: unit.id, claimId: unit.claimId, claimGeneration: unit.claimGeneration };
  }

  /** Send the assignment again, behind a preface, while the unit is still CLAIMED with this fence. */
  async redeliverClaim(
    executionId: string, workUnitId: string, fence: { claimId: string; claimGeneration: number }, sessionId: string, preface: string
  ): Promise<boolean> {
    const record = await this.deps.store.get(executionId);
    const unit = record?.workUnits?.find((candidate) => candidate.id === workUnitId);
    if (!record || !unit || unit.state !== 'CLAIMED' || unit.claimId !== fence.claimId
      || unit.claimGeneration !== fence.claimGeneration || !unit.assignedSlotId) return false;
    const text = assignmentText(record, {
      workUnitId: unit.id, slotId: unit.assignedSlotId, title: unit.title ?? '', task: unit.task, files: unit.files,
      claimId: unit.claimId, claimGeneration: unit.claimGeneration, ...(unit.turnCount ? { turnCount: unit.turnCount } : {}), ...(unit.verification?.length ? { verification: unit.verification } : {})
    });
    return Boolean(await (this.deps.deliverToWorker ?? this.deps.replyToSession)(sessionId, `${preface}\n\n${text}`));
  }

  /**
   * Shared tail of the two "block a unit to a human" paths: persist the block, wake the
   * coordinator, fire the human blocker and append the Inbox entry. Returns true iff the
   * unit was blocked; a guard rejection is logged and returns false.
   */
  private async blockUnitToHuman(
    executionId: string, workUnitId: string, block: () => Promise<ExecutionRecord>, message: string, label: string
  ): Promise<boolean> {
    try {
      const updated = await block();
      await this.wakeCoordinator(updated, {
        cause: 'NO_PROGRESS_EXHAUSTED', message, workUnitId, stateOrClaimGeneration: updated.state
      });
      const blocker = updated.blockers?.find((candidate) => candidate.workUnitId === workUnitId && candidate.audience === 'human' && !candidate.resolved);
      if (blocker) {
        this.fireHumanBlocker(updated, blocker);
        void this.deps.inbox?.append({
          projectId: updated.projectId,
          subject: blockerCardSubject(updated),
          comments: blocker.question,
          executionId: updated.id,
          blockerId: blocker.id
        }).catch((err) => {
          (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(`Failed to append inbox entry for ${label}`, err);
        });
      }
      return true;
    } catch (error) {
      if (!(error instanceof WorkUnitRecoveryGuardError)) {
        this.deps.logError?.(`Execution ${label} FAILED (persistence) for ${executionId}/${workUnitId}`, error);
      } else {
        // Guard rejection: below threshold / already blocked / duplicate → not an error.
        this.deps.logError?.(`Execution ${label} skipped for ${executionId}/${workUnitId}`, error);
      }
      return false;
    }
  }

  dispose(): void {
    for (const check of this.runCheckCompletions.values()) check.controller.abort();
    for (const check of this.checkCompletions.values()) check.controller.abort();
    this.checkCompletions.clear();
    this.deadlineWatchdog.dispose();
    this.planReadinessWatchdog.dispose();
    const clearTimer = this.deps.clearTimer ?? clearTimeout;
    for (const timer of this.autoFinalizeTimers.values()) clearTimer(timer);
    this.autoFinalizeTimers.clear();
    for (const timer of this.checkpointRetryTimers.values()) clearTimer(timer);
    this.checkpointRetryTimers.clear();
    this.disposed = true;
    for (const pause of [...this.noStartPauses]) pause.cancel();
    this.noStartPauses.clear();
    this.routeFactCircuits.clear();
    this.visibility.clear();
    this.wakeConfirmations.dispose();
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

  /** Whether the bound run's work unit declares an `output` (so `structuredResult` is accepted for it). */
  async workUnitDeclaresOutput(binding: ExecutionCohortBinding, workUnitId: string): Promise<boolean> {
    const record = await this.getBound(binding);
    return !!record?.workUnits?.find((unit) => unit.id === workUnitId)?.output;
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
    const result = await this.mutateBound(binding, async (record) => {
      // Admission first: only an admissible plan may become a held correction
      // candidate. The bound submitter lets main hold that candidate for review.
      const admission = await this.evaluateResolvedAdmission(record.projectId, this.planRegistrationRequest(record, workUnits));
      if (!admission.ready) {
        const failed = admission.checks.find((check) => check.required && check.status !== 'PASS');
        throw new Error(failed?.message ?? 'Team admission failed');
      }
      const consent = await this.deps.authorizePlanRegistration?.(record, workUnits, binding);
      if (consent && !consent.ok) throw new Error(consent.message);
      const references = [...workUnits.flatMap(unit => unit.checks ?? []), ...record.resolvedLaunch.checks.value];
      const frozen = record.resolvedChecks ?? [];
      const missing = references.filter(name => !frozen.some(check => check.reference === `check:${name}`));
      const resolvedChecks = missing.length ? [...frozen, ...await this.resolveChecks(record.projectId, missing)] : frozen;
      return this.deps.store.registerPlan(record.id, record.stateVersion, workUnits, resolvedChecks);
    });
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
    // Recheck correction consent after persistence. A user can cancel while the
    // coordinator's registration is in flight; terminal cancellation wins before
    // this path can mint any worker claims.
    const current = await this.deps.store.get(binding.executionId);
    const consent = current && await this.deps.authorizePlanRegistration?.(current, workUnits);
    if (consent && !consent.ok) return { ok: false as const, code: 'INVALID', message: consent.message };
    const dispatched = await this.dispatchReady(binding);
    return dispatched.ok ? dispatched : result;
  }

  /** Rebuild registration admission from immutable launch facts plus proposed plan. */
  private planRegistrationRequest(record: ExecutionRecord, workUnits: ExecutionWorkUnitInput[]): ExecutionRequestV1 {
    return {
      version: 1,
      launchKind: record.launchKind,
      launchDisplay: record.launchDisplay,
      teamId: record.teamId,
      launchRequestId: record.launchRequestId,
      jobTitle: record.jobTitle,
      summary: record.summary,
      slots: record.request.slots,
      policy: record.request.policy,
      workflow: record.request.workflow,
      resolvedModels: record.resolvedModels,
      sourceBundle: record.request.sourceBundle,
      workUnits,
      coordinationMode: record.coordinationMode,
      origin: record.origin,
      worktree: record.request.worktree,
      onComplete: record.request.onComplete,
      ...(record.request.target === undefined ? {} : { target: record.request.target })
    };
  }

  /**
   * Worker-initiated claim. `callerSessionId` is the MCP route session of the caller: a claim from a session that is not
   * the slot's current one (an old session of a respawned seat) is refused, and an accepted claim is bound to the
   * caller's session so the store's session fence covers its later lease / turn / write signals. Omitted (modern Squad
   * member path, no PTY session) or an unknown slot session fails open, as in the store fence.
   */
  async claimWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string, callerSessionId?: string, memberGeneration?: number) {
    if (binding.role !== 'worker') return deniedBound('coordinator must use execution.work.assign');
    const budget = await this.budgetAdmission(binding.executionId);
    if (!budget.ok) return budget;
    if (callerSessionId !== undefined && await this.claimSessionStale(binding, callerSessionId, memberGeneration)) {
      return deniedBound(`claim of ${workUnitId} refused: session ${callerSessionId} is no longer the live session of slot ${binding.slotId}`);
    }
    await this.drainStaleChecks(binding.executionId);
    const outcome = await this.captureClaimBaseline(await this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId)), workUnitId);
    // A modern member carries no PTY session id on its later signals, so only a CLI claim is bound to its session.
    if (callerSessionId !== undefined && memberGeneration === undefined && outcome.ok) {
      const unit = (outcome as unknown as { value?: ExecutionRecord }).value?.workUnits?.find((candidate) => candidate.id === workUnitId);
      if (unit?.state === 'CLAIMED' && unit.claimId && unit.assignedSlotId === binding.slotId) {
        try { await this.deps.store.bindClaimSession(binding.executionId, workUnitId, unit.claimId, callerSessionId); }
        catch (error) { this.deps.logError?.(`execution claim session bind failed for ${binding.executionId}/${workUnitId}`, error); }
      }
    }
    return outcome;
  }

  /**
   * True when the slot's current session is known and differs from the caller. A CLI seat is identified by its worker
   * `sessionId`; a modern member (`memberGeneration` set) by its `threadId` and binding generation. Unknown identity fails open.
   */
  private async claimSessionStale(binding: ExecutionCohortBinding, sessionId: string, memberGeneration?: number): Promise<boolean> {
    try {
      const record = await this.deps.store.get(binding.executionId);
      if (!record) return false;
      if (memberGeneration === undefined) {
        const { sessionId: current } = await this.slotSessionState(record, binding.slotId);
        return current !== undefined && current !== sessionId;
      }
      const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === binding.slotId && candidate.projectId === record.projectId) as { threadId?: unknown; generation?: unknown } | undefined;
      if (!worker) return false;
      if (typeof worker.threadId === 'string' && worker.threadId !== sessionId) return true;
      return typeof worker.generation === 'number' && worker.generation !== memberGeneration;
    } catch (error) {
      this.deps.logError?.(`claim session check failed for ${binding.executionId}/${binding.slotId}`, error);
      return false;
    }
  }

  async assignWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId: string) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can assign work');
    const budget = await this.budgetAdmission(binding.executionId);
    if (!budget.ok) return budget;
    await this.drainStaleChecks(binding.executionId);
    return this.captureClaimBaseline(await this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId)), workUnitId);
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
  async renewWorkerLease(executionId: string, slotId: string, sessionId?: string): Promise<void> {
    try {
      // Host-observed worker OUTPUT renews the lease and the output lease ONLY. It does not move `progressAt`:
      // a worker can print forever while stuck. A turn heartbeat or a file change advances it (recordClaimSignal).
      await this.deps.store.renewWorkerLease(executionId, slotId, { advanceProgress: false, output: true, ...(sessionId ? { sessionId } : {}) });
    } catch (error) {
      this.deps.logError?.(`execution worker lease renew failed (execution=${executionId}, slot=${slotId})`, error);
    }
  }

  private checkpointsOn(): boolean { return this.deps.unitCheckpointsEnabled?.() !== false; }

  /**
   * Record the squad worktree's git state when a claim starts (the checkpoint baseline). Runs before the claim
   * reply reaches the worker so no write can precede it. Never throws and never changes the claim outcome.
   */
  private async captureClaimBaseline<T extends { ok: boolean }>(outcome: T, workUnitId: string): Promise<T> {
    try {
      if (!outcome.ok || !this.checkpointsOn()) return outcome;
      const record = (outcome as unknown as { value?: ExecutionRecord }).value;
      const root = record?.squadWorktree?.path;
      const unit = record?.workUnits?.find((candidate) => candidate.id === workUnitId);
      if (!record || !root || !unit || unit.state !== 'CLAIMED' || !unit.claimId || unit.baseline?.claimId === unit.claimId) return outcome;
      const baseline = await captureBaseline(root, unit.claimId, { ...(this.deps.checkpointGit ? { git: this.deps.checkpointGit } : {}), now: this.deps.now });
      await this.deps.store.recordUnitCheckpoint(record.id, unit.id, { baseline });
    } catch (error) {
      this.deps.logError?.(`execution claim baseline failed (execution=${(outcome as { value?: { id?: string } }).value?.id}, unit=${workUnitId})`, error);
    }
    return outcome;
  }

  private readonly checkpointTails = new Map<string, Promise<void>>();
  private readonly checkpointRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly noStartPauses = new Set<{ cancel: () => void }>();
  private disposed = false;

  /** Fire-and-forget entry used after unit transitions. */
  private scheduleUnitCheckpoints(executionId: string): void {
    if (!this.checkpointsOn()) return;
    void this.settleUnitCheckpoints(executionId);
  }

  /**
   * Save per-unit checkpoints for COMPLETED and FAILED units that have none, and restore a FAILED unit's own
   * edits once its slot is quiet. Serialized per execution; never throws.
   */
  async settleUnitCheckpoints(executionId: string): Promise<void> {
    if (!this.checkpointsOn()) return;
    const tail = (this.checkpointTails.get(executionId) ?? Promise.resolve()).then(() => this.settleUnitCheckpointsOnce(executionId));
    const guarded = tail.catch((error) => this.deps.logError?.(`execution unit checkpoint failed (execution=${executionId})`, error));
    this.checkpointTails.set(executionId, guarded);
    await guarded;
    if (this.checkpointTails.get(executionId) === guarded) this.checkpointTails.delete(executionId);
    await this.scheduleCheckpointRetry(executionId);
  }

  /** A FAILED unit whose slot was still mid-turn stays `pending`; with no later cascade (e.g. a finished run) nothing would retry it, so re-check on a short bounded timer. */
  private async scheduleCheckpointRetry(executionId: string): Promise<void> {
    if (this.checkpointRetryTimers.has(executionId)) return;
    const record = await this.deps.store.get(executionId).catch(() => undefined);
    if (!record?.workUnits?.some((unit) => unit.state === 'FAILED' && unit.checkpoint?.state === 'pending' && (unit.checkpoint.attempts ?? 0) < MAX_RESTORE_ATTEMPTS)) return;
    const setTimer = this.deps.setTimer ?? setTimeout;
    const timer = setTimer(() => { this.checkpointRetryTimers.delete(executionId); void this.settleUnitCheckpoints(executionId); }, 1000);
    (timer as { unref?: () => void }).unref?.();
    this.checkpointRetryTimers.set(executionId, timer as ReturnType<typeof setTimeout>);
  }

  private async slotQuiet(record: ExecutionRecord, unit: ExecutionRecord['workUnits'] extends (infer U)[] | undefined ? NonNullable<U> : never): Promise<boolean> {
    const slot = unit.assignedSlotId;
    if (!slot) return true;
    if ((record.workUnits ?? []).some((other) => other.id !== unit.id && other.state === 'CLAIMED' && other.assignedSlotId === slot)) return false;
    if (!this.deps.getAgentState) return true;
    try {
      const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slot && candidate.projectId === record.projectId);
      if (worker?.sessionId && !DEAD_WORKER_PROCESSES.has(worker.process ?? '') && this.deps.getAgentState(worker.sessionId) === 'working') return false;
    } catch (error) {
      this.deps.logError?.(`execution checkpoint quiesce probe failed for ${record.id}/${slot}`, error);
      return false;
    }
    return true;
  }

  private async settleUnitCheckpointsOnce(executionId: string): Promise<void> {
    const record = await this.deps.store.get(executionId);
    const root = record?.squadWorktree?.path;
    if (!record || !root) return;
    const units = record.workUnits ?? [];
    for (const unit of units) {
      if (unit.state !== 'COMPLETED' && unit.state !== 'FAILED') continue;
      if (!unit.baseline && !(unit.touched?.length)) continue;
      const previous = unit.checkpoint;
      if (previous && previous.state !== 'pending') continue;
      const failed = unit.state === 'FAILED';
      const quiet = failed ? await this.slotQuiet(record, unit) : true;
      const attempts = (previous?.attempts ?? 0) + 1;
      const giveUp = failed && !quiet && attempts >= MAX_RESTORE_ATTEMPTS;
      const siblings = units.filter((other) => other.id !== unit.id && ((other.touched?.length ?? 0) > 0 || other.baseline !== undefined)).map((other) => ({
        id: other.id,
        touched: (other.touched ?? []).map((entry) => ({ path: entry.path, hash: entry.hash })),
        concurrent: other.state === 'CLAIMED' || other.state === 'BLOCKED'
          || (other.state !== 'PENDING' && other.state !== 'READY' && (other.checkpoint === undefined || other.checkpoint.at >= (unit.baseline?.at ?? 0)))
      }));
      const built = await buildUnitCheckpoint(root, {
        id: unit.id, state: unit.state, touched: (unit.touched ?? []).map((entry) => ({ path: entry.path, hash: entry.hash })),
        ...(unit.baseline ? { baseline: unit.baseline } : {})
      }, siblings, { restore: failed && quiet, ...(this.deps.checkpointGit ? { git: this.deps.checkpointGit } : {}), now: this.deps.now });
      let artifact = previous?.artifact;
      if (!artifact) {
        const name = `checkpoint/${unit.id}/${unit.claimGeneration ?? 0}`;
        try {
          const stored = await this.deps.artifacts.put({ executionId: record.id, attempt: record.attempt, projectId: record.projectId, name, mediaType: 'application/json', content: built.artifactContent });
          if (stored.outcome !== 'conflict') artifact = name;
        } catch (error) { this.deps.logError?.(`execution checkpoint artifact failed (execution=${record.id}, unit=${unit.id})`, error); }
      }
      let checkpoint: UnitCheckpoint = { ...built.checkpoint, attempts, ...(artifact ? { artifact } : {}) };
      if (failed && !quiet) {
        checkpoint = giveUp
          ? { ...checkpoint, state: 'partial', skipped: [...checkpoint.skipped, ...(unit.touched ?? []).slice(0, 100).map((entry) => ({ path: entry.path, reason: 'not-quiesced' }))], reason: 'slot never went quiet; nothing restored' }
          : { ...checkpoint, state: 'pending' };
      }
      await this.deps.store.recordUnitCheckpoint(record.id, unit.id, { checkpoint });
      const reported = checkpoint.restored.length || checkpoint.deleted.length || checkpoint.skipped.length;
      const degraded = checkpoint.state === 'partial' || checkpoint.state === 'unavailable';
      if (checkpoint.state !== 'pending' && ((failed && reported) || degraded)) {
        const skippedText = checkpoint.skipped.length ? ` (${checkpoint.skipped.slice(0, 5).map((entry) => `${entry.path}: ${entry.reason}`).join('; ')})` : '';
        const summary = degraded && !(failed && reported)
          ? `Checkpoint for unit ${unitNoticeName(unit)} is ${checkpoint.state}${checkpoint.reason ? ` (${checkpoint.reason})` : ''}: ${checkpoint.skipped.length} file(s) were not captured or restored${skippedText}. Review that unit's changes in the checkout.`
          : `Unit ${unitNoticeName(unit)} failed: restored ${checkpoint.restored.length}, deleted ${checkpoint.deleted.length}, left ${checkpoint.skipped.length} file(s) for the owner${skippedText}`;
        await this.raiseWorkerWarning(record, unit.assignedSlotId ?? 'unknown', summary, 'unit-checkpoint', `${unit.id}:${unit.claimGeneration ?? 0}`);
      }
    }
  }

  /**
   * Record a finished turn for the unit CLAIMED by `slotId` (the harness Stop hook). Best-effort;
   * never throws. Signal only: it does not renew the lease or advance `progressAt`.
   */
  async recordWorkerTurn(executionId: string, slotId: string, sessionId?: string): Promise<void> {
    try { await this.deps.store.recordClaimSignal(executionId, slotId, { turn: true, ...(sessionId ? { sessionId } : {}) }); }
    catch (error) { this.deps.logError?.(`execution worker turn signal failed (execution=${executionId}, slot=${slotId})`, error); }
  }

  /**
   * Record a write from the claim's OWN settled tool call (`tool_name` / `tool_input` of the worker
   * session's PostToolUse). The path is confined to the execution's worktree, so a sibling's edit or a
   * path outside the tree never counts. Best-effort; never throws.
   */
  async recordWorkerToolEvent(executionId: string, slotId: string, event: { toolName: unknown; input: unknown; cwd?: string; failed?: boolean; sessionId?: string }): Promise<void> {
    try {
      if (event.failed) return;
      const raw = claimWritePath(event.toolName, event.input);
      if (!raw) return;
      const root = (await this.deps.store.get(executionId))?.squadWorktree?.path;
      if (!root) return;
      const write = await confineAndHashClaimWrite(root, event.cwd, raw);
      if (!write) return;
      await this.deps.store.recordClaimSignal(executionId, slotId, { writes: [write], ...(event.sessionId ? { sessionId: event.sessionId } : {}) });
    } catch (error) {
      this.deps.logError?.(`execution worker write signal failed (execution=${executionId}, slot=${slotId})`, error);
    }
  }

  /** Capture one immutable main-owned transcript usage sample. */
  async observeSessionUsage(executionId: string, sessionId: string, sampleKind: UsageSampleKind, slotHint?: string): Promise<void> {
    const key = `${executionId}\0${sessionId}`;
    const flightKey = `${key}\0${sampleKind}`;
    const existing = this.usageFlights.get(flightKey);
    if (existing) return existing;
    const flight = this.serializeUsage(key, () => this.captureSessionUsage(executionId, sessionId, sampleKind, slotHint));
    this.usageFlights.set(flightKey, flight);
    void flight.finally(() => {
      if (this.usageFlights.get(flightKey) === flight) this.usageFlights.delete(flightKey);
    }).catch(() => undefined);
    return flight;
  }

  private async captureSessionUsage(executionId: string, sessionId: string, sampleKind: UsageSampleKind, slotHint?: string): Promise<void> {
    if (!this.deps.readSessionStats) return;
    const record = await this.deps.store.get(executionId);
    if (!record || isResumeGrantTerminal(record.state)) return;
    let lifecycle: ExtractedLifecycle | undefined;
    try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); } catch (error) {
      this.deps.logError?.(`execution usage lifecycle failed (execution=${executionId}, session=${sessionId}, sample=${sampleKind})`, error);
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.sessionId === sessionId);
    const role = lifecycle?.orchestratorSessionId === sessionId ? 'orchestrator' as const : 'worker' as const;
    // A seat detached between sessions (#579) no longer lists the old session id; the caller's slot keeps its cursor.
    const slotId = role === 'orchestrator' ? 'orchestrator' : worker?.slotId ?? slotHint ?? 'main:unmapped';
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
      && item.contextTokens === stats?.contextTokens && JSON.stringify(item.cumulative) === JSON.stringify(cumulative) && item.completeness === completeness);
    const sequence = duplicate?.sequence ?? (previous?.sequence ?? 0) + 1;
    const observation: Omit<ExecutionUsageObservationV1, 'version' | 'delta'> = {
      observationId: duplicate?.observationId ?? `${executionId}:usage:${sessionId}:${sequence}`, executionAttempt: record.attempt, role, slotId, sessionId,
      ...(unit ? { workUnitId: unit.id } : {}), workAttempt: unit?.attempt ?? 0, claimGeneration: unit?.claimGeneration ?? 0,
      adapterEpoch: previous?.adapterEpoch ?? 0, sampleKind, sequence, provider,
      ...(model ? { model } : {}), routingIdentity, ...(stats?.contextTokens === undefined ? {} : { contextTokens: stats.contextTokens }), cumulative, completeness,
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
      const { record: updated, assignments, noRouteBlockerIds } = await this.deps.store.dispatchReady(routed.id, { enforceRouting: this.deps.routingEnforcementEnabled?.(routed) === true, ...await this.deferredDispatchOpts(routed) });
      await this.pushAssignments(updated, assignments);
      await this.announceNoRoute(updated, noRouteBlockerIds);
      await this.maybeAutoFinalize(updated.id);
      return { ok: true as const, value: updated };
    } catch (error) {
      return invalidBound(error);
    }
  }

  async completeWork(binding: ExecutionCohortBinding, workUnitId: string, result: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false, structuredResult?: unknown) {
    const record = await this.getBound(binding);
    const unit = record?.workUnits?.find((candidate) => candidate.id === workUnitId);
    // Only named checks need a retained completion and runner drain. Check-free
    // outcomes must not consume this bounded runner queue.
    if (!record || !unit || !workCheckReferences(record, unit).length) {
      return this.completeWorkChecked(binding, workUnitId, result, claim, requireClaim, structuredResult);
    }
    const key = JSON.stringify([binding.executionId, workUnitId, binding.role, binding.slotId, binding.principalId, binding.authorizationId, claim?.claimId, claim?.claimGeneration, result, structuredResultIdentity(structuredResult)]);
    const existing = this.checkCompletions.get(key);
    if (existing) return existing.pending;
    if (this.checkCompletions.size >= 100) return Promise.resolve(invalidBound(new Error('Too many pending work completions')));
    const controller = new AbortController();
    const pending = this.completeWorkChecked(binding, workUnitId, result, claim, requireClaim, structuredResult, controller.signal, key);
    this.checkCompletions.set(key, { executionId: binding.executionId, workUnitId, ...claim, controller, pending });
    void pending.finally(() => this.checkCompletions.delete(key)).catch(() => {});
    return pending;
  }

  private async resolveChecks(projectId: string, names: readonly string[]): Promise<ExecutionResolvedCheckV1[]> {
    const references = [...new Set(names.map(name => `check:${name}`))].sort();
    if (!references.length) return [];
    if (!this.deps.resolveNamedChecks || !this.deps.runNamedCheck) throw new NamedCheckAdmissionError('Named checks require trusted resolver and runner');
    try {
      const checks = await this.deps.resolveNamedChecks(projectId, references);
      if (!validResolvedChecks(checks) || checks.length !== references.length || references.some(reference => !checks.some(check => check.reference === reference))) throw new Error('Named check resolution incomplete');
      return checks;
    } catch (error) { throw new NamedCheckAdmissionError(error instanceof Error ? error.message : 'Named check resolution failed'); }
  }

  /** Runner owns concurrency bounds; service must not serialize unrelated executions. */
  private async runCheckInLane(record: ExecutionRecord, reference: string, signal?: AbortSignal): Promise<ExecutionCheckResultV1> {
    if (signal?.aborted) throw new Error('Named check cancelled');
    if (!this.deps.runNamedCheck) throw new Error('Named check runner unavailable');
    return this.deps.runNamedCheck(record, reference, signal);
  }

  private async completionChecks(record: ExecutionRecord): Promise<readonly string[]> {
    if (record.workUnits?.length || !record.resolvedLaunch.checks.value.length) return [];
    const existing = this.runCheckCompletions.get(record.id);
    if (existing) return existing.pending;
    if (this.runCheckCompletions.size >= 100) throw new Error('Too many pending execution completions');
    const controller = new AbortController();
    const pending = (async () => {
      const references = [...new Set(record.resolvedLaunch.checks.value.map(name => `check:${name}`))].sort();
      if (!this.deps.runNamedCheck || references.some(reference => !record.resolvedChecks?.some(check => check.reference === reference))) throw new Error('Named checks require frozen resolution and trusted runner');
      for (const reference of references) {
        let checked: ExecutionCheckResultV1;
        try { checked = await this.runCheckInLane(record, reference, controller.signal); }
        catch { throw new Error(controller.signal.aborted ? 'Named check cancelled' : `CHECK_FAILED: ${reference}`); }
        if (controller.signal.aborted) throw new Error('Named check cancelled');
        const live = await this.deps.store.get(record.id);
        if (!live || isTerminalExecutionState(live.state) || live.attempt !== record.attempt || live.stateVersion !== record.stateVersion) throw new Error('stale execution state');
        if (!checked || checked.name !== reference.slice(6) || checked.status !== 'passed' || checked.exitCode !== 0 || checked.untrusted !== true || typeof checked.output !== 'string') throw new NamedCheckFailureError(reference, checked);
      }
      return references;
    })();
    this.runCheckCompletions.set(record.id, { controller, pending });
    void pending.finally(() => this.runCheckCompletions.delete(record.id)).catch(() => {});
    return pending;
  }

  async listNamedChecks(projectId: string): Promise<string[]> {
    if (this.deps.isRegisteredProject && !this.deps.isRegisteredProject(projectId)) throw new Error('owner project is not registered');
    if (!this.deps.listNamedCheckNames) throw new Error('Named check discovery unavailable');
    const names = await this.deps.listNamedCheckNames(projectId);
    if (!Array.isArray(names) || names.length > 100 || names.some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(name))) throw new Error('Invalid named check discovery');
    return [...new Set(names)].sort();
  }

  private async completeWorkChecked(binding: ExecutionCohortBinding, workUnitId: string, result: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false, structuredResult?: unknown, signal?: AbortSignal, completionKey?: string) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can complete work');
    if (binding.principalId) {
      try { await this.observeSessionUsage(binding.executionId, binding.principalId, 'outcome'); } catch (error) {
        this.deps.logError?.(`execution usage capture failed for ${binding.executionId}`, error);
      }
    }
    const before = await this.getBound(binding);
    const unit = before?.workUnits?.find((candidate) => candidate.id === workUnitId);
    const references = before && unit ? workCheckReferences(before, unit) : [];
    if (references.length && unit?.state !== 'COMPLETED') {
      if (!before || isTerminalExecutionState(before.state) || unit?.state !== 'CLAIMED' || unit.assignedSlotId !== binding.slotId || !claim || claim.claimId !== unit.claimId || claim.claimGeneration !== unit.claimGeneration) return invalidBound(new Error('stale work claim'));
    }
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
            const text = `TYPED_OUTPUT_REPAIR: work unit ${workUnitId}: ${validation.reason}`;
            try {
              if (this.deps.deliverAssignment) {
                const assignmentId = `repair:${claim.claimId}:${claim.claimGeneration}:${digest}`;
                await this.deps.deliverAssignment(binding.principalId, text, { executionId: before!.id,
                  assignmentId, idempotencyKey: `${before!.id}:${assignmentId}` });
              } else await (this.deps.deliverToWorker ?? this.deps.replyToSession)(binding.principalId, text);
            } catch (error) { this.deps.logError?.(`execution output repair delivery failed for ${before!.id}/${workUnitId}`, error); }
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
    let settled: ExecutionAssignmentCorrelation | undefined;
    if (references.length && unit?.state !== 'COMPLETED') {
      if (!this.deps.runNamedCheck || references.some(reference => !before?.resolvedChecks?.some(check => check.reference === reference))) return invalidBound(new Error('Named checks require frozen resolution and trusted runner'));
      for (const reference of references) {
        if (signal?.aborted) return invalidBound(new Error('Named check cancelled'));
        const live = await this.getBound(binding);
        const liveUnit = live?.workUnits?.find(candidate => candidate.id === workUnitId);
        if (!live || isTerminalExecutionState(live.state) || liveUnit?.state !== 'CLAIMED' || liveUnit.claimId !== claim?.claimId || liveUnit.claimGeneration !== claim?.claimGeneration || liveUnit.assignedSlotId !== binding.slotId) return invalidBound(new Error('stale work claim'));
        let checked: ExecutionCheckResultV1;
        try {
          const running = this.runCheckInLane(before!, reference, signal);
          const completion = completionKey ? this.checkCompletions.get(completionKey) : undefined;
          if (completion) completion.running = running;
          try { checked = await running; } finally { if (completion) completion.running = undefined; }
        }
        catch { checked = { name: reference.slice(6), status: 'spawn-error', exitCode: null, output: 'Named check runner failed', untrusted: true }; }
        if (!checked || checked.name !== reference.slice(6) || !['passed', 'failed', 'timeout', 'output-limit', 'cancelled', 'spawn-error'].includes(checked.status) || typeof checked.output !== 'string' || checked.untrusted !== true || checked.exitCode !== null && !Number.isInteger(checked.exitCode)) {
          checked = { name: reference.slice(6), status: 'spawn-error', exitCode: null, output: 'Invalid named check result', untrusted: true };
        }
        if (signal?.aborted) return invalidBound(new Error('Named check cancelled'));
        if (checked.status !== 'passed' || checked.exitCode !== 0 || checked.untrusted !== true) {
          const failure = { reference, result: { ...checked, status: checked.status === 'passed' ? 'failed' as const : checked.status, untrusted: true as const } };
          const failed = await this.mutateBound(binding, record => this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, `Named check did not pass: ${reference}`, 'VALIDATION_FAILED', claim, true, undefined, failure));
          if (failed.ok) { await this.cascadeDispatch(failed.value.id, binding.slotId); await this.maybeAutoFinalize(failed.value.id); }
          return failed.ok ? { ok: false as const, code: 'CHECK_FAILED', message: `Named check did not pass: ${reference}`, value: failed.value } : failed;
        }
      }
    }
    const outcome = await this.mutateBound(binding, async (record) => {
      const current = record.workUnits?.find((candidate) => candidate.id === workUnitId);
      if (references.length && current?.state !== 'COMPLETED' && (current?.state !== 'CLAIMED' || current.claimId !== claim?.claimId || current.claimGeneration !== claim?.claimGeneration || current.assignedSlotId !== binding.slotId)) throw new Error('stale work claim');
      const fence = current?.state === 'CLAIMED' ? current : current?.reclaimedClaim;
      const updated = await this.deps.store.completeWork(record.id, record.stateVersion, binding, workUnitId, result, claim, requireClaim, structuredResult, references.length ? references : undefined);
      if (current?.state !== 'COMPLETED' && fence) settled = assignmentCorrelation(record.id, fence);
      return updated;
    });
    // Deprioritize the just-completed slot: it's still mid-turn winding down, and
    // idle peers should take the next unit before it. It stays eligible (falls
    // back to it when it's the only free worker), and the idle-gated push keeps a
    // fallback-to-self delivery safe.
    if (outcome.ok) {
      if (settled && binding.principalId && this.deps.onWorkSettled) {
        try { await this.deps.onWorkSettled({ ...settled, workerSessionId: binding.principalId }); }
        catch (error) { this.deps.logError?.(`execution work receipt settlement failed for ${outcome.value.id}/${workUnitId}`, error); }
      }
      await this.announceLoopLimit(outcome.value, workUnitId, String(claim?.claimGeneration ?? outcome.value.state));
      await this.cascadeDispatch(outcome.value.id, binding.slotId);
      await this.maybeAutoFinalize(outcome.value.id);
    }
    return outcome;
  }

  /** A completed review that hit its loop bound is now blocked: tell the person and the coordinator at once. */
  private async announceLoopLimit(record: ExecutionRecord, workUnitId: string, stateOrClaimGeneration: string): Promise<void> {
    if (!record.workUnits?.find((candidate) => candidate.id === workUnitId)?.loop) return;
    try {
      // A Retry can land while the settlement hook runs: act on the current record, not the one from before the await.
      const current = await this.deps.store.get(record.id) ?? record;
      const unit = current.workUnits?.find((candidate) => candidate.id === workUnitId);
      const blocker = unit?.state === 'BLOCKED'
        ? current.blockers?.find((candidate) => !candidate.resolved && candidate.workUnitId === workUnitId && candidate.id.startsWith(LOOP_LIMIT_BLOCKER_PREFIX))
        : undefined;
      if (blocker) await this.announceHumanBlocker(current, blocker, workUnitId, stateOrClaimGeneration, {});
    } catch (error) {
      this.deps.logError?.(`execution loop-limit announcement failed for ${record.id}/${workUnitId}`, error);
    }
  }

  /** Shared tail of a human blocker: hook, coordinator wake and Inbox entry. */
  private async announceHumanBlocker(
    record: ExecutionRecord, blocker: NonNullable<ExecutionRecord['blockers']>[number], workUnitId: string,
    stateOrClaimGeneration: string, questionData: Record<string, unknown>
  ): Promise<void> {
    this.fireHumanBlocker(record, blocker);
    this.syncParkedHolds(record.id);
    this.deadlineWatchdog.schedule(record);
    // The Inbox entry goes first so a failing coordinator wake cannot keep the blocker from the person.
    try {
      await this.appendHumanBlockerNotice(record, blocker, questionData);
    } catch (error) {
      (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(
        `execution human-blocker inbox append failed for ${record.id}/${workUnitId}/${blocker.id}`,
        error
      );
    }
    await this.wakeCoordinator(record, { cause: 'HUMAN_BLOCKER', message: `HUMAN_BLOCKER: work unit ${workUnitId} requires human input.`, workUnitId, stateOrClaimGeneration });
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
      if (terminal.state === 'COMPLETED') {
        await this.teardownCompleted(terminal);
      } else {
        await this.cleanupTerminal(terminal);
        await this.deps.cancelTeamLaunch(terminal.callerPrincipalId, terminal.teamLaunchRequestId);
      }
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
   * Seats that start on demand and have not started (D11): authorized, CLI, no session.
   * Dispatch ranks them after live seats at equal price. A failed lifecycle read is
   * best-effort: no deferred hint, so selection falls back to price then roster order.
   */
  private async deferredDispatchOpts(record: ExecutionRecord): Promise<{ deferredSlotIds?: ReadonlySet<string> }> {
    await this.drainStaleChecks(record.id);
    try {
      const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
      const ids = (lifecycle?.workers ?? [])
        .filter((worker) => worker.projectId === record.projectId && worker.process === 'authorized' && !worker.sessionId && worker.onDemand === true && (worker as { transport?: string }).transport !== 'MODERN')
        .flatMap((worker) => worker.slotId ? [worker.slotId] : []);
      return ids.length ? { deferredSlotIds: new Set(ids) } : {};
    } catch (error) {
      (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(`execution ${record.id} deferred-seat lookup failed (team launch ${record.teamLaunchRequestId}); dispatching without deferred hint`, error);
      return {};
    }
  }

  /** Claim fences reject late receipts; runner drain also fences checkout side effects. */
  private async drainStaleChecks(executionId: string): Promise<void> {
    const completions = [...this.checkCompletions.values()].filter(check => check.executionId === executionId);
    if (!completions.length) return;
    const record = await this.deps.store.get(executionId);
    await Promise.all(completions.map(async check => {
      const unit = record?.workUnits?.find(candidate => candidate.id === check.workUnitId);
      if (record && !isTerminalExecutionState(record.state) && unit?.state === 'CLAIMED' && unit.claimId === check.claimId && unit.claimGeneration === check.claimGeneration) return;
      check.controller.abort();
      // Await the subprocess only, not completeWork's cascade (which calls this gate).
      await check.running?.catch(() => undefined);
    }));
  }

  /**
   * After a unit closes (freeing a slot and satisfying dependents), auto-assign
   * the newly-ready units and push them — the engine schedules the DAG so the
   * coordinator stays out of the per-unit relay. Best-effort: a cascade failure
   * never fails the worker's own close; the next completion (or an explicit
   * coordinator dispatch_ready) re-dispatches.
   */
  private async cascadeDispatch(executionId: string, deprioritizeSlotId?: string): Promise<void> {
    // Every blocker-resolving mutation cascades afterwards, so this re-derives the parked-worker hold.
    this.syncParkedHolds(executionId);
    this.scheduleUnitCheckpoints(executionId);
    try {
      const existing = await this.deps.store.get(executionId);
      if (!existing) return;
      if (existing.resourceBlock || this.checkUsageBudget(existing)) return;
      const routed = await this.refreshRouteFacts(existing);
      const { record, assignments, noRouteBlockerIds } = await this.deps.store.dispatchReady(routed.id, {
        ...(deprioritizeSlotId ? { deprioritizeSlotId } : {}), enforceRouting: this.deps.routingEnforcementEnabled?.(routed) === true,
        ...await this.deferredDispatchOpts(routed)
      });
      await this.pushAssignments(record, assignments);
      await this.announceNoRoute(record, noRouteBlockerIds);
      if (this.deps.routingEnforcementEnabled?.(record) === true) await this.maybeAutoFinalize(record.id);
    } catch { /* best-effort */ }
  }

  /**
   * Runtime escalation, first hop: wake the coordinator for each engine-raised no-route blocker. The
   * second hop (human + Inbox notice) is {@link escalateStaleCoordinatorBlockers}, which also fires at once
   * when no coordinator exists. Wake failures are logged inside wakeCoordinator and never fail dispatch.
   */
  private async announceNoRoute(record: ExecutionRecord, blockerIds: readonly string[]): Promise<void> {
    for (const blockerId of blockerIds) {
      const blocker = record.blockers?.find((candidate) => candidate.id === blockerId);
      if (!blocker) continue;
      await this.wakeCoordinator(record, { cause: 'SEMANTIC_CONFLICT', message: `SEMANTIC_CONFLICT: work unit ${blocker.workUnitId} has no qualified worker (blockerId=${blocker.id}). ${blocker.question} Answer with execution.work.answer to skip it, or stop the run and fix the plan. A reply never runs the step on a non-matching worker.`, workUnitId: blocker.workUnitId, stateOrClaimGeneration: blocker.id });
    }
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
    if (this.deps.routingEnforcementRequested?.(record) !== true || !record.workUnits?.some((unit) => unit.routing)) return record;
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
    // Engine dispatch claims units itself (no worker `claimWork`), so record each checkpoint baseline here, before
    // the assignment text reaches the worker and no write can precede it.
    for (const assignment of assignments) await this.captureClaimBaseline({ ok: true as const, value: record }, assignment.workUnitId);
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
    // Seats that are already running are delivered to first, so they never wait for a cold start. Seats that
    // start on demand then start together (a few at a time), and each is delivered to once its start settles.
    const ready: Array<{ assignment: ExecutionDispatchAssignment; sessionId?: string }> = [];
    let quarantined = false;
    for (const assignment of assignments) {
      const verdict = this.assignmentVerdict(record, assignment, lifecycle?.workers);
      if (verdict === 'release') { await this.releaseUndeliveredAssignments(record.id, [assignment]); continue; }
      if (verdict === 'quarantine') { quarantined = (await this.quarantineDeadSeat(record, assignment)) || quarantined; continue; }
      ready.push({ assignment, sessionId: verdict.sessionId });
    }
    const deferred = ready.filter((entry) => entry.sessionId === undefined);
    for (const entry of ready.filter((candidate) => candidate.sessionId !== undefined)) {
      if (this.handOffToRecycle(record, lifecycle, entry.assignment)) continue;
      await this.deliverAssignment(record, entry.assignment, entry.sessionId!, countedRecordId(record, lifecycle, entry.assignment.slotId));
    }
    const started = await this.startDeferredSeats(lifecycle?.recordId, deferred.map((entry) => entry.assignment.slotId));
    for (const entry of deferred) {
      quarantined = (await this.deliverStartedSeat(record, entry.assignment, started.get(entry.assignment.slotId), lifecycle)) || quarantined;
    }
    // A unit re-homed or blocked by the quarantine is dispatched again; the quarantined seat is excluded this time.
    if (quarantined) await this.cascadeDispatch(record.id);
  }

  /**
   * What to do with one assignment before delivery: `release` it, `quarantine` its seat (it can never
   * start), or deliver it, to `sessionId` or, when absent, to a seat that starts on demand and must be started first.
   */
  private assignmentVerdict(
    record: ExecutionRecord, assignment: ExecutionDispatchAssignment, workers: ExtractedLifecycle['workers']
  ): 'release' | 'quarantine' | { sessionId?: string } {
    const worker = workers?.find((candidate) => candidate.slotId === assignment.slotId && candidate.projectId === record.projectId);
    if (!worker) return 'release';
    // A seat that starts on demand has a lifecycle worker with no session yet (`authorized`, or `spawning` while
    // another dispatch is starting it). Any other session-less worker is released; one that already ended is quarantined.
    const waitingSeat = !worker.sessionId && (worker.process === 'authorized' || worker.process === 'spawning');
    if (!worker.sessionId && !waitingSeat) return worker.onDemand === true && worker.process && DEAD_WORKER_PROCESSES.has(worker.process) ? 'quarantine' : 'release';
    // Never DISPATCH to a worker whose process has already terminated. A restart
    // reconciles a prior-run worker to a terminal `process` (`exited`/`spawn-failed`/
    // `canceled`) but RETAINS its `sessionId` (team-lifecycle-store reconcileStartup),
    // so a recovered board can re-dispatch a completed unit to that stale sessionId.
    // The dead session's `reply()` may still be accepted by the surviving PTY (or the
    // agent-state sits at a stale busy value), so the assignment is counted delivered,
    // the worker never heartbeats, and the claim churns dispatch<->lease-reclaim to the
    // run timeout (live run f0f44413: 5/6 units done, 6th reclaimed 3x then timed out).
    // Release instead -> coordinator parks (HUMAN_BLOCKER). Deterministic, not a
    // liveness heuristic - a terminal process is authoritative.
    if (worker.process && DEAD_WORKER_PROCESSES.has(worker.process)) return 'release';
    // Never TYPE an assignment into a dead-agent's surviving shell (remote-opencode
    // zombie: outer wrapper alive, inner agent gone - a raw stdin write would be
    // eval'd by the bash prompt). Release instead; the next dispatch/reconcile cycle
    // re-delivers once a healthy worker exists or parks the coordinator. `'unknown'`/
    // `'alive'`/unwired => deliver as before (claude-family path byte-unchanged).
    if (worker.sessionId !== undefined && this.deps.getWorkerLiveness?.(worker.sessionId) === 'dead') {
      // Same dead-agent zombie as the reconcile path: release the assignment
      // AND reap the surviving outer shell/tmux wrapper (host tmux-kill close).
      this.deps.closeWorkerSession?.(worker.sessionId);
      return 'release';
    }
    const unit = record.workUnits?.find((candidate) => candidate.id === assignment.workUnitId);
    const model = record.resolvedModels.find((candidate) => candidate.slotId === assignment.slotId);
    const authorization = record.authorizationContext?.slots.find((candidate) => candidate.slotId === assignment.slotId);
    if (this.deps.routingEnforcementEnabled?.(record) === true && unit?.routing && authorization
      && unitSlotEligibility(unit, authorization, model, undefined, levelCheckSkipped(record, authorization.slotId)).status !== 'PASS') return 'release';
    // A hard requirement is re-checked at delivery in every mode, so a roster edit or a coordinator assignment cannot route around it.
    if (unit && authorization && assignmentRequirementFailures(record, unit, authorization).hardFailures.length) return 'release';
    return { sessionId: worker.sessionId };
  }

  /** Fence the freshly dispatched claim to the session it is delivered to (late signals of a replaced session are then ignored). Best-effort. */
  private async bindAssignmentSession(executionId: string, assignment: ExecutionDispatchAssignment, sessionId: string): Promise<void> {
    if (!assignment.claimId) return;
    try { await this.deps.store.bindClaimSession(executionId, assignment.workUnitId, assignment.claimId, sessionId); }
    catch (error) { this.deps.logError?.(`execution claim session bind failed for ${executionId}/${assignment.workUnitId}`, error); }
  }

  /** Push one assignment's text to a live session; the receipt rules are explained inline. */
  private async deliverAssignment(record: ExecutionRecord, assignment: ExecutionDispatchAssignment, sessionId: string, lifecycleRecordId?: string): Promise<void> {
    const text = assignmentText(record, assignment);
    if (this.deps.deliverAssignment) {
      const correlation = assignmentCorrelation(record.id, assignment);
      if (!correlation) {
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
        return;
      }
      // `uncertain`/throw keeps the claim and deliberately does NOT redeliver here: the member
      // may already hold the assignment, and a blind resend would duplicate work. Recovery is
      // owned by the claim-lease sweep instead (reconcileActive -> classifyExpiredClaim): a
      // member that never received it emits no output, so its lease is never output-renewed.
      // At lease expiry an idle member is reclaimed (SILENT_WORKER); a member reporting
      // 'working' is renewed until the durable stall/wall-clock ceilings. The no-progress
      // reclaim then escalates (escalateKickoffFailures): re-home to an untried slot, which
      // redelivers under a FRESH claimGeneration/idempotency key, else a HUMAN_BLOCKER -
      // never a resend to the same member that may hold it. Requires claim recovery
      // observe+enforce (config default on).
      try {
        await this.bindAssignmentSession(record.id, assignment, sessionId);
        const receipt = await this.deps.deliverAssignment(sessionId, text, correlation);
        // Runtime completion is delivery evidence, never an authenticated work outcome.
        if (receipt.state === 'rejected') await this.releaseUndeliveredAssignments(record.id, [assignment]);
        else await this.countDeliveredUnit(lifecycleRecordId, assignment.slotId);
      } catch (error) {
        // A lost receipt may follow acceptance. Preserve the claim; never retry blindly.
        this.deps.logError?.(`execution assignment delivery uncertain for ${record.id}/${assignment.workUnitId}`, error);
      }
      return;
    }
    try {
      // Idle-gated: never inject an assignment into a mid-turn worker (the
      // cascade fires from the worker's own completion, so it is busy). Falls
      // back to the raw reply when the host doesn't wire the idle-gated dep.
      await this.bindAssignmentSession(record.id, assignment, sessionId);
      const deliver = this.deps.deliverToWorker ?? this.deps.replyToSession;
      const delivered = await deliver(sessionId, text);
      if (delivered) {
        await this.countDeliveredUnit(lifecycleRecordId, assignment.slotId);
        try { this.deps.triggerDeliveryDrain?.(sessionId); } catch { /* nudge best-effort */ }
      } else {
        await this.releaseUndeliveredAssignments(record.id, [assignment]);
      }
    } catch {
      await this.releaseUndeliveredAssignments(record.id, [assignment]);
    }
  }

  /**
   * Deliver to a seat once its start settled: stop it and release the unit when the run ended meanwhile, quarantine
   * a seat that will never start, or release the unit for a refusal that may pass. Returns true when the unit was
   * re-homed or blocked by a quarantine.
   */
  private async deliverStartedSeat(
    record: ExecutionRecord, assignment: ExecutionDispatchAssignment, outcome: { sessionId?: string; final?: true } | undefined, lifecycle: ExtractedLifecycle | undefined
  ): Promise<boolean> {
    if (outcome?.sessionId === undefined) {
      // A refusal that will not pass takes the seat out of rotation, so the unit is not offered to it again.
      if (outcome?.final) return this.quarantineDeadSeat(record, assignment);
      await this.releaseUndeliveredAssignments(record.id, [assignment]);
      return false;
    }
    // The run may have ended while the seat was starting: stop the session, give it nothing, release the unit.
    const current = await this.deps.store.get(record.id);
    if (!current || isResumeGrantTerminal(current.state)) {
      try { this.deps.closeWorkerSession?.(outcome.sessionId); } catch (error) { this.deps.logError?.(`on-demand seat ${assignment.slotId} could not be closed after the run ended`, error); }
      await this.releaseUndeliveredAssignments(record.id, [assignment]);
      return false;
    }
    // The snapshot predates the start: the bind has since stored the seat's delivered-unit count, so read it again.
    const bound = await this.freshLifecycle(record, lifecycle);
    // That read was asynchronous: look again before handing work to a run that was stopped or dismissed meanwhile.
    const afterRead = await this.deps.store.get(record.id);
    if (!afterRead || isResumeGrantTerminal(afterRead.state)) {
      try { this.deps.closeWorkerSession?.(outcome.sessionId); } catch (error) { this.deps.logError?.(`on-demand seat ${assignment.slotId} could not be closed after the run ended`, error); }
      await this.releaseUndeliveredAssignments(record.id, [assignment]);
      return false;
    }
    await this.deliverAssignment(record, assignment, outcome.sessionId, countedRecordId(record, bound, assignment.slotId));
    return false;
  }

  /** The lifecycle read again, or the earlier one when the read fails. */
  private async freshLifecycle(record: ExecutionRecord, earlier: ExtractedLifecycle | undefined): Promise<ExtractedLifecycle | undefined> {
    try { return extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)) ?? earlier; } catch (error) {
      this.deps.logError?.(`fresh session lifecycle re-read failed for ${record.id}; the delivered unit may not be counted`, error);
      return earlier;
    }
  }

  /**
   * Finish a recycle (#579): the host started the seat's new session (or failed to). The assignment goes to it, or is
   * released, exactly as for a seat that starts on demand; a seat that can never start is quarantined and the unit
   * dispatched again.
   */
  private async finishRecycle(
    executionId: string, assignment: ExecutionDispatchAssignment, outcome: RecycleOutcome
  ): Promise<void> {
    const record = await this.deps.store.get(executionId);
    if (!record) return;
    let lifecycle: ExtractedLifecycle | undefined;
    try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); } catch (error) {
      this.deps.logError?.(`fresh session lifecycle read failed for ${executionId}/${assignment.slotId}`, error);
    }
    const current = outcome.declined ? lifecycle?.workers?.find((candidate) => candidate.slotId === assignment.slotId && candidate.projectId === record.projectId)?.sessionId : undefined;
    // Nothing could start a new session: the unit goes to the one the seat has, or back to the board.
    const settled = outcome.declined ? { sessionId: current } : outcome;
    if (await this.deliverStartedSeat(record, assignment, settled, lifecycle)) await this.cascadeDispatch(record.id);
  }

  /**
   * A seat that starts a fresh session per unit and has already been given a unit (#579): hand the next one to the
   * host's `recycleSeat` hook instead of typing it into the old session. The hook is NOT awaited: this dispatch runs
   * inside the worker's own `execution.work.complete` call, so closing the session here would cut that call short.
   * Returns true when the entry was handed over.
   */
  private handOffToRecycle(record: ExecutionRecord, lifecycle: ExtractedLifecycle | undefined, assignment: ExecutionDispatchAssignment): boolean {
    const recycle = this.deps.recycleSeat;
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === assignment.slotId && candidate.projectId === record.projectId);
    // A session's first unit is just delivered; only a later one may start a new session.
    if (!recycle || !lifecycle?.recordId || !worker?.deliveredUnitCount) return false;
    const skip = this.recycleSkipReason(record, assignment.slotId, worker.sessionId, worker.deliveredUnitCount);
    if (skip) {
      this.deps.logError?.(`fresh session skipped for ${record.id}/${assignment.slotId}: ${skip}`, new Error(skip));
      return false;
    }
    const where = `${record.id}/${assignment.slotId}`;
    void Promise.resolve().then(() => recycle(lifecycle.recordId!, assignment.slotId, assignment))
      .then((outcome) => (outcome ? this.finishRecycle(record.id, assignment, outcome) : undefined))
      .catch(async (error) => {
        this.deps.logError?.(`fresh session for ${where} failed`, error);
        // The unit must not stay claimed with no session to take it: release it undelivered, like a failed respawn.
        await this.finishRecycle(record.id, assignment, {}).catch((settleError) => this.deps.logError?.(`fresh session for ${where} could not be settled`, settleError));
      });
    return true;
  }

  /** Why a seat's next unit stays in its current session, or undefined when it may start a new one. */
  private recycleSkipReason(record: ExecutionRecord, slotId: string, sessionId: string | undefined, deliveredUnitCount: number): string | undefined {
    const decision = recycleDecision({
      deliveredUnitCount,
      hasBlockedUnit: (record.workUnits ?? []).some((unit) => unit.state === 'BLOCKED' && unit.assignedSlotId === slotId),
      hasOpenBlockerDelivery: (record.deliveries ?? []).some((delivery) => delivery.slotId === slotId && (delivery.state === 'PENDING' || delivery.state === 'LEASED')),
      queuedInInjector: (sessionId === undefined ? 0 : this.deps.queuedForSession?.(sessionId) ?? 0)
    });
    return decision.recycle ? undefined : decision.reason;
  }

  /** Tell the lifecycle a unit was accepted, so the next one can start a new session. Never fails a delivery. */
  private async countDeliveredUnit(lifecycleRecordId: string | undefined, slotId: string): Promise<void> {
    if (!lifecycleRecordId || !this.deps.recordUnitDelivered) return;
    try { await this.deps.recordUnitDelivered(lifecycleRecordId, slotId); } catch (error) {
      this.deps.logError?.(`delivered unit not counted for ${lifecycleRecordId}/${slotId}`, error);
    }
  }

  /**
   * A seat that ended without ever having a session (a start that failed for good, or one lost in a restart)
   * can never take this unit. Reclaim it as "no progress on that seat" so the unit is re-homed to another seat,
   * or blocked to a person when none is left, instead of being offered to the same dead seat again and again.
   * Returns true when the unit changed.
   */
  private async quarantineDeadSeat(record: ExecutionRecord, assignment: ExecutionDispatchAssignment): Promise<boolean> {
    try {
      if (assignment.claimId === undefined || assignment.claimGeneration === undefined) throw new Error('assignment has no claim fence');
      const reclaimed = await this.deps.store.reclaimExpiredClaims(record.id, [{
        workUnitId: assignment.workUnitId, claimId: assignment.claimId, claimGeneration: assignment.claimGeneration,
        reason: NO_PROGRESS_CLAIM_REASON.PROVEN_DEAD, force: true
      }]);
      await this.escalateKickoffFailures(reclaimed);
      return true;
    } catch (error) {
      this.deps.logError?.(`on-demand seat ${assignment.slotId} of ${record.id} could not be taken out of rotation`, error);
      await this.releaseUndeliveredAssignments(record.id, [assignment]);
      return false;
    }
  }

  /** At most this many on-demand seats start at the same time within one dispatch. */
  private static readonly DEFERRED_START_CONCURRENCY = 3;

  /**
   * Start the given on-demand seats a few at a time. Resolves per slot with its session id, or with no session and
   * `final` when the seat will not start (a refusal that may pass keeps the seat waiting, so it is not final).
   */
  private async startDeferredSeats(recordId: string | undefined, slotIds: readonly string[]): Promise<Map<string, { sessionId?: string; final?: true }>> {
    const outcomes = new Map<string, { sessionId?: string; final?: true }>();
    const queue = [...new Set(slotIds)];
    const lane = async () => {
      for (let slotId = queue.shift(); slotId !== undefined; slotId = queue.shift()) {
        outcomes.set(slotId, await this.startDeferredSeat(recordId, slotId));
      }
    };
    await Promise.all(Array.from({ length: Math.min(ExecutionService.DEFERRED_START_CONCURRENCY, queue.length) }, lane));
    return outcomes;
  }

  /** Ask the host to start a seat left closed at launch. */
  private async startDeferredSeat(recordId: string | undefined, slotId: string): Promise<{ sessionId?: string; final?: true }> {
    if (!recordId || !this.deps.spawnDeferredWorker) return {};
    try {
      const started = await this.deps.spawnDeferredWorker(recordId, slotId);
      if (started.ok) return { sessionId: started.sessionId };
      this.deps.logError?.(`on-demand seat ${slotId} of ${recordId} did not start: ${started.message}`, new Error(started.message));
      return started.retryable === true ? {} : { final: true };
    } catch (error) {
      this.deps.logError?.(`on-demand seat ${slotId} of ${recordId} failed to start`, error);
      return { final: true };
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

  async failWork(binding: ExecutionCohortBinding, workUnitId: string, failure: string, failureCode: ExecutionFailureCode = 'UNKNOWN', claim?: { claimId: string; claimGeneration: number }, requireClaim = false, structuredResult?: unknown) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can fail work');
    const retry = await this.retryNoStartFailure(binding, workUnitId, failure, failureCode, claim, structuredResult);
    if (retry.failure !== undefined) failure = retry.failure;
    if (retry.recovered) {
      const current = await this.deps.store.get(binding.executionId);
      if (current) return { ok: true as const, value: current };
    }
    const outcome = await this.mutateBound(binding, (record) => claim
      ? this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, failure, failureCode, claim, requireClaim, structuredResult)
      : this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, failure, failureCode, undefined, requireClaim, structuredResult));
    if (outcome.ok) {
      await this.cascadeDispatch(outcome.value.id, binding.slotId);
      if (outcome.value.workUnits?.find((unit) => unit.id === workUnitId)?.state !== 'FAILED') return outcome;
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
      this.syncParkedHolds(record.id);
      if (blocker.audience === 'coordinator') {
        // Self-heal lane: a worker asking the coordinator for a plan/spec
        // decision it cannot make itself. Wake the coordinator to answer it via
        // execution.work.answer — NO human inbox entry (no human is involved).
        // The wake message is injected verbatim into the coordinator session
        // (drainCoordinatorWake), so it must carry the blockerId the coordinator
        // needs to answer, plus the worker's question.
        await this.wakeCoordinator(record, { cause: 'SEMANTIC_CONFLICT', message: `SEMANTIC_CONFLICT: work unit ${workUnitId} needs a coordinator decision (blockerId=${blocker.id}). Answer with execution.work.answer. Worker asks: ${blocker.question}`, workUnitId, stateOrClaimGeneration: String(claim?.claimGeneration ?? record.state) });
      } else {
        // Human blockers must always accept a concrete typed value. Workers may
        // provide useful quick choices, but labels such as "Provide path" are
        // actions rather than answers and cannot resolve the blocker by themselves.
        const questionData = blocker.options
          ? buildInboxQuestion({ options: blocker.options, allowOther: true }, true)
          : {};
        const persistedBlocker = record.blockers?.find((candidate) => candidate.id === blocker.id);
        const generation = String(claim?.claimGeneration ?? record.state);
        if (persistedBlocker) await this.announceHumanBlocker(record, persistedBlocker, workUnitId, generation, questionData);
        else await this.wakeCoordinator(record, { cause: 'HUMAN_BLOCKER', message: `HUMAN_BLOCKER: work unit ${workUnitId} requires human input.`, workUnitId, stateOrClaimGeneration: generation });
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
    if (!blockerId.trim() || !answer.trim() || Buffer.byteLength(answer, 'utf8') > MAX_BLOCKER_ANSWER_BYTES) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker answer request' };
    }
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    if (blocker.audience !== 'coordinator') return deniedBound(humanBlockerDenial(record, blocker));
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
        let coordinatorUnavailable = false;
        try {
          const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
          coordinatorUnavailable = !lifecycle?.orchestratorSessionId
            || (lifecycle.workers ?? []).find((worker) => worker.sessionId === lifecycle.orchestratorSessionId)?.process === 'exited';
        } catch {
          // A failed lifecycle read is transient, not evidence the coordinator died.
        }
        if (!coordinatorUnavailable && now - blocker.createdAt < COORDINATOR_BLOCKER_ESCALATE_MS) continue;
        // A coordinator answer already in flight → let it land; not stuck.
        if ((record.deliveries ?? []).some((delivery) => delivery.blockerId === blocker.id && (delivery.state === 'PENDING' || delivery.state === 'LEASED'))) continue;
        let escalated: ExecutionRecord;
        try {
          escalated = await this.deps.store.escalateBlockerToHuman(record.id, blocker.id);
        } catch {
          // Lost a race (resolved / escalated / answered concurrently) — skip.
          continue;
        }
        const escalatedBlocker = escalated?.blockers?.find((candidate) => candidate.id === blocker.id);
        if (escalatedBlocker) this.fireHumanBlocker(escalated, escalatedBlocker);
        // Human blockers always accept a concrete typed value; quick choices are
        // an optional add-on. Same shape as blockWork's human path.
        const questionData = blocker.options
          ? buildInboxQuestion({ options: blocker.options, allowOther: true }, true)
          : {};
        void this.appendHumanBlockerNotice(record, blocker, questionData).catch((err) => {
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
    if (outcome.ok) {
      await this.drainStaleChecks(outcome.value.id);
      await this.cascadeDispatch(outcome.value.id, binding.slotId);
    }
    return outcome;
  }

  /**
   * Orchestrator-only: replace a dead worker slot. Authority is the main-resolved binding. Order matters: cheap
   * refusals first (no count spent), then one atomic persisted count under the store mutex, then the host spawn.
   * A per-slot in-flight set makes a concurrent second call refuse instead of spending the cap twice.
   */
  async respawnWorker(binding: ExecutionCohortBinding, slotId: string): Promise<{ ok: true; value: { slotId: string; sessionId: string; respawn: number; cap: number } } | { ok: false; code: string; message: string }> {
    if (binding.role !== 'orchestrator') return deniedBound('only the coordinator can respawn a worker');
    if (typeof slotId !== 'string' || !slotId || slotId.length > 120) return invalidBound(new Error('invalid worker slot'));
    if (isOrchestratorSlotId(slotId)) return deniedBound('the coordinator slot cannot be respawned');
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    return this.respawnSlot(record, slotId);
  }

  /** Respawn core shared by the coordinator tool and single-seat kickoff recovery: same fences, same per-slot cap. */
  private async respawnSlot(record: ExecutionRecord, slotId: string): Promise<{ ok: true; value: { slotId: string; sessionId: string; respawn: number; cap: number } } | { ok: false; code: string; message: string }> {
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    if (record.state !== 'RUNNING') return { ok: false, code: 'INVALID', message: `execution is ${record.state.toLowerCase()}; a worker can only be respawned while it is running` };
    const known = (record.authorizationContext?.slots ?? []).some((slot) => !isOrchestratorSlotId(slot.slotId) && slot.slotId === slotId);
    if (!known) return { ok: false, code: 'NOT_FOUND', message: `unknown worker slot "${boundReason(slotId, 120)}"` };
    const respawn = this.deps.respawnWorker;
    if (!respawn) return { ok: false, code: 'UNAVAILABLE', message: 'worker respawn is not available on this host' };
    const key = `${record.id}:${slotId}`;
    if (this.respawning.has(key)) return { ok: false, code: 'BUSY', message: `worker ${slotId} is already being respawned` };
    this.respawning.add(key);
    try {
      let lifecycle: ExtractedLifecycle | undefined;
      try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); } catch (error) {
        this.deps.logError?.(`respawn lifecycle read failed for ${record.id}/${slotId}`, error);
      }
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
      if (!lifecycle?.recordId || !worker) return { ok: false, code: 'NOT_FOUND', message: `worker ${slotId} has no launched session to replace` };
      if (worker.respawned !== undefined && !worker.sessionId && (worker.process === 'authorized' || worker.process === 'spawning')) {
        return { ok: false, code: 'QUEUED', message: `worker ${slotId} is already queued to restart; it starts when the machine has room, so do not call this again` };
      }
      if (!DEAD_WORKER_PROCESSES.has(worker.process ?? '')) return { ok: false, code: 'INVALID', message: `worker ${slotId} is still running; only a worker whose session is over can be respawned` };
      let reservation: Awaited<ReturnType<ExecutionServiceDeps['store']['reserveWorkerRespawn']>>;
      try { reservation = await this.deps.store.reserveWorkerRespawn(record.id, slotId, this.deps.workerRespawnCap); } catch (error) { return invalidBound(error); }
      if (!reservation.ok) {
        if (reservation.reason === 'cap') {
          await this.notifyRespawnWarning(record, slotId, `Worker ${slotId} could not be respawned: the limit of ${reservation.cap} respawn(s) is used up`);
          return { ok: false, code: 'CAP_EXCEEDED', message: `worker ${slotId} has already been respawned ${reservation.count} time(s); the limit is ${reservation.cap}` };
        }
        return { ok: false, code: reservation.reason === 'unknown-slot' ? 'NOT_FOUND' : 'INVALID', message: `worker ${slotId} cannot be respawned: ${reservation.reason}` };
      }
      let outcome: Awaited<ReturnType<NonNullable<ExecutionServiceDeps['respawnWorker']>>>;
      try { outcome = await respawn(lifecycle.recordId, slotId); } catch (error) {
        outcome = { ok: false, reason: 'spawn-failed', message: error instanceof Error ? error.message : String(error), committed: true };
      }
      if (!outcome.ok && outcome.committed !== true) {
        // Nothing was started, so the attempt does not count against the slot's budget.
        await this.deps.store.settleWorkerRespawn(record.id, slotId, { refund: true })
          .catch((error: unknown) => this.deps.logError?.(`Respawn refund failed for ${record.id}/${slotId}`, error));
        return { ok: false, code: 'RESPAWN_FAILED', message: `${outcome.reason}: ${boundReason(outcome.message)}` };
      }
      if (!outcome.ok) {
        const message = boundReason(outcome.message);
        await this.raiseWorkerWarning(record, slotId, `Worker ${slotId} could not be respawned (${outcome.reason}): ${message}`, 'worker-respawn');
        return { ok: false, code: 'RESPAWN_FAILED', message: `${outcome.reason}: ${message}` };
      }
      await this.deps.store.settleWorkerRespawn(record.id, slotId, { started: { count: reservation.count, cap: reservation.cap } })
        .catch((error: unknown) => this.deps.logError?.(`Respawn event failed for ${record.id}/${slotId}`, error));
      return { ok: true, value: { slotId, sessionId: outcome.sessionId, respawn: reservation.count, cap: reservation.cap } };
    } finally {
      this.respawning.delete(key);
    }
  }

  /** Live = a session is bound to the slot and its process is not over. */
  private async slotSessionState(record: ExecutionRecord, slotId: string): Promise<{ known: boolean; live: boolean; sessionId?: string }> {
    let lifecycle: ExtractedLifecycle | undefined;
    try { lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId)); } catch (error) {
      this.deps.logError?.(`slot liveness read failed for ${record.id}/${slotId}`, error);
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker) return { known: false, live: false };
    const live = !!worker.sessionId && !DEAD_WORKER_PROCESSES.has(worker.process ?? '');
    return { known: true, live, ...(worker.sessionId ? { sessionId: worker.sessionId } : {}) };
  }

  /**
   * Owner-agent restart of one worker slot (`execution_slot_restart`). A wrapper over the host's card-Restart / respawn
   * paths (`deps.restartWorker`): it adds no restart logic of its own. It does not spend the coordinator's per-slot respawn
   * budget; instead each slot may be restarted once per {@link OWNER_RESTART_MIN_INTERVAL_MS}. A live session that is
   * mid-turn is not restarted (same quiesce rule as unit checkpoints): retry once it is idle.
   */
  async restartSlotAsOwner(callerPrincipalId: string, projectId: string, executionId: string, slotId: string): Promise<{ ok: true; value: { slotId: string; sessionId: string; mode: 'respawned' | 'restarted'; sessionLive: true } } | { ok: false; code: string; message: string }> {
    if (typeof slotId !== 'string' || !slotId.trim() || slotId.length > 120) return { ok: false, code: 'INVALID', message: 'invalid worker slot' };
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (isOrchestratorSlotId(slotId)) return { ok: false, code: 'DENIED', message: 'the coordinator slot cannot be restarted' };
    if (isResumeGrantTerminal(record.state)) return { ok: false, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    if (record.state !== 'RUNNING') return { ok: false, code: 'INVALID', message: `execution is ${record.state.toLowerCase()}; a worker can only be restarted while it is running` };
    if (!(record.authorizationContext?.slots ?? []).some((slot) => !isOrchestratorSlotId(slot.slotId) && slot.slotId === slotId)) {
      return { ok: false, code: 'NOT_FOUND', message: `unknown worker slot "${boundReason(slotId, 120)}"` };
    }
    const restart = this.deps.restartWorker;
    if (!restart) return { ok: false, code: 'UNAVAILABLE', message: 'worker restart is not available on this host' };
    const key = `${record.id}:${slotId}`;
    if (this.respawning.has(key)) return { ok: false, code: 'BUSY', message: `worker ${slotId} is already being restarted` };
    this.respawning.add(key);
    try {
      const now = (this.deps.now ?? Date.now)();
      const last = this.ownerRestartAt.get(key);
      if (last !== undefined && now - last < OWNER_RESTART_MIN_INTERVAL_MS) {
        const waitS = Math.ceil((OWNER_RESTART_MIN_INTERVAL_MS - (now - last)) / 1000);
        return { ok: false, code: 'RATE_LIMITED', message: `worker ${slotId} was restarted moments ago; wait ${waitS}s before restarting it again` };
      }
      const state = await this.slotSessionState(record, slotId);
      if (!state.known) return { ok: false, code: 'NOT_FOUND', message: `worker ${slotId} has no launched session to restart` };
      if (state.live && state.sessionId && this.deps.getAgentState?.(state.sessionId) === 'working') {
        return { ok: false, code: 'NOT_QUIET', message: `worker ${slotId} is mid-turn and may have edits in flight; retry once it is idle` };
      }
      // Spend the rate-limit slot before the host call so a looping owner cannot churn sessions even when restarts fail.
      for (const [entry, at] of this.ownerRestartAt) if (now - at >= OWNER_RESTART_MIN_INTERVAL_MS) this.ownerRestartAt.delete(entry);
      this.ownerRestartAt.set(key, now);
      let lifecycleRecordId: string | undefined;
      try { lifecycleRecordId = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId))?.recordId; } catch { lifecycleRecordId = undefined; }
      if (!lifecycleRecordId) return { ok: false, code: 'NOT_FOUND', message: `worker ${slotId} has no launched session to restart` };
      let outcome: Awaited<ReturnType<typeof restart>>;
      try { outcome = await restart(lifecycleRecordId, slotId); } catch (error) {
        this.deps.logError?.(`owner slot restart failed for ${record.id}/${slotId}`, error);
        outcome = { ok: false, reason: 'restart-failed', message: 'the worker could not be restarted' };
      }
      if (!outcome.ok) return { ok: false, code: 'RESTART_FAILED', message: `${outcome.reason}: ${boundReason(outcome.message)}` };
      return { ok: true, value: { slotId, sessionId: outcome.sessionId, mode: outcome.mode, sessionLive: true } };
    } finally {
      this.respawning.delete(key);
    }
  }

  /**
   * Owner-agent release of a CLAIMED unit back to READY (`execution_unit_release`). Reuses the board release
   * (`releaseWorkFromBoard`: owner authority, unit must be CLAIMED, claim cleared, dispatch cascades). The worker-bound
   * `execution.work.release` stays worker-only. Reads the latest state version, so a concurrent write retries once.
   */
  async releaseUnitAsOwner(callerPrincipalId: string, projectId: string, executionId: string, workUnitId: string) {
    if (typeof workUnitId !== 'string' || !workUnitId.trim() || workUnitId.length > 256) return { ok: false as const, code: 'INVALID', message: 'invalid work unit' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
      if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
      if (isResumeGrantTerminal(record.state)) return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
      const unit = record.workUnits?.find((candidate) => candidate.id === workUnitId);
      if (!unit) return { ok: false as const, code: 'NOT_FOUND', message: 'work unit not found' };
      if (unit.state !== 'CLAIMED') return { ok: false as const, code: 'INVALID', message: `work unit is ${unit.state.toLowerCase()}, not claimed` };
      const outcome = await this.releaseWorkFromBoard(callerPrincipalId, projectId, executionId, record.stateVersion, workUnitId);
      if (outcome.ok || outcome.code !== 'CONFLICT' || attempt === 1) return outcome;
    }
    return { ok: false as const, code: 'CONFLICT', message: 'stale execution state' };
  }

  /**
   * Owner message to a worker slot with liveness (`execution_respond {slotId}`). A dead session is restarted first (same
   * path and rate limit as {@link restartSlotAsOwner}); if that fails, the message is not sent and the refusal says why.
   */
  async respondToSlotAsOwner(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, message: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    let state = isOrchestratorSlotId(slotId) || isResumeGrantTerminal(record.state) ? undefined : await this.slotSessionState(record, slotId);
    let restarted: 'respawned' | 'restarted' | undefined;
    if (state?.known && !state.live) {
      const result = await this.restartSlotAsOwner(callerPrincipalId, projectId, executionId, slotId);
      if (!result.ok) return { ok: false as const, code: result.code, message: `slot ${slotId} session is not live and could not be restarted: ${result.message}`, sessionLive: false as const };
      restarted = result.value.mode;
      state = { known: true, live: true, sessionId: result.value.sessionId };
    }
    // Restarting spends state versions (events), so the caller's expected version is refreshed after a restart.
    const version = restarted ? (await this.deps.store.get(record.id))?.stateVersion ?? expectedStateVersion : expectedStateVersion;
    const delivered = await this.respond(callerPrincipalId, projectId, executionId, version, slotId, message);
    const sessionLive = state?.live ?? false;
    return delivered.ok
      ? { ...delivered, sessionLive, ...(restarted ? { restarted } : {}) }
      : { ...delivered, sessionLive };
  }

  /** Liveness of the session that owns a blocker's slot, for the blocker-answer result. Never restarts. */
  async blockerSlotLive(callerPrincipalId: string, projectId: string, executionId: string, blockerId: string): Promise<boolean | undefined> {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    const blocker = record?.blockers?.find((candidate) => candidate.id === blockerId);
    if (!record || !blocker || isOrchestratorSlotId(blocker.slotId)) return undefined;
    const state = await this.slotSessionState(record, blocker.slotId);
    return state.known ? state.live : undefined;
  }

  private async notifyRespawnWarning(record: ExecutionRecord, slotId: string, summary: string): Promise<void> {
    const bounded = boundReason(summary);
    try { await this.deps.onRunWarning?.(record, { slotId: boundReason(slotId, 120), summary: bounded, kind: 'worker-respawn' }); }
    catch (error) { this.deps.logError?.(`Respawn warning delivery failed for ${record.id}`, error); }
  }

  async retryWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string) {
    const admission = await this.budgetAdmission(binding.executionId);
    if (!admission.ok) return admission;
    const outcome = await this.mutateBound(binding, (record) => this.deps.store.retryWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
    if (outcome.ok) this.deadlineWatchdog.schedule(outcome.value);
    if (outcome.ok) await this.cascadeDispatch(outcome.value.id);
    return outcome;
  }

  async retryWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string, assignedSlotId?: string) {
    const outcome = await this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.retryWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId));
    if (outcome.ok) this.deadlineWatchdog.schedule(outcome.value);
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
      async (record, authority) => {
        await this.drainStaleChecks(record.id);
        return this.deps.store.reassignWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId);
      });
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
    if (!current) return deniedBound('execution not found for bound cohort');
    let passedChecks: readonly string[];
    try { passedChecks = await this.completionChecks(current); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('CHECK_FAILED:')) await this.failNoDagCheckCompletion(current, namedCheckFailureSummary(error));
      return { ok: false as const, code: message.startsWith('CHECK_FAILED:') ? 'CHECK_FAILED' : 'INVALID', message };
    }
    const result = await this.mutateBound(binding, (record) => {
      if (passedChecks.length && record.stateVersion !== current.stateVersion) throw new Error('stale execution state');
      return this.deps.store.completeExecution(record.id, record.stateVersion, summary, evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true, passedChecks);
    });
    if (result.ok) {
      await this.teardownCompleted(result.value);
    }
    return result;
  }

  async retry(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number) {
    return this.launchRetry(callerPrincipalId, projectId, executionId, expectedStateVersion);
  }

  private async launchRetry(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, retainedRecovery?: {
    mode: RetainedRecoveryMode;
    snapshots?: NonNullable<ExecutionRecord['nativeRecoverySnapshots']>;
  }) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    let retry: ExecutionRecord;
    if (retainedRecovery) {
      if (record.state !== 'STARTING' || record.stateVersion !== expectedStateVersion) {
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: await this.deps.store.get(record.id) };
      }
      retry = record;
    } else {
      this.beginStarting(record.id);
      try {
        retry = await this.beginRetryWithLifecycleLock(record.id, expectedStateVersion);
      } catch (error) {
        this.endStarting(record.id);
        if (error instanceof Error && error.message === 'stale execution state') {
          return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: await this.deps.store.get(record.id) };
        }
        return { ok: false as const, code: 'RETRY_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
      }
    }
    this.deadlineWatchdog.schedule(retry);
    this.planReadinessWatchdog.schedule(retry);
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
        const failed = await this.failRetainedRecovery(retry, retainedRecovery, 'Team admission could not be evaluated');
        return { ok: false as const, code: 'ADMISSION_FAILED', message: 'Team admission could not be evaluated', value: failed };
      }
      if (!admission.ready) {
        const failed = admission.checks.find((check) => check.required && check.status !== 'PASS');
        const message = failed?.message ?? 'Team admission failed';
        const terminal = await this.failRetainedRecovery(retry, retainedRecovery, message);
        return { ok: false as const, code: 'ADMISSION_FAILED', message, value: terminal };
      }
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(retry.teamId, request.workflow);
        if (!preflight?.ok) {
          const message = preflight?.message ?? 'workflow profile is unavailable';
          const terminal = await this.failRetainedRecovery(retry, retainedRecovery, message);
          return { ok: false as const, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message, value: terminal };
        }
      }
      const authorization = await this.deps.authorizeTeamLaunch(
        retry.callerPrincipalId, retry.teamId, projectId, retry.teamLaunchRequestId,
        request.policy ?? {}, request.slots, retry.coordinationMode, admission.digest,
        ...(retainedRecovery?.snapshots ? [retainedRecovery.snapshots] : [])
      );
      if (!authorization.ok || !authorization.value.context) {
        if (authorization.ok) {
          issuedAuthorizationIds = authorization.value.slots.map((slot) => slot.authorizationId);
          await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
        }
        const message = authorization.ok ? 'Team authorization context unavailable' : authorization.message;
        const terminal = await this.failRetainedRecovery(retry, retainedRecovery, message);
        return { ok: false as const, code: authorization.ok ? 'AUTHORIZATION_CONTEXT_UNAVAILABLE' : authorization.code, message, value: terminal };
      }
      issuedAuthorizationIds = authorization.value.slots.map((slot) => slot.authorizationId);
      let current = await this.deps.store.setAuthorizationContext(retry.id, retry.stateVersion, authorization.value.context, launchDigest(authorization.value.context));
      current = await this.deps.store.prepareLaunchIntent(current.id, current.stateVersion, {
        version: 1, authorizationContextDigest: current.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask, automatedSkillIds }) => ({
          slotId, personaId, initialTaskDigest: launchDigest(initialTask),
          ...(automatedSkillIds === undefined ? {} : { automatedSkillIds })
        }))
      });
      let revalidatedAdmission: TeamAdmissionResultV1;
      try {
        revalidatedAdmission = await this.dryRun(projectId, admissionRequest);
      } catch (error) {
        this.deps.logError?.(`Team retry admission revalidation failed for ${projectId}:${retry.launchRequestId}`, error);
        const terminal = await this.failRetainedRecovery(current, retainedRecovery, 'Team admission could not be revalidated');
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'STALE_PREFLIGHT', message: 'Team admission could not be revalidated', value: terminal };
      }
      if (!revalidatedAdmission.ready || revalidatedAdmission.digest !== admission.digest) {
        const failed = revalidatedAdmission.checks.find((check) => check.required && check.status !== 'PASS');
        const message = failed?.message ?? 'Team admission changed after authorization';
        const terminal = await this.failRetainedRecovery(current, retainedRecovery, message);
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'STALE_PREFLIGHT', message, value: terminal };
      }
      if (!await this.launchMayProceed(current)) {
        await this.deps.revokeTeamAuthorizations?.(authorization.value.slots.map((slot) => slot.authorizationId));
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed before Team retry launch', value: await this.deps.store.get(current.id) };
      }
      if (this.deps.prepareSquadWorktree) {
        current = await this.deps.prepareSquadWorktree(current, { ...request, teamId: retry.teamId, launchRequestId: retry.launchRequestId });
      }
      const launched = await this.deps.launchTeam(retry.teamId, projectId, {
        callerPrincipalId: retry.callerPrincipalId, launchRequestId: retry.teamLaunchRequestId,
        slots: authorization.value.slots, policy: request.policy, requirePreauthorization: true, admissionDigest: authorization.value.admissionDigest,
        executionId: retry.id, executionJobTitle: retry.jobTitle,
        ...(request.worktree === undefined ? {} : { worktree: request.worktree }),
        ...(request.onComplete === undefined ? {} : { onComplete: request.onComplete }),
        ...(request.target === undefined ? {} : { target: request.target }),
        ...(retry.coordinationMode ? { coordinationMode: retry.coordinationMode } : {}),
        ...(retry.origin ? { origin: retry.origin } : {}),
        ...(isDurableCoordination(retry.coordinationMode) ? { jobContext: {
          objective: request.objective?.trim() || retry.jobTitle,
          title: retry.jobTitle,
          ...(retry.summary ? { summary: retry.summary } : {}),
          ...(request.sourceBundle ? { sourceBundle: request.sourceBundle } : {})
        } } : {}),
      });
      if (!launched.ok) {
        await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
        const failed = await this.failLaunch(current, launched.message ?? 'Team launch failed');
        return { ok: false as const, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed', value: failed };
      }
      if (retainedRecovery?.mode === 'fresh-plan') {
        // The Team is already live: a failed bookkeeping clear must not revoke
        // authorizations, fail the launch, or tear down the worktree.
        try {
          current = await this.deps.store.clearPriorNativeRecoverySnapshots(current.id);
        } catch (error) {
          this.deps.logError?.(`Prior native recovery snapshot clear failed for ${current.id}`, error);
        }
      }
      const failedRetry = await this.settleFailedSlots(current, launched.value?.failedSlots ?? [], issuedAuthorizationIds);
      if (failedRetry) {
        return { ok: false as const, code: 'TEAM_LAUNCH_FAILED', message: failedRetry.failureReason ?? 'One or more Team slots failed to launch', value: failedRetry };
      }
      if (!await this.launchMayProceed(current)) {
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed during Team retry launch', value: await this.deps.store.get(current.id) };
      }
      return { ok: true as const, value: await this.promoteStartingToRunning(current, 'Team retry launch started') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
      return { ok: false as const, code: message === 'WORKTREE_UNAVAILABLE' || message === 'TARGET_UNAVAILABLE' ? message : 'TEAM_LAUNCH_FAILED', message, value: await this.failLaunch(retry, `Team retry launch error: ${message}`) };
    } finally {
      if (!retainedRecovery) this.endStarting(record.id);
    }
  }

  /** Recover retained work through the same authorization, admission, and worktree gates as retry. */
  async recoverRetained(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, mode: RetainedRecoveryMode) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (record.successorExecutionId || record.state === 'STOPPED' && (record.timeoutReason === 'unresolved-blocker' || record.timeoutReason === 'plan-correction-cancelled')) {
      return { ok: false as const, code: 'RECOVERY_NOT_ALLOWED', message: 'execution recovery is not allowed' };
    }
    if (record.state !== 'FAILED' && record.state !== 'STOPPED') {
      return { ok: false as const, code: 'RECOVERY_NOT_ALLOWED', message: 'execution recovery requires a retained failed or stopped run' };
    }
    const snapshots = mode === 'exact-native'
      ? this.deps.resolveExactNativeRecoverySnapshots?.(record) ?? []
      : undefined;
    if (mode === 'exact-native' && (!snapshots || snapshots.length === 0)) {
      return { ok: false as const, code: 'NO_RESTORABLE_SLOTS', message: 'exact-native recovery requires at least one restorable native slot' };
    }
    if (mode === 'exact-native' && snapshots) {
      const totalSlots = this.deps.resolveExactNativeRecoveryTotalSlots?.(record);
      if (totalSlots !== undefined && snapshots.length < totalSlots) {
        return { ok: false as const, code: 'PARTIAL_RESTORE', message: `exact-native recovery requires every slot to be restorable: only ${snapshots.length} of ${totalSlots} can be resumed` };
      }
    }

    // Keep lifecycle polling from treating this valid STARTING replacement as a
    // missing Team record until every awaited admission and launch step settles.
    this.beginStarting(record.id);
    try {
      const keepSlotIds = snapshots ? new Set(snapshots.map((snapshot) => snapshot.slotId)) : undefined;
      const resumed = await this.beginRetainedRecoveryWithLifecycleLock(record.id, expectedStateVersion, keepSlotIds ? { keepSlotIds } : undefined);
      return await this.launchRetry(callerPrincipalId, projectId, executionId, resumed.stateVersion, { mode, ...(snapshots ? { snapshots } : {}) });
    } catch (error) {
      return { ok: false as const, code: error instanceof Error && error.message === 'stale execution state' ? 'CONFLICT' : 'RECOVERY_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.endStarting(record.id);
    }
  }

  /** @deprecated External compatibility alias for fresh-plan retained recovery. */
  async resumeRun(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, _replay = false) {
    return this.recoverRetained(callerPrincipalId, projectId, executionId, expectedStateVersion, 'fresh-plan');
  }

  /**
   * Start a fresh execution for a timeout that was waiting on human input. This
   * never reopens the source record or revives its canceled workers. Recovery is
   * deliberately limited to plans whose unfinished work is read-only: mutating
   * work needs durable artifact/provenance replay before it can be safe.
   */
  async recoverTimedOut(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, clientRequestId: string) {
    const source = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!source) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (!Number.isInteger(expectedStateVersion) || !clientRequestId.trim()) {
      return { ok: false as const, code: 'INVALID', message: 'invalid timeout recovery request' };
    }
    const rejectUnsafeRecovery = timeoutRecoveryBlockReason;
    const unsafeReason = rejectUnsafeRecovery(source);
    // Do not reserve an execution that policy will reject: the user may retry after
    // durable provenance becomes available.
    if (unsafeReason) return { ok: false as const, code: 'RECOVERY_NOT_ALLOWED', message: unsafeReason };
    let reserved: ExecutionRecord;
    try {
      reserved = await this.deps.store.reserveTimeoutRecovery(source.id, expectedStateVersion, clientRequestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, code: message === 'stale execution state' ? 'CONFLICT' : 'RECOVERY_NOT_ALLOWED', message };
    }
    const reservedUnsafeReason = rejectUnsafeRecovery(reserved);
    if (reservedUnsafeReason) return { ok: false as const, code: 'RECOVERY_NOT_ALLOWED', message: reservedUnsafeReason };
    const units = reserved.workUnits ?? [];
    const unfinished = units.filter((unit) => unit.state !== 'COMPLETED');
    const completed = units.filter((unit) => unit.state === 'COMPLETED');
    const completedIds = new Set(completed.map((unit) => unit.id));
    const unfinishedIds = new Set(unfinished.map((unit) => unit.id));
    const completedContext = completed
      .filter((unit) => unit.result !== undefined)
      .map((unit) => `${unit.title}: ${unit.result!.slice(0, 2_048)}`)
      .join('\n')
      .slice(0, 8_192);
    const unresolvedBlockers = (reserved.blockers ?? [])
      .filter((blocker) => !blocker.resolved)
      .map((blocker) => `- ${blocker.question}${blocker.options?.length ? ` Options: ${blocker.options.join(' | ')}` : ''}`)
      .join('\n')
      .slice(0, 8_192);
    const recoveryText = {
      objective: reserved.request.objective,
      header: 'Recovery run: completed read-only work must not be repeated.',
      sections: [completedContext ? `Verified completed outputs:\n${completedContext}` : 'No completed unit outputs were retained.', ...splitLoopNotes(units)],
      pinnedSection: unresolvedBlockers
        ? `Unresolved human input from the timed-out run:\n${unresolvedBlockers}\nAsk this again with execution.work.block before continuing; do not assume an answer or contact canceled workers.`
        : undefined,
      sourceExecutionId: reserved.id
    };
    const request: ExecutionRequestV1 = {
      ...reserved.request,
      teamId: reserved.teamId,
      launchRequestId: reserved.successorLaunchRequestId!,
      // A bounded preview: the full outputs and open questions stay in the source
      // execution's record. Members cannot read that record, so a shortened
      // preview is lossy for the successor's coordinator by design.
      objective: fitRecoveryObjective(recoveryText),
      workUnits: unfinished.map(({ state: _state, assignedSlotId: _assigned, attempt: _attempt, failureCode: _code, failure: _failure, result: _result, history: _history, loopRound: _round, loopExtraRounds: _extra, loop, ...unit }) => ({
        ...unit,
        // A loop needs both its review and its fix unit; once one of them finished, the successor runs the other as a plain unit.
        ...(loop && unfinishedIds.has(loop.fixUnitId) ? { loop } : {}),
        dependencies: unit.dependencies.filter((dependency) => !completedIds.has(dependency))
      })),
      coordinationMode: reserved.coordinationMode
    };
    // The recovered run keeps its proposal and its report target.
    const recovered = await this.start(callerPrincipalId, projectId, request, {
      ...(reserved.proposal ? { proposal: reserved.proposal } : {}),
      ...(reserved.reportTo ? { reportTo: reserved.reportTo } : {})
    });
    if (!recovered.ok) return recovered;
    await this.deps.store.linkTimeoutSuccessor(source.id, clientRequestId, recovered.value.id);
    return { ok: true as const, value: recovered.value, source };
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
  private async wakeCoordinator(record: ExecutionRecord, wake: string | Parameters<ExecutionServiceDeps['store']['queueCoordinatorWake']>[1], confirmation?: CoordinatorWakeConfirmation): Promise<void> {
    const logError = this.deps.logError ?? ((context: string, error: unknown) => console.error(context, error));
    let current: ExecutionRecord;
    try {
      current = await this.deps.store.queueCoordinatorWake(record.id, wake);
    } catch (error) {
      logError(`execution coordinator wake persistence failed for ${record.id}`, error);
      return;
    }
    if (confirmation && typeof wake !== 'string') {
      // Same identity the store dedupes on (cause + unit + generation).
      const queued = current.coordinatorWakes?.find((candidate) => candidate.cause === wake.cause
        && (candidate.workUnitId ?? '') === (wake.workUnitId ?? '') && candidate.stateOrClaimGeneration === wake.stateOrClaimGeneration);
      if (queued) this.wakeConfirmations.register(queued.id, current.projectId, current.id, confirmation);
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
        // A confirmation-required wake written into a verifiably idle, status-fed
        // coordinator stays queued until it is seen to leave idle (the TUI may have
        // swallowed the text); its bounded window, not this drain, owns any retry.
        const pending = this.wakeConfirmations.get(wake.id);
        if (pending && pending.deliveries > 0) return;
        const confirm = !!pending && state !== undefined && isRestfulAgentState(state)
          && this.deps.confirmsWakeConsumption?.(sessionId) === true;
        if (confirm && !this.wakeConfirmations.beginDelivery(pending, sessionId, record.attempt)) return;
        const delivered_ = await this.deps.replyToSession(sessionId, wake.message);
        if (!delivered_) {
          if (confirm) this.wakeConfirmations.abortDelivery(pending);
          return;
        }
        if (confirm) {
          this.wakeConfirmations.arm(pending);
          return;
        }
        // Unverifiable target (no status feed / `unknown`): acknowledge on write.
        if (pending) this.wakeConfirmations.forget(pending);
        await this.deps.store.acknowledgeCoordinatorWake(record.id, wake.id);
      }
    } catch (error) {
      (this.deps.logError ?? ((context: string, cause: unknown) => console.error(context, cause)))(`execution coordinator wake drain failed for ${executionId}`, error);
    }
  }

  /**
   * Queue a durable operator correction for a parked coordinator. With a
   * `confirmation` fence the wake is acknowledged only on consumption evidence
   * (see {@link observeCoordinatorState}); the generation carries the message
   * digest so a distinct correction never dedupes against an unconsumed one.
   */
  async wakeCoordinatorForPlanCorrection(executionId: string, message: string, confirmation?: CoordinatorWakeConfirmation): Promise<void> {
    const record = await this.deps.store.get(executionId);
    if (!record) throw new Error('execution not found');
    await this.wakeCoordinator(record, {
      cause: 'HUMAN_BLOCKER',
      message,
      stateOrClaimGeneration: `${record.state}:${createHash('sha256').update(message).digest('hex').slice(0, 16)}`
    }, confirmation);
  }

  /**
   * Main-fed agent-status edge for a coordinator session. A delivered
   * confirmation-required wake is consumed once its coordinator leaves idle;
   * only then is it acknowledged out of the durable queue.
   */
  observeCoordinatorState(sessionId: string, state: AgentState): void {
    for (const entry of this.wakeConfirmations.consumedBy(sessionId, state)) {
      this.wakeConfirmations.forget(entry);
      void this.deps.store.acknowledgeCoordinatorWake(entry.executionId, entry.wakeId).catch((error) =>
        this.deps.logError?.(`execution coordinator wake ack failed for ${entry.executionId}`, error));
    }
  }

  /**
   * One-shot consumption window elapsed with no evidence the coordinator read the
   * wake. Redeliver at most once, fenced to the same coordinator session, execution
   * attempt and caller fence (offer); otherwise escalate. A stale wake (cancelled,
   * approved, superseded, regenerated) is dropped and never redelivered.
   */
  private async expireCoordinatorWake(entry: PendingWakeConfirmation): Promise<void> {
    const live = () => this.wakeConfirmations.get(entry.wakeId) === entry;
    const drop = async () => {
      this.wakeConfirmations.forget(entry);
      await this.deps.store.acknowledgeCoordinatorWake(entry.executionId, entry.wakeId);
    };
    try {
      const record = await this.deps.store.getInProject(entry.projectId, entry.executionId);
      const queued = record?.coordinatorWakes?.find((wake) => wake.id === entry.wakeId);
      const sessionId = entry.sessionId;
      if (!record || !queued || !sessionId) {
        this.wakeConfirmations.forget(entry);
        return;
      }
      const state = this.deps.getAgentState?.(sessionId);
      // Left idle without an observed edge: that is consumption, not loss.
      if (state === 'working' || state === 'blocked') {
        if (live()) await drop();
        return;
      }
      const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
      const current = !isTerminalExecutionState(record.state)
        && record.attempt === entry.attempt
        && lifecycle?.orchestratorSessionId === sessionId
        && await entry.confirmation.isCurrent();
      if (!live()) return;
      if (!current) {
        await drop();
        return;
      }
      const idle = state !== undefined && isRestfulAgentState(state);
      if (idle && record.coordinatorWakes?.[0]?.id === entry.wakeId && this.wakeConfirmations.beginDelivery(entry, sessionId, record.attempt)) {
        if (await this.deps.replyToSession(sessionId, queued.message)) {
          this.wakeConfirmations.arm(entry);
          return;
        }
      }
      if (!live()) return;
      // Budget spent (or the coordinator is no longer verifiably idle): drop the
      // wake so it can never be typed again, and hand it to the caller's escalation.
      await drop();
      await entry.confirmation.onUnconsumed();
    } catch (error) {
      this.deps.logError?.(`execution coordinator wake confirmation failed for ${entry.executionId}`, error);
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

  /** Trusted host path for a rejected plan before any work may be registered. */
  async stopForPlanCorrection(executionId: string): Promise<ExecutionRecord | undefined> {
    let record: ExecutionRecord | undefined;
    // Bounded re-read loop: each stale write means another actor advanced the record.
    for (let attempt = 0; ; attempt += 1) {
      record = await this.deps.store.get(executionId);
      if (!record) return undefined;
      if (record.state === 'COMPLETED') return record;
      if (record.state === 'STOPPED' && record.timeoutReason === 'plan-correction-cancelled') break;
      try {
        record = await this.deps.store.stopForPlanCorrection(record.id);
        break;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
        if (attempt + 1 >= MAX_PLAN_CORRECTION_STOP_ATTEMPTS) throw error;
        const current = await this.deps.store.get(executionId);
        if (!current) return current;
        const cancelled = current.state === 'STOPPED' && current.timeoutReason === 'plan-correction-cancelled';
        if (!cancelled && isResumeGrantTerminal(current.state)) return current;
      }
    }
    // The ledger's cancelled state fences plan registration and resume, but must
    // never fence retries of terminal effects after a crash or transient failure.
    await this.cleanupTerminal(record);
    const canceled = await this.cancelLaunchVerified(record);
    if (!canceled.ok && canceled.code !== 'NOT_FOUND') {
      throw new Error(`${canceled.code ?? 'CANCEL_FAILED'}: ${canceled.message ?? 'Team cancellation failed'}`);
    }
    return record;
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
      const canceled = await this.cancelLaunchVerified(record);
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

  /**
   * Owner-agent answer to a human blocker (MCP `execution.respond {blockerId}`). Unlike the Inbox path
   * it refuses coordinator-audience blockers, and with no `expectedStateVersion` it uses the latest
   * version (retrying on a concurrent write): the open blocker id already prevents a double answer.
   */
  async respondToHumanBlockerAsOwner(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number | undefined, blockerId: string, clientRequestId: string, message: string, scopeSplit?: 'split' | 'keep') {
    if (!blockerId.trim() || !clientRequestId.trim() || !message.trim() || Buffer.byteLength(message, 'utf8') > MAX_BLOCKER_ANSWER_BYTES) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker delivery request' };
    }
    for (let attempt = 0; ; attempt += 1) {
      const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
      if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
      const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
      if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
      if (blocker.audience === 'coordinator') return { ok: false as const, code: 'DENIED', message: `blocker ${blocker.id} is for the coordinator, not the owner` };
      const result = await this.enqueueOwnedBlocker(record, expectedStateVersion ?? record.stateVersion, blocker, clientRequestId, message, false, scopeSplit ?? 'auto');
      if (result.ok || result.code !== 'CONFLICT' || expectedStateVersion !== undefined || attempt >= 4) return result;
    }
  }

  async resumeBlocker(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string) {
    return this.deliverToBlocker(callerPrincipalId, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message, true);
  }

  async retryBlockerDelivery(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, deliveryId: string) {
    if (!blockerId.trim() || !deliveryId.trim()) return { ok: false as const, code: 'INVALID', message: 'invalid execution delivery retry request' };
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      const value = await this.deps.store.retryBlockerDelivery(record.id, expectedStateVersion, blockerId, deliveryId);
      // A worker already idle will not emit another edge after a manual retry.
      try {
        const lifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId));
        const slotId = value.deliveries?.find(delivery => delivery.id === deliveryId)?.slotId;
        const sessionId = slotId && isOrchestratorSlotId(slotId)
          ? lifecycle?.orchestratorSessionId
          : lifecycle?.workers?.find(worker => worker.slotId === slotId && worker.projectId === record.projectId)?.sessionId;
        if (sessionId) this.deps.triggerDeliveryDrain?.(sessionId);
      } catch (error) {
        this.deps.logError?.(`execution delivery retry nudge failed for ${record.id}/${deliveryId}`, error);
      }
      return { ok: true as const, value };
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
      this.syncParkedHolds(record.id);
      if (ack.outcome === 'accepted' && ack.delivery.state === 'DELIVERED') this.deadlineWatchdog.schedule(ack.record);
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
      const passedChecks = await this.completionChecks(current);
      if (passedChecks.length) {
        const live = await this.deps.store.get(current.id);
        const liveLifecycle = extractLifecycleInfo(await this.deps.getTeamLaunch(current.callerPrincipalId, current.teamLaunchRequestId));
        if (!live || liveLifecycle?.orchestratorSessionId !== callerPrincipalId && !live.effectiveOwnerPrincipalIds?.includes(callerPrincipalId)) return { ok: false as const, code: 'DENIED', message: 'only the Team coordinator can complete this execution' };
      }
      const completed = await this.deps.store.completeExecution(current.id, current.stateVersion, summary.trim(), evidence.artifacts, this.deps.routeFitObserveEnabled?.() === true, passedChecks);
      await this.teardownCompleted(completed);
      return { ok: true as const, value: completed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('CHECK_FAILED:')) await this.failNoDagCheckCompletion(record, namedCheckFailureSummary(error));
      return { ok: false as const, code: message.startsWith('CHECK_FAILED:') ? 'CHECK_FAILED' : 'CONFLICT', message };
    }
  }

  /** A global check failure is terminal for a no-DAG run, not an active retry loop. */
  private async failNoDagCheckCompletion(record: ExecutionRecord, message: string): Promise<void> {
    const current = await this.deps.store.get(record.id);
    if (!current || current.workUnits?.length || isTerminalExecutionState(current.state)) return;
    try {
      const evidence = await this.terminalEvidence(current);
      const failed = await this.deps.store.failExecution(
        current.id,
        current.stateVersion,
        message,
        evidence.artifacts,
        this.deps.routeFitObserveEnabled?.() === true
      );
      await this.cleanupTerminal(failed);
      await this.deps.cancelTeamLaunch(failed.callerPrincipalId, failed.teamLaunchRequestId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') {
        this.deps.logError?.(`execution no-DAG check failure persistence failed for ${record.id}`, error);
      }
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

  private async beginRetryWithLifecycleLock(executionId: string, expectedStateVersion: number): Promise<ExecutionRecord> {
    const begin = () => this.deps.store.beginRetry(executionId, expectedStateVersion);
    return this.deps.withExecutionLifecycleLock
      ? this.deps.withExecutionLifecycleLock(executionId, begin)
      : begin();
  }

  private async beginRetainedRecoveryWithLifecycleLock(executionId: string, expectedStateVersion: number, opts?: { keepSlotIds?: ReadonlySet<string> }): Promise<ExecutionRecord> {
    const begin = () => {
      if (this.deps.mayResumeRetainedWorktree?.(executionId) === false) {
        throw new Error('retained squad worktree is owned by an active follow-up agent');
      }
      return this.deps.store.beginRetainedRecovery(executionId, expectedStateVersion, opts);
    };
    return this.deps.withExecutionLifecycleLock
      ? this.deps.withExecutionLifecycleLock(executionId, begin)
      : begin();
  }

  /** `reportKind`: how the binding session receives reports, so an owner's [Squad report]s follow it. */
  async resumeBinding(callerPrincipalId: string, projectId: string, executionId: string, token: string, reportKind?: 'pty' | 'thread') {
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
        const value = await this.deps.store.addEffectiveOwner(executionId, callerPrincipalId, reportKind);
        this.pendingBindingOwners.delete(executionId);
        if (reportKind && value.reportTo?.role === 'owner') {
          // The report target moved to this session: it gets the human blockers the previous one never saw.
          for (const blocker of value.blockers ?? []) {
            if (!blocker.resolved && blocker.audience !== 'coordinator' && !value.reportedBlockerIds?.includes(blocker.id)) this.fireHumanBlocker(value, blocker);
          }
        }
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
    if (!blockerId.trim() || !clientRequestId.trim() || !text.trim() || Buffer.byteLength(text, 'utf8') > MAX_BLOCKER_ANSWER_BYTES) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker delivery request' };
    }
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    // Inbox / board answer (not the owner agent): same split guards, but never a confirm refusal it cannot act on.
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, clientRequestId, text, resume, 'decided');
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
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, `${record.id}:${expectedStateVersion}:${blocker.id}`, text, resume, 'decided');
  }

  /**
   * Scope re-split (AC6) for an owner answer: decide whether `text` widens the blocked unit's scope. Returns the child to
   * create and the worker-facing text, a refusal asking the owner to confirm, or nothing. Never throws.
   */
  private planScopeSplit(record: ExecutionRecord, blocker: NonNullable<ExecutionRecord['blockers']>[number], clientRequestId: string, text: string, mode: 'auto' | 'split' | 'keep' | 'decided'):
    { kind: 'none' } | { kind: 'replay'; text: string } | { kind: 'confirm'; message: string } | { kind: 'split'; child: ExecutionWorkUnitInput; text: string } {
    if (mode === 'keep' || blocker.noRoute || blocker.audience === 'coordinator') return { kind: 'none' };
    const prior = record.deliveries?.find((delivery) => delivery.clientRequestId === clientRequestId);
    // A retried request replays its stored delivery (which may carry the split note); it never splits twice.
    if (prior) return prior.payload.text.startsWith(text) ? { kind: 'replay', text: prior.payload.text } : { kind: 'none' };
    const unit = record.workUnits?.find((candidate) => candidate.id === blocker.workUnitId);
    if (!unit || unit.state === 'COMPLETED' || unit.state === 'FAILED' || unit.state === 'SKIPPED') return { kind: 'none' };
    const assessment = assessScopeWidening(unit, text);
    if (assessment.verdict === 'none') return { kind: 'none' };
    if (assessment.verdict === 'undecidable') {
      // 'decided' (non-owner paths: Inbox / board answers) has nobody to confirm with, so an undecidable answer is delivered unchanged.
      if (mode === 'decided') return { kind: 'none' };
      return mode === 'split'
        ? { kind: 'confirm', message: `scope split requested for unit ${unit.id} but the response names no file outside its scope; name the files the new unit must own.` }
        : { kind: 'confirm', message: confirmSplitPrompt(unit.id, assessment) };
    }
    const childId = splitChildId(record.workUnits ?? [], unit.id);
    const child = buildSplitChild(unit, childId, assessment, text);
    const note = splitDeliveryNote(unit.id, childId, assessment.addedFiles);
    if (Buffer.byteLength(text + note, 'utf8') > MAX_BLOCKER_ANSWER_BYTES) {
      if (mode === 'decided') return { kind: 'none' };
      return { kind: 'confirm', message: `answer plus the scope-split note exceeds ${MAX_BLOCKER_ANSWER_BYTES} bytes; shorten it.` };
    }
    return { kind: 'split', child, text: text + note };
  }

  private async enqueueOwnedBlocker(record: ExecutionRecord, expectedStateVersion: number, blocker: NonNullable<ExecutionRecord['blockers']>[number], clientRequestId: string, text: string, resume: boolean, scopeSplit?: 'auto' | 'split' | 'keep' | 'decided') {
    let split: { child: ExecutionWorkUnitInput } | undefined;
    if (scopeSplit !== undefined) {
      const plan = this.planScopeSplit(record, blocker, clientRequestId, text, scopeSplit);
      if (plan.kind === 'confirm') return { ok: false as const, code: 'CONFIRM_SPLIT', message: plan.message };
      if (plan.kind === 'replay') text = plan.text;
      if (plan.kind === 'split') { text = plan.text; split = { child: plan.child }; }
    }
    if (blocker.noRoute) {
      // No worker owns this blocker, so there is nothing to deliver: the reply ends the step directly.
      try {
        const value = await this.deps.store.resolveNoRouteBlocker(record.id, expectedStateVersion, blocker.id, text);
        this.syncParkedHolds(record.id);
        await this.cascadeDispatch(record.id);
        return { ok: true as const, pending: false as const, notified: false, value, resumeRequested: resume };
      } catch (error) {
        if (error instanceof Error && error.message === 'stale execution state') return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
        return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
      }
    }
    let enqueued: Awaited<ReturnType<ExecutionServiceDeps['store']['enqueueBlockerDelivery']>>;
    try {
      enqueued = await this.deps.store.enqueueBlockerDelivery(record.id, expectedStateVersion, {
        clientRequestId,
        blockerId: blocker.id,
        text,
        ...(split ? { split } : {})
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
    if (enqueued.splitChildId) {
      // The child is READY (or waits on its dependencies); route it now rather than at the next tick.
      this.syncParkedHolds(record.id);
      try { await this.cascadeDispatch(record.id); } catch (error) { this.deps.logError?.(`execution scope-split dispatch failed for ${record.id}`, error); }
    }
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    let targetSessionId: string | undefined;
    if (isOrchestratorSlotId(blocker.slotId)) {
      targetSessionId = lifecycle?.orchestratorSessionId;
    } else {
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === blocker.slotId && candidate.projectId === record.projectId);
      targetSessionId = worker?.sessionId;
    }
    let notified = false;
    try {
      notified = !!targetSessionId && await this.deps.replyToSession(targetSessionId, `Execution response pending. Pull with execution.delivery.pull for execution ${record.id}.`);
    } catch {
      notified = false;
    }
    if (targetSessionId) {
      try { this.deps.triggerDeliveryDrain?.(targetSessionId); } catch {}
    }
    return { ok: true as const, pending: true as const, notified, delivery: enqueued.delivery, value: enqueued.record, resumeRequested: resume, ...(enqueued.splitChildId ? { splitChildId: enqueued.splitChildId } : {}) };
  }

  private async deliverLegacyMessage(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker?.sessionId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution slot not found for caller' };
    if (!await this.deps.replyToSession(worker.sessionId, text)) return { ok: false as const, code: 'SESSION_GONE', message: 'execution slot is no longer live' };
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
      const canceled = await this.cancelLaunchVerified(record);
      return canceled.ok
        ? { ok: true as const, value: record, canceled: canceled.value }
        : { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    }
    const fenced = await this.fenceCommand(record, expectedStateVersion, 'Execution stop requested');
    if (!fenced.ok) return fenced;
    const runChecks = this.runCheckCompletions.get(record.id);
    if (runChecks) { runChecks.controller.abort(); await runChecks.pending.catch(() => undefined); }
    for (const check of this.checkCompletions.values()) if (check.executionId === record.id) check.controller.abort();
    const canceled = await this.cancelLaunchVerified(fenced.value);
    if (!canceled.ok && canceled.code !== 'NOT_FOUND') return { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    const stopped = await this.settleStopped(fenced.value);
    if (!isResumeGrantTerminal(stopped.state)) {
      return { ok: false as const, code: 'STOP_INCOMPLETE', message: `execution is still ${stopped.state.toLowerCase()} after the stop; retry Stop`, current: stopped };
    }
    return { ok: true as const, value: stopped, canceled: canceled.value };
  }

  /**
   * Land STOPPED after the launch was cancelled. Cancelling closes sessions, and their exit events (worker
   * exit, blocker/board writes) advance stateVersion while the cancel is in flight, so a single transition
   * at the fenced version loses the race and silently leaves the run BLOCKED/RUNNING. Re-read and retry
   * until the run is final; a terminal state written by another actor is accepted as-is.
   */
  private async settleStopped(fenced: ExecutionRecord): Promise<ExecutionRecord> {
    let current = fenced;
    for (let attempt = 0; attempt < MAX_STOP_TRANSITION_ATTEMPTS; attempt += 1) {
      const outcome = await this.transitionWithOutcome(current, 'STOPPED', 'info', 'Execution stopped');
      current = outcome.record;
      if (outcome.wrote || current.state === 'COMPLETED' || current.state === 'FAILED' || current.state === 'STOPPED') return current;
    }
    return current;
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
    const dueAt = nextDeadlineAt(record, (this.deps.now ?? Date.now)());
    if (dueAt !== undefined && (this.deps.now ?? Date.now)() >= dueAt
      && record.state !== 'COMPLETED' && record.state !== 'FAILED' && record.state !== 'STOPPED') {
      return this.applyDeadlineDecision(record);
    }
    let rawLifecycle: any;
    try {
      rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
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
    if (lifecycle.launchResult?.failedSlots?.length && !warnOnlyOnFailedSlots(record.coordinationMode)) {
      return this.failLaunch(record, formatFailedSlots(lifecycle.launchResult.failedSlots), 'background');
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
    // A seat that starts on demand and never started is not a live worker; once everything else has
    // ended it can no longer be used, so it must not keep the run open.
    const startedWorkers = lifecycle.workers.filter((worker) => worker.sessionId !== undefined || worker.process !== 'authorized');
    if (startedWorkers.length > 0 && startedWorkers.every((worker) =>
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
    return (await this.transitionWithOutcome(record, state, severity, summary)).record;
  }

  /**
   * Like {@link transitionOrCurrent}, but reports whether this caller wrote the transition. Only the writer
   * runs terminal cleanup and, for FAILED, cancels the launch: a caller that lost a stale-version race
   * returns the current record and leaves teardown to whoever won.
   */
  private async transitionWithOutcome(
    record: ExecutionRecord,
    state: ExecutionRecord['state'],
    severity: 'info' | 'warning' | 'error',
    summary: string
  ): Promise<{ record: ExecutionRecord; wrote: boolean }> {
    try {
      const updated = await this.deps.store.transition(record.id, record.stateVersion, state, severity, summary);
      if (isResumeGrantTerminal(updated.state)) {
        await this.cleanupTerminal(updated);
        if (updated.state === 'FAILED') {
          // Reads (status, reconcile) must not block on the bounded session-close wait; cancelBestEffort never rejects.
          void this.cancelBestEffort(updated, `execution ${updated.id} failed-run cleanup`);
        }
      }
      return { record: updated, wrote: true };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(record.id);
      if (!current) throw error;
      return { record: current, wrote: false };
    }
  }

  /**
   * Cancel the run's launch and wait a bounded time for sessions that are still closing. A close that failed
   * is retried on each check. The result is incomplete (CANCEL_INCOMPLETE) only if sessions survive the wait;
   * a launch the lifecycle no longer knows is reported as-is (NOT_FOUND) for the caller to accept.
   */
  private async cancelLaunchVerified(
    record: Pick<ExecutionRecord, 'id' | 'callerPrincipalId' | 'teamLaunchRequestId'>
  ): Promise<Awaited<ReturnType<ExecutionServiceDeps['cancelTeamLaunch']>>> {
    const settle = this.deps.cancelSettle;
    const attempts = Math.max(1, settle?.attempts ?? 4);
    const intervalMs = Math.max(0, settle?.intervalMs ?? 300);
    const sleep = settle?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let last: Awaited<ReturnType<ExecutionServiceDeps['cancelTeamLaunch']>> = { ok: false, code: 'CANCEL_FAILED', message: 'Team cancellation failed' };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(intervalMs);
      last = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      // A refused cancellation is the caller's to retry; only surviving sessions are waited on here.
      if (!last.ok) return last;
      const pending = last.value?.pendingSessionIds ?? [];
      if (pending.length === 0 && last.value?.lifecycleState !== 'cancel-pending') return last;
    }
    const pending = last.ok ? last.value?.pendingSessionIds ?? [] : [];
    return {
      ok: false,
      code: 'CANCEL_INCOMPLETE',
      message: pending.length > 0 ? `Team sessions are still closing: ${pending.join(', ')}` : 'Team sessions are still closing',
      value: {
        canceledSessionIds: last.value?.canceledSessionIds ?? [],
        pendingSessionIds: pending,
        ...(last.value?.lifecycleState ? { lifecycleState: last.value.lifecycleState } : {})
      }
    };
  }

  /** Terminal-path cancel that never throws: the run is already final, so a stuck session is logged for the next Stop to finish. */
  private async cancelBestEffort(record: ExecutionRecord, context: string): Promise<void> {
    try {
      const canceled = await this.cancelLaunchVerified(record);
      if (!canceled.ok && canceled.code !== 'NOT_FOUND') this.deps.logError?.(context, new Error(`${canceled.code}: ${canceled.message}`));
    } catch (error) {
      this.deps.logError?.(context, error);
    }
  }

  /**
   * Members can record progress (claims, events) while launchTeam is still in
   * flight, bumping stateVersion. Promote the current STARTING version rather
   * than losing the transition to a stale one; any other state wins as-is.
   */
  private async promoteStartingToRunning(record: ExecutionRecord, summary: string): Promise<ExecutionRecord> {
    let current = record;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      current = await this.transitionOrCurrent(current, 'RUNNING', 'info', summary);
      if (current.state !== 'STARTING') return current;
    }
    return current;
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

  /**
   * `cancel: 'background'` is for read/reconcile paths (status), which must not block on the bounded
   * session-close wait; launch paths keep the awaited, verified cancel.
   */
  private async failLaunch(record: ExecutionRecord, summary: string, cancel: 'awaited' | 'background' = 'awaited'): Promise<ExecutionRecord> {
    const cleanup = async (target: ExecutionRecord, context: string) => {
      const pending = this.cancelBestEffort(target, context);
      if (cancel === 'awaited') await pending;
    };
    let current = record;
    // Members bump stateVersion while a launch is in flight; keep refetching so one writer lands FAILED.
    for (let attempt = 0; attempt < MAX_FAIL_LAUNCH_ATTEMPTS; attempt += 1) {
      if (current.state !== 'STARTING' && current.state !== 'RUNNING') return current;
      try {
        const failed = await this.deps.store.transition(current.id, current.stateVersion, 'FAILED', 'error', boundReason(summary));
        await this.cleanupTerminal(failed);
        await cleanup(failed, `execution ${failed.id} failed-launch cleanup`);
        return failed;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
        const refreshed = await this.deps.store.get(current.id);
        if (!refreshed) throw error;
        current = refreshed;
      }
    }
    // Retries exhausted without a FAILED write: still close the seats this launch started.
    await cleanup(current, `execution ${current.id} failed-launch cleanup after retries`);
    return current;
  }

  /**
   * Evaluates worker slots that failed while the launch itself succeeded. Freeform and legacy `job-team` runs
   * keep going with a persistent warning (the coordinator is told at kickoff); every other mode cannot finish
   * with a missing worker and fails now. Returns the settled record only when the run was failed.
   */
  private async settleFailedSlots(record: ExecutionRecord, failedSlots: unknown[], issuedAuthorizationIds: string[]): Promise<ExecutionRecord | undefined> {
    if (failedSlots.length === 0) return undefined;
    if (warnOnlyOnFailedSlots(record.coordinationMode)) {
      await this.deps.store.warning(record.id, { slots: failedSlots }).catch((error) => {
        this.deps.logError?.(`Team launch warning failed for ${record.id}`, error);
      });
      return undefined;
    }
    await this.deps.revokeTeamAuthorizations?.(issuedAuthorizationIds);
    // failLaunch writes FAILED and cancels the launch once.
    return this.failLaunch(record, formatFailedSlots(failedSlots));
  }

  /** Retained recovery must stay terminal so its recovery mode and snapshots remain actionable. */
  private async failRetainedRecovery(
    record: ExecutionRecord,
    recovery: { mode: RetainedRecoveryMode } | undefined,
    summary: string
  ): Promise<ExecutionRecord> {
    return recovery
      ? this.failLaunch(record, summary)
      : this.transitionOrCurrent(record, 'BLOCKED', 'warning', summary);
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
    const runChecks = this.runCheckCompletions.get(record.id);
    if (runChecks) { runChecks.controller.abort(); await runChecks.pending.catch(() => undefined); }
    for (const check of this.checkCompletions.values()) if (check.executionId === record.id) check.controller.abort();
    this.deadlineWatchdog.remove(record.id);
    this.planReadinessWatchdog.remove(record.id);
    this.syncParkedHolds(record.id, { restore: true });
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
    try {
      await this.deps.onTerminal?.(record);
    } catch (error) {
      this.deps.logError?.(`execution terminal lifecycle ${record.id}`, error);
    }
  }

  /** Shared teardown for a successfully completed run: notice, terminal cleanup, then cancel (optionally keeping the orchestrator). */
  private async teardownCompleted(record: ExecutionRecord): Promise<void> {
    await this.appendCompletionInboxNotice(record);
    let retainOrchestrator = false;
    try {
      retainOrchestrator = extractLifecycleInfo(await this.deps.getTeamLaunch(
        record.callerPrincipalId,
        record.teamLaunchRequestId
      ))?.retainOrchestrator === true;
    } catch (error) {
      this.deps.logError?.(`execution completion lifecycle lookup failed for ${record.id}`, error);
    }
    await this.cleanupTerminal(record);
    await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId, { retainOrchestrator });
  }

  private async appendCompletionInboxNotice(record: ExecutionRecord): Promise<void> {
    if (executionReportTarget(record) || record.request.completionInboxNotice !== true || !this.deps.inbox?.appendOnce) return;
    try {
      await this.deps.inbox.appendOnce({
        projectId: record.projectId,
        subject: record.jobTitle || 'Squad Completed',
        comments: record.finalSummary || 'Squad completed.',
        executionId: record.id,
        dedupeKey: record.id
      });
    } catch (error) {
      this.deps.logError?.(`execution completion inbox append failed for ${record.id}`, error);
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
    // A prior deadline write can survive while cancellation fails. Keep the
    // watchdog retrying terminal teardown; do not reinterpret STOPPED as a new
    // deadline decision.
    if (record.state === 'STOPPED') {
      await this.cancelTimedOutLaunch(record);
      return;
    }
    await this.applyDeadlineDecision(record);
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

  private async applyDeadlineDecision(record: ExecutionRecord): Promise<ExecutionRecord> {
    if (isResumeGrantTerminal(record.state)) return record;
    const timings = deadlineTimings(record);
    if (!timings) return record;
    // The store recomputes the due time from the live record inside its queue.
    const decision = await this.deps.store.decideDeadline(record.id, timings);
    if (decision.kind === 'continue' || decision.kind === 'warned') {
      if (decision.kind === 'warned') await this.announceBlockedWaitWarning(decision.record, timings.blockedWaitMs);
      this.deadlineWatchdog.schedule(decision.record, (this.deps.now ?? Date.now)() + DEADLINE_RECHECK_FLOOR_MS);
      return decision.record;
    }
    await this.cleanupTerminal(decision.record);
    await this.cancelTimedOutLaunch(decision.record);
    return decision.record;
  }

  /**
   * The drain exhausted its bounded retries on an 'uncertain' resume nudge. The delivery stays PENDING and the
   * blocker stays open; this raises ONE Inbox notice per delivery (dedupe key) so a human can look. Best effort.
   */
  async announceDeliveryStall(executionId: string, deliveryIds: string[]): Promise<void> {
    const inbox = this.deps.inbox;
    if (!inbox) return;
    const record = await this.deps.store.get(executionId);
    if (!record || isResumeGrantTerminal(record.state)) return;
    for (const deliveryId of deliveryIds) {
      const delivery = record.deliveries?.find((candidate) => candidate.id === deliveryId);
      if (!delivery || delivery.state !== 'PENDING') continue;
      const input: InboxInput = {
        projectId: record.projectId,
        subject: blockerCardSubject(record),
        comments: 'An answer to a question is waiting, but the worker has not confirmed it received the reminder to pick it up. The question stays open and the answer is kept. Open the job to check on the worker.',
        executionId: record.id,
        blockerId: delivery.blockerId,
        dedupeKey: `execution-delivery-stall:${record.id}:${delivery.id}`
      };
      try {
        await (inbox.appendOnce ? inbox.appendOnce(input) : inbox.append(input));
      } catch (error) {
        this.deps.logError?.(`execution delivery stall notice failed for ${record.id}`, error);
      }
    }
  }

  /** Fire-and-forget hold sync; failures (load, lifecycle lookup) are logged, never thrown into the caller. */
  private syncParkedHolds(executionId: string, opts?: { restore?: boolean }): void {
    void this.parkedHolds.sync(executionId, opts).catch((error) => this.deps.logError?.(`execution parked-worker hold sync failed for ${executionId}`, error));
  }

  /** One Inbox warning before an open human blocker's bounded wait expires; best effort, idempotent by dedupe key. */
  private async announceBlockedWaitWarning(record: ExecutionRecord, blockedWaitMs: number): Promise<void> {
    const inbox = this.deps.inbox;
    if (!inbox) return;
    const blocker = (record.blockers ?? []).find((candidate) => !candidate.resolved && candidate.audience !== 'coordinator');
    const input: InboxInput = {
      projectId: record.projectId,
      subject: blockerCardSubject(record),
      comments: `This job has been waiting on an unanswered question and will be stopped in about ${Math.max(1, Math.round(Math.min(BLOCKED_WAIT_WARN_LEAD_MS, Math.floor(blockedWaitMs / 4)) / 60_000))} minutes. Answer it to keep the job running.`,
      executionId: record.id,
      dedupeKey: `execution-blocker-expiry:${record.id}:${blocker?.id ?? 'blocked'}`
    };
    try {
      await (inbox.appendOnce ? inbox.appendOnce(input) : inbox.append(input));
    } catch (error) {
      this.deps.logError?.(`execution blocked-wait warning failed for ${record.id}`, error);
    }
  }

  private async appendHumanBlockerNotice(
    record: ExecutionRecord,
    blocker: NonNullable<ExecutionRecord['blockers']>[number],
    questionData: Record<string, unknown>
  ): Promise<void> {
    const inbox = this.deps.inbox;
    if (!inbox) return;
    const input: InboxInput = {
      projectId: record.projectId,
      subject: blockerCardSubject(record),
      comments: blocker.question,
      executionId: record.id,
      blockerId: blocker.id,
      dedupeKey: `execution-blocker:${record.id}:${blocker.id}`,
      ...questionData
    };
    const entry = inbox.appendOnce ? await inbox.appendOnce(input) : await inbox.append(input);
    await this.deps.store.acknowledgeNotice(record.id, input.dedupeKey!, entry.id);
  }

  /**
   * Grace elapsed with no registered plan. Re-checks at fire time (the record
   * may have gained work units or already gone terminal) before failing the run
   * and cancelling its workers. Mirrors {@link timeoutExecution}'s stale-version
   * re-arm so a concurrent transition just reschedules rather than throwing.
   */
  private async failPlanlessExecution(executionId: string, reason?: PlanReadinessExpiryReason): Promise<void> {
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
      failed = await this.deps.store.transition(record.id, record.stateVersion, 'FAILED', 'error', reason === 'suspension-cap'
        ? 'No plan registered within the 24h safety cap while a plan-correction decision was pending'
        : 'No plan registered within startup grace');
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
    if (current.state === 'STOPPED') {
      try { await this.cancelTimedOutLaunch(current); } catch { /* watchdog retries teardown */ }
      return false;
    }
    const dueAt = nextDeadlineAt(current, (this.deps.now ?? Date.now)());
    const expired = dueAt !== undefined && (this.deps.now ?? Date.now)() >= dueAt;
    if (!isResumeGrantTerminal(current.state) && !expired) return true;
    if (expired) {
      try {
        const decided = await this.applyDeadlineDecision(current);
        if (!isResumeGrantTerminal(decided.state)) return true;
      } catch {
        // Watchdog owns bounded retry; post-launch fence still prevents RUNNING.
      }
    }
    return false;
  }

  private async cancelTimedOutLaunch(record: ExecutionRecord): Promise<void> {
    const canceled = await this.cancelLaunchVerified(record);
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

/** Bounded canonical identity prevents distinct structured receipts sharing a check run. */
function structuredResultIdentity(value: unknown): string {
  const bounded = validateStructuredJson(value);
  return bounded.ok
    ? `sha256:${createHash('sha256').update(bounded.canonical).digest('hex')}`
    : `<invalid:${bounded.reason}>`;
}

/** Store has no run-level check receipt field; retain bounded untrusted evidence in final summary. */
function namedCheckFailureSummary(error: unknown): string {
  if (!(error instanceof NamedCheckFailureError) || !error.receipt) return error instanceof Error ? error.message : String(error);
  const { name, status, exitCode, output } = error.receipt;
  return `${error.message}\n\nNamed check receipt (untrusted): ${name} status=${status} exitCode=${exitCode}\n${output.slice(0, MAX_NAMED_CHECK_FAILURE_OUTPUT_CHARS)}`;
}

/** One line per review loop the recovery splits (one half finished): it continues as plain units, so say so. */
function splitLoopNotes(units: NonNullable<ExecutionRecord['workUnits']>): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  return units.flatMap((review) => {
    const fix = review.loop ? byId.get(review.loop.fixUnitId) : undefined;
    if (!review.loop || !fix || (review.state === 'COMPLETED') === (fix.state === 'COMPLETED')) return [];
    return [`Review loop ${review.id} was interrupted in round ${review.loopRound ?? 1}; it continues as plain units, so check by hand that ${fix.id}'s changes were re-reviewed.`];
  });
}
