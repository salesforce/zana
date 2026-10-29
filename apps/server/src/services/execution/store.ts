import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing/storage.js';
import type { WorkflowPolicyResultV1 } from './policy-result.js';
import { EXECUTION_FAILURE_CODES, isDurableCoordination, isSquadExecutionTargetSelector } from '@zana-ai/zcc-domain/product';
import type { SquadExecutionTargetSelector, SquadWorktreeOwnership } from '@zana-ai/zcc-domain/product';
import type { ExecutionFailureCode, ExecutionSourceSnapshot, TeamLaunchAuthorizationContextV1 } from '@zana-ai/zcc-domain/product';
import type { SquadBundleWorkflowMetadataV1, TeamLaunchAuthorizationInputSlot, TeamLaunchRequestInput } from '@zana-ai/zcc-domain/product';
import { SQUAD_GOAL_MAX_CHARS, SQUAD_SUMMARY_MAX_CHARS, squadStoredFieldTooLong } from '@zana-ai/zcc-domain/squad-proposal';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../launch/team-lifecycle-store.js';
import { normalizeExecutionPlan } from '../launch/preflight.js';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { readExecutionStoreSqliteState, writeExecutionStoreSqliteState } from './storage/sqlite-state.js';
import { isResumableExecutionState } from './storage/backend-policy.js';
import { evaluateSlotEligibility, type WorkUnitRoutingV1 } from './routing-policy.js';
import { MODEL_PRICING_CATALOG_ID, MODEL_PRICING_CATALOG_VERSION } from './model-pricing-catalog.js';
import {
  assembleExecutionResult,
  hasOnlyKeys,
  MAX_EXECUTION_PLAN_BYTES,
  evaluateRouteFit,
  usageCursorIdentity,
  usageRollup,
  usageIdentity,
  usageIdentityDigest,
  usageObservationFingerprint,
  validOutputDeclaration,
  type CoordinatorWakeCause,
  type CoordinatorWakeV1,
  type ExecutionAssembledResultV1,
  type ExecutionUsageObservationV1,
  type ExecutionUsageBaselineV1,
  type RouteFitProposalV1,
  type WorkOutputDeclarationV1
} from './contracts.js';

export type ExecutionState = 'READY' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'STOPPED' | 'FAILED';
/** States an execution never leaves. BLOCKED is not terminal: it can resume. */
export const TERMINAL_EXECUTION_STATES: ReadonlySet<ExecutionState> = new Set(['COMPLETED', 'STOPPED', 'FAILED']);
export function isTerminalExecutionState(state: ExecutionState): boolean {
  return TERMINAL_EXECUTION_STATES.has(state);
}
export type ExecutionWorkUnitState = 'PENDING' | 'READY' | 'CLAIMED' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type ExecutionCohortAuthority = { role: 'worker' | 'orchestrator'; slotId: string };
export type ExecutionLaunchKind = 'team';
/**
 * No-progress reclaim reasons keyed by name. Consumers reference a NAMED key
 * (`NO_PROGRESS_CLAIM_REASON.PROVEN_DEAD`) so reordering can't silently rewire
 * which reason a call site means — the positional-index coupling this replaced
 * was fragile. {@link NO_PROGRESS_CLAIM_REASONS} is the derived value list for
 * membership tests + projection (stable insertion order).
 */
export const NO_PROGRESS_CLAIM_REASON = {
  WALL_CLOCK: 'Work claim exceeded main-observable wall-clock limit',
  PROVEN_DEAD: 'Claim lease expired and assigned Team worker is proven dead',
  AGENT_DEAD: 'Claim reclaimed: worker shell/wrapper is alive but its inner agent is dead',
  SILENT: 'Claim lease expired with no worker output for a full lease window',
  STALLED: 'Claim reclaimed: worker alive but produced no output progress within the stall limit'
} as const;
export const NO_PROGRESS_CLAIM_REASONS = Object.values(NO_PROGRESS_CLAIM_REASON);
export type NoProgressReason = typeof NO_PROGRESS_CLAIM_REASON[keyof typeof NO_PROGRESS_CLAIM_REASON];

function isNoProgressReason(reason: string): reason is NoProgressReason {
  return (NO_PROGRESS_CLAIM_REASONS as readonly string[]).includes(reason);
}

/**
 * A no-op *guard* rejection from a background recovery mutation (kickoff reassign /
 * block, human escalation) — the requested transition simply does not apply
 * (not in the required state, below a threshold, no untried slot, duplicate,
 * already resolved/escalated). It is EXPECTED control flow the service caller
 * swallows, and is deliberately DISTINCT from a real persistence/write failure
 * (which is NOT this type and must surface). See `service.ts escalateKickoffFailures`.
 */
export class WorkUnitRecoveryGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkUnitRecoveryGuardError';
  }
}

/** Ordered steps of Zana's automatic recovery of a worker that stopped on an API error. */
export const WORKER_RECOVERY_STEPS = ['waiting', 'nudged', 'restarted', 'resumed', 'restart-failed', 'exhausted'] as const;
export type WorkerRecoveryStep = typeof WORKER_RECOVERY_STEPS[number];

const MAX_RECOVERY_KIND = 64;
const MAX_RECOVERY_TEXT = 500;
const MAX_RECOVERY_DETAIL = 300;
const MAX_RECOVERY_STEPS = 8;
/** Length of the last-error excerpt quoted in the blocker question. */
const MAX_BLOCKER_ERROR_EXCERPT = 300;

/** Steps at which Zana is still working through the ladder: the claim is held and the board shows it. */
const LIVE_RECOVERY_STEPS: ReadonlySet<WorkerRecoveryStep> = new Set(['waiting', 'nudged', 'restarted']);
/** Unfinished steps the blocker may close: the live ones plus a failed restart ('resumed' and 'exhausted' are finished). */
const BLOCKABLE_RECOVERY_STEPS: ReadonlySet<WorkerRecoveryStep> = new Set([...LIVE_RECOVERY_STEPS, 'restart-failed']);

/** Durable record of one claim's API-error recovery; only meaningful while it names the unit's current claim. */
export interface WorkerApiErrorRecovery {
  claimId: string;
  claimGeneration: number;
  slotId: string;
  executionAttempt: number;
  step: WorkerRecoveryStep;
  errorKind?: string;
  errorText?: string;
  startedAt: number;
  updatedAt: number;
  deadlineAt?: number;
  steps: Array<{ step: WorkerRecoveryStep; at: number; detail?: string }>;
}

export interface RecordWorkerRecoveryInput {
  workUnitId: string;
  claimId: string;
  claimGeneration: number;
  slotId: string;
  step: WorkerRecoveryStep;
  errorKind?: string;
  errorText?: string;
  deadlineAt?: number;
  detail?: string;
  severity: 'info' | 'warning';
  summary: string;
}

/** Steps at which a recovery is unfinished: a 'resumed' or 'exhausted' recovery must not be blocked as unrecovered. */
function isWorkerRecoveryActiveStep(step: WorkerRecoveryStep): boolean {
  return BLOCKABLE_RECOVERY_STEPS.has(step);
}

/** True while Zana is still recovering the unit's CURRENT claim (not a stale or finished attempt). */
export function isWorkerRecoveryActive(unit: ExecutionWorkUnit): boolean {
  const recovery = unit.apiErrorRecovery;
  return unit.state === 'CLAIMED' && recovery !== undefined && unit.claimId !== undefined
    && recovery.claimId === unit.claimId && recovery.claimGeneration === unit.claimGeneration
    && LIVE_RECOVERY_STEPS.has(recovery.step);
}

/** {@link isWorkerRecoveryActive} and before its deadline: past it nothing more will be tried, so ordinary reclaim applies. */
export function isWorkerRecoveryLive(unit: ExecutionWorkUnit, now: number): boolean {
  const deadlineAt = unit.apiErrorRecovery?.deadlineAt;
  return isWorkerRecoveryActive(unit) && deadlineAt !== undefined && now < deadlineAt;
}

/** Local HH:MM used in blocker text that tells a human when recovery was tried. */
export function formatRecoveryClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function validWorkerApiErrorRecovery(value: unknown): value is WorkerApiErrorRecovery {
  if (!value || typeof value !== 'object') return false;
  const recovery = value as Partial<WorkerApiErrorRecovery>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return validString(recovery.claimId) && validNonNegativeInteger(recovery.claimGeneration) && validString(recovery.slotId)
    && validNonNegativeInteger(recovery.executionAttempt)
    && (WORKER_RECOVERY_STEPS as readonly unknown[]).includes(recovery.step)
    && (recovery.errorKind === undefined || validString(recovery.errorKind) && recovery.errorKind.length <= MAX_RECOVERY_KIND)
    && (recovery.errorText === undefined || validString(recovery.errorText) && recovery.errorText.length <= MAX_RECOVERY_TEXT)
    && finite(recovery.startedAt) && finite(recovery.updatedAt) && (recovery.deadlineAt === undefined || finite(recovery.deadlineAt))
    && Array.isArray(recovery.steps) && recovery.steps.length <= MAX_RECOVERY_STEPS
    && recovery.steps.every((entry) => !!entry && (WORKER_RECOVERY_STEPS as readonly unknown[]).includes(entry.step)
      && finite(entry.at) && (entry.detail === undefined || validString(entry.detail) && entry.detail.length <= MAX_RECOVERY_DETAIL));
}

/** Backend-neutral label captured with a durable execution request. */
export interface ExecutionLaunchDisplayV1 {
  label: string;
}

export interface ExecutionWorkUnitInput {
  id: string;
  title: string;
  task: string;
  dependencies: string[];
  preferredRole?: string;
  files?: string[];
  verification?: string[];
  readOnly?: boolean;
  routing?: WorkUnitRoutingV1;
  output?: WorkOutputDeclarationV1;
  requires?: WorkUnitRequirementsV1;
}

/** Optional capabilities a work unit must have before the execution can launch. */
export interface WorkUnitRequirementsV1 {
  skills?: string[];
  mcpServers?: string[];
}

export interface ExecutionWorkUnit extends ExecutionWorkUnitInput {
  state: ExecutionWorkUnitState;
  assignedSlotId?: string;
  /** Main-minted fence. Missing only on pre-Phase-04 persisted claims. */
  claimGeneration?: number;
  claimId?: string;
  claimedBy?: { slotId: string; sessionId?: string; routeId?: string };
  claimedAt?: number;
  leaseExpiresAt?: number;
  heartbeatAt?: number;
  /** Last main-observed OUTPUT progress (epoch ms): set at claim, advanced by
   *  byte-output lease renewal (and a worker turn heartbeat), NEVER by the
   *  agent-state lease renewal in `reconcileActive`. So while `leaseExpiresAt`
   *  answers "is the worker considered alive" (kept fresh by output OR agent
   *  state), `progressAt` answers "when did the worker last actually emit
   *  output" — the signal the stall ceiling (`maxClaimStallMs`) uses to reclaim
   *  a silent-but-'working' worker before the blunt wall-clock backstop. */
  progressAt?: number;
  turnCount?: number;
  /**
   * Count of successive claim reclaims where the worker NEVER reported a completed
   * turn (`turnCount` stayed 0) — the kickoff-churn signature. A bare interactive
   * worker (e.g. OpenCode) whose injected first-prompt never submits gets claimed,
   * echoes the paste, produces no turn, and is stall-reclaimed with `turnCount: 0`
   * every cycle; without a cap the engine re-dispatches it forever down the same
   * broken delivery path (live run 47823553). Incremented in {@link
   * reclaimExpiredClaims} for a never-turned unit, RESET to 0 the moment the worker
   * heartbeats a real turn (so a slow-but-eventually-working kickoff never
   * accumulates a false block). Deliberately survives `clearClaim` — it counts
   * ACROSS reclaims. At {@link KICKOFF_FAILURE_BLOCK_THRESHOLD} the unit is blocked
   * to a human ({@link blockKickoffFailure}) instead of silently re-dispatched.
   */
  kickoffFailures?: number;
  /** Bounded per-attempt no-progress evidence. A listed slot is excluded from
   * automatic redispatch until an explicit retry resets this unit. */
  noProgressSlots?: Array<{ slotId: string; executionAttempt: number; unitAttempt: number; claimGeneration: number; reason: NoProgressReason; reclaimedAt: number }>;
  /**
   * The exact claim an engine sweep reclaimed while the unit was still CLAIMED,
   * retained ONLY while the unit stays READY (still unclaimed). It authorizes a
   * late completion from that same worker — the sanctioned reclaim→finish race
   * where a worker was silent through a long tool phase, got reclaimed, and then
   * finished. It is cleared the instant anything newer supersedes it (a new claim
   * — even to the same slot, since slot ids are reused across worker restarts — a
   * retry, or a fresh-slot reassignment), so a stale worker can NEVER overwrite a
   * reassigned or re-claimed unit, nor resurrect a terminal one. See {@link
   * completeWork}. Runtime-only (stripped by {@link stripWorkUnitState}).
   */
  reclaimedClaim?: { slotId: string; claimId: string; claimGeneration: number };
  /** Zana's API-error recovery of this unit's worker; inactive once the claim changes ({@link isWorkerRecoveryActive}). */
  apiErrorRecovery?: WorkerApiErrorRecovery;
  attempt: number;
  failureCode?: ExecutionFailureCode;
  failure?: string;
  result?: string;
  structuredResult?: unknown;
  repairDigests?: string[];
  history: Array<{ action: 'claimed' | 'released' | 'retried' | 'blocked' | 'failed' | 'completed'; slotId?: string; attempt: number; at: number; detail?: string }>;
}

/**
 * One engine auto-dispatch assignment (store side). The store transitions the
 * unit to CLAIMED and returns these so the service can resolve each `slotId` to
 * a live worker session and push the task text.
 */
export interface ExecutionDispatchAssignment {
  workUnitId: string;
  slotId: string;
  title: string;
  task: string;
  files?: string[];
  claimId?: string;
  claimGeneration?: number;
}

export interface ExecutionBlocker {
  id: string;
  workUnitId: string;
  slotId: string;
  question: string;
  options?: string[];
  /**
   * Who must answer this blocker. `'human'` (the default when absent) is the
   * legacy behavior: it wakes the coordinator AND appends a human inbox
   * question, and only the OWNER may answer it. `'coordinator'` is a self-heal
   * blocker — a worker asking the coordinator for a plan/spec decision it cannot
   * make itself; it wakes the coordinator WITHOUT a human inbox entry, and the
   * coordinator answers it via `execution.work.answer` (no owner involvement).
   */
  audience?: 'human' | 'coordinator';
  /**
   * Set when a stuck `'coordinator'` blocker is auto-escalated to a human: the
   * coordinator was given a chance to self-heal (its wake retries on every idle
   * edge) but the blocker sat unanswered past `COORDINATOR_BLOCKER_ESCALATE_MS`,
   * so the sweep flips `audience` → `'human'` and appends a human inbox entry.
   * Stamped once; its presence guards against re-escalating the same blocker.
   */
  escalatedAt?: number;
  response?: string;
  resolved: boolean;
  createdAt: number;
  respondedAt?: number;
  resolvedAt?: number;
}

export type ExecutionDeliveryState = 'PENDING' | 'LEASED' | 'DELIVERED' | 'FAILED';

export interface ExecutionDeliveryRecord {
  id: string;
  clientRequestId: string;
  blockerId: string;
  workUnitId: string;
  slotId: string;
  payload: { text: string };
  state: ExecutionDeliveryState;
  attempt: number;
  manualRetryCount?: number;
  recipientPrincipalId?: string;
  recipientAuthorizationId?: string;
  leaseId?: string;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
}

export interface ExecutionNoticeIntent {
  key: string;
  blockerId: string;
  status: 'PENDING' | 'ACKNOWLEDGED';
  attempts: number;
  nextAttemptAt: number;
  inboxItemId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionRecord {
  id: string;
  callerPrincipalId: string;
  projectId: string;
  teamId: string;
  /** Generic launch identity. Team ids remain for current backend reconciliation. */
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  jobTitle: string;
  summary?: string;
  requestDigest: string;
  launchRequestId: string;
  teamLaunchRequestId: string;
  request: ExecutionRequestSnapshotV1;
  /** Main-created shared checkout for this squad execution, if isolation applied. */
  squadWorktree?: SquadWorktreeRecord;
  /** User completed retained-worktree handling without deleting its checkout. */
  squadWorktreeDisposition?: 'left';
  /** Terminal worktree effects completed for this exact terminal generation. */
  terminalWorktreeEffectsStateVersion?: number;
  attempt: number;
  /** Durable start of current launch attempt; resets before every retry launch. */
  attemptStartedAt: number;
  state: ExecutionState;
  stateVersion: number;
  lastEventSequence?: number;
  resolvedModels: ResolvedModelSnapshotV1[];
  /** Shadow-only routing evidence; legacy assignment remains authoritative. */
  routingDecisions?: RoutingDecisionV1[];
  authorizationContext?: TeamLaunchAuthorizationContextV1;
  authorizationContextDigest?: string;
  launchIntent?: ExecutionLaunchIntentV1;
  policyResult?: WorkflowPolicyResultV1;
  effectiveOwnerPrincipalIds?: string[];
  recoveryGeneration?: number;
  recoveryDeadlineAt?: number;
  /** Trusted-host capture only. Never contains a session token or transcript. */
  nativeRecoverySnapshots?: ExecutionNativeRecoverySnapshotV1[];
  /** Immutable trusted-host MCP catalogue attestation, keyed by execution slot. */
  automatedMcpCatalogueProvenance?: Record<string, ExecutionSlotMcpCatalogueProvenanceV1>;
  workUnits?: ExecutionWorkUnit[];
  blockers?: ExecutionBlocker[];
  deliveries?: ExecutionDeliveryRecord[];
  noticeIntents?: ExecutionNoticeIntent[];
  /** Fixed, non-sliding timeout extension for a committed unresolved blocker. */
  blockerGraceUntil?: number;
  /** Durable explanation for a terminal stop; never implies inbox delivery. */
  timeoutReason?: 'idle' | 'unresolved-blocker' | 'plan-correction-cancelled';
  /** Stable launch request reserved for one recovered successor. */
  successorLaunchRequestId?: string;
  successorExecutionId?: string;
  recoveryRequestId?: string;
  finalSummary?: string;
  assembledResult?: ExecutionAssembledResultV1;
  usageObservations?: ExecutionUsageObservationV1[];
  usageBaseline?: ExecutionUsageBaselineV1;
  resourceBlock?: { version: 1; kind: 'usage-budget' | 'telemetry-unavailable'; reason: string; blockedAt: number };
  routeFitProposal?: RouteFitProposalV1;
  telemetryGapCount?: number;
  /** Coordinator intentionally stopped taking routine turns after initial dispatch. */
  coordinatorState?: 'ACTIVE' | 'PARKED';
  coordinatorWakes?: CoordinatorWakeV1[];
  coordinatorWakeSequence?: number;
  coordinationMode?: import('@zana-ai/zcc-domain/product').TeamCoordinationMode;
  origin?: import('@zana-ai/zcc-domain/product').LaunchOrigin;
  /** Squad launch proposal this run was started from. Never part of the request digest. */
  proposal?: { id: string; proposerKind: 'pty' | 'thread'; proposerId: string; proposerTitle?: string };
  /**
   * Conversation that gets a `[Squad report]` when the run ends or needs a human: the agent
   * that owns it (`execution.start`) or the one that proposed it. Never part of the digest.
   */
  reportTo?: ExecutionReportTarget;
  /** `attempt` whose terminal report was already handled. */
  reportNoticeVersion?: number;
  /** Legacy terminal-report mark from before `reportNoticeVersion`. Read for every run; still written for proposal-backed runs so a downgrade does not type their report again. */
  proposalNoticeVersion?: number;
  /** Blockers already reported to `reportTo`, so a restart neither repeats nor drops one. Newest last, at most {@link MAX_REPORTED_BLOCKER_IDS}. */
  reportedBlockerIds?: string[];
  /**
   * Set at claim on a local Composer run (principal {@link LOCAL_COMPOSER_PRINCIPAL}, no report target) so its
   * terminal Inbox result can be marked reported durably. Absent on older records, which are never replayed.
   */
  localReport?: true;
  createdAt: number;
  updatedAt: number;
  /** User hid terminal history from board; durable evidence remains retained. */
  dismissedAt?: number;
}

export interface ExecutionReportTarget {
  kind: 'pty' | 'thread';
  id: string;
  title?: string;
  role: 'owner' | 'proposer';
}

/**
 * Where a run's reports go. Records written before `reportTo` existed report to their
 * proposer; a record with neither gets no report, as before.
 */
export function executionReportTarget(record: Pick<ExecutionRecord, 'reportTo' | 'proposal'>): ExecutionReportTarget | undefined {
  if (record.reportTo) return record.reportTo;
  const proposal = record.proposal;
  return proposal ? {
    kind: proposal.proposerKind, id: proposal.proposerId, role: 'proposer',
    ...(proposal.proposerTitle ? { title: proposal.proposerTitle } : {})
  } : undefined;
}

/** Principal of a run launched from the local Composer (no proposer, no `reportTo`). */
export const LOCAL_COMPOSER_PRINCIPAL = 'interactive:local';

/** A local Composer run whose terminal result is tracked by the durable reported mark. A plan-correction stop is not a result. */
export function isLocalReportRecord(record: Pick<ExecutionRecord, 'localReport' | 'reportTo' | 'proposal' | 'timeoutReason'>): boolean {
  return record.localReport === true && !executionReportTarget(record) && record.timeoutReason !== 'plan-correction-cancelled';
}

/** The attempt whose terminal report was handled, under either key. */
export function reportedAttempt(record: Pick<ExecutionRecord, 'reportNoticeVersion' | 'proposalNoticeVersion'>): number | undefined {
  return record.reportNoticeVersion ?? record.proposalNoticeVersion;
}

export type RetainedRecoveryMode = 'exact-native' | 'fresh-plan';

/** Per-slot identity needed by a future trusted host native-session restore. */
export interface ExecutionNativeRecoverySnapshotV1 {
  version: 1;
  attempt: number;
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId?: string;
  profileId?: string;
  profileVersion?: string;
  nativeConversationId: string;
  capturedAt: number;
}

/** Trusted host's frozen automated MCP tool surface for one execution member. */
export interface ExecutionSlotMcpCatalogueProvenanceV1 {
  version: 1;
  role: 'worker' | 'orchestrator';
  capabilities: string[];
  tools: string[];
  digest: string;
}

export type ExecutionClaimInput = Omit<ExecutionRecord,
  'id' | 'teamLaunchRequestId' | 'attempt' | 'attemptStartedAt' | 'state' | 'stateVersion' | 'reportNoticeVersion' | 'proposalNoticeVersion' | 'reportedBlockerIds' | 'localReport' | 'createdAt' | 'updatedAt' | 'workUnits' | 'blockers' | 'automatedMcpCatalogueProvenance'
> & { workUnits?: ExecutionWorkUnitInput[] };

export interface ExecutionRequestSnapshotV1 {
  version: 1;
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: ExecutionPolicyV1;
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels: ResolvedModelSnapshotV1[];
  sourceBundle?: {
    contentRef: string;
    sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>;
  };
  objective?: string;
  /** Explicit execution API override. Undefined defers to project then Team defaults. */
  worktree?: boolean;
  onComplete?: 'leave' | 'merge' | 'delete';
    /** Opt-in terminal inbox notice for runs without an owner report target. */
    completionInboxNotice?: boolean;
    /** Trusted selector for an existing user-owned target; absent keeps the legacy generated-worktree flag. */
    target?: SquadExecutionTargetSelector;
}

/** Minimal durable identity for one shared squad checkout. */
export interface SquadWorktreeRecord {
  path: string;
  branch: string;
  baseBranch?: string;
  /**
   * Lifecycle owner. Absent on records written before selectors existed: only the
   * generated-worktree path wrote those, so absent is read as `managed`.
   */
  ownership?: SquadWorktreeOwnership;
  /** Selector kind that resolved a user-owned target. */
  targetKind?: SquadExecutionTargetSelector['kind'];
}

/** A user-owned target is never deleted, merged, branched, cleaned, reset, or force-deleted. */
export function isUserOwnedSquadWorktree(worktree: SquadWorktreeRecord | undefined): boolean {
  return worktree?.ownership === 'user';
}

export interface ExecutionPolicyV1 extends NonNullable<TeamLaunchRequestInput['policy']> {
  maxTurnsPerClaim?: number;
  maxClaimWallClockMs?: number;
  /** Reclaim a CLAIMED unit whose worker is alive/non-restful but has produced no
   *  OUTPUT progress (see {@link ExecutionWorkUnit.progressAt}) for this long —
   *  a tighter, progress-aware ceiling than the blunt {@link maxClaimWallClockMs}
   *  wall-clock backstop. Reclaimed only from a lease already expired (a streaming
   *  worker keeps its lease fresh and never reaches this branch). */
  maxClaimStallMs?: number;
  usageBudget?: { maxTokens?: number; maxUsd?: number };
}

/** Durable, non-capability launch boundary for crash diagnosis and reconciliation. */
export interface ExecutionLaunchIntentV1 {
  version: 1;
  authorizationContextDigest: string;
  slots: Array<{ slotId: string; personaId: string; initialTaskDigest: string; automatedSkillIds?: string[] }>;
  preparedAt: number;
}

export interface ResolvedModelSnapshotV1 {
  slotId: string;
  personaId?: string;
  provider: string;
  /** Undefined only when a native role owns its model and no model is exposed. */
  model?: string;
  reasoning?: string;
  level?: import('@zana-ai/zcc-domain/harness-adapter').ModelLevel;
  roleOwnedModel?: boolean;
  capabilities?: string[];
  modalities?: string[];
  maxContextBytes?: number;
  health?: 'available' | 'unavailable' | 'unknown';
  observedAt?: number;
  maxAgeMs?: number;
}

export interface RoutingDecisionV1 {
  workUnitId: string;
  attempt: number;
  policyVersion: 1;
  observedStateVersion: number;
  pricingCatalogId: string;
  pricingCatalogVersion: number;
  recommendedSlotId?: string;
  candidates: Array<{ slotId: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; reasons: string[]; estimatedInputUsd?: number }>;
}

export interface ExecutionEvent {
  id: string;
  executionId: string;
  attempt: number;
  sequence: number;
  state: ExecutionState;
  stateVersion?: number;
  kind?: 'reservation' | 'transition' | 'command' | 'event';
  fromState?: ExecutionState;
  toState?: ExecutionState;
  slotId?: string;
  producerRole?: 'worker' | 'orchestrator';
  eventType?: 'progress' | 'blocker' | 'failure' | 'outcome';
  attention?: boolean;
  progress?: { completed: number; total: number };
  references?: Array<{ label: string; uri: string }>;
  detail?: string;
  blocker?: { question: string; options?: string[] };
  severity: 'info' | 'warning' | 'error';
  summary: string;
  createdAt: number;
}

interface ExecutionStateFile {
  version: 1;
  revision: number;
  records: ExecutionRecord[];
  events: ExecutionEvent[];
}

export interface ExecutionStoreOptions {
  filePath: string;
  database?: ExecutionDatabase;
  /** New records use JSON only during an explicit rollout override. */
  createInJson?: boolean;
  now?: () => number;
  id?: () => string;
  maxRecords?: number;
  maxEvents?: number;
  maxEventsPerExecution?: number;
  maxUsageObservationsPerExecution?: number;
  /** Claim lease TTL; defaults to {@link WORK_CLAIM_LEASE_MS}. Injectable so an E2E can drive
   * the real reclaim/backstop path in seconds instead of the 90s production lease. */
  workClaimLeaseMs?: number;
}

export interface ActiveClaimCursor {
  updatedAt: number;
  id: string;
}

export interface ActiveClaimPage {
  records: ExecutionRecord[];
  next?: ActiveClaimCursor;
}

export interface ReclaimExpiredClaimInput {
  workUnitId: string;
  claimId: string;
  claimGeneration: number;
  reason: string;
  /** Bypass the lease-expiry floor. The wall-clock backstop (`maxClaimWallClockMs`)
   * is a state-agnostic ceiling that MUST be able to reclaim even a claim whose
   * lease is still fresh — otherwise a worker that emits output forever (renewing
   * its lease via {@link renewWorkerLease}) but never completes could never be
   * reclaimed. Lease-expiry and proven-dead reclaims leave this unset (their lease
   * is already expired, so the floor passes anyway). */
  force?: boolean;
}

const MAX_RECORDS = 2_000;
const MAX_EVENTS = 10_000;
const MAX_EVENTS_PER_EXECUTION = 500;
export const EXECUTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const EXECUTION_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_STRING = 2_048;
// A work unit's `task` carries the full executable-step Work body, so it is
// bounded far above MAX_STRING. MUST match MAX_WORK_UNIT_TASK_LEN in the
// preflight normalizer (normalizeExecutionPlan) — a smaller cap here rejects a
// legitimately-large provided plan at persist ("invalid execution state before
// persistence") that the normalizer already accepted.
const MAX_WORK_UNIT_TASK = 16_384;
const MAX_FINAL_SUMMARY = 64 * 1024;
const MAX_WORK_UNITS = 100;
export const MAX_REPORTED_BLOCKER_IDS = 100;
const MAX_UNIT_LIST = 100;
const MAX_DELIVERIES_PER_EXECUTION = 128;
const MAX_COORDINATOR_WAKES = 100;
const MAX_AUTOMATED_MCP_CATALOGUE_SLOTS = 100;
const MAX_AUTOMATED_MCP_CATALOGUE_TOOLS = 32;
export const MAX_USAGE_OBSERVATIONS_PER_EXECUTION = 1_000;
export const MAX_ROUTING_DECISIONS_PER_EXECUTION = 256;
const MAX_DELIVERY_TEXT_BYTES = 16 * 1024;
const MAX_DELIVERY_ERROR_BYTES = 1024;
export const MAX_DELIVERY_ATTEMPTS = 8;
/**
 * How many times a work unit may be reclaimed while its worker never once
 * reported a completed turn (see {@link ExecutionWorkUnit.kickoffFailures})
 * before {@link blockKickoffFailure} blocks it to a human instead of the engine
 * re-dispatching it forever. Each reclaim of a never-turned unit means a FULL
 * output-stall window (`maxClaimStallMs`, ~10 min) of total silence, so this is
 * already strong evidence of a broken kickoff, not a slow-but-working first turn
 * (which streams output, keeps its lease fresh, and is never stall-reclaimed).
 * Three confirmations before surfacing balances fast recovery against a false
 * block of a genuinely slow worker.
 */
export const KICKOFF_FAILURE_BLOCK_THRESHOLD = 3;
const DELIVERY_LEASE_MS = 60_000;
// Claim lease TTL. The host renews this from the worker's PTY output activity
// (Part B), so a streaming worker never hits it — only a SILENT worker does. A
// real worker is legitimately silent for minutes during a long tool call (build,
// tests, large read) or a long single turn, so 90s was far too tight and drove a
// dispatch↔reclaim churn that discarded near-finished work. 5 min gives real work
// room while still detecting a genuinely dead/hung worker within a bounded window
// (the wall-clock ceiling remains the backstop for a streams-forever worker).
export const WORK_CLAIM_LEASE_MS = 300_000;
export const HEARTBEAT_PERSIST_REMAINING_MS = 30_000;

function assertClaimFence(unit: ExecutionWorkUnit, claim?: { claimId: string; claimGeneration: number }, required = false): void {
  if (!unit.claimId || !required && !claim) return;
  if (!claim || unit.claimId !== claim.claimId || unit.claimGeneration !== claim.claimGeneration) throw new Error('stale work claim');
}
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const storeQueue = createSerializedTransactionQueue();
const terminalStates = TERMINAL_EXECUTION_STATES;
const failureCodes = new Set<ExecutionFailureCode>(EXECUTION_FAILURE_CODES);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING) throw new Error(`invalid execution ${label}`);
  return value;
}

function isState(value: unknown): value is ExecutionState {
  return value === 'READY' || value === 'STARTING' || value === 'RUNNING' || value === 'COMPLETED'
    || value === 'BLOCKED' || value === 'STOPPED' || value === 'FAILED';
}

function validNoticeIntent(intent: unknown): intent is ExecutionNoticeIntent {
  if (!intent || typeof intent !== 'object') return false;
  const value = intent as Partial<ExecutionNoticeIntent>;
  return validString(value.key) && validString(value.blockerId)
    && (value.status === 'PENDING' || value.status === 'ACKNOWLEDGED')
    && validNonNegativeInteger(value.attempts)
    && typeof value.nextAttemptAt === 'number' && Number.isFinite(value.nextAttemptAt)
    && (value.inboxItemId === undefined || validString(value.inboxItemId))
    && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number';
}

function validSquadWorktree(value: unknown): value is SquadWorktreeRecord {
  if (!value || typeof value !== 'object') return false;
  const worktree = value as Partial<SquadWorktreeRecord>;
  return hasOnlyKeys(value as Record<string, unknown>, ['path', 'branch', 'baseBranch', 'ownership', 'targetKind'])
    && validString(worktree.path) && worktree.path.trim().length > 0
    && validString(worktree.branch) && worktree.branch.trim().length > 0
    && (worktree.baseBranch === undefined || validString(worktree.baseBranch) && worktree.baseBranch.trim().length > 0)
    && (worktree.ownership === undefined || worktree.ownership === 'managed' || worktree.ownership === 'user')
    && (worktree.ownership === 'user'
      ? worktree.targetKind === 'project-root' || worktree.targetKind === 'worktree'
      : worktree.targetKind === undefined);
}

function validRecord(value: unknown): value is ExecutionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ExecutionRecord>;
  return validString(record.id) && validString(record.callerPrincipalId)
    && validString(record.projectId) && validString(record.teamId)
    && validString(record.jobTitle) && validString(record.requestDigest)
    && (record.launchKind === undefined || record.launchKind === 'team')
    && (record.launchDisplay === undefined || validLaunchDisplay(record.launchDisplay))
    && validString(record.launchRequestId) && validString(record.teamLaunchRequestId) && validRequestSnapshot(record.request)
    && (record.summary === undefined || validString(record.summary)) && Number.isInteger(record.attempt)
    && typeof record.attemptStartedAt === 'number' && Number.isFinite(record.attemptStartedAt)
    && isState(record.state) && Number.isInteger(record.stateVersion)
    && (record.lastEventSequence === undefined || Number.isInteger(record.lastEventSequence) && record.lastEventSequence >= 0)
    && Array.isArray(record.resolvedModels) && record.resolvedModels.every(validModelSnapshot)
    && (record.routingDecisions === undefined || Array.isArray(record.routingDecisions) && record.routingDecisions.length <= MAX_ROUTING_DECISIONS_PER_EXECUTION && record.routingDecisions.every(validRoutingDecision))
    && (record.authorizationContext === undefined || validAuthorizationContext(record.authorizationContext))
    && (record.authorizationContextDigest === undefined || validString(record.authorizationContextDigest))
    && (record.launchIntent === undefined || validLaunchIntent(record.launchIntent))
    && (record.squadWorktree === undefined || validSquadWorktree(record.squadWorktree))
    && (record.policyResult === undefined || validPolicyResult(record.policyResult))
    && (record.effectiveOwnerPrincipalIds === undefined || Array.isArray(record.effectiveOwnerPrincipalIds) && record.effectiveOwnerPrincipalIds.every(validString))
    && (record.recoveryGeneration === undefined || Number.isInteger(record.recoveryGeneration) && record.recoveryGeneration >= 0)
    && (record.recoveryDeadlineAt === undefined || typeof record.recoveryDeadlineAt === 'number' && Number.isFinite(record.recoveryDeadlineAt))
    && (record.terminalWorktreeEffectsStateVersion === undefined || validNonNegativeInteger(record.terminalWorktreeEffectsStateVersion))
    && (record.nativeRecoverySnapshots === undefined || Array.isArray(record.nativeRecoverySnapshots) && record.nativeRecoverySnapshots.length <= 100 && record.nativeRecoverySnapshots.every(validNativeRecoverySnapshot))
    && (record.automatedMcpCatalogueProvenance === undefined || validAutomatedMcpCatalogueProvenanceMap(record.automatedMcpCatalogueProvenance))
    && (record.workUnits === undefined || Array.isArray(record.workUnits) && record.workUnits.length <= MAX_WORK_UNITS && record.workUnits.every(validWorkUnit))
    && (record.blockers === undefined || Array.isArray(record.blockers) && record.blockers.length <= MAX_WORK_UNITS && record.blockers.every(validExecutionBlocker))
    && (record.deliveries === undefined || Array.isArray(record.deliveries) && record.deliveries.length <= MAX_DELIVERIES_PER_EXECUTION && record.deliveries.every(validExecutionDelivery))
    && (record.noticeIntents === undefined || Array.isArray(record.noticeIntents) && record.noticeIntents.length <= MAX_WORK_UNITS && record.noticeIntents.every(validNoticeIntent))
    && (record.blockerGraceUntil === undefined || typeof record.blockerGraceUntil === 'number' && Number.isFinite(record.blockerGraceUntil))
    && (record.timeoutReason === undefined || record.timeoutReason === 'idle' || record.timeoutReason === 'unresolved-blocker' || record.timeoutReason === 'plan-correction-cancelled')
    && (record.successorLaunchRequestId === undefined || validString(record.successorLaunchRequestId))
    && (record.successorExecutionId === undefined || validString(record.successorExecutionId))
    && (record.recoveryRequestId === undefined || validString(record.recoveryRequestId))
    && (record.finalSummary === undefined || typeof record.finalSummary === 'string' && record.finalSummary.length > 0 && record.finalSummary.length <= MAX_FINAL_SUMMARY)
    && (record.assembledResult === undefined || validAssembledResult(record.assembledResult))
    && (record.usageObservations === undefined || Array.isArray(record.usageObservations) && record.usageObservations.length <= MAX_USAGE_OBSERVATIONS_PER_EXECUTION && record.usageObservations.every(validUsageObservation))
    && (record.usageBaseline === undefined || validUsageRollup(record.usageBaseline))
    && (record.resourceBlock === undefined || validResourceBlock(record.resourceBlock))
    && (record.routeFitProposal === undefined || validRouteFitProposal(record.routeFitProposal))
    && (record.telemetryGapCount === undefined || validNonNegativeInteger(record.telemetryGapCount))
    && (record.coordinatorState === undefined || record.coordinatorState === 'ACTIVE' || record.coordinatorState === 'PARKED')
    && (record.coordinatorWakes === undefined || Array.isArray(record.coordinatorWakes) && record.coordinatorWakes.length <= MAX_COORDINATOR_WAKES && record.coordinatorWakes.every(validCoordinatorWake))
    && (record.coordinatorWakeSequence === undefined || Number.isInteger(record.coordinatorWakeSequence) && record.coordinatorWakeSequence >= 0)
    && (record.coordinationMode === undefined || record.coordinationMode === 'interactive-team' || record.coordinationMode === 'autonomous-team' || record.coordinationMode === 'job-team' || record.coordinationMode === 'structured' || record.coordinationMode === 'freeform')
    && (record.origin === undefined || record.origin === 'explicit' || record.origin === 'scheduled' || record.origin === 'goal')
    && (record.proposal === undefined || validProposal(record.proposal))
    && (record.reportTo === undefined || validReportTarget(record.reportTo))
    && (record.reportNoticeVersion === undefined || validNonNegativeInteger(record.reportNoticeVersion))
    && (record.localReport === undefined || record.localReport === true)
    && (record.proposalNoticeVersion === undefined || validNonNegativeInteger(record.proposalNoticeVersion))
    && (record.reportedBlockerIds === undefined || Array.isArray(record.reportedBlockerIds) && record.reportedBlockerIds.length <= MAX_REPORTED_BLOCKER_IDS && record.reportedBlockerIds.every(validString))
    && typeof record.createdAt === 'number' && typeof record.updatedAt === 'number'
    && (record.dismissedAt === undefined || typeof record.dismissedAt === 'number');
}

function validNativeRecoverySnapshot(value: unknown): value is ExecutionNativeRecoverySnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ExecutionNativeRecoverySnapshotV1>;
  return snapshot.version === 1 && typeof snapshot.attempt === 'number' && validNonNegativeInteger(snapshot.attempt) && snapshot.attempt >= 1
    && validString(snapshot.slotId) && (snapshot.role === 'worker' || snapshot.role === 'orchestrator')
    && (snapshot.personaId === undefined || validString(snapshot.personaId))
    && (snapshot.profileId === undefined || validString(snapshot.profileId))
    && (snapshot.profileVersion === undefined || validString(snapshot.profileVersion))
    && (snapshot.personaId !== undefined || snapshot.profileId !== undefined)
    && validString(snapshot.nativeConversationId)
    && typeof snapshot.capturedAt === 'number' && Number.isFinite(snapshot.capturedAt);
}

function validAutomatedMcpCatalogueProvenanceMap(value: unknown): value is Record<string, ExecutionSlotMcpCatalogueProvenanceV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_AUTOMATED_MCP_CATALOGUE_SLOTS
    && entries.every(([slotId, provenance]) => validString(slotId) && validAutomatedMcpCatalogueProvenance(provenance));
}

function validAutomatedMcpCatalogueProvenance(value: unknown): value is ExecutionSlotMcpCatalogueProvenanceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const provenance = value as Partial<ExecutionSlotMcpCatalogueProvenanceV1>;
  return hasOnlyKeys(value as Record<string, unknown>, ['version', 'role', 'capabilities', 'tools', 'digest'])
    && provenance.version === 1 && (provenance.role === 'worker' || provenance.role === 'orchestrator')
    && Array.isArray(provenance.capabilities) && provenance.capabilities.length <= MAX_AUTOMATED_MCP_CATALOGUE_TOOLS
    && provenance.capabilities.every(validString)
    && Array.isArray(provenance.tools) && provenance.tools.length <= MAX_AUTOMATED_MCP_CATALOGUE_TOOLS
    && provenance.tools.every(validString) && validSha256Hex(provenance.digest);
}

function equalAutomatedMcpCatalogueProvenance(
  left: ExecutionSlotMcpCatalogueProvenanceV1,
  right: ExecutionSlotMcpCatalogueProvenanceV1
): boolean {
  return left.version === right.version
    && left.role === right.role
    && left.digest === right.digest
    && left.capabilities.length === right.capabilities.length
    && left.capabilities.every((capability, index) => capability === right.capabilities[index])
    && left.tools.length === right.tools.length
    && left.tools.every((tool, index) => tool === right.tools[index]);
}

function validSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validWorkUnit(value: unknown): value is ExecutionWorkUnit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ExecutionWorkUnit>;
  return validString(unit.id) && validString(unit.title)
    && typeof unit.task === 'string' && unit.task.length > 0 && unit.task.length <= MAX_WORK_UNIT_TASK
    && Array.isArray(unit.dependencies) && unit.dependencies.length <= MAX_UNIT_LIST && unit.dependencies.every(validString)
    && (unit.preferredRole === undefined || validString(unit.preferredRole))
    && (unit.files === undefined || Array.isArray(unit.files) && unit.files.length <= MAX_UNIT_LIST && unit.files.every(validString))
    && (unit.verification === undefined || Array.isArray(unit.verification) && unit.verification.length <= MAX_UNIT_LIST && unit.verification.every(validString))
    && (unit.readOnly === undefined || typeof unit.readOnly === 'boolean')
    && (unit.routing === undefined || validRouting(unit.routing))
    && (unit.output === undefined || validOutputDeclaration(unit.output))
    && (unit.requires === undefined || validWorkUnitRequirements(unit.requires))
    && (unit.state === 'PENDING' || unit.state === 'READY' || unit.state === 'CLAIMED' || unit.state === 'BLOCKED' || unit.state === 'COMPLETED' || unit.state === 'FAILED' || unit.state === 'SKIPPED')
    && (unit.assignedSlotId === undefined || validString(unit.assignedSlotId)) && Number.isInteger(unit.attempt) && (unit.attempt ?? -1) >= 0
    && (unit.claimGeneration === undefined || validNonNegativeInteger(unit.claimGeneration))
    && (unit.claimId === undefined || validString(unit.claimId))
    && (unit.claimedBy === undefined || !!unit.claimedBy && validString(unit.claimedBy.slotId)
      && (unit.claimedBy.sessionId === undefined || validString(unit.claimedBy.sessionId))
      && (unit.claimedBy.routeId === undefined || validString(unit.claimedBy.routeId)))
    && (unit.claimedAt === undefined || typeof unit.claimedAt === 'number' && Number.isFinite(unit.claimedAt))
    && (unit.leaseExpiresAt === undefined || typeof unit.leaseExpiresAt === 'number' && Number.isFinite(unit.leaseExpiresAt))
    && (unit.heartbeatAt === undefined || typeof unit.heartbeatAt === 'number' && Number.isFinite(unit.heartbeatAt))
    && (unit.progressAt === undefined || typeof unit.progressAt === 'number' && Number.isFinite(unit.progressAt))
    && (unit.turnCount === undefined || validNonNegativeInteger(unit.turnCount))
    && (unit.kickoffFailures === undefined || validNonNegativeInteger(unit.kickoffFailures))
    && (unit.noProgressSlots === undefined || Array.isArray(unit.noProgressSlots) && unit.noProgressSlots.length <= MAX_WORK_UNITS
      && unit.noProgressSlots.every((entry) => validString(entry.slotId) && validNonNegativeInteger(entry.executionAttempt)
        && validNonNegativeInteger(entry.unitAttempt) && validNonNegativeInteger(entry.claimGeneration)
        && isNoProgressReason(entry.reason) && typeof entry.reclaimedAt === 'number' && Number.isFinite(entry.reclaimedAt)))
    && (unit.apiErrorRecovery === undefined || validWorkerApiErrorRecovery(unit.apiErrorRecovery))
    && (unit.failureCode === undefined || failureCodes.has(unit.failureCode))
    && (unit.failure === undefined || validString(unit.failure)) && (unit.result === undefined || validString(unit.result))
    && (unit.structuredResult === undefined || validStructuredJson(unit.structuredResult))
    && (unit.repairDigests === undefined || Array.isArray(unit.repairDigests) && unit.repairDigests.length <= 2 && unit.repairDigests.every(validDigest))
    && Array.isArray(unit.history) && unit.history.length <= MAX_UNIT_LIST * 10;
}

function validWorkUnitRequirements(value: unknown): value is WorkUnitRequirementsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const requires = value as WorkUnitRequirementsV1;
  if (Object.keys(requires).some((key) => key !== 'skills' && key !== 'mcpServers')) return false;
  return (requires.skills === undefined || validRequirementNames(requires.skills))
    && (requires.mcpServers === undefined || validRequirementNames(requires.mcpServers));
}

function validRequirementNames(values: unknown): values is string[] {
  return Array.isArray(values) && values.length <= 50
    && values.every((value) => typeof value === 'string' && value.trim().length >= 1 && value.length <= 256);
}

function clearClaim(unit: ExecutionWorkUnit): void {
  unit.claimId = undefined;
  unit.claimedBy = undefined;
  unit.claimedAt = undefined;
  unit.leaseExpiresAt = undefined;
  unit.heartbeatAt = undefined;
  unit.progressAt = undefined;
  unit.turnCount = undefined;
}

function resetRetainedWork(record: ExecutionRecord): void {
  for (const unit of record.workUnits ?? []) {
    if (unit.state === 'COMPLETED') continue;
    unit.state = 'PENDING';
    unit.assignedSlotId = undefined;
    unit.claimId = undefined;
    unit.claimedBy = undefined;
    unit.claimedAt = undefined;
    unit.leaseExpiresAt = undefined;
    unit.heartbeatAt = undefined;
    unit.progressAt = undefined;
    unit.turnCount = undefined;
    unit.failureCode = undefined;
    unit.failure = undefined;
    unit.result = undefined;
    unit.structuredResult = undefined;
    unit.reclaimedClaim = undefined;
    unit.noProgressSlots = undefined;
    unit.apiErrorRecovery = undefined;
  }
  record.blockers = [];
  record.deliveries = [];
  record.noticeIntents = [];
  record.timeoutReason = undefined;
  record.blockerGraceUntil = undefined;
  deriveReadiness(record, true);
}

function beginRetryAttempt(record: ExecutionRecord, timestamp: number): void {
  record.attempt += 1;
  record.teamLaunchRequestId = `${record.id}:attempt:${record.attempt}`;
  record.attemptStartedAt = timestamp;
  record.state = 'STARTING';
  record.stateVersion += 1;
  record.authorizationContext = undefined;
  record.authorizationContextDigest = undefined;
  record.launchIntent = undefined;
  record.policyResult = undefined;
  record.coordinatorState = 'ACTIVE';
  record.updatedAt = timestamp;
}

function validExecutionBlocker(value: unknown): value is ExecutionBlocker {
  if (!value || typeof value !== 'object') return false;
  const blocker = value as Partial<ExecutionBlocker>;
  return validString(blocker.id) && validString(blocker.workUnitId) && validString(blocker.slotId)
    && validString(blocker.question) && (blocker.options === undefined || Array.isArray(blocker.options) && blocker.options.length <= 20 && blocker.options.every(validString))
    && (blocker.response === undefined || validUtf8String(blocker.response, MAX_DELIVERY_TEXT_BYTES)) && typeof blocker.resolved === 'boolean'
    && typeof blocker.createdAt === 'number' && (blocker.respondedAt === undefined || typeof blocker.respondedAt === 'number')
    && (blocker.resolvedAt === undefined || typeof blocker.resolvedAt === 'number');
}

function validExecutionDelivery(value: unknown): value is ExecutionDeliveryRecord {
  if (!value || typeof value !== 'object') return false;
  const delivery = value as Partial<ExecutionDeliveryRecord>;
  return validString(delivery.id) && validString(delivery.clientRequestId) && validString(delivery.blockerId)
    && validString(delivery.workUnitId) && validString(delivery.slotId)
    && !!delivery.payload && validUtf8String(delivery.payload.text, MAX_DELIVERY_TEXT_BYTES)
    && (delivery.state === 'PENDING' || delivery.state === 'LEASED' || delivery.state === 'DELIVERED' || delivery.state === 'FAILED')
    && Number.isInteger(delivery.attempt) && (delivery.attempt ?? -1) >= 0 && (delivery.attempt ?? 0) <= MAX_DELIVERY_ATTEMPTS
    && (delivery.manualRetryCount === undefined || Number.isInteger(delivery.manualRetryCount) && delivery.manualRetryCount >= 0 && delivery.manualRetryCount <= 1)
    && (delivery.recipientPrincipalId === undefined || validString(delivery.recipientPrincipalId))
    && (delivery.recipientAuthorizationId === undefined || validString(delivery.recipientAuthorizationId))
    && (delivery.leaseId === undefined || validString(delivery.leaseId))
    && (delivery.leaseExpiresAt === undefined || typeof delivery.leaseExpiresAt === 'number')
    && (delivery.nextAttemptAt === undefined || typeof delivery.nextAttemptAt === 'number')
    && (delivery.lastError === undefined || validUtf8String(delivery.lastError, MAX_DELIVERY_ERROR_BYTES))
    && typeof delivery.createdAt === 'number' && typeof delivery.updatedAt === 'number'
    && (delivery.deliveredAt === undefined || typeof delivery.deliveredAt === 'number');
}

function validPolicyResult(value: unknown): value is WorkflowPolicyResultV1 {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<WorkflowPolicyResultV1>;
  return result.version === 1 && validString(result.executionId) && typeof result.attempt === 'number'
    && validString(result.outputDigest) && validString(result.extensionDigest) && validString(result.summary)
    && (result.status === 'PENDING' || result.status === 'PASSED' || result.status === 'BLOCKED' || result.status === 'FAILED' || result.status === 'ELIGIBLE_FOR_DELIVERY');
}

function validModelSnapshot(value: unknown): value is ResolvedModelSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ResolvedModelSnapshotV1>;
  return validString(snapshot.slotId) && validString(snapshot.provider) && (snapshot.model === undefined || validString(snapshot.model))
    && (snapshot.personaId === undefined || validString(snapshot.personaId))
    && (snapshot.reasoning === undefined || validString(snapshot.reasoning))
    && (snapshot.level === undefined || ['low', 'medium', 'high', 'extra-high'].includes(snapshot.level))
    && (snapshot.roleOwnedModel === undefined || typeof snapshot.roleOwnedModel === 'boolean')
    && (snapshot.capabilities === undefined || validStringList(snapshot.capabilities))
    && (snapshot.modalities === undefined || validStringList(snapshot.modalities))
    && (snapshot.maxContextBytes === undefined || validNonNegativeInteger(snapshot.maxContextBytes))
    && (snapshot.health === undefined || snapshot.health === 'available' || snapshot.health === 'unavailable' || snapshot.health === 'unknown')
    && (snapshot.observedAt === undefined || typeof snapshot.observedAt === 'number' && Number.isFinite(snapshot.observedAt) && snapshot.observedAt >= 0)
    && (snapshot.maxAgeMs === undefined || validNonNegativeInteger(snapshot.maxAgeMs));
}

function validRouting(value: unknown): value is WorkUnitRoutingV1 {
  if (!value || typeof value !== 'object') return false;
  const routing = value as Partial<WorkUnitRoutingV1>;
  return routing.version === 1
    && (routing.taskClass === undefined || validString(routing.taskClass))
    && (routing.minimumLevel === undefined || ['low', 'medium', 'high', 'extra-high'].includes(routing.minimumLevel))
    && (routing.requiredCapabilities === undefined || validStringList(routing.requiredCapabilities))
    && (routing.requiredModalities === undefined || validStringList(routing.requiredModalities))
    && (routing.estimatedContextBytes === undefined || validNonNegativeInteger(routing.estimatedContextBytes))
    && (routing.requiredRole === undefined || validString(routing.requiredRole))
    && (routing.preferredRole === undefined || validString(routing.preferredRole))
    && (routing.hardSlotId === undefined || validString(routing.hardSlotId));
}

function validStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_UNIT_LIST && value.every((item) => validString(item));
}

function validProposal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const proposal = value as NonNullable<ExecutionRecord['proposal']>;
  return validString(proposal.id) && validString(proposal.proposerId)
    && (proposal.proposerKind === 'pty' || proposal.proposerKind === 'thread')
    && (proposal.proposerTitle === undefined || typeof proposal.proposerTitle === 'string');
}

function validReportTarget(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as ExecutionReportTarget;
  return validString(target.id) && (target.kind === 'pty' || target.kind === 'thread')
    && (target.role === 'owner' || target.role === 'proposer')
    && (target.title === undefined || typeof target.title === 'string');
}

function validNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validRoutingDecision(value: unknown): value is RoutingDecisionV1 {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Partial<RoutingDecisionV1>;
  return validString(decision.workUnitId) && validNonNegativeInteger(decision.attempt) && decision.policyVersion === 1
    && validNonNegativeInteger(decision.observedStateVersion) && validString(decision.pricingCatalogId) && validNonNegativeInteger(decision.pricingCatalogVersion)
    && (decision.recommendedSlotId === undefined || validString(decision.recommendedSlotId))
    && Array.isArray(decision.candidates) && decision.candidates.length <= 32 && decision.candidates.every((candidate) =>
      !!candidate && validString(candidate.slotId) && (candidate.status === 'PASS' || candidate.status === 'FAIL' || candidate.status === 'UNKNOWN')
      && Array.isArray(candidate.reasons) && candidate.reasons.length <= 16 && candidate.reasons.every((reason) => validString(reason))
      && (candidate.estimatedInputUsd === undefined || typeof candidate.estimatedInputUsd === 'number' && Number.isFinite(candidate.estimatedInputUsd) && candidate.estimatedInputUsd >= 0));
}

function validUsageCounters(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const counters = value as Record<string, unknown>;
  return ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'providerCostUsd'].every((key) =>
    counters[key] === undefined || typeof counters[key] === 'number' && Number.isFinite(counters[key]) && (counters[key] as number) >= 0);
}

function validUsageObservation(value: unknown): value is ExecutionUsageObservationV1 {
  if (!value || typeof value !== 'object') return false;
  const observation = value as Partial<ExecutionUsageObservationV1>;
  return observation.version === 1 && validString(observation.observationId) && validNonNegativeInteger(observation.executionAttempt)
    && (observation.role === 'worker' || observation.role === 'orchestrator') && validString(observation.slotId) && validString(observation.sessionId)
    && (observation.workUnitId === undefined || validString(observation.workUnitId)) && validNonNegativeInteger(observation.workAttempt)
    && validNonNegativeInteger(observation.claimGeneration) && validNonNegativeInteger(observation.adapterEpoch)
    && ['delivery', 'heartbeat', 'outcome', 'reclaim', 'terminal'].includes(observation.sampleKind ?? '')
    && validNonNegativeInteger(observation.sequence) && validString(observation.provider)
    && (observation.model === undefined || validString(observation.model)) && validString(observation.routingIdentity)
    && (observation.contextTokens === undefined || validNonNegativeInteger(observation.contextTokens))
    && validUsageCounters(observation.cumulative) && validUsageCounters(observation.delta)
    && (observation.completeness === 'complete' || observation.completeness === 'partial' || observation.completeness === 'unavailable')
    && typeof observation.observedAt === 'number' && Number.isFinite(observation.observedAt)
    && (observation.gap === undefined || observation.gap === 'reset' || observation.gap === 'regression' || observation.gap === 'missing')
    && (observation.replayFingerprint === undefined || validDigest(observation.replayFingerprint));
}

function validUsageRollup(value: unknown): value is ExecutionUsageBaselineV1 {
  if (!value || typeof value !== 'object') return false;
  const rollup = value as Partial<ExecutionUsageBaselineV1>;
  return rollup.version === 1 && validUsageCounters(rollup)
    && (rollup.completeness === 'complete' || rollup.completeness === 'partial' || rollup.completeness === 'unavailable')
    && validNonNegativeInteger(rollup.observationCount) && validNonNegativeInteger(rollup.gapCount)
    && Array.isArray(rollup.byRole) && rollup.byRole.length <= 2 && rollup.byRole.every((role) => !!role && (role.role === 'worker' || role.role === 'orchestrator') && validUsageCounters(role))
    && (rollup.cursors === undefined || Array.isArray(rollup.cursors) && rollup.cursors.length <= MAX_USAGE_OBSERVATIONS_PER_EXECUTION && rollup.cursors.every((cursor) => !!cursor && validString(cursor.sessionId) && validString(cursor.provider)
      && (cursor.model === undefined || validString(cursor.model)) && validString(cursor.routingIdentity) && validNonNegativeInteger(cursor.adapterEpoch)
      && validNonNegativeInteger(cursor.sequence) && validUsageCounters(cursor.cumulative)
      && (cursor.observationId === undefined || validString(cursor.observationId))
      && (cursor.replayFingerprint === undefined || validDigest(cursor.replayFingerprint))))
    && (rollup.replays === undefined || Array.isArray(rollup.replays) && rollup.replays.length <= MAX_USAGE_OBSERVATIONS_PER_EXECUTION
      && rollup.replays.every((replay) => !!replay && validString(replay.observationId) && validDigest(replay.identity)
        && validNonNegativeInteger(replay.sequence) && validDigest(replay.fingerprint)));
}

function validResourceBlock(value: unknown): value is NonNullable<ExecutionRecord['resourceBlock']> {
  if (!value || typeof value !== 'object') return false;
  const block = value as NonNullable<ExecutionRecord['resourceBlock']>;
  return block.version === 1 && (block.kind === 'usage-budget' || block.kind === 'telemetry-unavailable')
    && validString(block.reason) && typeof block.blockedAt === 'number' && Number.isFinite(block.blockedAt);
}

function validCoordinatorWake(value: unknown): value is CoordinatorWakeV1 {
  if (!value || typeof value !== 'object') return false;
  const wake = value as Partial<CoordinatorWakeV1>;
  return wake.version === 1 && validString(wake.id) && validString(wake.key)
    && ['HUMAN_BLOCKER', 'NO_PROGRESS_EXHAUSTED', 'SEMANTIC_CONFLICT', 'POLICY_ESCALATION', 'TYPED_OUTPUT_REPAIR', 'TERMINAL_SYNTHESIS'].includes(wake.cause ?? '')
    && validString(wake.message) && (wake.workUnitId === undefined || validString(wake.workUnitId))
    && validString(wake.stateOrClaimGeneration) && typeof wake.createdAt === 'number' && Number.isFinite(wake.createdAt);
}

function validStructuredJson(value: unknown): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 64 * 1024; } catch { return false; }
}

function validAssembledResult(value: unknown): value is ExecutionAssembledResultV1 {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ExecutionAssembledResultV1>;
  return hasOnlyKeys(result as Record<string, unknown>, ['version', 'outcome', 'summary', 'units', 'failures', 'artifacts', 'policy', 'verification', 'usage', 'digest'])
    && result.version === 1 && (result.outcome === 'success' || result.outcome === 'partial' || result.outcome === 'failure')
    && typeof result.summary === 'string' && result.summary.length <= MAX_FINAL_SUMMARY && validDigest(result.digest)
    && Array.isArray(result.units) && result.units.length <= MAX_WORK_UNITS && result.units.every((unit) => !!unit && hasOnlyKeys(unit as unknown as Record<string, unknown>, ['id', 'title', 'state', 'result', 'failureCode']) && validString(unit.id) && validString(unit.title)
      && ['PENDING', 'READY', 'CLAIMED', 'BLOCKED', 'COMPLETED', 'FAILED', 'SKIPPED'].includes(unit.state)
      && (unit.result === undefined || typeof unit.result === 'string' && unit.result.length <= MAX_STRING)
      && (unit.failureCode === undefined || validString(unit.failureCode)))
    && Array.isArray(result.failures) && result.failures.length <= MAX_WORK_UNITS && result.failures.every((failure) => !!failure && hasOnlyKeys(failure as Record<string, unknown>, ['workUnitId', 'code']) && validString(failure.workUnitId) && validString(failure.code))
    && Array.isArray(result.artifacts) && result.artifacts.length <= 100 && result.artifacts.every((artifact) => !!artifact && hasOnlyKeys(artifact as Record<string, unknown>, ['name', 'mediaType', 'contentDigest']) && validString(artifact.name) && validString(artifact.mediaType) && validDigest(artifact.contentDigest))
    && (result.policy === undefined || !!result.policy && hasOnlyKeys(result.policy as Record<string, unknown>, ['status', 'summary']) && validString(result.policy.status) && validString(result.policy.summary))
    && Array.isArray(result.verification) && result.verification.length <= MAX_WORK_UNITS && result.verification.every((item) => !!item && hasOnlyKeys(item as Record<string, unknown>, ['workUnitId', 'checks']) && validString(item.workUnitId) && validStringList(item.checks))
    && validUsageRollup(result.usage);
}

function validRouteFitProposal(value: unknown): value is RouteFitProposalV1 {
  if (!value || typeof value !== 'object') return false;
  const proposal = value as Partial<RouteFitProposalV1>;
  return hasOnlyKeys(proposal as Record<string, unknown>, ['version', 'evaluatorVersion', 'active', 'outcome', 'fit', 'reason', 'evaluatedAt', 'samples', 'selected', 'proposedRouting'])
    && proposal.version === 1 && proposal.active === false && validString(proposal.evaluatorVersion)
    && ['success', 'partial', 'failure'].includes(proposal.outcome ?? '')
    && ['underpowered', 'appropriate', 'overpowered', 'indeterminate'].includes(proposal.fit ?? '')
    && validString(proposal.reason) && typeof proposal.evaluatedAt === 'number' && validNonNegativeInteger(proposal.samples)
    && Array.isArray(proposal.selected) && proposal.selected.length <= MAX_WORK_UNITS
    && proposal.selected.every((selected) => !!selected && typeof selected === 'object'
      && hasOnlyKeys(selected as Record<string, unknown>, ['workUnitId', 'slotId', 'provider', 'model'])
      && validString(selected.workUnitId) && (selected.slotId === undefined || validString(selected.slotId))
      && (selected.provider === undefined || validString(selected.provider)) && (selected.model === undefined || validString(selected.model)))
    && (proposal.proposedRouting === undefined || !!proposal.proposedRouting && typeof proposal.proposedRouting === 'object'
      && hasOnlyKeys(proposal.proposedRouting as Record<string, unknown>, ['minimumLevel'])
      && (proposal.proposedRouting.minimumLevel === undefined || ['low', 'medium', 'high', 'extra-high'].includes(proposal.proposedRouting.minimumLevel)));
}

function validRequestSnapshot(value: unknown): value is ExecutionRequestSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<ExecutionRequestSnapshotV1>;
  return request.version === 1 && (request.launchKind === undefined || request.launchKind === 'team')
    && (request.launchDisplay === undefined || validLaunchDisplay(request.launchDisplay))
    && Array.isArray(request.slots) && request.slots.length > 0
    && request.slots.every((slot) => !!slot && typeof slot === 'object'
      && validUtf8String((slot as { initialTask?: unknown }).initialTask, MAX_TEAM_INITIAL_TASK_BYTES)
      && ((slot as { automatedSkillIds?: unknown }).automatedSkillIds === undefined
        || validAutomatedSkillIds((slot as { automatedSkillIds?: unknown }).automatedSkillIds)))
    && Array.isArray(request.resolvedModels) && request.resolvedModels.every(validModelSnapshot)
    && (request.objective === undefined || validString(request.objective))
    && (request.worktree === undefined || typeof request.worktree === 'boolean')
    && (request.onComplete === undefined || ['leave', 'merge', 'delete'].includes(request.onComplete))
    && (request.completionInboxNotice === undefined || typeof request.completionInboxNotice === 'boolean')
    && (request.target === undefined || isSquadExecutionTargetSelector(request.target))
    && (request.sourceBundle === undefined || validSourceBundle(request.sourceBundle))
    && (request.policy === undefined || validExecutionPolicy(request.policy))
    && (request.workflow === undefined || typeof request.workflow === 'object');
}

function validAutomatedSkillIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64
    && value.every((skillId) => typeof skillId === 'string' && skillId.length > 0 && skillId.length <= 256);
}

function validSourceBundle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as ExecutionRequestSnapshotV1['sourceBundle'];
  return !!bundle && validString(bundle.contentRef) && Array.isArray(bundle.sources)
    && bundle.sources.every((source) => !!source && validString(source.id) && validString(source.name)
      && validString(source.mediaType) && validDigest(source.contentDigest)
      && (source.extractedTextDigest === undefined || validDigest(source.extractedTextDigest))
      && typeof source.byteSize === 'number' && source.extractionStatus === 'READY'
      && Array.isArray(source.extractionWarnings) && source.extractionWarnings.every((warning) => typeof warning === 'string'));
}

function validExecutionPolicy(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const policy = value as { maxTurnsPerClaim?: unknown; maxClaimWallClockMs?: unknown; maxClaimStallMs?: unknown; usageBudget?: { maxTokens?: unknown; maxUsd?: unknown } | null };
  const positiveInteger = (input: unknown, max: number) => Number.isInteger(input) && (input as number) > 0 && (input as number) <= max;
  return (policy.maxTurnsPerClaim === undefined || positiveInteger(policy.maxTurnsPerClaim, 10_000))
    && (policy.maxClaimWallClockMs === undefined || positiveInteger(policy.maxClaimWallClockMs, 24 * 60 * 60 * 1_000))
    && (policy.maxClaimStallMs === undefined || positiveInteger(policy.maxClaimStallMs, 24 * 60 * 60 * 1_000))
    && (policy.usageBudget === undefined || policy.usageBudget !== null && typeof policy.usageBudget === 'object'
      && (policy.usageBudget.maxTokens === undefined || positiveInteger(policy.usageBudget.maxTokens, Number.MAX_SAFE_INTEGER))
      && (policy.usageBudget.maxUsd === undefined || typeof policy.usageBudget.maxUsd === 'number' && Number.isFinite(policy.usageBudget.maxUsd) && policy.usageBudget.maxUsd > 0));
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validLaunchDisplay(value: unknown): value is ExecutionLaunchDisplayV1 {
  return !!value && typeof value === 'object' && validString((value as Partial<ExecutionLaunchDisplayV1>).label);
}

function validAuthorizationContext(value: unknown): value is TeamLaunchAuthorizationContextV1 {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<TeamLaunchAuthorizationContextV1>;
  return context.version === 1 && validString(context.principalId)
    && typeof context.authorizedAt === 'number' && typeof context.expiresAt === 'number'
    && context.expiresAt > context.authorizedAt && Array.isArray(context.slots)
    && context.slots.every((slot) => !!slot && typeof slot === 'object'
      && validString((slot as { slotId?: unknown }).slotId)
      && validString((slot as { personaId?: unknown }).personaId)
      && validString((slot as { authorizationIdDigest?: unknown }).authorizationIdDigest));
}

function validLaunchIntent(value: unknown): value is ExecutionLaunchIntentV1 {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<ExecutionLaunchIntentV1>;
  return intent.version === 1 && validString(intent.authorizationContextDigest)
    && typeof intent.preparedAt === 'number'
    && Array.isArray(intent.slots) && intent.slots.every((slot) => !!slot && typeof slot === 'object'
      && validString((slot as { slotId?: unknown }).slotId)
      && validString((slot as { personaId?: unknown }).personaId)
      && validString((slot as { initialTaskDigest?: unknown }).initialTaskDigest)
      && ((slot as { automatedSkillIds?: unknown }).automatedSkillIds === undefined
        || validAutomatedSkillIds((slot as { automatedSkillIds?: unknown }).automatedSkillIds)));
}

function validEvent(value: unknown): value is ExecutionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ExecutionEvent>;
  return validString(event.id) && validString(event.executionId)
    && Number.isInteger(event.attempt) && Number.isInteger(event.sequence) && isState(event.state)
    && (event.stateVersion === undefined || Number.isInteger(event.stateVersion))
    && (event.kind === undefined || event.kind === 'reservation' || event.kind === 'transition' || event.kind === 'command' || event.kind === 'event')
    && (event.fromState === undefined || isState(event.fromState)) && (event.toState === undefined || isState(event.toState))
    && (event.slotId === undefined || validString(event.slotId))
    && (event.producerRole === undefined || event.producerRole === 'worker' || event.producerRole === 'orchestrator')
    && (event.eventType === undefined || event.eventType === 'progress' || event.eventType === 'blocker' || event.eventType === 'failure' || event.eventType === 'outcome')
    && (event.attention === undefined || typeof event.attention === 'boolean')
    && (event.progress === undefined || validProgress(event.progress))
    && (event.references === undefined || Array.isArray(event.references) && event.references.length <= 20 && event.references.every(validReference))
    && (event.detail === undefined || validString(event.detail))
    && (event.blocker === undefined || validBlocker(event.blocker))
    && (event.severity === 'info' || event.severity === 'warning' || event.severity === 'error')
    && validString(event.summary) && typeof event.createdAt === 'number';
}

function validBlocker(value: unknown): value is { question: string; options?: string[] } {
  if (!value || typeof value !== 'object') return false;
  const blocker = value as { question?: unknown; options?: unknown };
  return validString(blocker.question) && (blocker.options === undefined
    || Array.isArray(blocker.options) && blocker.options.length <= 20 && blocker.options.every(validString));
}

function validProgress(value: unknown): value is { completed: number; total: number } {
  if (!value || typeof value !== 'object') return false;
  const progress = value as { completed: unknown; total: unknown };
  return Number.isInteger(progress.completed) && Number.isInteger(progress.total)
    && (progress.completed as number) >= 0 && (progress.total as number) >= (progress.completed as number);
}

function validReference(value: unknown): value is { label: string; uri: string } {
  if (!value || typeof value !== 'object') return false;
  const reference = value as { label?: unknown; uri?: unknown };
  return validString(reference.label) && validString(reference.uri);
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING;
}

function validUtf8String(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

export function createExecutionStore(options: ExecutionStoreOptions) {
  if (options.maxRecords !== undefined && (!Number.isInteger(options.maxRecords) || options.maxRecords < 1)) {
    throw new Error('invalid execution max records');
  }
  if (options.maxEvents !== undefined && (!Number.isInteger(options.maxEvents) || options.maxEvents < 1)) {
    throw new Error('invalid execution max events');
  }
  if (options.maxUsageObservationsPerExecution !== undefined
    && (!Number.isInteger(options.maxUsageObservationsPerExecution) || options.maxUsageObservationsPerExecution < 1)) {
    throw new Error('invalid execution max usage observations per execution');
  }
  if (options.workClaimLeaseMs !== undefined
    && (!Number.isInteger(options.workClaimLeaseMs) || options.workClaimLeaseMs < 1)) {
    throw new Error('invalid execution work claim lease');
  }
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const workClaimLeaseMs = options.workClaimLeaseMs ?? WORK_CLAIM_LEASE_MS;
  const maxRecords = Math.min(options.maxRecords ?? MAX_RECORDS, MAX_RECORDS);
  const maxUsageObservationsPerExecution = Math.min(
    options.maxUsageObservationsPerExecution ?? MAX_USAGE_OBSERVATIONS_PER_EXECUTION,
    MAX_USAGE_OBSERVATIONS_PER_EXECUTION
  );
  const maxEvents = Math.min(options.maxEvents ?? MAX_EVENTS, MAX_EVENTS);
  const maxEventsPerExecution = Math.min(options.maxEventsPerExecution ?? MAX_EVENTS_PER_EXECUTION, MAX_EVENTS_PER_EXECUTION);
  const createInJson = options.createInJson === true || options.database === undefined;
  // Ensure the store directory exists once, at construction — not on every
  // persist(). atomicDurableWrite writes tmp+rename within this directory.
  mkdirSync(dirname(options.filePath), { recursive: true });

  type StorageBackend = 'json' | 'sqlite';
  type StorageSnapshot = {
    state: ExecutionStateFile;
    /** Compatibility alias while all mutation paths retain their read snapshot. */
    hash: StorageSnapshot;
    hashes: Record<StorageBackend, string | null>;
    states: Record<StorageBackend, ExecutionStateFile>;
    owners: Map<string, StorageBackend>;
  };
  const emptyState = (): ExecutionStateFile => ({ version: 1, revision: 0, records: [], events: [] });

  function parseState(value: unknown, source: string): ExecutionStateFile {
    try {
      const parsed = value as Partial<ExecutionStateFile>;
      if (Array.isArray(parsed.records)) {
        for (const record of parsed.records) {
          if (!record || typeof record !== 'object') continue;
          if (!Array.isArray(record.deliveries)) record.deliveries = [];
          if (!Array.isArray(record.noticeIntents)) record.noticeIntents = [];
          const legacyWake = (record as ExecutionRecord & { coordinatorWake?: { message: string; createdAt: number } }).coordinatorWake;
          if (!Array.isArray(record.coordinatorWakes)) record.coordinatorWakes = legacyWake ? [{ version: 1, id: `${record.id}:wake:1`, key: `HUMAN_BLOCKER\0\0${record.state}`, cause: 'HUMAN_BLOCKER', stateOrClaimGeneration: record.state, ...legacyWake }] : [];
          record.coordinatorWakes = (record.coordinatorWakes as Array<CoordinatorWakeV1 | { id: string; message: string; createdAt: number }>).map((wake, index) => 'version' in wake ? wake : ({
            version: 1, id: wake.id, key: `HUMAN_BLOCKER\0\0legacy-${index}`, cause: 'HUMAN_BLOCKER', message: wake.message,
            stateOrClaimGeneration: `legacy-${index}`, createdAt: wake.createdAt
          }));
          record.coordinatorWakeSequence ??= record.coordinatorWakes.length;
          delete (record as ExecutionRecord & { coordinatorWake?: unknown }).coordinatorWake;
          for (const delivery of record.deliveries) delivery.manualRetryCount ??= 0;
           record.recoveryGeneration ??= 0;
           record.nativeRecoverySnapshots ??= [];
           record.usageObservations ??= [];
          const legacyRequest = record.request as ExecutionRequestSnapshotV1 & { goal?: string };
          if (legacyRequest.objective === undefined && legacyRequest.goal !== undefined) legacyRequest.objective = legacyRequest.goal;
          delete legacyRequest.goal;
           if (typeof record.createdAt === 'number') record.recoveryDeadlineAt ??= record.createdAt + EXECUTION_RECOVERY_TTL_MS;
           if (typeof record.createdAt === 'number') record.attemptStartedAt ??= record.createdAt;
        }
      }
      if (parsed.version !== 1 || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)
        || !Array.isArray(parsed.events) || !parsed.events.every(validEvent) || !Number.isInteger(parsed.revision)) {
        throw new Error('invalid shape');
      }
      return parsed as ExecutionStateFile;
    } catch (error) {
      throw new Error(`corrupt execution store (${source}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function read(): StorageSnapshot {
    const sqlite = readExecutionStoreSqliteState<ExecutionStateFile>(options.database, 'execution-store');
    const bytes = readRawFile(options.filePath);
    const states = {
      // Keep immutable owner snapshots separate from the merged mutable state.
      // Otherwise a mutation changes both sides of the persist comparison.
      json: bytes ? clone(parseState(JSON.parse(bytes.toString('utf8')), 'JSON')) : emptyState(),
      sqlite: sqlite ? clone(parseState(sqlite.value, 'SQLite')) : emptyState()
    };
    const owners = new Map<string, StorageBackend>();
    // SQLite wins an accidental duplicate so its existing execution is never hidden.
    for (const record of states.json.records) owners.set(record.id, 'json');
    for (const record of states.sqlite.records) owners.set(record.id, 'sqlite');
    const state = emptyState();
    state.records = clone([...states.sqlite.records, ...states.json.records.filter((record) => owners.get(record.id) === 'json')]);
    const eventOwner = (event: ExecutionEvent): StorageBackend | undefined => owners.get(event.executionId);
    state.events = clone([...states.sqlite.events.filter((event) => eventOwner(event) === 'sqlite'), ...states.json.events.filter((event) => eventOwner(event) === 'json')]);
    state.revision = Math.max(states.sqlite.revision, states.json.revision);
    const snapshot: StorageSnapshot = {
      state,
      hash: undefined as unknown as StorageSnapshot,
      hashes: { json: bytes ? hashBytes(bytes) : null, sqlite: sqlite?.hash ?? null },
      states,
      owners
    };
    snapshot.hash = snapshot;
    return snapshot;
  }

  function persist(state: ExecutionStateFile, snapshot: StorageSnapshot): void {
    for (const record of state.records) {
      record.deliveries ??= [];
      record.noticeIntents ??= [];
      record.deliveries = record.deliveries.filter((delivery) => {
        if (delivery.state === 'DELIVERED') return delivery.deliveredAt === undefined || now() - delivery.deliveredAt < DELIVERED_RETENTION_MS;
        if (delivery.state === 'FAILED') return now() - delivery.updatedAt < DELIVERED_RETENTION_MS;
        return true;
      });
      for (const unit of record.workUnits ?? []) unit.history = unit.history.slice(-MAX_UNIT_LIST * 10);
      const observations = record.usageObservations ?? [];
      if (observations.length > maxUsageObservationsPerExecution) {
        const compacted = observations.slice(0, observations.length - maxUsageObservationsPerExecution);
        record.usageBaseline = usageRollup(compacted, record.usageBaseline);
        record.usageObservations = observations.slice(-maxUsageObservationsPerExecution);
      } else record.usageObservations = observations;
      if ((record.blockers?.length ?? 0) > MAX_WORK_UNITS) {
        const activeBlockers = record.blockers!.filter((blocker) => !blocker.resolved);
        const resolved = record.blockers!.filter((blocker) => blocker.resolved).slice(-(MAX_WORK_UNITS - activeBlockers.length));
        record.blockers = [...resolved, ...activeBlockers];
      }
    }
    const active = state.records.filter((record) => !terminalStates.has(record.state));
    const protectedTerminalIds = new Set(state.records
      .filter((record) => terminalStates.has(record.state) && now() - record.updatedAt < EXECUTION_RETENTION_MS)
      .map((record) => record.id));
    const retainedTerminalIds = new Set(state.records
      .filter((record) => terminalStates.has(record.state) && !protectedTerminalIds.has(record.id))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxRecords)
      .map((record) => record.id));
    const retainedIds = new Set([...protectedTerminalIds, ...retainedTerminalIds, ...active.map((record) => record.id)]);
    if (maxRecords === MAX_RECORDS && protectedTerminalIds.size > maxRecords) {
      throw new Error('execution retention pressure: protected history exceeds storage limit');
    }
    state.records = state.records.filter((record) => retainedIds.has(record.id));
    state.events = compactEvents(state.events, maxEventsPerExecution, maxEvents);
    if (!state.records.every(validRecord) || !state.events.every(validEvent)) throw new Error('invalid execution state before persistence');
    const recordsByBackend: Record<StorageBackend, ExecutionRecord[]> = { json: [], sqlite: [] };
    for (const record of state.records) {
      const owner = snapshot.owners.get(record.id) ?? (createInJson ? 'json' : 'sqlite');
      recordsByBackend[owner].push(record);
    }
    const ownerForEvent = (event: ExecutionEvent): StorageBackend => {
      const owner = snapshot.owners.get(event.executionId);
      if (owner) return owner;
      if (recordsByBackend.sqlite.some((record) => record.id === event.executionId)) return 'sqlite';
      return createInJson ? 'json' : 'sqlite';
    };
    const desired: Record<StorageBackend, ExecutionStateFile> = {
      json: { version: 1, revision: snapshot.states.json.revision, records: recordsByBackend.json, events: [] },
      sqlite: { version: 1, revision: snapshot.states.sqlite.revision, records: recordsByBackend.sqlite, events: [] }
    };
    for (const event of state.events) desired[ownerForEvent(event)].events.push(event);
    for (const backend of ['json', 'sqlite'] as const) {
      const next = desired[backend];
      const previous = snapshot.states[backend];
      const changed = JSON.stringify({ version: next.version, records: next.records, events: next.events })
        !== JSON.stringify({ version: previous.version, records: previous.records, events: previous.events });
      if (!changed) continue;
      next.revision = previous.revision + 1;
      if (backend === 'sqlite') {
        if (!options.database) throw new Error('execution SQLite backend is unavailable');
        writeExecutionStoreSqliteState(options.database, 'execution-store', next, snapshot.hashes.sqlite);
      } else {
        atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(next)), { expectedHash: snapshot.hashes.json });
      }
    }
  }

  async function claim(input: ExecutionClaimInput) {
    if (input.launchKind !== undefined && input.launchKind !== 'team') throw new Error('invalid execution launch kind');
    const request = normalizeRequest(input.request);
    if (typeof input.summary === 'string' && input.summary.length > SQUAD_SUMMARY_MAX_CHARS) {
      throw new Error(squadStoredFieldTooLong('summary', input.summary.length));
    }
    const workUnits = input.workUnits === undefined ? undefined : normalizePlan(input.workUnits, isDurableCoordination(input.coordinationMode));
    if (input.launchKind !== undefined && input.launchKind !== request.launchKind) {
      throw new Error('execution launch kind disagrees with request snapshot');
    }
    if (input.launchDisplay !== undefined && !sameLaunchDisplay(input.launchDisplay, request.launchDisplay)) {
      throw new Error('execution launch display disagrees with request snapshot');
    }
    const bounded = {
      callerPrincipalId: string(input.callerPrincipalId, 'caller principal id'),
      projectId: string(input.projectId, 'project id'),
      teamId: string(input.teamId, 'team id'),
      launchKind: request.launchKind,
      ...(request.launchDisplay === undefined ? {} : { launchDisplay: request.launchDisplay }),
      jobTitle: string(input.jobTitle, 'job title'),
      ...(input.summary === undefined ? {} : { summary: string(input.summary, 'summary') }),
      requestDigest: string(input.requestDigest, 'request digest'),
      launchRequestId: string(input.launchRequestId, 'launch request id'),
      request,
      resolvedModels: input.resolvedModels.map(normalizeModelSnapshot),
      ...(workUnits ? { workUnits, blockers: [] } : {}),
      ...(input.coordinationMode ? { coordinationMode: input.coordinationMode } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.proposal ? { proposal: {
        id: string(input.proposal.id, 'proposal id'),
        proposerKind: input.proposal.proposerKind,
        proposerId: string(input.proposal.proposerId, 'proposer id'),
        ...(input.proposal.proposerTitle === undefined ? {} : { proposerTitle: string(input.proposal.proposerTitle, 'proposer title') })
      } } : {}),
      ...(input.reportTo ? { reportTo: {
        kind: input.reportTo.kind === 'thread' ? 'thread' as const : 'pty' as const,
        id: string(input.reportTo.id, 'report target id'),
        role: input.reportTo.role === 'proposer' ? 'proposer' as const : 'owner' as const,
        ...(input.reportTo.title === undefined ? {} : { title: string(input.reportTo.title, 'report target title') })
      } } : {})
    };
    const localReport = !bounded.reportTo && !bounded.proposal && bounded.callerPrincipalId === LOCAL_COMPOSER_PRINCIPAL;
    return storeQueue.run(async () => {
      const snapshot = read();
      const existing = snapshot.state.records.find((record) =>
        record.callerPrincipalId === bounded.callerPrincipalId && record.launchRequestId === bounded.launchRequestId);
      if (existing) {
        return existing.requestDigest === bounded.requestDigest
          ? { outcome: 'replay' as const, record: clone(existing) }
          : { outcome: 'conflict' as const, record: clone(existing) };
      }
      if (snapshot.state.records.filter((record) => !terminalStates.has(record.state)).length >= maxRecords) {
        throw new Error('execution active record limit reached');
      }
      const timestamp = now();
      const record: ExecutionRecord = {
        ...bounded, ...(localReport ? { localReport: true as const } : {}), id: string(id(), 'id'), teamLaunchRequestId: bounded.launchRequestId, attempt: 1, attemptStartedAt: timestamp, state: 'READY', stateVersion: 0, lastEventSequence: 0,
        deliveries: [], noticeIntents: [], recoveryGeneration: 0, recoveryDeadlineAt: timestamp + EXECUTION_RECOVERY_TTL_MS, createdAt: timestamp, updatedAt: timestamp
      };
      snapshot.state.records.push(record);
      append(snapshot.state, record, 'READY', 'info', 'Execution reserved', timestamp);
      persist(snapshot.state, snapshot);
      return { outcome: 'claimed' as const, record: clone(record) };
    });
  }

  async function transition(
    executionId: string,
    expectedStateVersion: number,
    state: ExecutionState,
    severity: ExecutionEvent['severity'],
    summary: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if (!canTransition(record.state, state)) throw new Error(`invalid execution transition ${record.state} -> ${state}`);
      if ((state === 'COMPLETED' || state === 'FAILED') && record.blockers?.some((blocker) => !blocker.resolved)) {
        throw new Error(`cannot transition to ${state} while blockers are unresolved`);
      }
      const fromState = record.state;
      const timestamp = now();
      record.state = state;
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, state, severity, string(summary, 'event summary'), timestamp, { kind: 'transition', fromState, toState: state });
      persist(snapshot.state, snapshot);
      return clone(record);
    });
  }

  async function stopForPlanCorrection(executionId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.state === 'STOPPED' && record.timeoutReason === 'plan-correction-cancelled') return clone(record);
      // Correction cancellation is a final owner decision. It wins a concurrent
      // generic stop or launch failure so neither path leaves a resumable record.
      if (record.state === 'COMPLETED') return clone(record);
      const fromState = record.state;
      record.state = 'STOPPED';
      record.timeoutReason = 'plan-correction-cancelled';
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, 'STOPPED', 'info', 'Execution cancelled during plan correction', record.updatedAt, {
        kind: fromState === 'STOPPED' ? 'event' : 'transition',
        ...(fromState === 'STOPPED' ? {} : { fromState, toState: 'STOPPED' })
      });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function setSquadWorktree(
    executionId: string,
    expectedStateVersion: number,
    squadWorktree: SquadWorktreeRecord
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (!squadWorktree || typeof squadWorktree !== 'object'
        || !hasOnlyKeys(squadWorktree as unknown as Record<string, unknown>, ['path', 'branch', 'baseBranch', 'ownership', 'targetKind'])) {
        throw new Error('invalid squad worktree record');
      }
      const reattachingWorktree = record.squadWorktree !== undefined;
      const ownership = squadWorktree.ownership ?? 'managed';
      if (ownership !== 'managed' && ownership !== 'user') throw new Error('invalid squad worktree ownership');
      if (ownership === 'user' && squadWorktree.targetKind !== 'project-root' && squadWorktree.targetKind !== 'worktree') {
        throw new Error('invalid squad worktree target kind');
      }
      if (ownership === 'managed' && squadWorktree.targetKind !== undefined) throw new Error('invalid squad worktree target kind');
      const path = string(squadWorktree.path, 'squad worktree path');
      const branch = string(squadWorktree.branch, 'squad worktree branch');
      if (!path.trim() || !branch.trim()) throw new Error('invalid squad worktree record');
      const baseBranch = squadWorktree.baseBranch === undefined
        ? undefined
        : string(squadWorktree.baseBranch, 'squad worktree base branch');
      if (baseBranch !== undefined && !baseBranch.trim()) throw new Error('invalid squad worktree record');
      if (record.squadWorktree) {
        if (record.squadWorktree.branch !== branch
          || (record.squadWorktree.ownership ?? 'managed') !== ownership) {
          throw new Error('squad worktree already differs');
        }
        if (record.squadWorktree.path === path &&
          (record.squadWorktree.baseBranch || !baseBranch)) return clone(record);
      }
      record.squadWorktree = {
        path,
        branch,
        ...(baseBranch !== undefined ? { baseBranch } : {}),
        ...(ownership === 'user' ? { ownership, targetKind: squadWorktree.targetKind } : {})
      };
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', reattachingWorktree ? 'Squad worktree reattached' : 'Squad worktree prepared', record.updatedAt, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Mark terminal worktree effects only after their whole generation completed. */
  async function markSquadWorktreeTerminalEffects(
    executionId: string,
    expectedStateVersion: number
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (!terminalStates.has(record.state) || !record.squadWorktree) throw new Error('terminal squad worktree is unavailable');
      if (record.terminalWorktreeEffectsStateVersion === expectedStateVersion) return clone(record);
      record.terminalWorktreeEffectsStateVersion = expectedStateVersion;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Record that the terminal report for `attempt` was handled. Idempotent; keyed on attempt
   * (not stateVersion, which notice acks bump), so it never bumps stateVersion.
   */
  async function markReported(executionId: string, attempt: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (!terminalStates.has(record.state) || !(executionReportTarget(record) || isLocalReportRecord(record))) throw new Error('terminal report target is unavailable');
      if (record.attempt !== attempt) throw new Error('stale execution attempt');
      if (reportedAttempt(record) === attempt) return clone(record);
      record.reportNoticeVersion = attempt;
      // A build from before reportNoticeVersion reads this key, so it does not type a proposer's report again.
      if (record.proposal) record.proposalNoticeVersion = attempt;
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Record that a human blocker was reported to the run's report target. Idempotent; keeps the
   * open blockers' ids, newest {@link MAX_REPORTED_BLOCKER_IDS}. Like {@link markReported} it never bumps stateVersion.
   */
  async function markBlockerReported(executionId: string, blockerId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (!executionReportTarget(record)) throw new Error('report target is unavailable');
      const safeBlockerId = string(blockerId, 'blocker id');
      if (!record.blockers?.some((blocker) => blocker.id === safeBlockerId)) throw new Error('execution blocker not found');
      if (record.reportedBlockerIds?.includes(safeBlockerId)) return clone(record);
      // Drop ids of blockers that are resolved or gone first, so the cap never evicts an open one.
      const open = new Set((record.blockers ?? []).filter((blocker) => !blocker.resolved).map((blocker) => blocker.id));
      const kept = (record.reportedBlockerIds ?? []).filter((id) => open.has(id));
      record.reportedBlockerIds = [...kept, safeBlockerId].slice(-MAX_REPORTED_BLOCKER_IDS);
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Terminal lifecycle action completed. Leave preserves checkout but closes its action surface. */
  async function disposeSquadWorktree(
    executionId: string,
    expectedStateVersion: number,
    disposition: 'left' | 'deleted'
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (!terminalStates.has(record.state) || !record.squadWorktree) throw new Error('terminal squad worktree is unavailable');
      if (disposition === 'deleted' && isUserOwnedSquadWorktree(record.squadWorktree)) {
        throw new Error('a user-owned squad target is never deleted');
      }
      if (disposition === 'left') record.squadWorktreeDisposition = 'left';
      else {
        record.squadWorktree = undefined;
        record.squadWorktreeDisposition = undefined;
      }
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Reserve exactly one successor request for an eligible timed-out source. */
  async function reserveTimeoutRecovery(executionId: string, expectedStateVersion: number, clientRequestId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const requestId = string(clientRequestId, 'recovery request id');
      // Same click retry replays even after reservation advanced stateVersion.
      if (record.successorLaunchRequestId && record.recoveryRequestId === requestId) return clone(record);
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.state !== 'STOPPED' || record.timeoutReason !== 'unresolved-blocker' || record.dismissedAt !== undefined) {
        throw new Error('execution recovery is not allowed');
      }
      if (record.successorLaunchRequestId) {
        if (record.recoveryRequestId !== requestId) throw new Error('execution recovery already reserved');
        return clone(record);
      }
      record.recoveryRequestId = requestId;
      record.successorLaunchRequestId = `${record.id}:recovery:${requestId}`;
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Timed-out execution recovery reserved', record.updatedAt, { kind: 'reservation' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function linkTimeoutSuccessor(executionId: string, clientRequestId: string, successorExecutionId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.recoveryRequestId !== string(clientRequestId, 'recovery request id')) throw new Error('execution recovery request mismatch');
      const successorId = string(successorExecutionId, 'successor execution id');
      if (record.successorExecutionId && record.successorExecutionId !== successorId) throw new Error('execution recovery successor conflict');
      if (record.successorExecutionId) return clone(record);
      record.successorExecutionId = successorId;
      record.stateVersion += 1; record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Timed-out execution successor linked', record.updatedAt, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * One serialized deadline decision used by watchdog and polling callers. A
   * committed blocker earns exactly one fixed grace window; repeated polls never
   * extend it. The terminal transition and its reason persist together.
   */
  async function decideDeadline(executionId: string, deadlineAt: number, blockerGraceMs: number): Promise<{ kind: 'continue' | 'grace' | 'stopped'; record: ExecutionRecord }> {
    if (!Number.isFinite(deadlineAt) || !Number.isInteger(blockerGraceMs) || blockerGraceMs < 0) throw new Error('invalid deadline decision');
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const timestamp = now();
      if (terminalStates.has(record.state) || timestamp < deadlineAt) return { kind: 'continue' as const, record: clone(record) };
      const hasBlocker = record.blockers?.some((blocker) => !blocker.resolved) ?? false;
      if (hasBlocker && blockerGraceMs > 0 && record.blockerGraceUntil === undefined) {
        record.blockerGraceUntil = timestamp + blockerGraceMs;
        record.stateVersion += 1;
        record.updatedAt = timestamp;
        append(snapshot.state, record, record.state, 'warning', 'Execution deadline paused for unresolved blocker', timestamp, { kind: 'event' });
        persist(snapshot.state, snapshot.hash);
        return { kind: 'grace' as const, record: clone(record) };
      }
      if (hasBlocker && record.blockerGraceUntil !== undefined && timestamp < record.blockerGraceUntil) {
        return { kind: 'grace' as const, record: clone(record) };
      }
      const fromState = record.state;
      record.state = 'STOPPED';
      record.timeoutReason = hasBlocker ? 'unresolved-blocker' : 'idle';
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, 'STOPPED', 'warning', hasBlocker ? 'Execution timed out with unresolved blocker' : 'Execution timed out', timestamp, { kind: 'transition', fromState, toState: 'STOPPED' });
      persist(snapshot.state, snapshot.hash);
      return { kind: 'stopped' as const, record: clone(record) };
    });
  }

  async function event(
    executionId: string,
    expectedStateVersion: number,
    severity: ExecutionEvent['severity'],
    summary: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      const timestamp = now();
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, severity, string(summary, 'event summary'), timestamp, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function command(
    executionId: string,
    expectedStateVersion: number,
    summary: string,
    slotId?: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const timestamp = now();
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', string(summary, 'event summary'), timestamp, { kind: 'command', ...(slotId === undefined ? {} : { slotId: string(slotId, 'slot id') }) });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function producerEvent(
    executionId: string,
    input: {
      id: string;
      slotId?: string;
      producerRole?: 'worker' | 'orchestrator';
      type: NonNullable<ExecutionEvent['eventType']>;
      severity: ExecutionEvent['severity'];
      summary: string;
      detail?: string;
      blocker?: { question: string; options?: string[] };
      attention?: boolean;
      progress?: { completed: number; total: number };
      references?: Array<{ label: string; uri: string }>;
    }
  ): Promise<{ outcome: 'accepted' | 'replay'; event: ExecutionEvent }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      const eventId = string(input.id, 'event id');
      const existing = snapshot.state.events.find((event) => event.executionId === record.id && event.id === eventId);
      if (existing) return { outcome: 'replay' as const, event: clone(existing) };
      if ((input.type === 'blocker') !== !!input.blocker || (input.type === 'blocker' && !validBlocker(input.blocker))) {
        throw new Error('invalid execution blocker');
      }
      const timestamp = now();
      const event: ExecutionEvent = {
        id: eventId, executionId: record.id, attempt: record.attempt,
        sequence: (record.lastEventSequence ?? nextSequence(snapshot.state, record.id) - 1) + 1, state: record.state, stateVersion: record.stateVersion,
        kind: 'event', eventType: input.type, severity: input.severity,
        summary: string(input.summary, 'event summary'), createdAt: timestamp,
        ...(input.slotId === undefined ? {} : { slotId: string(input.slotId, 'slot id') }),
        ...(input.producerRole === undefined ? {} : { producerRole: input.producerRole }),
        ...(input.detail === undefined ? {} : { detail: string(input.detail, 'event detail') }),
        ...(input.blocker === undefined ? {} : { blocker: clone(input.blocker) }),
        ...(input.attention === undefined ? {} : { attention: input.attention }),
        ...(input.progress === undefined ? {} : { progress: validProgress(input.progress) ? clone(input.progress) : (() => { throw new Error('invalid execution progress'); })() }),
        ...(input.references === undefined ? {} : { references: Array.isArray(input.references) && input.references.length <= 20 && input.references.every(validReference) ? clone(input.references) : (() => { throw new Error('invalid execution references'); })() })
      };
      record.lastEventSequence = event.sequence;
      snapshot.state.events.push(event);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, event: clone(event) };
    });
  }

  async function setPolicyResult(executionId: string, expectedStateVersion: number, policyResult: WorkflowPolicyResultV1): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if (!validPolicyResult(policyResult) || policyResult.executionId !== record.id || policyResult.attempt !== record.attempt) throw new Error('invalid execution policy result');
      record.policyResult = clone(policyResult);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, policyResult.status === 'FAILED' ? 'error' : policyResult.status === 'BLOCKED' ? 'warning' : 'info', `Optional policy: ${policyResult.status}` , record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function setAuthorizationContext(
    executionId: string,
    expectedStateVersion: number,
    authorizationContext: TeamLaunchAuthorizationContextV1,
    authorizationContextDigest: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.authorizationContext || !validAuthorizationContext(authorizationContext)) throw new Error('invalid execution authorization context');
      record.authorizationContext = clone(authorizationContext);
      record.authorizationContextDigest = string(authorizationContextDigest, 'authorization context digest');
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Team authorization context recorded', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function prepareLaunchIntent(
    executionId: string,
    expectedStateVersion: number,
    intent: Omit<ExecutionLaunchIntentV1, 'preparedAt' | 'dispatchedAt'>
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.launchIntent || !validLaunchIntent({ ...intent, version: 1, preparedAt: now() })) throw new Error('invalid execution launch intent');
      record.launchIntent = { ...clone(intent), version: 1, preparedAt: now() };
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Team launch intent prepared', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Bind a fresh owner session. `reportKind` moves an owner's report target to that session,
   * so the reports follow the agent that now owns the run; a proposer's target never moves.
   */
  async function addEffectiveOwner(executionId: string, principalId: string, reportKind?: ExecutionReportTarget['kind']): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const safePrincipalId = string(principalId, 'effective owner principal id');
      const owners = new Set(record.effectiveOwnerPrincipalIds ?? []);
      owners.add(safePrincipalId);
      record.effectiveOwnerPrincipalIds = [...owners];
      if (reportKind && record.reportTo?.role === 'owner') {
        record.reportTo = { kind: reportKind === 'thread' ? 'thread' : 'pty', id: safePrincipalId, role: 'owner', ...(record.reportTo.title === undefined ? {} : { title: record.reportTo.title }) };
      }
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Execution monitor rebound', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function removeEffectiveOwner(executionId: string, principalId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const safePrincipalId = string(principalId, 'effective owner principal id');
      record.effectiveOwnerPrincipalIds = (record.effectiveOwnerPrincipalIds ?? []).filter((owner) => owner !== safePrincipalId);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Execution monitor binding revoked', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function rotateRecoveryGeneration(executionId: string, expectedStateVersion: number, expectedGeneration: number, generation: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if ((record.recoveryGeneration ?? 0) !== expectedGeneration || generation <= expectedGeneration) {
        throw new Error('stale execution recovery generation');
      }
      record.recoveryGeneration = generation;
      record.effectiveOwnerPrincipalIds = [];
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'warning', 'Execution recovery grant rotated', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Trusted hosts capture only native restore identity. State-version CAS prevents
   * a stale slot report from replacing a newer execution generation.
   */
  async function upsertNativeRecoverySnapshot(
    executionId: string,
    expectedStateVersion: number,
    input: Omit<ExecutionNativeRecoverySnapshotV1, 'version' | 'capturedAt'> & { capturedAt?: number }
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const captured = { ...clone(input), version: 1 as const, capturedAt: input.capturedAt ?? now() };
      if (!validNativeRecoverySnapshot(captured) || captured.attempt !== record.attempt) throw new Error('invalid native recovery snapshot');
      const existing = record.nativeRecoverySnapshots ?? [];
      record.nativeRecoverySnapshots = [...existing.filter((entry) => entry.slotId !== captured.slotId), captured];
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Native recovery snapshot captured', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Record the trusted host's first automated MCP catalogue selection for a slot.
   * Retries return that exact value; any changed selection is a durable conflict.
   */
  async function recordAutomatedMcpCatalogueProvenance(
    executionId: string,
    slotId: string,
    input: Omit<ExecutionSlotMcpCatalogueProvenanceV1, 'version'>
  ): Promise<ExecutionSlotMcpCatalogueProvenanceV1> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const safeSlotId = string(slotId, 'slot id');
      const provenance = { version: 1 as const, ...clone(input) };
      if (!validAutomatedMcpCatalogueProvenance(provenance)) throw new Error('invalid automated MCP catalogue provenance');
      const existing = record.automatedMcpCatalogueProvenance?.[safeSlotId];
      if (existing) {
        if (!equalAutomatedMcpCatalogueProvenance(existing, provenance)) {
          throw new Error(`automated MCP catalogue provenance mismatch for slot ${safeSlotId}`);
        }
        return clone(existing);
      }
      if (Object.keys(record.automatedMcpCatalogueProvenance ?? {}).length >= MAX_AUTOMATED_MCP_CATALOGUE_SLOTS) {
        throw new Error('automated MCP catalogue provenance slot limit reached');
      }
      record.automatedMcpCatalogueProvenance = {
        ...record.automatedMcpCatalogueProvenance,
        [safeSlotId]: provenance
      };
      record.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(provenance);
    });
  }

  async function beginRetry(executionId: string, expectedStateVersion: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.state !== 'BLOCKED' || record.successorExecutionId) throw new Error('execution retry is not allowed');
      const fromState = record.state;
      beginRetryAttempt(record, now());
      append(snapshot.state, record, record.state, 'info', 'Execution retry started', record.updatedAt, { kind: 'transition', fromState, toState: 'STARTING' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Reset retained work and reserve its replacement launch in one terminal-state CAS. */
  async function beginRetainedRecovery(executionId: string, expectedStateVersion: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if ((record.state !== 'FAILED' && record.state !== 'STOPPED') || record.successorExecutionId
        || record.state === 'STOPPED' && record.timeoutReason === 'unresolved-blocker') throw new Error('execution retry is not allowed');
      const fromState = record.state;
      resetRetainedWork(record);
      beginRetryAttempt(record, now());
      append(snapshot.state, record, record.state, 'info', 'Execution retained recovery started', record.updatedAt, { kind: 'transition', fromState, toState: 'STARTING' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * A fresh-plan recovery invalidates only identities from prior attempts, and
   * only after its replacement launch succeeded. Current-attempt captures may
   * race the cleanup, so they are deliberately retained.
   */
  async function clearPriorNativeRecoverySnapshots(executionId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const retained = (record.nativeRecoverySnapshots ?? []).filter((entry) => entry.attempt >= record.attempt);
      if (retained.length === (record.nativeRecoverySnapshots ?? []).length) return clone(record);
      record.nativeRecoverySnapshots = retained;
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Prior native recovery snapshots cleared after fresh-plan launch', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function mutateRecord(executionId: string, expectedStateVersion: number | undefined, operation: (record: ExecutionRecord, timestamp: number) => void, summary: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (expectedStateVersion !== undefined && record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      const timestamp = now();
      operation(record, timestamp);
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', summary, timestamp, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function registerPlan(executionId: string, expectedStateVersion: number, units: ExecutionWorkUnitInput[]): Promise<ExecutionRecord> {
    if (Buffer.byteLength(JSON.stringify(units), 'utf8') > MAX_EXECUTION_PLAN_BYTES) throw new Error(`execution plan exceeds ${MAX_EXECUTION_PLAN_BYTES} bytes`);
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      // Job-team plans registered dynamically by a coordinator must meet the SAME
      // strict bar as work supplied at claim (store.ts:492): every mutating unit
      // needs a non-empty file scope and every unit needs verification. Otherwise a
      // scope-less mutating unit passes registration but `scopesOverlap` treats it
      // as overlapping every other mutation, falsely serializing the whole plan.
      const normalized = normalizePlan(units, isDurableCoordination(record.coordinationMode));
      if (record.workUnits?.length) {
        if (JSON.stringify(record.workUnits.map(stripWorkUnitState)) === JSON.stringify(normalized.map(stripWorkUnitState))) {
          return clone(record);
        }
        throw new Error('execution plan already registered with different work units');
      }
      const timestamp = now();
      record.workUnits = normalized;
      record.blockers = [];
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', 'Execution plan registered', timestamp, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function claimWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId?: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (authority.role === 'orchestrator' && assignedSlotId === undefined) throw new Error('coordinator assignment requires assigned slot id');
      const slotId = authority.role === 'worker' ? authority.slotId : string(assignedSlotId, 'assigned slot id');
      if (authority.role === 'worker' && assignedSlotId && assignedSlotId !== authority.slotId) throw new Error('worker cannot claim another slot assignment');
      // Stale coordinator retries can race a persisted completion. Same-owner
      // claims and completed work are replays, not evidence of a broken DAG.
      if (unit.state === 'COMPLETED') return;
      if (unit.state === 'CLAIMED' && unit.assignedSlotId === slotId) return;
      if (record.resourceBlock) throw new Error(record.resourceBlock.reason);
      if (unit.state !== 'READY') throw new Error('work unit is not ready');
      if (unit.assignedSlotId && unit.assignedSlotId !== slotId) throw new Error('work unit is assigned to another slot');
      if (authority.role === 'orchestrator') {
        if (slotId === authority.slotId || slotId.startsWith('orchestrator:')) throw new Error('coordinator must assign work to a worker slot');
        assertAuthorizedSlot(record, slotId);
      }
      assertScopeAvailable(record, unit);
       unit.state = 'CLAIMED';
       unit.assignedSlotId = slotId;
       unit.claimGeneration = (unit.claimGeneration ?? 0) + 1;
       unit.claimId = randomUUID();
       unit.claimedBy = { slotId };
       unit.claimedAt = timestamp;
       unit.leaseExpiresAt = timestamp + workClaimLeaseMs;
       unit.heartbeatAt = timestamp;
       unit.progressAt = timestamp;
       unit.turnCount = 0;
       unit.reclaimedClaim = undefined; // a fresh claim supersedes any reclaimed-idle window
      unit.attempt += 1;
      unit.failureCode = undefined;
      unit.failure = undefined;
      unit.history.push({ action: 'claimed', slotId, attempt: unit.attempt, at: timestamp });
    }, `Work unit claimed: ${workUnitId}`);
  }

  /**
   * Engine-driven auto-dispatch: assign every currently-READY work unit to a free
   * worker slot and return the assignments so the service can push each to its
   * live session. Generic + Rule-6-clean — a unit's `preferredRole` matches a
   * slot's opaque `personaId` (no tier/domain literal in core); with no match (or
   * none set) it round-robins onto any free worker slot. A slot is "free" when it
   * holds no CLAIMED unit; a unit whose mutating file scope overlaps one already
   * in flight (incl. one just claimed in this pass) is left READY for a later
   * cascade. Reads the live record inside the store queue — no optimistic version
   * needed, this is the engine, not a client — and bumps the version ONLY when it
    * actually assigns or writes first-time shadow evidence; later idle cascades
    * remain true no-ops (no spurious event/bump).
   */
  async function dispatchReady(executionId: string, opts?: { deprioritizeSlotId?: string; enforceRouting?: boolean }): Promise<{ record: ExecutionRecord; assignments: ExecutionDispatchAssignment[] }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const assignments: ExecutionDispatchAssignment[] = [];
      const slots = record.authorizationContext?.slots;
      if (!terminalStates.has(record.state) && !record.resourceBlock && record.workUnits?.length && slots?.length) {
        const workerSlots = slots.filter((slot) => slot.slotId !== 'orchestrator' && !slot.slotId.startsWith('orchestrator:'));
        const busy = new Set((record.workUnits ?? []).filter((unit) => unit.state === 'CLAIMED' && unit.assignedSlotId).map((unit) => unit.assignedSlotId!));
        const freeSlots = workerSlots.filter((slot) => !busy.has(slot.slotId));
        // Soft-deprioritize the slot whose completion/release triggered this
        // cascade: it just finished a turn and is still winding down, so send the
        // next unit to a genuinely-idle peer FIRST. It stays eligible (sorted
        // last, not removed) so a single-worker team still dispatches to it. An
        // explicit assignedSlotId / preferredRole match still wins over this order.
        if (opts?.deprioritizeSlotId) {
          freeSlots.sort((a, b) => Number(a.slotId === opts.deprioritizeSlotId) - Number(b.slotId === opts.deprioritizeSlotId));
        }
        const timestamp = now();
        let decisionsChanged = false;
        for (const unit of record.workUnits ?? []) {
          if (unit.state !== 'READY') continue;
          const excludedSlots = new Set((unit.noProgressSlots ?? [])
            .filter((entry) => entry.executionAttempt === record.attempt)
            .map((entry) => entry.slotId));
          let recommendation: string | undefined;
          let routeImpossible = false;
          if (unit.routing) {
            // Decision applies to assignment about to claim this unit, so use
            // next attempt value. A later no-op dispatch sees same identity.
            const decisionAttempt = unit.attempt + 1;
            const key = `${unit.id}\0${decisionAttempt}\0${unit.routing.version}`;
            const existing = record.routingDecisions?.some((decision) => `${decision.workUnitId}\0${decision.attempt}\0${decision.policyVersion}` === key);
            if (!existing) {
              const modelBySlot = new Map(record.resolvedModels.map((model) => [model.slotId, model]));
              const candidates = workerSlots.map((slot) => {
                const model = modelBySlot.get(slot.slotId);
                const eligibility = evaluateSlotEligibility(unit.routing, {
                  slotId: slot.slotId, personaId: slot.personaId, provider: model?.provider, model: model?.model,
                  level: model?.level, roleOwnedModel: model?.roleOwnedModel, capabilities: model?.capabilities,
                  modalities: model?.modalities, maxContextBytes: model?.maxContextBytes, health: model?.health,
                  observedAt: model?.observedAt, maxAgeMs: model?.maxAgeMs
                });
                return { slotId: slot.slotId, status: eligibility.status, reasons: eligibility.reasons, ...(eligibility.estimatedInputUsd === undefined ? {} : { estimatedInputUsd: eligibility.estimatedInputUsd }), pricingCatalogId: eligibility.pricingCatalogId, pricingCatalogVersion: eligibility.pricingCatalogVersion };
              });
              if (opts?.enforceRouting && candidates.length && candidates.every((candidate) => candidate.status === 'UNKNOWN')) {
                // Facts might recover on next inventory snapshot; Phase 04 owns
                // bounded refresh and timeout before this becomes terminal.
                continue;
              }
              const qualified = candidates.filter((candidate) => candidate.status === 'PASS' && freeSlots.some((slot) => slot.slotId === candidate.slotId)).sort((left, right) => {
                if (left.estimatedInputUsd === undefined && right.estimatedInputUsd !== undefined) return 1;
                if (left.estimatedInputUsd !== undefined && right.estimatedInputUsd === undefined) return -1;
                return (left.estimatedInputUsd ?? 0) - (right.estimatedInputUsd ?? 0) || left.slotId.localeCompare(right.slotId);
              });
              const decision: RoutingDecisionV1 = {
                workUnitId: unit.id, attempt: decisionAttempt, policyVersion: 1, observedStateVersion: record.stateVersion,
                pricingCatalogId: MODEL_PRICING_CATALOG_ID,
                pricingCatalogVersion: MODEL_PRICING_CATALOG_VERSION,
                ...(qualified[0] ? { recommendedSlotId: qualified[0].slotId } : {}), candidates: candidates.map(({ pricingCatalogId: _id, pricingCatalogVersion: _version, ...candidate }) => candidate)
              };
              record.routingDecisions = [...(record.routingDecisions ?? []), decision]
                .sort((left, right) => left.observedStateVersion - right.observedStateVersion || left.workUnitId.localeCompare(right.workUnitId))
                .slice(-MAX_ROUTING_DECISIONS_PER_EXECUTION);
              decisionsChanged = true;
              recommendation = decision.recommendedSlotId;
              routeImpossible = candidates.length === 0 || candidates.every((candidate) => candidate.status === 'FAIL');
            } else if (!opts?.enforceRouting) {
              const decision = record.routingDecisions?.find((candidate) => `${candidate.workUnitId}\0${candidate.attempt}\0${candidate.policyVersion}` === key);
              recommendation = decision?.recommendedSlotId;
              routeImpossible = !recommendation && (decision?.candidates.length === 0 || decision?.candidates.every((candidate) => candidate.status === 'FAIL')) === true;
            } else {
              // Shadow evidence is immutable. Enforcement must re-evaluate free
              // slots, because availability changes without incrementing attempt.
              const modelBySlot = new Map(record.resolvedModels.map((model) => [model.slotId, model]));
              const candidates = workerSlots.map((slot) => {
                const model = modelBySlot.get(slot.slotId);
                const eligibility = evaluateSlotEligibility(unit.routing!, {
                  slotId: slot.slotId, personaId: slot.personaId, provider: model?.provider, model: model?.model,
                  level: model?.level, roleOwnedModel: model?.roleOwnedModel, capabilities: model?.capabilities,
                  modalities: model?.modalities, maxContextBytes: model?.maxContextBytes, health: model?.health,
                  observedAt: model?.observedAt, maxAgeMs: model?.maxAgeMs
                });
                return { slotId: slot.slotId, status: eligibility.status, estimatedInputUsd: eligibility.estimatedInputUsd };
              });
              const qualified = candidates.filter((candidate) => candidate.status === 'PASS' && freeSlots.some((slot) => slot.slotId === candidate.slotId)).sort((left, right) => {
                if (left.estimatedInputUsd === undefined && right.estimatedInputUsd !== undefined) return 1;
                if (left.estimatedInputUsd !== undefined && right.estimatedInputUsd === undefined) return -1;
                return (left.estimatedInputUsd ?? 0) - (right.estimatedInputUsd ?? 0) || left.slotId.localeCompare(right.slotId);
              });
              recommendation = qualified[0]?.slotId;
              routeImpossible = candidates.length === 0 || candidates.every((candidate) => candidate.status === 'FAIL');
            }
          }
          if (opts?.enforceRouting && routeImpossible) {
            unit.state = 'FAILED';
            unit.failureCode = 'NO_QUALIFIED_ROUTE';
            unit.failure = 'no authorized worker slot satisfies hard routing requirements';
            unit.history.push({ action: 'failed', attempt: unit.attempt, at: timestamp, detail: unit.failure });
            deriveReadiness(record);
            continue;
          }
          if (!freeSlots.length) break;
          // Never claim a mutating unit whose file scope overlaps one already in
          // flight (incl. one just claimed in this pass) — leave it READY.
          try { assertScopeAvailable(record, unit); } catch { continue; }
          let index = -1;
          if (unit.assignedSlotId) {
            index = freeSlots.findIndex((slot) => slot.slotId === unit.assignedSlotId);
            if (index < 0) continue;
          }
          if (index < 0 && opts?.enforceRouting && unit.routing) {
            if (!recommendation) continue;
            index = freeSlots.findIndex((slot) => slot.slotId === recommendation);
            if (index < 0) continue;
          }
          if (index < 0 && unit.preferredRole) index = freeSlots.findIndex((slot) => slot.personaId === unit.preferredRole && !excludedSlots.has(slot.slotId));
          if (index < 0) index = freeSlots.findIndex((slot) => !excludedSlots.has(slot.slotId));
          if (index < 0) continue;
          const slot = freeSlots[index];
           unit.state = 'CLAIMED';
           unit.assignedSlotId = slot.slotId;
           unit.claimGeneration = (unit.claimGeneration ?? 0) + 1;
           unit.claimId = randomUUID();
           unit.claimedBy = { slotId: slot.slotId };
           unit.claimedAt = timestamp;
           unit.leaseExpiresAt = timestamp + workClaimLeaseMs;
           unit.heartbeatAt = timestamp;
           unit.progressAt = timestamp;
           unit.turnCount = 0;
          unit.attempt += 1;
          unit.failureCode = undefined;
          unit.failure = undefined;
          unit.history.push({ action: 'claimed', slotId: slot.slotId, attempt: unit.attempt, at: timestamp });
          freeSlots.splice(index, 1);
           assignments.push({ workUnitId: unit.id, slotId: slot.slotId, title: unit.title, task: unit.task, claimId: unit.claimId, claimGeneration: unit.claimGeneration, ...(unit.files?.length ? { files: unit.files } : {}) });
        }
        if (assignments.length || decisionsChanged) {
          record.coordinatorState = 'PARKED';
          // Shadow records are durable evidence. They advance version without an
          // assignment event, preserving true no-op behavior on later calls.
          record.stateVersion += 1;
          record.updatedAt = timestamp;
          if (assignments.length) append(snapshot.state, record, record.state, 'info', `Coordinator parked; auto-dispatched ${assignments.length} ready work unit(s)`, timestamp, { kind: 'command' });
          persist(snapshot.state, snapshot.hash);
        }
      }
      return { record: clone(record), assignments };
    });
  }

  async function replaceResolvedModels(executionId: string, resolvedModels: ResolvedModelSnapshotV1[]): Promise<ExecutionRecord> {
    return mutateRecord(executionId, undefined, (record) => {
      record.resolvedModels = resolvedModels.map(normalizeModelSnapshot);
    }, 'Team route facts refreshed');
  }

  async function failRouteFacts(executionId: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, undefined, (record, timestamp) => {
      for (const unit of record.workUnits ?? []) {
        if (!unit.routing || unit.state !== 'READY') continue;
        unit.state = 'FAILED';
        unit.failureCode = 'ROUTE_FACTS_UNAVAILABLE';
        unit.failure = 'authorized worker route facts could not be refreshed';
        unit.history.push({ action: 'failed', attempt: unit.attempt, at: timestamp, detail: unit.failure });
      }
      deriveReadiness(record);
    }, 'Work routing facts unavailable');
  }

  async function completeWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, result: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false, structuredResult?: unknown): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (structuredResult !== undefined && !unit.output) throw new Error('structuredResult requires a work output declaration');
      if (record.blockers?.some((blocker) => !blocker.resolved && blocker.workUnitId === workUnitId)) {
        throw new Error('work unit has unresolved blockers');
      }
      if (unit.state === 'COMPLETED') return;

      // Non-destructive completion for the sanctioned reclaim→finish race, WITHOUT
      // letting a stale worker resurrect or clobber a unit. A doc worker is routinely
      // silent for a full lease window during a long think / tool phase, so the
      // reconcile reclaims its (still-live) claim; the worker then finishes and wants
      // to complete under its now-STALE claim. The old CLAIMED-by-this-slot + fence
      // code threw that finished result away and the unit churned reclaim→redispatch
      // forever (runs b56e63f5, e531f415). We accept it — but ONLY the exact reclaimed
      // claim, and ONLY while the unit is still READY (unclaimed). The moment anything
      // newer supersedes it — a fresh claim (even to the SAME slot; slot ids are reused
      // across worker restarts), a retry, or a fresh-slot reassignment — reclaimedClaim
      // is cleared and the completion is rejected, so a stale generation can never
      // overwrite a replacement worker (the claim-generation fence still governs a live
      // CLAIMED unit) and a terminal / reassigned unit is never resurrected or stolen.
      const isWorker = authority.role === 'worker';
      if (isWorker) {
        if (unit.state === 'CLAIMED') {
          // Live claim: only the current holder, with a matching fence, may complete.
          // (service maps 'another slot' → DENIED.)
          if (unit.assignedSlotId !== authority.slotId) throw new Error('work unit is assigned to another slot');
          assertClaimFence(unit, claim, requireClaim);
        } else if (unit.state === 'READY' && unit.reclaimedClaim) {
          // Reclaimed-but-still-idle: accept the finished result from the exact claim
          // we reclaimed, provided no reassignment has re-pointed the unit elsewhere.
          const reclaimed = unit.reclaimedClaim;
          if (reclaimed.slotId !== authority.slotId) throw new Error('work unit is not claimed');
          if (unit.assignedSlotId !== undefined && unit.assignedSlotId !== authority.slotId) {
            throw new Error('work unit is assigned to another slot');
          }
          if ((requireClaim || claim) && (!claim || claim.claimId !== reclaimed.claimId || claim.claimGeneration !== reclaimed.claimGeneration)) {
            throw new Error('stale work claim');
          }
        } else {
          // Not CLAIMED and not a reclaimed-idle unit (READY-reassigned, FAILED,
          // BLOCKED, …): a stale worker must never resurrect or clobber it.
          throw new Error('work unit is not claimed');
        }
      } else {
        // Owner / coordinator: keep the strict live-claim + fence contract.
        if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
        assertClaimFence(unit, claim, requireClaim);
      }
      unit.state = 'COMPLETED';
      const slotId = unit.assignedSlotId ?? unit.reclaimedClaim?.slotId ?? authority.slotId;
      unit.reclaimedClaim = undefined;
      clearClaim(unit);
      unit.result = string(result, 'work unit result');
      if (structuredResult !== undefined) unit.structuredResult = clone(structuredResult);
      unit.history.push({ action: 'completed', slotId, attempt: unit.attempt, at: timestamp, detail: unit.result });
      deriveReadiness(record);
    }, `Work unit completed: ${workUnitId}`);
  }

  async function failWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, failure: string, failureCode: ExecutionFailureCode = 'UNKNOWN', claim?: { claimId: string; claimGeneration: number }, requireClaim = false): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (record.blockers?.some((blocker) => !blocker.resolved && blocker.workUnitId === workUnitId)) {
        throw new Error('work unit has unresolved blockers');
      }
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      assertClaimFence(unit, claim, requireClaim);
      if (!failureCodes.has(failureCode)) throw new Error('invalid execution work unit failure code');
      unit.state = 'FAILED';
      const slotId = unit.assignedSlotId;
      clearClaim(unit);
      unit.failureCode = failureCode;
      unit.failure = string(failure, 'work unit failure');
      unit.history.push({ action: 'failed', slotId, attempt: unit.attempt, at: timestamp, detail: unit.failure });
      deriveReadiness(record);
    }, `Work unit failed: ${workUnitId}`);
  }

  async function releaseWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, claim?: { claimId: string; claimGeneration: number }, requireClaim = false): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      assertClaimFence(unit, claim, requireClaim);
      unit.state = 'READY';
      unit.history.push({ action: 'released', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp });
      clearClaim(unit);
      unit.assignedSlotId = undefined;
      unit.reclaimedClaim = undefined;
    }, `Work unit released: ${workUnitId}`);
  }

  async function heartbeatWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, claim: { claimId: string; claimGeneration: number; turnCount?: number }): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      if (unit.claimId !== claim.claimId || unit.claimGeneration !== claim.claimGeneration) throw new Error('stale work claim');
      const timestamp = now();
      let changed = false;
      if (claim.turnCount !== undefined) {
        if (!validNonNegativeInteger(claim.turnCount)) throw new Error('invalid work claim turn count');
        const maxTurns = record.request.policy?.maxTurnsPerClaim;
        if (maxTurns !== undefined && claim.turnCount > maxTurns) throw new Error('work claim turn limit exceeded');
        const nextTurnCount = Math.max(unit.turnCount ?? 0, claim.turnCount);
        changed ||= nextTurnCount !== unit.turnCount;
        unit.turnCount = nextTurnCount;
        // A real completed turn proves the kickoff succeeded — clear the churn
        // counter so a later mid-work stall/reclaim is never mislabeled as a
        // never-started kickoff and cannot trip the block escape hatch.
        if (nextTurnCount > 0 && unit.kickoffFailures !== undefined) { unit.kickoffFailures = undefined; changed = true; }
      }
      if ((unit.leaseExpiresAt ?? 0) - timestamp <= HEARTBEAT_PERSIST_REMAINING_MS) {
        unit.heartbeatAt = timestamp;
        unit.leaseExpiresAt = timestamp + workClaimLeaseMs;
        changed = true;
      }
      // A cohort-authenticated worker heartbeat is genuine progress (unlike raw
      // byte output), so advance the stall clock whenever this call mutates.
      if (changed) unit.progressAt = timestamp;
      if (changed) {
        record.stateVersion += 1;
        record.updatedAt = timestamp;
        append(snapshot.state, record, record.state, 'info', `Work claim heartbeat: ${workUnitId}`, timestamp, { kind: 'command' });
        persist(snapshot.state, snapshot.hash);
      }
      return clone(record);
    });
  }

  /** Renew the lease of the unit currently CLAIMED by `slotId`, driven by host-observed
   * worker output activity (see host.ts `PtyManager` `'data'` → `renewWorkerLease`). This
   * is the engine-owned liveness signal that makes lease expiry MEAN "no worker output for
   * a full lease window" rather than "turn took longer than 90s" — a live, streaming worker
   * keeps its lease fresh and is never reclaimed as silent, while a hung one lets the lease
   * expire on its own. Unlike {@link heartbeatWork} there is no cohort authority or
   * stateVersion fence (this is not a principal mutation) and NO event append (output is
   * far too frequent to log). Cheap: only persists when the lease is within
   * {@link HEARTBEAT_PERSIST_REMAINING_MS} of expiry, so a hot output stream is a no-op. */
  async function renewWorkerLease(executionId: string, slotId: string, options?: { advanceProgress?: boolean }): Promise<ExecutionRecord | undefined> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || terminalStates.has(record.state)) return undefined;
      const unit = (record.workUnits ?? []).find((candidate) =>
        candidate.state === 'CLAIMED' && candidate.assignedSlotId === slotId && candidate.claimId !== undefined);
      if (!unit) return undefined;
      const timestamp = now();
      if ((unit.leaseExpiresAt ?? 0) - timestamp > HEARTBEAT_PERSIST_REMAINING_MS) return clone(record);
      unit.heartbeatAt = timestamp;
      unit.leaseExpiresAt = timestamp + workClaimLeaseMs;
      // Only real worker OUTPUT advances the stall clock. The agent-state renewal
      // in `reconcileActive` passes `advanceProgress: false` so a silent-but-alive
      // worker can still be stall-reclaimed even though its lease is kept fresh.
      if (options?.advanceProgress) unit.progressAt = timestamp;
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Return assignments that were never delivered in one engine-owned transaction. */
  async function releaseUndelivered(executionId: string, assignments: ExecutionDispatchAssignment[]): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (terminalStates.has(record.state) || !assignments.length) return clone(record);
      const timestamp = now();
      let released = 0;
      for (const assignment of assignments) {
        const unit = record.workUnits?.find((candidate) => candidate.id === assignment.workUnitId);
        if (unit?.state !== 'CLAIMED' || unit.assignedSlotId !== assignment.slotId) continue;
        unit.state = 'READY';
        unit.history.push({ action: 'released', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp });
        clearClaim(unit);
        unit.assignedSlotId = undefined;
        unit.reclaimedClaim = undefined;
        released += 1;
      }
      if (released) {
        record.stateVersion += 1;
        record.updatedAt = timestamp;
        append(snapshot.state, record, record.state, 'warning', `Released ${released} undelivered work assignment(s)`, timestamp, { kind: 'command' });
        persist(snapshot.state, snapshot.hash);
      }
      return clone(record);
    });
  }

  async function reclaimExpiredClaims(executionId: string, claims: readonly ReclaimExpiredClaimInput[]): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (terminalStates.has(record.state) || !claims.length) return clone(record);
      const timestamp = now();
      let reclaimed = 0;
      for (const claim of claims.slice(0, MAX_WORK_UNITS)) {
        const unit = record.workUnits?.find((candidate) => candidate.id === claim.workUnitId);
        if (!unit || unit.state !== 'CLAIMED' || unit.claimId !== claim.claimId
          || unit.claimGeneration !== claim.claimGeneration
          || ((unit.leaseExpiresAt ?? Infinity) > timestamp && !claim.force)) continue;
        // Count a reclaim of a NEVER-TURNED claim as a kickoff failure (captured
        // BEFORE clearClaim wipes turnCount). This is the churn signature the
        // engine must eventually escape via blockKickoffFailure — a worker that
        // repeatedly accepts the unit but never starts a turn is not making
        // progress, it is stuck at delivery.
        if ((unit.turnCount ?? 0) === 0) unit.kickoffFailures = (unit.kickoffFailures ?? 0) + 1;
        const holderSlotId = unit.assignedSlotId ?? unit.claimedBy?.slotId;
        if (holderSlotId && isNoProgressReason(claim.reason)) {
          const evidence = unit.noProgressSlots ?? [];
          if (!evidence.some((entry) => entry.slotId === holderSlotId && entry.executionAttempt === record.attempt)) {
            unit.noProgressSlots = [...evidence, {
              slotId: holderSlotId, executionAttempt: record.attempt, unitAttempt: unit.attempt,
              claimGeneration: unit.claimGeneration ?? 0, reason: claim.reason as NoProgressReason, reclaimedAt: timestamp
            }].slice(-MAX_WORK_UNITS);
          }
        }
        unit.state = 'READY';
        unit.history.push({ action: 'released', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: string(claim.reason, 'claim recovery reason') });
        // Durable evidence of the EXACT claim we just reclaimed. A worker that was
        // mid-flight when we reclaimed its silent claim may still finish; completeWork
        // accepts that late result ONLY from this recorded claim, and only while the
        // unit stays READY (no newer claim/assignment supersedes it).
        unit.reclaimedClaim = holderSlotId !== undefined && unit.claimId !== undefined && unit.claimGeneration !== undefined
          ? { slotId: holderSlotId, claimId: unit.claimId, claimGeneration: unit.claimGeneration }
          : undefined;
        clearClaim(unit);
        unit.assignedSlotId = undefined;
        reclaimed += 1;
      }
      if (reclaimed) {
        deriveReadiness(record);
        record.stateVersion += 1;
        record.updatedAt = timestamp;
        append(snapshot.state, record, record.state, 'warning', `Reclaimed ${reclaimed} expired work claim(s)`, timestamp, { kind: 'command' });
        persist(snapshot.state, snapshot.hash);
      }
      return clone(record);
    });
  }

  /**
   * Durably record one step of Zana's automatic recovery of a worker that stopped
   * on an API error. Store-initiated like {@link blockKickoffFailure} (no cohort
   * authority, no CAS version) and fenced on the exact claim, so a late recovery
   * decision can never touch a unit that was reclaimed or re-claimed. Appends
   * exactly ONE event.
   */
  async function recordWorkerRecovery(executionId: string, input: RecordWorkerRecoveryInput): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      const unit = findUnit(record, input.workUnitId);
      if (unit.state !== 'CLAIMED' || unit.claimId !== input.claimId || unit.claimGeneration !== input.claimGeneration
        || unit.assignedSlotId !== input.slotId) throw new WorkUnitRecoveryGuardError('work unit claim does not match the recovery');
      if (!(WORKER_RECOVERY_STEPS as readonly string[]).includes(input.step)) throw new Error('invalid worker recovery step');
      const timestamp = now();
      const detail = input.detail ? input.detail.slice(0, MAX_RECOVERY_DETAIL) : undefined;
      const errorKind = input.errorKind ? input.errorKind.slice(0, MAX_RECOVERY_KIND) : undefined;
      const errorText = input.errorText ? input.errorText.slice(0, MAX_RECOVERY_TEXT) : undefined;
      const entry = { step: input.step, at: timestamp, ...(detail ? { detail } : {}) };
      const existing = unit.apiErrorRecovery;
      if (existing && existing.claimId === input.claimId && existing.claimGeneration === input.claimGeneration) {
        existing.step = input.step;
        existing.updatedAt = timestamp;
        if (errorKind) existing.errorKind = errorKind;
        if (errorText) existing.errorText = errorText;
        if (input.deadlineAt !== undefined) existing.deadlineAt = input.deadlineAt;
        existing.steps = [...existing.steps, entry].slice(-MAX_RECOVERY_STEPS);
      } else {
        unit.apiErrorRecovery = {
          claimId: input.claimId, claimGeneration: input.claimGeneration, slotId: input.slotId, executionAttempt: record.attempt,
          step: input.step, ...(errorKind ? { errorKind } : {}), ...(errorText ? { errorText } : {}),
          startedAt: timestamp, updatedAt: timestamp, ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
          steps: [entry]
        };
      }
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      // A summary can carry a restart error message; over MAX_STRING it would fail the whole persist.
      append(snapshot.state, record, record.state, input.severity, input.summary.slice(0, MAX_STRING), timestamp,
        { kind: 'event', eventType: 'progress', slotId: input.slotId, ...(detail ? { detail } : {}) });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /**
   * Kickoff-churn escape hatch. A unit reclaimed {@link
   * KICKOFF_FAILURE_BLOCK_THRESHOLD} times while its worker never reported a
   * completed turn (`kickoffFailures`) is stuck at delivery, not making progress —
   * so instead of the engine re-dispatching it forever down the same broken path
   * ({@link dispatchReady} only ever picks READY units), transition it to BLOCKED
   * with a HUMAN-audience blocker so the run surfaces on the board / inbox as
   * needing attention (a human then fixes the worker and `retryWork`s the unit).
   * Store-initiated (no cohort authority / claim fence — a background recovery
   * decision, not a principal action) and background-swept (undefined version →
   * skips the CAS). THROWS on every no-op guard so a non-qualifying call never
   * spuriously bumps the version / appends an event / re-cascades (mirrors {@link
   * escalateBlockerToHuman}); the service caller catches and ignores.
   */
  async function blockKickoffFailure(executionId: string, workUnitId: string, apiError?: { claimId: string; claimGeneration: number }): Promise<ExecutionRecord> {
    return mutateRecord(executionId, undefined, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (unit.state === 'BLOCKED' || unit.state === 'COMPLETED' || unit.state === 'FAILED') throw new WorkUnitRecoveryGuardError('work unit is not blockable for kickoff failure');
      const recovery = unit.apiErrorRecovery;
      if (apiError) {
        if (unit.state !== 'CLAIMED' || unit.claimId !== apiError.claimId || unit.claimGeneration !== apiError.claimGeneration
          || !recovery || recovery.claimId !== apiError.claimId || recovery.claimGeneration !== apiError.claimGeneration
          || !isWorkerRecoveryActiveStep(recovery.step)) {
          throw new WorkUnitRecoveryGuardError('work unit has no API-error recovery for this claim');
        }
      } else if (!(unit.noProgressSlots ?? []).some((entry) => entry.executionAttempt === record.attempt)
        && (unit.kickoffFailures ?? 0) < KICKOFF_FAILURE_BLOCK_THRESHOLD) throw new WorkUnitRecoveryGuardError('kickoff failures below block threshold');
      const blockerId = `no-progress:${record.attempt}:${unit.id}:${unit.attempt}`;
      if (record.blockers?.some((blocker) => blocker.id === blockerId)) throw new WorkUnitRecoveryGuardError('duplicate kickoff blocker');
      const slotId = unit.assignedSlotId ?? 'engine';
      const lastError = recovery ? `${recovery.errorKind ?? 'unknown'}: ${(recovery.errorText ?? 'no details').slice(0, MAX_BLOCKER_ERROR_EXCERPT)}` : '';
      let question: string;
      if (apiError && recovery) {
        const tried = recovery.steps.flatMap((entry) => entry.step === 'nudged' ? [`nudged it at ${formatRecoveryClock(entry.at)}`]
          : entry.step === 'restarted' ? [`restarted its session at ${formatRecoveryClock(entry.at)}`]
          : entry.step === 'restart-failed' ? [`could not restart its session at ${formatRecoveryClock(entry.at)}`] : []);
        const what = tried.length ? tried.join(' and ') : 'did not retry it because this kind of error is not temporary';
        // A long unit title must not push the question past MAX_STRING, which would fail the persist and leave the unit unblocked.
        question = `Work unit \`${unit.id}\` (${unit.title}) stopped after an API error on ${slotId} and did not recover. Zana ${what}. Last error: ${lastError}. Check the worker terminal, then retry the unit or restart the run.`.slice(0, MAX_STRING);
        recovery.step = 'exhausted';
        recovery.updatedAt = timestamp;
        recovery.steps = [...recovery.steps, { step: 'exhausted' as const, at: timestamp }].slice(-MAX_RECOVERY_STEPS);
      } else {
        const earlier = recovery && recovery.executionAttempt === record.attempt
          ? ` Earlier, Zana tried to recover ${recovery.slotId} after an API error: ${recovery.steps.map((entry) => entry.step).join(', ')}. Last error: ${lastError}.`
          : '';
        question = `Work unit ${unit.id}${unit.title ? ` (${unit.title})` : ''} made no progress on every eligible worker slot; its worker never started a turn.${earlier} Check the worker terminal, then retry the unit or restart the run.`;
        if (earlier) question = question.slice(0, MAX_STRING);
      }
      unit.state = 'BLOCKED';
      unit.history.push({ action: 'blocked', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: apiError ? 'stopped after an API error' : 'kickoff delivery produced no worker turn' });
      clearClaim(unit);
      unit.assignedSlotId = undefined;
      record.blockers ??= [];
      record.blockers.push({ id: blockerId, workUnitId: unit.id, slotId, question, audience: 'human', resolved: false, createdAt: timestamp });
      record.state = 'BLOCKED';
    }, `Work unit blocked after ${apiError ? 'an unrecovered API error' : 'repeated kickoff failure'}: ${workUnitId}`);
  }

  /**
   * Kickoff-churn SELF-HEAL, tried BEFORE {@link blockKickoffFailure}. A unit that
   * has churned {@link KICKOFF_FAILURE_BLOCK_THRESHOLD} times on one worker slot is
   * re-homed onto a DIFFERENT authorized worker slot it has not been dispatched to
   * yet — a slot-specific delivery failure (a wedged/broken worker) may simply not
   * recur on a fresh peer, so the engine reassigns before ever asking a human. The
   * "already tried" set is read from the unit's own `claimed` history (the durable
   * record of which slots it has run on). The fresh slot gets a FRESH kickoff budget
   * (`kickoffFailures` reset) so the prior slot's failures don't immediately re-block
   * it. Store-initiated (no cohort authority — a background recovery decision, like
   * {@link blockKickoffFailure}) and background-swept (undefined version → no CAS).
   * THROWS on every no-op guard (not READY / below threshold / NO untried slot left)
   * so the service caller falls through to the human block; a single-worker team or
   * a unit that has already tried every slot always throws here and blocks.
   */
  async function reassignKickoffToFreshSlot(executionId: string, workUnitId: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, undefined, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'READY') throw new WorkUnitRecoveryGuardError('work unit is not reassignable for kickoff failure');
      if (!(unit.noProgressSlots ?? []).some((entry) => entry.executionAttempt === record.attempt)
        && (unit.kickoffFailures ?? 0) < KICKOFF_FAILURE_BLOCK_THRESHOLD) throw new WorkUnitRecoveryGuardError('kickoff failures below block threshold');
      const workerSlots = (record.authorizationContext?.slots ?? []).filter(
        (slot) => slot.slotId !== 'orchestrator' && !slot.slotId.startsWith('orchestrator:')
      );
      const tried = new Set([...
        unit.history.filter((entry) => entry.action === 'claimed' && entry.slotId).map((entry) => entry.slotId!),
        ...(unit.noProgressSlots ?? []).filter((entry) => entry.executionAttempt === record.attempt).map((entry) => entry.slotId)
      ]);
      const fresh = workerSlots.find((slot) => !tried.has(slot.slotId));
      if (!fresh) throw new WorkUnitRecoveryGuardError('no untried worker slot for kickoff reassignment');
      unit.assignedSlotId = fresh.slotId;
      unit.kickoffFailures = undefined;
      unit.reclaimedClaim = undefined; // re-homed to a different slot — the prior worker can no longer complete it
      unit.history.push({ action: 'retried', slotId: fresh.slotId, attempt: unit.attempt, at: timestamp, detail: 'kickoff reassigned to fresh worker slot' });
    }, `Work unit reassigned to fresh slot after kickoff failure: ${workUnitId}`);
  }

  async function retryWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId?: string): Promise<ExecutionRecord> {
    if (authority.role !== 'orchestrator') throw new Error('only coordinator can retry work');
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      if (record.resourceBlock) throw new Error(record.resourceBlock.reason);
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'FAILED' && unit.state !== 'BLOCKED') throw new Error('work unit retry is not allowed');
      // Never pre-empt an in-flight human answer. A PENDING/LEASED delivery for
      // this unit's unresolved blocker is still recoverable by the at-least-once
      // outbox + drain re-announce (and lease rebind on recovery); resolving the
      // blocker here would discard the human's answer and force the worker to
      // re-ask. Only a delivery-exhausted (FAILED) or delivery-free blocker may
      // be retried — while a delivery is in flight the human can still force an
      // answer via respondToBlocker/resumeBlocker or the board "retry delivery".
      if (unit.state === 'BLOCKED' && (record.deliveries ?? []).some((delivery) =>
        (delivery.state === 'PENDING' || delivery.state === 'LEASED')
        && (record.blockers ?? []).some((blocker) =>
          blocker.id === delivery.blockerId && !blocker.resolved && blocker.workUnitId === unit.id))) {
        throw new Error('work unit has an in-flight blocker response; retry the delivery or wait for acknowledgement');
      }
      if (assignedSlotId) assertAuthorizedSlot(record, assignedSlotId);
      unit.state = 'READY';
      unit.assignedSlotId = assignedSlotId ? string(assignedSlotId, 'assigned slot id') : undefined;
      unit.failureCode = undefined;
      unit.failure = undefined;
      unit.reclaimedClaim = undefined; // a retry is a fresh assignment — drop any reclaimed-idle completion window
      // A human retry gives a fresh kickoff budget: they have (or will) fix the
      // worker, so a prior kickoff-churn block must not immediately re-block.
      unit.kickoffFailures = undefined;
      unit.noProgressSlots = undefined;
      unit.apiErrorRecovery = undefined;
      unit.history.push({ action: 'retried', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp });
      for (const blocker of record.blockers ?? []) {
        if (blocker.workUnitId === unit.id && !blocker.resolved) {
          blocker.resolved = true;
          blocker.resolvedAt = timestamp;
          failActiveDeliveries(record, blocker.id, 'blocker resolved by work retry', timestamp);
        }
      }
      record.state = record.blockers?.some((blocker) => !blocker.resolved) ? 'BLOCKED' : 'RUNNING';
      deriveReadiness(record, true);
    }, `Work unit retry ready: ${workUnitId}`);
  }

  async function reassignWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId: string): Promise<ExecutionRecord> {
    if (authority.role !== 'orchestrator') throw new Error('only coordinator can reassign work');
    return mutateRecord(executionId, expectedStateVersion, (record) => {
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'READY') throw new Error('work unit reassignment is not allowed');
      assertAuthorizedSlot(record, assignedSlotId);
      unit.assignedSlotId = string(assignedSlotId, 'assigned slot id');
      unit.reclaimedClaim = undefined; // reassigned — the prior worker can no longer complete it
    }, `Work unit reassigned: ${workUnitId}`);
  }

  async function blockWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, input: { id: string; question: string; options?: string[]; audience?: 'human' | 'coordinator' }, claim?: { claimId: string; claimGeneration: number }, requireClaim = false): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      assertClaimFence(unit, claim, requireClaim);
      if (record.blockers?.some((blocker) => blocker.id === input.id)) throw new Error('duplicate execution blocker id');
      unit.state = 'BLOCKED';
      unit.history.push({ action: 'blocked', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: string(input.question, 'blocker question') });
      clearClaim(unit);
      record.blockers ??= [];
      record.blockers.push({ id: string(input.id, 'blocker id'), workUnitId: unit.id, slotId: authority.slotId, question: string(input.question, 'blocker question'), ...(input.options ? { options: input.options.map((option) => string(option, 'blocker option')) } : {}), ...(input.audience === 'coordinator' ? { audience: 'coordinator' as const } : {}), resolved: false, createdAt: timestamp });
      if (input.audience !== 'coordinator') {
        record.noticeIntents ??= [];
        record.noticeIntents.push({ key: `execution-blocker:${record.id}:${input.id}`, blockerId: string(input.id, 'blocker id'), status: 'PENDING', attempts: 0, nextAttemptAt: timestamp, createdAt: timestamp, updatedAt: timestamp });
      }
      record.state = 'BLOCKED';
    }, `Work unit blocked: ${workUnitId}`);
  }

  /**
   * Flip a stuck `'coordinator'` self-heal blocker to `'human'` and stamp
   * `escalatedAt`. Background-swept (no caller stateVersion → mutateRecord's
   * `undefined` version skips the CAS). Idempotent by guard: throws if the
   * blocker is missing/resolved/already-escalated or was never coordinator-audience,
   * so the sweep only ever escalates a genuinely stuck coordinator ask exactly once.
   */
  async function escalateBlockerToHuman(executionId: string, blockerId: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, undefined, (record, timestamp) => {
      const blocker = findBlocker(record, blockerId);
      if (blocker.resolved) throw new Error('execution blocker is resolved');
      if (blocker.audience !== 'coordinator') throw new Error('only a coordinator-audience blocker escalates to human');
      if (blocker.escalatedAt !== undefined) throw new Error('execution blocker already escalated');
      blocker.audience = 'human';
      blocker.escalatedAt = timestamp;
      record.noticeIntents ??= [];
      if (!record.noticeIntents.some((intent) => intent.blockerId === blocker.id)) {
        record.noticeIntents.push({ key: `execution-blocker:${record.id}:${blocker.id}`, blockerId: blocker.id, status: 'PENDING', attempts: 0, nextAttemptAt: timestamp, createdAt: timestamp, updatedAt: timestamp });
      }
    }, `Coordinator blocker escalated to human: ${blockerId}`);
  }

  async function acknowledgeNotice(executionId: string, key: string, inboxItemId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const timestamp = now();
      const intent = record.noticeIntents?.find((candidate) => candidate.key === string(key, 'notice key'));
      if (!intent) throw new Error('execution notice intent not found');
      if (intent.status !== 'ACKNOWLEDGED') {
        intent.status = 'ACKNOWLEDGED'; intent.inboxItemId = string(inboxItemId, 'inbox item id'); intent.attempts += 1; intent.updatedAt = timestamp;
        record.stateVersion += 1; record.updatedAt = timestamp;
        append(snapshot.state, record, record.state, 'info', 'Execution blocker notice acknowledged', timestamp, { kind: 'event' });
        persist(snapshot.state, snapshot.hash);
      }
      return clone(record);
    });
  }

  async function deferNotice(executionId: string, key: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const timestamp = now();
      const intent = record.noticeIntents?.find((candidate) => candidate.key === string(key, 'notice key'));
      if (!intent || intent.status !== 'PENDING') return clone(record);
      intent.attempts += 1;
      intent.nextAttemptAt = timestamp + Math.min(60_000, 1_000 * 2 ** Math.min(intent.attempts, 6));
      intent.updatedAt = timestamp;
      record.stateVersion += 1; record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'warning', 'Execution blocker notice deferred', timestamp, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function cancelNotice(executionId: string, key: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const timestamp = now();
      const keyValue = string(key, 'notice key');
      const index = record.noticeIntents?.findIndex((candidate) => candidate.key === keyValue) ?? -1;
      if (index < 0 || record.noticeIntents![index]!.status !== 'PENDING') return clone(record);
      record.noticeIntents!.splice(index, 1);
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', 'Execution blocker notice cancelled', timestamp, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function listPendingNotices(limit = 100): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records
      .filter((record) => record.noticeIntents?.some((intent) => intent.status === 'PENDING'))
      .slice(0, Math.max(1, Math.min(limit, 100)))));
  }

  async function enqueueBlockerDelivery(
    executionId: string,
    expectedStateVersion: number,
    input: { clientRequestId: string; blockerId: string; text: string }
  ): Promise<{ outcome: 'accepted' | 'replay'; delivery: ExecutionDeliveryRecord; record: ExecutionRecord }> {
    const clientRequestId = string(input.clientRequestId, 'delivery client request id');
    const blockerId = string(input.blockerId, 'blocker id');
    if (!validUtf8String(input.text, MAX_DELIVERY_TEXT_BYTES)) throw new Error('delivery payload exceeds 16384 bytes');
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      record.deliveries ??= [];
      record.deliveries = record.deliveries.filter((delivery) => {
        if (delivery.state === 'DELIVERED') return delivery.deliveredAt === undefined || now() - delivery.deliveredAt < DELIVERED_RETENTION_MS;
        if (delivery.state === 'FAILED') return now() - delivery.updatedAt < DELIVERED_RETENTION_MS;
        return true;
      });
      const existing = record.deliveries.find((delivery) => delivery.clientRequestId === clientRequestId);
      if (existing) {
        if (existing.blockerId !== blockerId || existing.payload.text !== input.text) throw new Error('delivery client request conflict');
        return { outcome: 'replay' as const, delivery: clone(existing), record: clone(record) };
      }
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const blocker = findBlocker(record, blockerId);
      if (blocker.resolved) throw new Error('execution blocker is resolved');
      if (record.deliveries.some((delivery) => delivery.blockerId === blockerId && (delivery.state === 'PENDING' || delivery.state === 'LEASED'))) {
        throw new Error('execution blocker already has an active delivery');
      }
      if (record.deliveries.length >= MAX_DELIVERIES_PER_EXECUTION) {
        throw new Error('execution delivery outbox limit reached');
      }
      const timestamp = now();
      const delivery: ExecutionDeliveryRecord = {
        id: string(id(), 'delivery id'), clientRequestId, blockerId, workUnitId: blocker.workUnitId,
        slotId: blocker.slotId, payload: { text: input.text }, state: 'PENDING', attempt: 0,
        createdAt: timestamp, updatedAt: timestamp
      };
      record.deliveries.push(delivery);
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', `Execution blocker response accepted: ${blockerId}`, timestamp, { kind: 'command', slotId: blocker.slotId });
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, delivery: clone(delivery), record: clone(record) };
    });
  }

  async function pullBlockerDelivery(binding: ExecutionCohortAuthority & { executionId: string; projectId: string; principalId?: string; authorizationId?: string }): Promise<ExecutionDeliveryRecord | undefined> {
    if (binding.role !== 'worker' && binding.role !== 'orchestrator') return undefined;
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === binding.executionId && candidate.projectId === binding.projectId);
      if (!record || terminalStates.has(record.state)) return undefined;
      record.deliveries ??= [];
      const timestamp = now();
      const activeLease = record.deliveries.find((delivery) => delivery.slotId === binding.slotId && delivery.state === 'LEASED' && (delivery.leaseExpiresAt ?? 0) > timestamp);
      if (activeLease) {
        if (binding.principalId && (activeLease.recipientPrincipalId !== binding.principalId
          || activeLease.recipientAuthorizationId !== binding.authorizationId)) return undefined;
        return clone(activeLease);
      }
      let leaseExpired = false;
      for (const delivery of record.deliveries) {
        if (delivery.state === 'LEASED' && (delivery.leaseExpiresAt ?? 0) <= timestamp) {
          delivery.state = delivery.attempt >= MAX_DELIVERY_ATTEMPTS ? 'FAILED' : 'PENDING';
          delivery.recipientPrincipalId = undefined;
          delivery.recipientAuthorizationId = undefined;
          delivery.leaseId = undefined;
          delivery.leaseExpiresAt = undefined;
          delivery.updatedAt = timestamp;
          leaseExpired = true;
        }
      }
      const delivery = record.deliveries.find((candidate) => candidate.slotId === binding.slotId && candidate.state === 'PENDING' && (candidate.nextAttemptAt ?? 0) <= timestamp);
      if (!delivery) {
        if (leaseExpired) persist(snapshot.state, snapshot.hash);
        return undefined;
      }
      if (binding.principalId && delivery.recipientPrincipalId && (delivery.recipientPrincipalId !== binding.principalId
        || delivery.recipientAuthorizationId !== binding.authorizationId)) return undefined;
      if (binding.principalId) delivery.recipientPrincipalId = binding.principalId;
      if (binding.authorizationId) delivery.recipientAuthorizationId = binding.authorizationId;
      delivery.state = 'LEASED';
      delivery.attempt += 1;
      delivery.leaseId = string(id(), 'delivery lease id');
      delivery.leaseExpiresAt = timestamp + DELIVERY_LEASE_MS;
      delivery.updatedAt = timestamp;
      persist(snapshot.state, snapshot.hash);
      return clone(delivery);
    });
  }

  async function ackBlockerDelivery(
    binding: ExecutionCohortAuthority & { executionId: string; projectId: string; principalId?: string; authorizationId?: string },
    deliveryId: string,
    leaseId: string,
    result: { delivered: boolean; error?: string }
  ): Promise<{ outcome: 'accepted' | 'replay'; delivery: ExecutionDeliveryRecord; record: ExecutionRecord }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === binding.executionId && candidate.projectId === binding.projectId);
      const delivery = record?.deliveries?.find((candidate) => candidate.id === string(deliveryId, 'delivery id'));
      if (!record || (binding.role !== 'worker' && binding.role !== 'orchestrator') || !delivery || delivery.slotId !== binding.slotId
        || binding.principalId && delivery.recipientPrincipalId !== binding.principalId
        || binding.authorizationId && delivery.recipientAuthorizationId !== binding.authorizationId) throw new Error('delivery route is not authorized');
      if (delivery.state === 'DELIVERED') return { outcome: 'replay' as const, delivery: clone(delivery), record: clone(record) };
      if (delivery.state === 'FAILED') throw new Error('delivery is no longer active');
      assertActive(record);
      if (delivery.state !== 'LEASED' || delivery.leaseId !== leaseId || (delivery.leaseExpiresAt ?? 0) <= now()) throw new Error('delivery lease is not current');
      const timestamp = now();
      delivery.leaseId = undefined;
      delivery.leaseExpiresAt = undefined;
      delivery.updatedAt = timestamp;
      if (result.delivered) {
        delivery.state = 'DELIVERED';
        delivery.deliveredAt = timestamp;
        delivery.nextAttemptAt = undefined;
        delivery.lastError = undefined;
        const blocker = findBlocker(record, delivery.blockerId);
        if (blocker.workUnitId !== delivery.workUnitId || blocker.slotId !== delivery.slotId) throw new Error('delivery blocker binding changed');
        blocker.response = delivery.payload.text;
        blocker.respondedAt = timestamp;
        blocker.resolved = true;
        blocker.resolvedAt = timestamp;
        const unit = findUnit(record, blocker.workUnitId);
        unit.state = unit.assignedSlotId ? 'CLAIMED' : 'READY';
        record.state = record.blockers?.some((candidate) => !candidate.resolved) ? 'BLOCKED' : 'RUNNING';
      } else {
        delivery.lastError = truncateUtf8(result.error?.trim() || 'delivery failed', MAX_DELIVERY_ERROR_BYTES);
        if (delivery.attempt >= MAX_DELIVERY_ATTEMPTS) {
          delivery.state = 'FAILED';
          delivery.nextAttemptAt = undefined;
        } else {
          delivery.state = 'PENDING';
          delivery.nextAttemptAt = timestamp + Math.min(300_000, 1_000 * 2 ** (delivery.attempt - 1));
        }
      }
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, result.delivered ? 'info' : 'warning', result.delivered
        ? `Execution blocker response delivered: ${delivery.blockerId}` : `Execution blocker response delivery failed: ${delivery.blockerId}`, timestamp, { kind: 'command', slotId: delivery.slotId });
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, delivery: clone(delivery), record: clone(record) };
    });
  }

  async function retryBlockerDelivery(
    executionId: string,
    expectedStateVersion: number,
    blockerId: string,
    deliveryId: string
  ): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const blocker = findBlocker(record, blockerId);
      const delivery = record.deliveries?.find((candidate) => candidate.id === string(deliveryId, 'delivery id'));
      if (!delivery || delivery.blockerId !== blocker.id || delivery.workUnitId !== blocker.workUnitId
        || delivery.slotId !== blocker.slotId) throw new Error('delivery route is not authorized');
      if (blocker.resolved || delivery.state !== 'FAILED' || (delivery.manualRetryCount ?? 0) >= 1) {
        throw new Error('delivery retry is not allowed');
      }
      delivery.state = 'PENDING';
      delivery.attempt = 0;
      delivery.manualRetryCount = (delivery.manualRetryCount ?? 0) + 1;
      delete delivery.recipientPrincipalId;
      delete delivery.recipientAuthorizationId;
      delivery.nextAttemptAt = timestamp;
      delivery.lastError = undefined;
      delivery.leaseId = undefined;
      delivery.leaseExpiresAt = undefined;
      delivery.updatedAt = timestamp;
    }, `Execution blocker response delivery retried: ${blockerId}`);
  }

  async function completeExecution(executionId: string, expectedStateVersion: number, finalSummary: string, artifacts: readonly import('./artifact-store.js').ExecutionArtifactRecord[] = [], includeRouteFit = false): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record) => {
      if (isDurableCoordination(record.coordinationMode) && !record.workUnits?.length) throw new Error('execution plan is required');
      if (record.workUnits?.some((unit) => unit.state !== 'COMPLETED')) throw new Error('required work units are incomplete');
      if (record.blockers?.some((blocker) => !blocker.resolved)) throw new Error('execution has unresolved blockers');
      if (record.state !== 'RUNNING' && record.state !== 'STARTING' && !(record.state === 'BLOCKED' && record.resourceBlock)) throw new Error(`invalid execution transition ${record.state} -> COMPLETED`);
      if (typeof finalSummary !== 'string' || !finalSummary.trim() || finalSummary.length > MAX_FINAL_SUMMARY) throw new Error('invalid execution final summary');
      record.finalSummary = finalSummary;
      record.state = 'COMPLETED';
      record.assembledResult = assembleExecutionResult(record, artifacts, finalSummary);
      if (includeRouteFit) record.routeFitProposal = evaluateRouteFit(record, now());
    }, 'Coordinator completed execution');
  }

  async function failExecution(executionId: string, expectedStateVersion: number, finalSummary: string, artifacts: readonly import('./artifact-store.js').ExecutionArtifactRecord[] = [], includeRouteFit = false): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if (record.blockers?.some((blocker) => !blocker.resolved)) throw new Error('cannot transition to FAILED while blockers are unresolved');
      if (typeof finalSummary !== 'string' || !finalSummary.trim() || finalSummary.length > MAX_FINAL_SUMMARY) throw new Error('invalid execution final summary');
      const fromState = record.state;
      record.state = 'FAILED';
      record.finalSummary = finalSummary;
      record.assembledResult = assembleExecutionResult(record, artifacts, finalSummary);
      if (includeRouteFit) record.routeFitProposal = evaluateRouteFit(record, now());
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'error', 'All runnable work settled; execution failed automatically by the engine.', record.updatedAt, { kind: 'transition', fromState, toState: 'FAILED' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function queueCoordinatorWake(executionId: string, input: string | { cause: CoordinatorWakeCause; message: string; workUnitId?: string; stateOrClaimGeneration: string }): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (terminalStates.has(record.state)) return clone(record);
      const normalized = typeof input === 'string'
        ? { cause: 'HUMAN_BLOCKER' as const, message: input, stateOrClaimGeneration: `${record.state}:${input}` }
        : input;
      const boundedMessage = string(normalized.message, 'coordinator wake');
      const key = `${normalized.cause}\0${normalized.workUnitId ?? ''}\0${normalized.stateOrClaimGeneration}`;
      if (record.coordinatorWakes?.some((wake) => wake.key === key)) return clone(record);
      record.coordinatorState = 'ACTIVE';
      record.coordinatorWakeSequence = (record.coordinatorWakeSequence ?? 0) + 1;
      record.coordinatorWakes ??= [];
      if (record.coordinatorWakes.length >= MAX_COORDINATOR_WAKES) throw new Error('coordinator wake queue is full');
      const wake: CoordinatorWakeV1 = {
        version: 1, id: `${record.id}:wake:${record.coordinatorWakeSequence}`, key, cause: normalized.cause,
        message: boundedMessage, ...(normalized.workUnitId ? { workUnitId: string(normalized.workUnitId, 'wake work unit id') } : {}),
        stateOrClaimGeneration: string(normalized.stateOrClaimGeneration, 'wake state'), createdAt: now()
      };
      record.coordinatorWakes.push(wake);
      record.stateVersion += 1;
      record.updatedAt = wake.createdAt;
      append(snapshot.state, record, record.state, 'warning', 'Coordinator wake queued', record.updatedAt, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function acknowledgeCoordinatorWake(executionId: string, wakeId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const wakeIndex = record.coordinatorWakes?.findIndex((wake) => wake.id === wakeId) ?? -1;
      if (wakeIndex < 0) return clone(record);
      record.coordinatorWakes!.splice(wakeIndex, 1);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Coordinator wake delivered', record.updatedAt, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function appendUsageObservation(
    executionId: string,
    input: Omit<ExecutionUsageObservationV1, 'version' | 'delta'>,
    control: { telemetryGapGraceSamples?: number } = {}
  ): Promise<{ outcome: 'accepted' | 'replay'; record: ExecutionRecord; observation: ExecutionUsageObservationV1; action: 'none' | 'usage-budget' | 'telemetry-unavailable' }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const observations = record.usageObservations ??= [];
      const fingerprint = usageObservationFingerprint(input);
      const sameId = observations.find((item) => item.observationId === input.observationId);
      if (sameId) {
        const replay = { ...sameId, ...input, version: 1 as const, adapterEpoch: sameId.adapterEpoch, delta: sameId.delta, ...(sameId.gap ? { gap: sameId.gap } : {}) };
        if (JSON.stringify(sameId) !== JSON.stringify(replay)) throw new Error('usage observation conflict');
        return { outcome: 'replay' as const, record: clone(record), observation: clone(sameId), action: 'none' as const };
      }
      const compactedById = record.usageBaseline?.replays?.find((item) => item.observationId === input.observationId);
      if (compactedById) {
        if (compactedById.fingerprint !== fingerprint) throw new Error('usage observation conflict');
        return { outcome: 'replay' as const, record: clone(record), observation: { ...clone(input), version: 1, delta: {}, replayFingerprint: fingerprint }, action: 'none' as const };
      }
      if (input.executionAttempt !== record.attempt) throw new Error('usage observation execution attempt mismatch');
      // Delta against whole adapter session, not current claim. A new claim on a
      // reused worker session must not count lifetime cumulative tokens again.
      const group = observations.filter((item) => usageCursorIdentity(item) === usageCursorIdentity(input));
      const cursor = record.usageBaseline?.cursors?.find((item) => usageCursorIdentity(item) === usageCursorIdentity(input));
      const previous = [...group, ...(cursor ? [cursor] : [])].reduce<typeof cursor>((latest, item) => !latest
        || item.adapterEpoch > latest.adapterEpoch || item.adapterEpoch === latest.adapterEpoch && item.sequence > latest.sequence ? item : latest, undefined);
      if (previous && input.adapterEpoch < previous.adapterEpoch) throw new Error('usage observation epoch conflict');
      if (previous && input.adapterEpoch === previous.adapterEpoch && input.sequence <= previous.sequence) throw new Error('usage observation sequence conflict');
      const identity = usageIdentity(input);
      const tuple = observations.find((item) => usageIdentity(item) === identity);
      if (tuple) throw new Error('usage observation tuple conflict');
      const compactedTuple = record.usageBaseline?.replays?.find((item) => item.identity === usageIdentityDigest(input));
      if (compactedTuple) throw new Error('usage observation tuple conflict');
      const regressed = previous && usageCounterRegression(previous.cumulative, input.cumulative);
      if (regressed && input.adapterEpoch <= previous.adapterEpoch) throw new Error('usage counter regression without newer adapter epoch');
      const gap = regressed ? 'regression' as const : input.gap;
      const baseline = previous && previous.adapterEpoch === input.adapterEpoch && !gap ? previous.cumulative : {};
      const delta = usageCounterDelta(baseline, input.cumulative);
      const observation: ExecutionUsageObservationV1 = { ...clone(input), version: 1, delta, replayFingerprint: fingerprint, ...(gap ? { gap } : {}) };
      if (!validUsageObservation(observation)) throw new Error('invalid usage observation');
      observations.push(observation);
      record.telemetryGapCount = observation.completeness === 'unavailable' || observation.gap === 'missing'
        ? (record.telemetryGapCount ?? 0) + 1
        : 0;
      const usage = usageRollup(record.usageObservations, record.usageBaseline);
      const budget = record.request.policy?.usageBudget;
      const tokens = usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined
        ? undefined : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      const budgetReason = budget?.maxTokens !== undefined && tokens !== undefined && tokens >= budget.maxTokens
        ? `RESOURCE_EXHAUSTED: execution token budget exhausted (${tokens}/${budget.maxTokens}). Existing in-flight provider calls may still finish.`
        : budget?.maxUsd !== undefined && usage.providerCostUsd !== undefined && usage.providerCostUsd >= budget.maxUsd
          ? `RESOURCE_EXHAUSTED: execution provider cost budget exhausted (${usage.providerCostUsd}/${budget.maxUsd}). Existing in-flight provider calls may still finish.` : undefined;
      const gapBlocked = !!budget && control.telemetryGapGraceSamples !== undefined && (record.telemetryGapCount ?? 0) >= control.telemetryGapGraceSamples;
      const action = budgetReason ? 'usage-budget' as const : gapBlocked ? 'telemetry-unavailable' as const : 'none' as const;
      if (action !== 'none' && !terminalStates.has(record.state) && !(record.state === 'BLOCKED' && record.resourceBlock)) {
        const fromState = record.state;
        record.state = 'BLOCKED';
        record.resourceBlock = { version: 1, kind: action, reason: budgetReason ?? 'Usage telemetry unavailable; execution requires attention', blockedAt: now() };
        record.stateVersion += 1;
        record.updatedAt = now();
        append(snapshot.state, record, record.state, 'warning', record.resourceBlock.reason, record.updatedAt, { kind: 'transition', fromState, toState: 'BLOCKED' });
      }
      // Usage is observational evidence, not execution control state. Advancing
      // stateVersion here races claim-fenced worker outcomes with transcript
      // samples taken immediately after delivery.
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, record: clone(record), observation: clone(observation), action };
    });
  }

  async function blockForResource(executionId: string, reason = 'Usage telemetry unavailable; execution requires attention', kind: NonNullable<ExecutionRecord['resourceBlock']>['kind'] = 'telemetry-unavailable'): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (terminalStates.has(record.state)) return clone(record);
      if (record.state === 'BLOCKED' && record.resourceBlock) return clone(record);
      const fromState = record.state;
      record.state = 'BLOCKED';
      record.resourceBlock = { version: 1, kind, reason: string(reason, 'resource block reason'), blockedAt: now() };
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'warning', record.resourceBlock.reason, record.updatedAt, { kind: 'transition', fromState, toState: 'BLOCKED' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function recordOutputRepair(executionId: string, expectedStateVersion: number, workUnitId: string, claim: { claimId: string; claimGeneration: number }, digest: string): Promise<{ outcome: 'accepted' | 'replay' | 'exhausted'; record: ExecutionRecord }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      assertClaimFence(unit, claim, true);
      const boundedDigest = string(digest, 'repair digest');
      if (unit.repairDigests?.includes(boundedDigest)) return { outcome: 'replay', record: clone(record) };
      unit.repairDigests ??= [];
      if (unit.repairDigests.length >= 2) {
        unit.state = 'FAILED';
        unit.failureCode = 'VALIDATION_FAILED';
        unit.failure = 'structured output remained invalid after two unique repair requests';
        unit.history.push({ action: 'failed', slotId: unit.assignedSlotId, attempt: unit.attempt, at: now(), detail: unit.failure });
        clearClaim(unit);
        deriveReadiness(record);
        record.stateVersion += 1;
        record.updatedAt = now();
        persist(snapshot.state, snapshot.hash);
        return { outcome: 'exhausted', record: clone(record) };
      }
      unit.repairDigests.push(boundedDigest);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'warning', `Structured output repair requested: ${workUnitId}`, record.updatedAt, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted', record: clone(record) };
    });
  }

  async function setRouteFitProposal(executionId: string, proposal?: RouteFitProposalV1): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (!terminalStates.has(record.state)) throw new Error('route fit requires terminal execution');
      const next = proposal ?? evaluateRouteFit(record, now());
      if (!validRouteFitProposal(next)) throw new Error('invalid route fit proposal');
      if (record.routeFitProposal?.evaluatorVersion === next.evaluatorVersion) return clone(record);
      record.routeFitProposal = clone(next);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  /** Hide terminal board history without deleting audit records or source retention. */
  async function dismiss(executionId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (!terminalStates.has(record.state)) throw new Error('only terminal executions can be dismissed');
      if (record.dismissedAt !== undefined) return clone(record);
      record.dismissedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function get(executionId: string): Promise<ExecutionRecord | undefined> {
    return storeQueue.run(async () => {
      const record = read().state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      return record ? clone(record) : undefined;
    });
  }

  async function getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined> {
    const record = await get(executionId);
    return record?.projectId === string(projectId, 'project id') ? record : undefined;
  }

  async function list(callerPrincipalId: string, projectId: string, limit = 100): Promise<ExecutionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => clone(read().state.records
      .filter((record) => (record.callerPrincipalId === string(callerPrincipalId, 'caller principal id')
          || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId))
        && record.projectId === string(projectId, 'project id') && record.dismissedAt === undefined)
      .slice(-safeLimit).reverse()));
  }

  /** Live runs the principal owns in a project, uncapped (unlike `list`, which returns the newest 100 of any state). */
  async function countActiveOwned(callerPrincipalId: string, projectId: string): Promise<number> {
    return storeQueue.run(async () => read().state.records.filter((record) =>
      (record.callerPrincipalId === string(callerPrincipalId, 'caller principal id')
        || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId))
      && record.projectId === string(projectId, 'project id') && record.dismissedAt === undefined
      && !isTerminalExecutionState(record.state)).length);
  }

  async function listInProject(projectId: string, before?: number, limit = 100): Promise<{ records: ExecutionRecord[]; hasMore: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const candidates = read().state.records
        .filter((record) => record.projectId === string(projectId, 'project id'))
        .filter((record) => record.dismissedAt === undefined)
        .filter((record) => before === undefined || record.createdAt < before)
        .sort((left, right) => right.createdAt - left.createdAt);
      return { records: clone(candidates.slice(0, safeLimit)), hasMore: candidates.length > safeLimit };
    });
  }

  async function listActive(): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records.filter((record) => !terminalStates.has(record.state))));
  }

  /** Retain every execution-owned squad checkout until user explicitly dismisses it. */
  async function listUndisposedSquadWorktrees(): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records.filter((record) =>
      record.squadWorktree !== undefined && record.dismissedAt === undefined
    )));
  }

  async function listUnreportedExecutions(): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records.filter((record) =>
      (executionReportTarget(record) !== undefined || isLocalReportRecord(record)) && terminalStates.has(record.state) && reportedAttempt(record) !== record.attempt
    )));
  }

  /**
   * Live runs with their own `reportTo` and an open human blocker that was not reported yet.
   * Records written before report-back have no `reportTo`/`reportedBlockerIds`: the previous
   * build already delivered their blockers, so they are never replayed.
   */
  async function listUnreportedBlockers(): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records.filter((record) =>
      record.reportTo !== undefined && !terminalStates.has(record.state)
      && (record.blockers ?? []).some((blocker) => !blocker.resolved && blocker.audience !== 'coordinator' && !record.reportedBlockerIds?.includes(blocker.id))
    )));
  }

  async function listActiveClaims(after?: ActiveClaimCursor, limit = 25): Promise<ActiveClaimPage> {
    return storeQueue.run(async () => {
      const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
      const records = read().state.records
        .filter((record) => !terminalStates.has(record.state) && record.workUnits?.some((unit) => unit.state === 'CLAIMED'))
        .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
        .filter((record) => !after || record.updatedAt > after.updatedAt || record.updatedAt === after.updatedAt && record.id > after.id);
      const page = records.slice(0, safeLimit);
      const last = page.at(-1);
      return { records: clone(page), ...(records.length > page.length && last ? { next: { updatedAt: last.updatedAt, id: last.id } } : {}) };
    });
  }

  async function retainedSourceContentRefs(): Promise<ReadonlySet<string>> {
    return storeQueue.run(async () => new Set(read().state.records
      .map((record) => record.request.sourceBundle?.contentRef)
      .filter((contentRef): contentRef is string => !!contentRef)));
  }

  async function upgradeSourceBundle(
    executionId: string,
    expectedSources: NonNullable<ExecutionRequestSnapshotV1['sourceBundle']>['sources'],
    upgradedSources: NonNullable<ExecutionRequestSnapshotV1['sourceBundle']>['sources']
  ): Promise<void> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record?.request.sourceBundle) throw new Error('execution source bundle not found');
      if (JSON.stringify(record.request.sourceBundle.sources) === JSON.stringify(upgradedSources)) return;
      if (JSON.stringify(record.request.sourceBundle.sources) !== JSON.stringify(expectedSources)) {
        throw new Error('execution source metadata changed before upgrade');
      }
      if (!upgradedSources.every((source) => validDigest(source.extractedTextDigest)) || !validSourceBundle({
        contentRef: record.request.sourceBundle.contentRef,
        sources: upgradedSources
      })) throw new Error('invalid execution source metadata upgrade');
      record.request.sourceBundle.sources = clone(upgradedSources);
      persist(snapshot.state, snapshot.hash);
    });
  }

  async function events(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    after = 0,
    limit = 100
  ): Promise<{ events: ExecutionEvent[]; nextSequence?: number; resyncRequired?: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.callerPrincipalId !== string(callerPrincipalId, 'caller principal id')
        || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const all = state.events.filter((event) => event.executionId === record.id);
      const earliest = all[0]?.sequence;
      const matching = all.filter((event) => event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return {
        events: clone(events),
        ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {}),
        ...((earliest === undefined ? after > 0 : after < earliest - 1 || after > (record.lastEventSequence ?? 0)) ? { resyncRequired: true } : {})
      };
    });
  }

  async function eventsInProject(projectId: string, executionId: string, after = 0, limit = 100): Promise<{ events: ExecutionEvent[]; nextSequence?: number; resyncRequired?: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const all = state.events.filter((event) => event.executionId === record.id);
      const earliest = all[0]?.sequence;
      const matching = all.filter((event) => event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return {
        events: clone(events),
        ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {}),
        ...((earliest === undefined ? after > 0 : after < earliest - 1 || after > (record.lastEventSequence ?? 0)) ? { resyncRequired: true } : {})
      };
    });
  }

  return { claim, transition, stopForPlanCorrection, setSquadWorktree, markSquadWorktreeTerminalEffects, markReported, markBlockerReported, disposeSquadWorktree, reserveTimeoutRecovery, linkTimeoutSuccessor, decideDeadline, event, command, producerEvent, setPolicyResult, setAuthorizationContext, prepareLaunchIntent, addEffectiveOwner, removeEffectiveOwner, rotateRecoveryGeneration, upsertNativeRecoverySnapshot, recordAutomatedMcpCatalogueProvenance, beginRetry, beginRetainedRecovery, clearPriorNativeRecoverySnapshots, registerPlan, claimWork, heartbeatWork, renewWorkerLease, dispatchReady, replaceResolvedModels, failRouteFacts, completeWork, failWork, releaseWork, releaseUndelivered, reclaimExpiredClaims, recordWorkerRecovery, blockKickoffFailure, reassignKickoffToFreshSlot, retryWork, reassignWork, blockWork, escalateBlockerToHuman, acknowledgeNotice, deferNotice, cancelNotice, listPendingNotices, enqueueBlockerDelivery, pullBlockerDelivery, ackBlockerDelivery, retryBlockerDelivery, completeExecution, failExecution, queueCoordinatorWake, acknowledgeCoordinatorWake, appendUsageObservation, blockForResource, recordOutputRepair, setRouteFitProposal, dismiss, get, getInProject, list, countActiveOwned, listInProject, listActive, listUndisposedSquadWorktrees, listUnreportedExecutions, listUnreportedBlockers, listActiveClaims, retainedSourceContentRefs, upgradeSourceBundle, events, eventsInProject };
}

function normalizeModelSnapshot(snapshot: ResolvedModelSnapshotV1): ResolvedModelSnapshotV1 {
  const normalized: ResolvedModelSnapshotV1 = {
    slotId: string(snapshot.slotId, 'model slot id'), provider: string(snapshot.provider, 'model provider'),
    ...(snapshot.personaId === undefined ? {} : { personaId: string(snapshot.personaId, 'model persona id') }),
    ...(snapshot.model === undefined ? {} : { model: string(snapshot.model, 'model') }),
    ...(snapshot.reasoning === undefined ? {} : { reasoning: string(snapshot.reasoning, 'model reasoning') }),
    ...(snapshot.level === undefined ? {} : { level: snapshot.level }),
    ...(snapshot.roleOwnedModel === undefined ? {} : { roleOwnedModel: snapshot.roleOwnedModel }),
    ...(snapshot.capabilities === undefined ? {} : { capabilities: normalizeStringList(snapshot.capabilities, 'model capability') }),
    ...(snapshot.modalities === undefined ? {} : { modalities: normalizeStringList(snapshot.modalities, 'model modality') }),
    ...(snapshot.maxContextBytes === undefined ? {} : { maxContextBytes: nonNegativeInteger(snapshot.maxContextBytes, 'model context ceiling') }),
    ...(snapshot.health === undefined ? {} : { health: snapshot.health }),
    ...(snapshot.observedAt === undefined ? {} : { observedAt: finiteTimestamp(snapshot.observedAt, 'model observation time') }),
    ...(snapshot.maxAgeMs === undefined ? {} : { maxAgeMs: nonNegativeInteger(snapshot.maxAgeMs, 'model max age') })
  };
  if (!validModelSnapshot(normalized)) throw new Error('invalid resolved model snapshot');
  return normalized;
}

function normalizeStringList(values: string[], label: string): string[] {
  if (!Array.isArray(values) || values.length > MAX_UNIT_LIST) throw new Error(`invalid execution ${label}`);
  return [...new Set(values.map((value) => string(value, label)))].sort();
}

function nonNegativeInteger(value: number, label: string): number {
  if (!validNonNegativeInteger(value)) throw new Error(`invalid execution ${label}`);
  return value;
}

function finiteTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid execution ${label}`);
  return value;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return value.slice(0, end);
}

function failActiveDeliveries(record: ExecutionRecord, blockerId: string, reason: string, timestamp: number): void {
  for (const delivery of record.deliveries ?? []) {
    if (delivery.blockerId !== blockerId || delivery.state === 'DELIVERED' || delivery.state === 'FAILED') continue;
    delivery.state = 'FAILED';
    delivery.leaseId = undefined;
    delivery.leaseExpiresAt = undefined;
    delivery.nextAttemptAt = undefined;
    delivery.lastError = truncateUtf8(reason, MAX_DELIVERY_ERROR_BYTES);
    delivery.updatedAt = timestamp;
  }
}

function normalizeRequest(input: ExecutionRequestSnapshotV1): ExecutionRequestSnapshotV1 {
  const objective = (input as { objective?: unknown } | null | undefined)?.objective;
  if (typeof objective === 'string' && objective.length > SQUAD_GOAL_MAX_CHARS) {
    throw new Error(squadStoredFieldTooLong('goal', objective.length));
  }
  if (!validRequestSnapshot(input)) throw new Error('invalid execution request snapshot');
  return { ...clone(input), launchKind: input.launchKind ?? 'team' };
}


function sameLaunchDisplay(left: ExecutionLaunchDisplayV1, right: ExecutionLaunchDisplayV1 | undefined): boolean {
  return left.label === right?.label;
}

function normalizePlan(inputs: ExecutionWorkUnitInput[], requireComplete = false): ExecutionWorkUnit[] {
  return normalizeExecutionPlan(inputs, requireComplete).map((unit) => ({
    ...unit,
    state: unit.dependencies.length ? 'PENDING' as const : 'READY' as const,
    attempt: 0,
    history: []
  }));
}

function stripWorkUnitState(unit: ExecutionWorkUnit): ExecutionWorkUnitInput {
  const { state: _state, assignedSlotId: _assignedSlotId, claimGeneration: _claimGeneration, claimId: _claimId, claimedBy: _claimedBy, claimedAt: _claimedAt, leaseExpiresAt: _leaseExpiresAt, heartbeatAt: _heartbeatAt, progressAt: _progressAt, turnCount: _turnCount, kickoffFailures: _kickoffFailures, reclaimedClaim: _reclaimedClaim, apiErrorRecovery: _apiErrorRecovery, attempt: _attempt, failureCode: _failureCode, failure: _failure, result: _result, structuredResult: _structuredResult, repairDigests: _repairDigests, history: _history, ...input } = unit;
  return input;
}

function usageCounterRegression(previous: ExecutionUsageObservationV1['cumulative'], next: ExecutionUsageObservationV1['cumulative']): boolean {
  return (['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'providerCostUsd'] as const)
    .some((key) => previous[key] !== undefined && next[key] !== undefined && next[key]! < previous[key]!);
}

function usageCounterDelta(previous: ExecutionUsageObservationV1['cumulative'], next: ExecutionUsageObservationV1['cumulative']): ExecutionUsageObservationV1['delta'] {
  const delta: ExecutionUsageObservationV1['delta'] = {};
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'providerCostUsd'] as const) {
    if (next[key] !== undefined) delta[key] = Math.max(0, next[key]! - (previous[key] ?? 0));
  }
  return delta;
}

function findUnit(record: ExecutionRecord, workUnitId: string): ExecutionWorkUnit {
  const unit = record.workUnits?.find((candidate) => candidate.id === string(workUnitId, 'work unit id'));
  if (!unit) throw new Error('work unit not found');
  return unit;
}

function findBlocker(record: ExecutionRecord, blockerId: string): ExecutionBlocker {
  const blocker = record.blockers?.find((candidate) => candidate.id === string(blockerId, 'blocker id'));
  if (!blocker) throw new Error('execution blocker not found');
  return blocker;
}

function assertUnitAuthority(unit: ExecutionWorkUnit, authority: ExecutionCohortAuthority): void {
  if (authority.role === 'worker' && unit.assignedSlotId !== authority.slotId) throw new Error('work unit is assigned to another slot');
}

function assertAuthorizedSlot(record: ExecutionRecord, slotId: string): void {
  if (isDurableCoordination(record.coordinationMode) && !record.authorizationContext?.slots.some((slot) => slot.slotId === slotId)) {
    throw new Error('assigned slot is not authorized');
  }
}

function deriveReadiness(record: ExecutionRecord, recoverSkipped = false): void {
  const units = record.workUnits ?? [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  if (recoverSkipped) {
    for (const unit of units) if (unit.state === 'SKIPPED') unit.state = 'PENDING';
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (unit.state !== 'PENDING') continue;
      const dependencies = unit.dependencies.map((dependency) => byId.get(dependency));
      if (dependencies.some((dependency) => !dependency)) continue;
      const knownDependencies = dependencies.filter((dependency): dependency is ExecutionWorkUnit => dependency !== undefined);
      if (knownDependencies.some((dependency) => dependency.state === 'FAILED' || dependency.state === 'SKIPPED')) {
        unit.state = 'SKIPPED';
        changed = true;
      } else if (knownDependencies.every((dependency) => dependency.state === 'COMPLETED')) {
        unit.state = 'READY';
        changed = true;
      }
    }
  }
}

function scopesOverlap(left: ExecutionWorkUnit, right: ExecutionWorkUnit): boolean {
  if (left.readOnly || right.readOnly) return false;
  if (!left.files?.length || !right.files?.length) return true;
  return left.files.some((a) => right.files!.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function assertScopeAvailable(record: ExecutionRecord, candidate: ExecutionWorkUnit): void {
  const conflict = record.workUnits?.some((unit) => unit.id !== candidate.id && unit.state === 'CLAIMED' && scopesOverlap(candidate, unit));
  if (conflict) throw new Error('overlapping mutating file scope');
}

function assertActive(record: ExecutionRecord): void {
  if (terminalStates.has(record.state)) throw new Error(`execution is ${record.state.toLowerCase()}`);
}

function compactEvents(events: ExecutionEvent[], perExecution: number, global: number): ExecutionEvent[] {
  const byExecution = new Map<string, ExecutionEvent[]>();
  for (const event of events) {
    const group = byExecution.get(event.executionId) ?? [];
    group.push(event);
    byExecution.set(event.executionId, group);
  }
  let retained = [...byExecution.values()].flatMap((group) => retainEvents(group, perExecution));
  if (retained.length > global) retained = retainEvents(retained, global);
  return retained.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
}

function retainEvents(events: ExecutionEvent[], limit: number): ExecutionEvent[] {
  if (events.length <= limit) return events;
  const newestFirst = [...events].sort((left, right) => right.createdAt - left.createdAt || right.sequence - left.sequence);
  const essential = newestFirst.filter((event) => event.kind === 'transition' || event.eventType === 'blocker' || event.eventType === 'outcome');
  const selected = essential.slice(0, limit);
  if (selected.length < limit) {
    const selectedIds = new Set(selected);
    selected.push(...newestFirst.filter((event) => !selectedIds.has(event)).slice(0, limit - selected.length));
  }
  return selected;
}

function append(
  state: ExecutionStateFile,
  record: ExecutionRecord,
  eventState: ExecutionState,
  severity: ExecutionEvent['severity'],
  summary: string,
  createdAt: number,
  metadata: Pick<ExecutionEvent, 'kind' | 'fromState' | 'toState' | 'slotId' | 'eventType' | 'detail'> = {}
): void {
  const sequence = (record.lastEventSequence ?? nextSequence(state, record.id) - 1) + 1;
  record.lastEventSequence = sequence;
  state.events.push({ id: randomUUID(), executionId: record.id, attempt: record.attempt, sequence, state: eventState, stateVersion: record.stateVersion, severity, summary, createdAt, ...metadata });
}

function nextSequence(state: ExecutionStateFile, executionId: string): number {
  return state.events.reduce((highest, event) => event.executionId === executionId ? Math.max(highest, event.sequence) : highest, 0) + 1;
}

function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return (from === 'READY' && (to === 'STARTING' || to === 'BLOCKED' || to === 'STOPPED' || to === 'FAILED'))
    || (from === 'STARTING' && (to === 'RUNNING' || to === 'COMPLETED' || to === 'BLOCKED' || to === 'FAILED' || to === 'STOPPED'))
    || (from === 'RUNNING' && (to === 'COMPLETED' || to === 'BLOCKED' || to === 'FAILED' || to === 'STOPPED'))
    || (from === 'BLOCKED' && (to === 'RUNNING' || to === 'STOPPED' || to === 'FAILED'));
}
