/**
 * Pure types and helpers for Squad launch proposals: an agent in a PTY or
 * thread proposes a Squad run, the user reviews it in the composer, and main
 * launches it. No I/O; shared by main, the MCP tools and the renderer.
 */
import { z } from 'zod';
import type { Persona, SquadTransport } from './product.js';
import { launchOptionsSchema, resolvedLaunchSchema, squadLaunchLocationSchema, type LaunchOptions, type SquadLaunchLocation } from './launch-options.js';

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
  /** All private attachment copies kept for pending proposals, measured from disk. */
  maxStagedBytes: 64 * 1024 * 1024,
  /** A proposal still `staging` after this long is abandoned. */
  stagingTimeoutMs: 10 * 60 * 1000,
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
  | 'SOURCE_UNREADABLE' | 'NEEDS_DECISION';

export interface SquadAttachmentInput {
  name: string;
  text: string;
}

/** How an attachment's name was used: unchanged, numbered after a clash, or folded into an identical one. */
export interface SquadAttachmentMapping {
  given: string;
  used: string;
  /** Name of the kept attachment this one duplicated (same name, same content). */
  deduplicated?: string;
}

export interface SquadProposalInput {
  launchOptions?: LaunchOptions;
  teamId: string;
  goal: string;
  planning?: SquadPlanning;
  sources?: string[];
  /** Text handed over by value (agent sessions only); shares the sources budget and becomes a source. */
  attachments?: SquadAttachmentInput[];
  title?: string;
  summary?: string;
  /** Request a completion Inbox notice for an agent-started Squad. */
  completionInboxNotice?: boolean;
  /** The user chose to review the plan with its Must fix findings still in it; without this a review launch asks first. */
  acceptFindings?: boolean;
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
  /** The file is a private copy of agent-supplied text kept for this proposal, not a file in the Project. */
  attachment?: boolean;
}

export interface SquadPlanStep {
  id: string;
  title: string;
  dependencies: string[];
  writeScope: string[];
}

export interface SquadProposalRecord {
  launchPreview?: SquadLaunchPreview;
  launchOptions?: LaunchOptions;
  /** Host-authored advisory snapshot; launch revalidates against current project state. */
  location?: SquadLaunchLocation;
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
  /** `staging`: attachments are still being written; not yet shown or launchable. */
  state: 'staging' | 'pending' | 'launched' | 'dismissed' | 'expired';
  /** Present when the proposal holds private copies of attachments (their folder name is the proposal id). */
  staged?: { bytes: number };
  inboxEntryId?: string;
  executionId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const timestamp = z.number().finite().nonnegative();

export const squadLaunchPreviewSchema = z.strictObject({
  launchOptions: launchOptionsSchema,
  resolvedLaunch: resolvedLaunchSchema,
  location: squadLaunchLocationSchema,
  path: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  /** Host-observed checkout HEAD; fences reviewed bases without inventing a branch. */
  head: z.string().min(1).optional(),
  fingerprint: z.string().min(1)
}).refine((preview) => preview.location.kind === 'new-worktree'
  ? preview.path === undefined
  : preview.location.kind === 'worktree' ? Boolean(preview.path && preview.branch)
    : Boolean(preview.path), { message: 'Existing locations need an actual path; linked worktrees need a branch; prospective worktrees have no path.' });
export type SquadLaunchPreview = z.infer<typeof squadLaunchPreviewSchema>;

/**
 * A persisted proposal record, checked in full before the ledger is trusted. It checks types
 * and structure only: input caps live in `squad_propose`, so a release that changes a cap (or a
 * downgrade) never discards stored proposals. Unknown keys are allowed (a newer Zana may add some).
 */
export const squadProposalRecordSchema = z.object({
  launchPreview: squadLaunchPreviewSchema.optional(),
  launchOptions: launchOptionsSchema.optional(),
  location: squadLaunchLocationSchema.optional(),
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
    outsideProject: z.boolean().optional(),
    attachment: z.boolean().optional()
  })),
  title: z.string().optional(),
  summary: z.string().optional(),
  planSteps: z.array(z.object({
    id: z.string().min(1),
    title: z.string(),
    dependencies: z.array(z.string()),
    writeScope: z.array(z.string())
  })).optional(),
  state: z.enum(['staging', 'pending', 'launched', 'dismissed', 'expired']),
  staged: z.object({ bytes: z.number().int().nonnegative() }).optional(),
  inboxEntryId: z.string().optional(),
  executionId: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp
}).refine((record) => record.state !== 'launched' || typeof record.executionId === 'string', {
  message: 'a launched proposal names its execution'
});

export interface SquadProposalResult {
  launchPreview?: SquadLaunchPreview;
  proposalId: string;
  inboxEntryId: string;
  team: { id: string; name: string; workers: number; orchestrator: string };
  planning: SquadPlanning;
  plan: { steps: Array<{ id: string; title: string }> } | null;
  sources: Array<{ path: string; bytes: number; outsideProject?: boolean }>;
  /** One entry per attachment given, in order; absent when none were given. */
  attachments?: SquadAttachmentMapping[];
  expiresAt: number;
}

/** What a Squad started straight away by an agent (no Inbox card) looks like to that agent. */
export interface SquadLaunchNowResult {
  location?: SquadLaunchLocation;
  path?: string;
  branch?: string;
  executionId: string;
  state: string;
  /** True when an identical recent launch from the same conversation was returned instead of starting another. */
  deduped?: true;
  team: SquadProposalResult['team'];
  planning: SquadPlanning;
  plan: SquadProposalResult['plan'];
  sources: SquadProposalResult['sources'];
  attachments?: SquadAttachmentMapping[];
}

/** Refusals a Squad start without review adds to the proposal ones. */
export type SquadLaunchNowErrorCode =
  | SquadProposalErrorCode | 'LAUNCH_REVIEW_REQUIRED' | 'LAUNCH_APPROVAL_UNAVAILABLE'
  | 'LAUNCH_IN_PROGRESS' | 'TOO_MANY_LAUNCHES';

export const LAUNCH_REVIEW_REQUIRED_MESSAGE =
  "This Squad requires review before launch. Use squad_launch with mode 'review' so the user can Launch it from the Inbox.";

/** Advisory tier-fit finding for a checked plan against a Squad's roster. Never changes pass/fail. */
export interface SquadPlanTierFitFinding {
  unitId: string;
  kind: 'over-tiered' | 'under-tiered' | 'no-eligible-slot';
  detail: string;
}

export const ROSTER_TEXT_MAX_CHARS = 60;

/**
 * Squad roster text (labels, persona ids, role tags) is user-authored and ends up in agent prompts, plan cards and
 * Markdown. Display copy only: matching always uses the raw value. Drops control and bidi characters, folds every
 * whitespace run (newlines included) to one space, removes characters that open Markdown, code, headings, quotes or
 * prompt-section delimiters, and caps the length so one name cannot crowd out the rest of a prompt.
 */
export function sanitizeRosterText(value: unknown, max = ROSTER_TEXT_MAX_CHARS): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ')
    .replace(/[`*_#>|<>\[\]{}\\~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…` : cleaned;
}

/** Caps on what one surface carries (requirement 23/24); the card says how many were hidden. */
export const SQUAD_PLAN_BINDING_CAP = 50;
export const SQUAD_PLAN_FINDING_CAP = 50;

/**
 * One finding shape for `squad_plan_check`, launch preflight, `squad_launch` and the Plan correction card.
 * `blocking` is the "hard" of the design notes. The machine fields keep their form; people read
 * {@link formatSquadPlanFinding}, never these fields directly.
 */
export interface SquadPlanFinding {
  /** Absent for document-level findings (`squad`, and any plan-wide `plan` or `format` finding). */
  stepId?: string;
  requirement: 'required-role' | 'prefer-role' | 'not-same-worker' | 'tier' | 'skill' | 'mcp' | 'format' | 'plan' | 'squad';
  severity: 'blocking' | 'warning' | 'repair';
  candidateSlots: { slotId: string; label?: string; personaId: string; reason: string }[];
  /** The most likely fix, naming the Squad's own roles; empty when there is no single fix. */
  suggestion: string;
  degraded?: { slotId: string; why: 'level-unknown' }[];
  /** What the plan said or what changed, for requirements without candidate slots (format, plan, squad, tier). */
  detail?: string;
}

/** Which Squad slot a step will run on (or the offered slots when more than one qualifies). */
export interface SquadPlanBinding {
  stepId: string;
  slotId?: string;
  label?: string;
  personaId?: string;
  /** Why no slot is bound (the step has no qualifying worker slot). */
  unbound?: true;
  /** Steps that will not run if this step fails (transitive dependents, in plan order); absent when none. */
  skipsIfFailed?: string[];
}

/** One line for the launch card: "If this step fails, these steps will not run: a, b and N more". */
export function formatSquadPlanSkipImpact(stepIds: readonly string[], shown = 5): string {
  const rest = stepIds.length - shown;
  return `If this step fails, these steps will not run: ${stepIds.slice(0, shown).join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

export interface SquadPlanCheckSummary {
  mustFix: number;
  check: number;
  fixedForYou: number;
}

const FINDING_SEVERITY_LABEL: Record<SquadPlanFinding['severity'], string> = {
  blocking: 'Must fix',
  warning: 'Check (launch is still allowed)',
  repair: 'Fixed for you'
};

export function squadFindingSeverityLabel(severity: SquadPlanFinding['severity']): string {
  return FINDING_SEVERITY_LABEL[severity];
}

export function summarizeSquadPlanFindings(findings: readonly SquadPlanFinding[]): SquadPlanCheckSummary {
  return {
    mustFix: findings.filter((finding) => finding.severity === 'blocking').length,
    check: findings.filter((finding) => finding.severity === 'warning').length,
    fixedForYou: findings.filter((finding) => finding.severity === 'repair').length
  };
}

/** One line for the launch card, e.g. "2 Must fix before this can launch, 1 to check, 3 fixed for you". */
export function formatSquadPlanSummary(findings: readonly SquadPlanFinding[]): string {
  const { mustFix, check, fixedForYou } = summarizeSquadPlanFindings(findings);
  const parts = [
    mustFix ? `${mustFix} Must fix before this can launch` : '',
    check ? `${check} to check` : '',
    fixedForYou ? `${fixedForYou} fixed for you` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No problems found';
}

function slotName(slot: { label?: string; personaId: string }): string {
  return sanitizeRosterText(slot.label) || sanitizeRosterText(slot.personaId) || 'a member';
}

function nameList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one human-text formatter every surface uses (requirement 23): what the plan asked for, what is wrong in the
 * Squad's own terms, the likely fix, and who acts. No internal terms (severity names, requirement ids, codes).
 */
/** A parser/preflight detail as a sentence: without the step id the heading already names, and ending in a full stop. */
function tidyDetail(detail: string | undefined, stepId: string | undefined): string {
  let text = (detail ?? '').trim();
  if (!text) return '';
  if (stepId) {
    const lead = /^(?:step|work unit)\s+(\S+?):?\s+/i.exec(text);
    if (lead && lead[1] === stepId) text = text.slice(lead[0].length);
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

const PLAN_CHECK_ADVICE = 'Launch is still allowed. You can launch as is, or ask the agent to revise the plan.';

export function formatSquadPlanFinding(finding: SquadPlanFinding): string {
  const step = finding.stepId ? `Step ${finding.stepId}` : 'The plan';
  const offered = nameList([...new Set(finding.candidateSlots.map(slotName))]);
  const fix = finding.suggestion ? ` ${finding.suggestion}` : '';
  const detail = tidyDetail(finding.detail, finding.stepId);
  switch (finding.requirement) {
    case 'required-role':
      return `${step} asks for a role this Squad does not have.${offered ? ` This Squad offers ${offered}.` : ''}${fix} Ask the agent to revise the plan, or edit the plan and launch again.`;
    case 'prefer-role':
      return `${step} prefers a role no member of this Squad has, so it will run on whichever member fits best.${offered ? ` This Squad offers ${offered}.` : ''}${fix} Launch is still allowed.`;
    case 'not-same-worker':
      return `${step} must run on a different member than the steps it names, but this Squad has no other member that fits.${offered ? ` Members that fit: ${offered}.` : ''}${fix} Add a member to the Squad, or ask the agent to revise the plan.`;
    case 'tier':
      return `${step}: ${detail || 'the model level it needs does not match this Squad.'}${fix} Launch is still allowed. You can launch as is, or ask the agent to revise the plan.`.trim();
    case 'skill':
      return `${step} needs a skill that no member of this Squad is allowed to use.${fix} Change the member's skills, or ask the agent to revise the plan.`;
    case 'mcp':
      return `${step} needs a tool server that no member of this Squad is allowed to use.${fix} Change the member's tools, or ask the agent to revise the plan.`;
    case 'squad': // Document-level: the step id is never used.
      return `${detail || 'The plan was written for a different Squad than the one launching it.'}${fix} Role checks use the Squad you are launching.`.trim();
    case 'format':
      return `${step}: ${detail}${finding.severity === 'repair' ? ' Zana fixed this for you.' : `${fix} Launch is still allowed. You can launch as is, or ask the agent to revise the plan.`}`.trim();
    case 'plan':
    default:
      return `${step}: ${detail || 'the plan has a problem.'}${fix} ${finding.severity === 'warning' ? PLAN_CHECK_ADVICE : 'Ask the agent to revise the plan, or edit it and launch again.'}`.trim();
  }
}

/**
 * Only what is wrong, in the Squad's own terms: no remedy sentence and no internal ids from the suggestion.
 * The composer shows this beside its own action buttons, so it must not tell the user to go elsewhere.
 * Agent-facing text and the Inbox card keep `formatSquadPlanFinding`.
 */
export function formatSquadPlanFindingProblem(finding: SquadPlanFinding): string {
  const step = finding.stepId ? `Step ${finding.stepId}` : 'The plan';
  const offered = nameList([...new Set(finding.candidateSlots.map(slotName))]);
  const detail = tidyDetail(finding.detail, finding.stepId);
  switch (finding.requirement) {
    case 'required-role':
      return `${step} asks for a role this Squad does not have.${offered ? ` This Squad offers ${offered}.` : ''}`;
    case 'prefer-role':
      return `${step} prefers a role no member of this Squad has, so it will run on whichever member fits best.${offered ? ` This Squad offers ${offered}.` : ''}`;
    case 'not-same-worker':
      return `${step} must run on a different member than the steps it names, but this Squad has no other member that fits.${offered ? ` Members that fit: ${offered}.` : ''}`;
    case 'tier':
      return `${step}: ${detail || 'the model level it needs does not match this Squad.'}`;
    case 'skill':
      return `${step} needs a skill that no member of this Squad is allowed to use.`;
    case 'mcp':
      return `${step} needs a tool server that no member of this Squad is allowed to use.`;
    case 'squad':
      return detail || 'The plan was written for a different Squad than the one launching it.';
    case 'format':
      return `${step}: ${detail}`.trim();
    case 'plan':
    default:
      return `${step}: ${detail || 'the plan has a problem.'}${finding.severity === 'warning' ? ` ${PLAN_CHECK_ADVICE}` : ''}`;
  }
}

/** Findings capped for a surface, blocking first; `hidden` is what the card must say it left out. */
export function capSquadPlanFindings(findings: readonly SquadPlanFinding[], cap = SQUAD_PLAN_FINDING_CAP): { findings: SquadPlanFinding[]; hidden: number } {
  const rank = { blocking: 0, warning: 1, repair: 2 } as const;
  const ordered = findings.map((finding, index) => ({ finding, index }))
    .sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
  return { findings: ordered.slice(0, cap), hidden: Math.max(0, ordered.length - cap) };
}

/**
 * What to ask the user when a plan they own has a Must fix: concrete fixes first, the unchanged plan last.
 * Built in code so the options do not depend on how an agent words them; the agent only relays it.
 */
export interface SquadPlanDecision {
  question: string;
  options: { label: string; description: string }[];
  /** The option that prepares the launch unchanged. Choosing it means calling squad_launch again with acceptFindings. */
  asIsLabel: string;
  instructions: string;
}

const AS_IS_LABEL = 'Prepare the launch as it is';

export function buildSquadPlanDecision(findings: readonly SquadPlanFinding[]): SquadPlanDecision | undefined {
  const blocking = findings.filter((finding) => finding.severity === 'blocking');
  const first = blocking[0];
  if (!first) return undefined;
  const options: SquadPlanDecision['options'] = [];
  const step = first.stepId ? `step ${first.stepId}` : 'the plan';
  if (first.requirement === 'required-role') {
    const labels = [...new Set(first.candidateSlots.map(slotName))].slice(0, 3);
    for (const label of labels) {
      options.push({ label: `Change Required role to ${label}`, description: `Edit ${step} in a copy of the plan. Your file stays as it is.` });
    }
    options.push({ label: 'Remove the role requirement', description: `Edit ${step} in a copy of the plan so any member can take it. Your file stays as it is.` });
  } else if (first.suggestion) {
    options.push({ label: 'Apply the suggested fix', description: `${first.suggestion} Edit a copy of the plan; your file stays as it is.` });
  }
  options.push({ label: AS_IS_LABEL, description: 'The launch card shows the Must fix and Launch stays blocked until the plan is fixed.' });
  const lead = blocking.length > 1 ? `${blocking.length} Must fix in this plan. The first: ` : '';
  return {
    question: `${lead}${formatSquadPlanFinding(first)} Which fix should I use?`,
    options,
    asIsLabel: AS_IS_LABEL,
    instructions: `Ask the user with the ask-user-question tool using exactly these options (it adds a free-text answer). A fix: apply it to a copy of the plan, never their file, run squad_plan_check again, then call squad_launch with the copy. "${AS_IS_LABEL}": call squad_launch again with acceptFindings: true and the original plan. A free-text answer: follow it.`
  };
}

/** The decision as the plain text a refused squad_launch hands the agent. */
export function formatSquadPlanDecision(decision: SquadPlanDecision): string {
  const lines = decision.options.map((option, index) => `${index + 1}. ${option.label}: ${option.description}`);
  return `${decision.question}\nOptions:\n${lines.join('\n')}\n${decision.instructions}`;
}

export type SquadPlanCheckResult =
  | {
    ok: true; steps: SquadPlanStep[];
    /** Advisory warnings; present only when a teamId was given and there are findings. */
    tierFit?: { findings: SquadPlanTierFitFinding[] };
    /** Every finding for the plan against the launch Squad (`teamId`, else the plan's declared Squad). Capped. */
    findings?: SquadPlanFinding[];
    /** How many findings were left out by the cap. */
    findingsHidden?: number;
    /** Step-to-slot binding table; capped. */
    bindings?: SquadPlanBinding[];
    bindingsHidden?: number;
    /** The Squad the plan said it was written for (`Squad:` in `## Launch`). */
    declaredSquad?: string;
    /** The Squad the findings were judged against. */
    judgedAgainst?: string;
    /** One line for the launch card. */
    summary?: string;
    /** Present when a Must fix remains: the question and options to put to the user. */
    decision?: SquadPlanDecision;
    /** Plain-language warning, present only when no Squad judged the plan (a pass then means "readable", not "runnable"). */
    note?: string;
  }
  | { ok: false; reason: string; findings?: SquadPlanFinding[]; declaredSquad?: string; note?: string };

/** Shown wherever a reviewer sees attached content: it is a private copy, so later edits to the original are not picked up. */
export const SQUAD_ATTACHMENT_FROZEN_NOTE =
  'Attached content was captured when this launch was prepared. Anything changed after that is not included, and the Squad will use only the captured version.';

/** Safe renderer projection that pre-fills the composer from a proposal. */
export interface SquadLaunchPrefill {
  launchOptions?: LaunchOptions;
  launchPreview?: SquadLaunchPreview;
  proposalId: string;
  projectId: string;
  teamId: string;
  coordinationMode: 'freeform' | 'structured';
  goal: string;
  title?: string;
  summary?: string;
  /** `path` and `outsideProject` are set for a file outside the project, so the composer can show where it is. */
  sources: Array<{ id: string; name: string; byteSize: number; expiresAt: number; path?: string; outsideProject?: boolean; attachment?: true }>;
  proposerTitle?: string;
  planStepCount?: number;
  /** Capped (see SQUAD_PLAN_*_CAP). Output only: main re-runs the checks at launch and never reads these back. */
  planFindings?: SquadPlanFinding[];
  planFindingsHidden?: number;
  planBindings?: SquadPlanBinding[];
  planBindingsHidden?: number;
  planSummary?: string;
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
