/**
 * Pure types and helpers for Squad launch proposals: an agent in a PTY or
 * thread proposes a Squad run, the user reviews it in the composer, and main
 * launches it. No I/O; shared by main, the MCP tools and the renderer.
 */
import { z } from 'zod';
import type { Persona, SquadTransport } from './product.js';

/** How the Squad's plan is produced: the orchestrator infers it, or the goal/sources provide it. */
export type SquadPlanning = 'infer' | 'provided';

/** Whether an agent-started Squad run needs the user's Launch first (`review`) or may start straight away (`direct`). */
export type LaunchApproval = 'review' | 'direct';

export function isLaunchApproval(value: unknown): value is LaunchApproval {
  return value === 'review' || value === 'direct';
}

/**
 * The launch-approval policy for a Squad run. `review` is a floor: if either the
 * Squad or its Project asks for review, the run needs review. A Squad cannot lift
 * its Project's review requirement, because Squad files under the project's
 * `.zcc/teams` are writable by agents working in that checkout.
 */
export function resolveLaunchApproval(
  { squad, project }: { squad?: { launchApproval?: LaunchApproval } | null; project?: { launchApproval?: LaunchApproval } | null }
): LaunchApproval {
  return squad?.launchApproval === 'review' || project?.launchApproval === 'review' ? 'review' : 'direct';
}

/** The execution store's persisted goal limit; not higher because an older Zana treats the whole execution store as corrupt when one record has a longer objective. */
export const SQUAD_GOAL_MAX_CHARS = 2048;
/** The execution store's persisted summary limit; not higher because an older Zana treats the whole execution store as corrupt when one record has a longer summary. */
export const SQUAD_SUMMARY_MAX_CHARS = 2048;
/** The share of a Squad text limit at which the composer starts showing its character counter. */
export const SQUAD_LIMIT_COUNTER_RATIO = 0.9;
/** The goal length from which the composer shows its character counter. */
export const SQUAD_LIMIT_COUNTER_FROM = Math.ceil(SQUAD_GOAL_MAX_CHARS * SQUAD_LIMIT_COUNTER_RATIO);

export type SquadLaunchLimitCode = 'GOAL_TOO_LONG' | 'SUMMARY_TOO_LONG';

export function formatSquadChars(n: number): string {
  return n.toLocaleString('en-US');
}

export function squadGoalTooLongMessage(length: number, options?: { afterSourceNames?: boolean }): string {
  const base = `The goal is too long for a Squad (${formatSquadChars(length)} of ${formatSquadChars(SQUAD_GOAL_MAX_CHARS)} characters). Move details into an attached plan or source.`;
  return options?.afterSourceNames ? `${base} File paths in the goal count after they are replaced by source names.` : base;
}

export function squadSummaryTooLongMessage(length: number): string {
  return `The summary is too long for a Squad (${formatSquadChars(length)} of ${formatSquadChars(SQUAD_SUMMARY_MAX_CHARS)} characters). Shorten it or move details into an attached source.`;
}

export function squadStoredFieldTooLong(field: 'goal' | 'summary', length: number): string {
  const max = field === 'goal' ? SQUAD_GOAL_MAX_CHARS : SQUAD_SUMMARY_MAX_CHARS;
  return `Squad ${field} is ${formatSquadChars(length)} characters; the limit is ${formatSquadChars(max)}`;
}

/** Measures the strings exactly as given (no trimming): callers pass the text they will send. Goal is reported before summary. */
export function squadLaunchTextProblem(
  input: { goal?: string; summary?: string }
): { code: SquadLaunchLimitCode; message: string } | undefined {
  if (input.goal !== undefined && input.goal.length > SQUAD_GOAL_MAX_CHARS) {
    return { code: 'GOAL_TOO_LONG', message: squadGoalTooLongMessage(input.goal.length) };
  }
  if (input.summary !== undefined && input.summary.length > SQUAD_SUMMARY_MAX_CHARS) {
    return { code: 'SUMMARY_TOO_LONG', message: squadSummaryTooLongMessage(input.summary.length) };
  }
  return undefined;
}

export const SQUAD_PROPOSAL_LIMITS = {
  goalChars: SQUAD_GOAL_MAX_CHARS,
  titleChars: 256,
  summaryChars: SQUAD_SUMMARY_MAX_CHARS,
  maxSources: 16,
  planTextBytes: 1_048_576,
  maxPendingPerProject: 20,
  maxRecords: 200,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  reportChars: 2048,
  ptyQuietMs: 30_000,
  ptyQueueMax: 10
} as const;

export type SquadProposalErrorCode =
  | 'DISABLED' | 'NOT_LIVE' | 'INVALID' | 'TEAM_NOT_FOUND'
  | 'NO_ORCHESTRATOR' | 'HOST_UNSUPPORTED' | 'SOURCE_NOT_ALLOWED' | 'SOURCE_NOT_FILE'
  | 'SOURCE_TOO_LARGE' | 'TOO_MANY_SOURCES' | 'INVALID_PLAN' | 'ORCHESTRATOR_CANNOT_PLAN'
  | 'PROPOSER_IN_SQUAD' | 'TOO_MANY_PROPOSALS' | 'NOT_FOUND' | 'EXPIRED' | 'NOT_PENDING'
  | 'SOURCE_UNREADABLE';

export interface SquadProposalInput {
  teamId: string;
  goal: string;
  planning?: SquadPlanning;
  sources?: string[];
  title?: string;
  summary?: string;
  /** Request a completion Inbox notice for an agent-started Squad. */
  completionInboxNotice?: boolean;
}

export interface SquadProposer {
  kind: 'pty' | 'thread';
  id: string;
  title?: string;
}

export interface SquadProposalSource {
  /** Realpath of the source file. */
  path: string;
  /** Path inside the project, or the `~`-abbreviated absolute path of a file outside it. */
  relPath: string;
  bytes: number;
  /** The file is outside the project (under HOME or the clone root); absent for files inside it. */
  outsideProject?: boolean;
}

export interface SquadPlanStep {
  id: string;
  title: string;
  dependencies: string[];
  writeScope: string[];
}

export interface SquadProposalRecord {
  id: string;
  projectId: string;
  proposer: SquadProposer;
  teamId: string;
  goal: string;
  planning: SquadPlanning;
  sources: SquadProposalSource[];
  title?: string;
  summary?: string;
  planSteps?: SquadPlanStep[];
  state: 'pending' | 'launched' | 'dismissed' | 'expired';
  inboxEntryId?: string;
  executionId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const timestamp = z.number().finite().nonnegative();

/**
 * A persisted proposal record, checked in full before the ledger is trusted. It checks types
 * and structure only: input caps live in `squad_propose`, so a release that changes a cap (or a
 * downgrade) never discards stored proposals. Unknown keys are allowed (a newer Zana may add some).
 */
export const squadProposalRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  proposer: z.object({ kind: z.enum(['pty', 'thread']), id: z.string().min(1), title: z.string().optional() }),
  teamId: z.string().min(1),
  goal: z.string().min(1),
  planning: z.enum(['infer', 'provided']),
  sources: z.array(z.object({
    path: z.string().min(1),
    relPath: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    outsideProject: z.boolean().optional()
  })),
  title: z.string().optional(),
  summary: z.string().optional(),
  planSteps: z.array(z.object({
    id: z.string().min(1),
    title: z.string(),
    dependencies: z.array(z.string()),
    writeScope: z.array(z.string())
  })).optional(),
  state: z.enum(['pending', 'launched', 'dismissed', 'expired']),
  inboxEntryId: z.string().optional(),
  executionId: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp
}).refine((record) => record.state !== 'launched' || typeof record.executionId === 'string', {
  message: 'a launched proposal names its execution'
});

export interface SquadProposalResult {
  proposalId: string;
  inboxEntryId: string;
  team: { id: string; name: string; workers: number; orchestrator: string };
  planning: SquadPlanning;
  plan: { steps: Array<{ id: string; title: string }> } | null;
  sources: Array<{ path: string; bytes: number; outsideProject?: boolean }>;
  expiresAt: number;
}

/** What a Squad started straight away by an agent (no Inbox card) looks like to that agent. */
export interface SquadLaunchNowResult {
  executionId: string;
  state: string;
  /** True when an identical recent launch from the same conversation was returned instead of starting another. */
  deduped?: true;
  team: SquadProposalResult['team'];
  planning: SquadPlanning;
  plan: SquadProposalResult['plan'];
  sources: SquadProposalResult['sources'];
}

/** Refusals a Squad start without review adds to the proposal ones. */
export type SquadLaunchNowErrorCode =
  | SquadProposalErrorCode | 'LAUNCH_REVIEW_REQUIRED' | 'LAUNCH_APPROVAL_UNAVAILABLE'
  | 'LAUNCH_IN_PROGRESS' | 'TOO_MANY_LAUNCHES';

export const LAUNCH_REVIEW_REQUIRED_MESSAGE =
  "This Squad requires review before launch. Use squad_launch with mode 'review' so the user can Launch it from the Inbox.";

export type SquadPlanCheckResult =
  | { ok: true; steps: SquadPlanStep[] }
  | { ok: false; reason: string };

/** Safe renderer projection that pre-fills the composer from a proposal. */
export interface SquadLaunchPrefill {
  proposalId: string;
  projectId: string;
  teamId: string;
  coordinationMode: 'freeform' | 'structured';
  goal: string;
  title?: string;
  summary?: string;
  /** `path` and `outsideProject` are set for a file outside the project, so the composer can show where it is. */
  sources: Array<{ id: string; name: string; byteSize: number; expiresAt: number; path?: string; outsideProject?: boolean }>;
  proposerTitle?: string;
  planStepCount?: number;
}

export function planningToCoordinationMode(p: SquadPlanning): 'freeform' | 'structured' {
  return p === 'provided' ? 'structured' : 'freeform';
}

/**
 * Whether a persona can write files, i.e. can be trusted to infer and record a
 * plan. `allowedTools` is ignored: it is not strict in interactive mode. Only a
 * bare `Write`/`Edit` deny counts; path-scoped entries such as `Write(~/.zcc/**)` don't.
 */
export function personaCanWriteFiles(
  p: Pick<Persona, 'deniedTools' | 'permissionMode' | 'executionState' | 'codexSandbox'>
): boolean {
  const denied = p.deniedTools ?? [];
  if (denied.includes('Write') || denied.includes('Edit')) return false;
  if (p.permissionMode === 'plan') return false;
  if (p.executionState === 'plan') return false;
  if (p.codexSandbox === 'read-only') return false;
  return true;
}

/** How a planless coordinator hands its authored plan to the host on a given transport. */
export type PlanAuthoringTransport = 'cli' | 'modern';

export function planAuthoringTransportOf(transport: SquadTransport | undefined): PlanAuthoringTransport {
  return transport === 'MODERN' ? 'modern' : 'cli';
}

const PLAN_REGISTER_DENIALS = [
  'mcp__zcc-inbox__execution.plan.register',
  'mcp__zcc-inbox__*',
  'mcp__zcc-inbox'
] as const;

/**
 * Whether a coordinator can both author a plan AND get it registered on its
 * transport, i.e. whether "Infer plan from goal" can finish.
 *  - CLI: the coordinator writes the plan file and the host rereads it on idle,
 *    so it needs file-write ability ({@link personaCanWriteFiles}).
 *  - Modern: the coordinator calls its bound `execution.plan.register` MCP tool
 *    once and writes no file, so only a denied register tool blocks it.
 */
export function canAuthorAndRegisterPlan(
  p: Pick<Persona, 'deniedTools' | 'permissionMode' | 'executionState' | 'codexSandbox'>,
  ctx: { transport: PlanAuthoringTransport }
): boolean {
  const denied = p.deniedTools ?? [];
  return ctx.transport === 'modern'
    ? !PLAN_REGISTER_DENIALS.some((tool) => denied.includes(tool))
    : personaCanWriteFiles(p);
}
