import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { InboxEntry, Persona, Team, TeamJobLaunchResponse } from '@zana-ai/zcc-domain/product';
import { launchOptionsSchema, type LaunchOptions } from '@zana-ai/zcc-domain/launch-options';
import {
  LAUNCH_REVIEW_REQUIRED_MESSAGE,
  SQUAD_PROPOSAL_LIMITS,
  squadLaunchPreviewSchema,
  type SquadLaunchPreview,
  canAuthorAndRegisterPlan,
  planAuthoringTransportOf,
  planningToCoordinationMode,
  SQUAD_ATTACHMENT_FROZEN_NOTE,
  squadGoalTooLongMessage,
  squadSummaryTooLongMessage,
  type LaunchApproval,
  type SquadLaunchNowErrorCode,
  type SquadLaunchNowResult,
  type SquadLaunchPrefill,
  type SquadPlanCheckResult,
  type SquadPlanFinding,
  type SquadPlanBinding,
  SQUAD_PLAN_BINDING_CAP,
  buildSquadPlanDecision,
  capSquadPlanFindings,
  formatSquadPlanDecision,
  formatSquadPlanFindingProblem,
  formatSquadPlanSummary,
  summarizeSquadPlanFindings,
  type SquadPlanTierFitFinding,
  type SquadPlanStep,
  SQUAD_PLAN_SKIP_IMPACT_CAP,
  type SquadPlanning,
  type SquadProposalErrorCode,
  type SquadAttachmentInput,
  type SquadAttachmentMapping,
  type SquadProposalInput,
  type SquadProposalRecord,
  type SquadProposalTransportPin,
  type SquadProposalResult,
  type SquadProposalSource,
  type SquadProposer
} from '@zana-ai/zcc-domain/squad-proposal';
import { ExecutionSourceError } from '@zana-ai/zcc-server/services/execution/source-registry';
import { isTerminalExecutionState, type ExecutionState } from '@zana-ai/zcc-server/services/execution/store';
import { sourcePolicyText, type SourcePolicy } from '@zana-ai/zcc-server/services/execution/source-policy';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import type { SquadLaunchAttachment, SquadLaunchContext } from '../squad-launch-core.js';
import {
  FILE_MAX_BYTES,
  TOTAL_MAX_BYTES,
  confineSource,
  goalPathNotAllowed,
  goalPathTokens,
  readConfinedSource,
  sha256Hex,
  validateLaunchItems,
  sourceScope,
  type ConfinedSource,
  type LaunchItemsResult,
  type SquadProposalFs,
  type SquadSourceBases,
  type SquadSourceScope
} from './sources.js';
import { isDesignDocSource, readDesignDocSource, type DesignDocsRpc } from './design-doc-source.js';
import { diagnoseNoSteps, planCriticalPathWidth, planSkippedIfFails, NO_EXECUTABLE_STEPS_REASON } from '@zana-ai/zcc-server/services/execution/portable-plan';
import type { SquadProposalStore } from './store.js';
import type { StagingStore, StagedFile } from './staging.js';

export const SQUAD_LAUNCH_PROPOSAL_ACTION = 'squad-launch-proposal';

/** Only trusted validation sites construct this with public admission text, never filesystem errors. */
export class SquadPreviewAdmissionError extends Error {
  constructor(publicMessage: string) {
    super(publicMessage.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 400));
    this.name = 'SquadPreviewAdmissionError';
  }
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const MAX_SLOTS = 32;
const PATH_MAX_CHARS = 4096;
const TITLE_FALLBACK_CHARS = 80;
/**
 * A launch holds its proposal from beginLaunch until markLaunched or releaseLaunch. The
 * timeout only frees a lease whose launch hung; it is far above any real start time.
 */
const LAUNCH_LEASE_MS = 10 * 60_000;
/** Non-terminal Squads one conversation may own through squad_launch `now` before it must wait. */
export const MAX_ACTIVE_NOW_RUNS_PER_SESSION = 3;
/** An identical `now` call from the same conversation within this window returns the run it already started. */
const NOW_DEDUPE_MS = 10 * 60_000;
const NOW_DEDUPE_MAX_ENTRIES = 256;
const PLANNING_LABEL: Record<SquadPlanning, string> = { infer: 'Infer plan from goal', provided: 'Plan provided in goal' };

export type SquadProposalOutcome<T> = { ok: true; value: T } | { ok: false; code: SquadProposalErrorCode; message: string };

export interface SquadProposalRoute { projectId: string; sessionId: string }
/** A failed start passes the launch core's own code through, so it is not limited to the proposal codes. */
export type SquadLaunchNowOutcome = { ok: true; value: SquadLaunchNowResult } | { ok: false; code: SquadLaunchNowErrorCode | (string & {}); message: string };
export type SquadProposerLookup = SquadProposer & { squadMember: boolean; origin?: InboxEntry['origin'] };
export type { SquadProposalFs } from './sources.js';

type ProjectRef = { id: string; name: string; path: string; remote?: unknown };

/** A Squad an agent starts without review, after the same checks as a proposal. */
export interface SquadLaunchNowRequest {
  launchOptions?: LaunchOptions;
  launchPreview?: SquadLaunchPreview;
  team: Team;
  project: ProjectRef;
  goal: string;
  coordinationMode: 'structured' | 'freeform';
  title?: string;
  summary?: string;
  completionInboxNotice: boolean;
  /** Realpaths of the confined sources the agent listed. */
  sourcePaths: string[];
  /** Text the agent handed over by value, already named and de-duplicated; snapshotted in memory. */
  attachments?: SquadLaunchAttachment[];
}

export interface SquadLaunchNowDeps {
  /** The effective approval for a Squad in a Project: review when either the Squad or the Project asks for it. */
  launchApproval(teamId: string, projectId: string): Promise<LaunchApproval>;
  /** Non-terminal runs this session owns in the project. */
  activeOwnedRuns(sessionId: string, projectId: string): Promise<number>;
  /**
   * Current state of a run this session started, or undefined when the run no longer exists.
   * A repeated launch is deduped only while its run is not terminal: a terminal or missing run
   * is evicted and the repeat starts a new one; a lookup that throws keeps the cached launch.
   * When this callback is not provided, the cached launch is returned without a state check.
   */
  executionState?(executionId: string): Promise<ExecutionState | undefined>;
  launch(request: SquadLaunchNowRequest, ctx: SquadLaunchContext): Promise<TeamJobLaunchResponse & {
    value?: { executionId: string; state: string; location?: SquadLaunchNowResult['location']; path?: string; branch?: string };
  }>;
}

/** A finding as the plan parser emits it, before it is judged against a roster. */
export interface PlanParserFinding {
  severity: SquadPlanFinding['severity'];
  requirement: SquadPlanFinding['requirement'];
  stepId?: string;
  message: string;
}

export interface SquadLaunchPreviewRequest {
  teamId: string;
  projectId: string;
  planning: SquadPlanning;
  goal: string;
  sourcePaths: string[];
  attachments: SquadLaunchAttachment[];
  launchOptions: LaunchOptions;
}

export interface SquadProposalServiceDeps {
  resolveLaunchPreview?(input: SquadLaunchPreviewRequest): Promise<SquadLaunchPreview>;
  store: SquadProposalStore;
  enabled(): boolean;
  lookupProposer(sessionId: string, projectId: string): Promise<SquadProposerLookup | null>;
  projects: { get(id: string): ProjectRef | undefined };
  teams: { get(id: string): Team | undefined };
  personas: { get(id: string): Persona | undefined };
  teamHostProblem(project: ProjectRef): string | undefined;
  /** Effective transport for a Squad (resolver chain); the proposer, when known, is the caller. Absent: the Squad's own value. */
  resolveTransport?(team: Team, project: ProjectRef, callerTransport?: 'CLI' | 'MODERN'): SquadProposalTransportPin | { refusal: string };
  expandTeamSlots(team: Team): readonly unknown[];
  resolveSquadPlan(
    planSource: 'provided',
    texts: string[]
  ): {
    workUnits?: Array<{ id: string; title: string; dependencies: string[]; files?: string[] }>; planError?: string;
    findings?: readonly PlanParserFinding[]; declaredSquad?: string;
  };
  /**
   * Judges a checked plan against a Squad's roster in the one finding shape. `teamId` is the launch target (or the
   * declared Squad for `squad_plan_check` without one); undefined yields parser-only findings. Failures are swallowed
   * by the caller: findings never turn a good plan into an error.
   */
  /** The checked plan re-rendered in the Squad plan grammar, or undefined when it cannot be rendered within `maxBytes`. */
  canonicalPlanText?(workUnits: readonly unknown[], options: { declaredSquad?: string; maxBytes: number }): string | undefined;
  planFindings?(projectId: string, teamId: string | undefined, plan: { workUnits: readonly unknown[]; findings?: readonly PlanParserFinding[]; declaredSquad?: string }):
    Promise<{ findings: SquadPlanFinding[]; bindings: SquadPlanBinding[] }>;
  /**
   * Advisory tier-fit findings for a checked plan against a Squad's roster (squad_plan_check with a teamId).
   * Must not throw for a missing roster; failures are swallowed by the caller since the result is advisory.
   */
  planTierFit?(projectId: string, teamId: string, workUnits: readonly unknown[]): Promise<readonly SquadPlanTierFitFinding[]>;
  fs: SquadProposalFs;
  /**
   * Design Docs plugin RPC, for `doc://` sources. Absent: a `doc://` source is refused with a plain message. The doc is
   * read in main, must belong to the launching project, and is snapshotted as an attachment (never written to the project).
   */
  designDocs?: DesignDocsRpc;
  /** HOME, the clone root and Zana's data folders: with the project, the bases of the source policy. */
  sourceBases(): SquadSourceBases;
  inbox: { appendOnce(input: InboxInput): Promise<InboxEntry> };
  actions: {
    /** Returns false when the action could not be bound (e.g. inert registry). */
    bind(entry: InboxEntry, action: { kind: string; ref: string }): boolean | void;
    markUnavailable(kind: string, ref: string, message: string): void;
  };
  /** `policy` confines each source at capability time (re-checked against the issued realpath). */
  issueSources(windowId: number | string, projectId: string, paths: string[], policy: SourcePolicy): Promise<Array<{ id: string; name: string; byteSize: number; expiresAt: number }>>;
  now(): number;
  newId(): string;
  /**
   * The execution already started from this proposal, if any. Guards a second launch when
   * recording the first failed or the app crashed between start and markLaunched.
   */
  findLaunchedExecution?(projectId: string, proposalId: string): Promise<string | undefined>;
  /** Unexpected failures are logged here with their context; callers only see a stable message. */
  logError(context: string, error: unknown): void;
  /** Absent ⇒ attachments cannot be kept for review (they still work for a Squad started straight away). */
  staging?: StagingStore;
  /** Absent ⇒ an agent cannot start a Squad without review. */
  launchNow?: SquadLaunchNowDeps;
  /** Sends text into the proposing conversation. Absent ⇒ the fix request can only be copied. */
  sendToProposer?(proposer: SquadProposer, projectId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
}

/** The plan-review part of a prefill, re-read from the plan files. */
export type SquadPlanRecheck = Pick<SquadLaunchPrefill, 'planFindings' | 'planFindingsHidden' | 'planBindings' | 'planBindingsHidden' | 'planSummary' | 'planStepCount' | 'planCanonicalText' | 'planSkipImpact' | 'planSkipImpactHidden'>;

const STAGING_RETRIES = 5;

const fail = <C extends SquadLaunchNowErrorCode = SquadProposalErrorCode>(code: C, message: string): { ok: false; code: C; message: string } => ({ ok: false, code, message });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const noStagingStore = () => fail('INVALID', 'Attached content cannot be kept for review here. Start the Squad now instead, or pass files in sources.');
const tooManyProposals = () => fail('TOO_MANY_PROPOSALS',
  `This project already has ${SQUAD_PROPOSAL_LIMITS.maxPendingPerProject} pending Squad launch proposals. Dismiss some in the Inbox first.`);

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '').slice(0, max);
}

/** Field checks on an agent's proposal input; undefined when it is well formed. */
function validateInput(input: SquadProposalInput): string | undefined {
  const L = SQUAD_PROPOSAL_LIMITS;
  if (!input || typeof input !== 'object') return 'Proposal input is required.';
  if ('location' in input || 'launchPreview' in input || 'resolvedLaunch' in input || 'source' in input) return 'Launch location and sources are host-owned.';
  if (!launchOptionsSchema.safeParse(input.launchOptions ?? {}).success) return 'Invalid launch options.';
  if (typeof input.teamId !== 'string' || !input.teamId.trim()) return 'teamId is required.';
  if (typeof input.goal !== 'string' || !input.goal.trim()) return 'goal is required.';
  if (input.goal.length > L.goalChars) return squadGoalTooLongMessage(input.goal.length);
  if (input.planning !== undefined && input.planning !== 'infer' && input.planning !== 'provided') return "planning must be 'infer' or 'provided'.";
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > L.titleChars)) return `title must be at most ${L.titleChars} characters.`;
  if (input.summary !== undefined && typeof input.summary !== 'string') return 'summary must be text.';
  if (input.summary !== undefined && input.summary.length > L.summaryChars) return squadSummaryTooLongMessage(input.summary.length);
  if (input.completionInboxNotice !== undefined && typeof input.completionInboxNotice !== 'boolean') return 'completionInboxNotice must be a boolean.';
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) return 'sources must be a list of paths.';
    if (input.sources.length <= L.maxSources && input.sources.some((s) => typeof s !== 'string' || !s.trim() || s.length > PATH_MAX_CHARS)) {
      return 'Each source must be a non-empty path.';
    }
  }
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments)) return 'attachments must be a list of { name, text }.';
    if (input.attachments.some((a) => !a || typeof a.name !== 'string' || typeof a.text !== 'string')) {
      return 'Each attachment needs a name and text.';
    }
  }
  return undefined;
}

/** An attachment kept for the launch: its final name, text and size. */
interface PreparedAttachment { name: string; text: string; bytes: number }

interface Prepared {
  resolvedTransport?: SquadProposalTransportPin;
  launchPreview?: SquadLaunchPreview;
  project: ProjectRef;
  /** Undefined only when the project folder is unavailable and nothing needed it. */
  scope?: SquadSourceScope;
  team: Team;
  orchestrator: Persona;
  workers: number;
  planning: SquadPlanning;
  sources: SquadProposalSource[];
  planSteps?: SquadPlanStep[];
  planFindings?: SquadPlanFinding[];
  planBindings?: SquadPlanBinding[];
  planCanonicalText?: string;
  /** Attachments kept after de-duplication, in the order given. */
  attachments: PreparedAttachment[];
  /** One entry per attachment given; empty when none were. */
  attachmentMapping: SquadAttachmentMapping[];
}

const LAUNCH_ITEM_ERROR_CODES: Record<Extract<LaunchItemsResult, { ok: false }>['code'], SquadProposalErrorCode> = {
  INVALID_NAME: 'INVALID', NAME_TOO_LONG: 'INVALID', TOO_MANY_ITEMS: 'TOO_MANY_SOURCES',
  ITEM_TOO_LARGE: 'SOURCE_TOO_LARGE', TOTAL_TOO_LARGE: 'SOURCE_TOO_LARGE'
};

/**
 * Name and budget the attachments together with the path sources, by the one launch-item
 * validator the registry also uses. Path sources are never renamed, and an attachment is never
 * folded into one (their contents are not compared here), so a clash with a source is numbered.
 */
function prepareAttachments(sources: ConfinedSource[], given: readonly SquadAttachmentInput[]): SquadProposalOutcome<{
  attachments: PreparedAttachment[]; mapping: SquadAttachmentMapping[];
}> {
  if (!given.length) return ok({ attachments: [], mapping: [] });
  const encoded = given.map((a) => Buffer.from(a.text, 'utf8'));
  const checked = validateLaunchItems([
    ...sources.map((s) => ({ kind: 'source' as const, name: basename(s.source.path), byteSize: s.source.bytes, sha256: `path:${s.source.path}` })),
    ...given.map((a, i) => ({ kind: 'attachment' as const, name: a.name, byteSize: encoded[i]!.byteLength, sha256: sha256Hex(encoded[i]!) }))
  ]);
  if (!checked.ok) return fail(LAUNCH_ITEM_ERROR_CODES[checked.code], checked.message);
  const attachments: PreparedAttachment[] = [];
  for (const kept of checked.kept) {
    if (kept.index < sources.length) continue;
    const at = kept.index - sources.length;
    attachments.push({ name: kept.name, text: given[at]!.text, bytes: encoded[at]!.byteLength });
  }
  const mapping = checked.mapping.map(({ given: g, used, deduplicated }) => ({ given: g, used, ...(deduplicated ? { deduplicated } : {}) }));
  return ok({ attachments, mapping });
}

const toPlanSteps = (units: Array<{ id: string; title: string; dependencies: string[]; files?: string[] }>): SquadPlanStep[] => {
  const skipped = planSkippedIfFails(units);
  return units.map((u) => ({ id: u.id, title: u.title, dependencies: [...u.dependencies], writeScope: [...(u.files ?? [])], skippedIfFails: skipped.get(u.id) ?? [] }));
};

/** Steps that would skip something if they failed, biggest first is left to the card; capped for the prefill. */
function skipImpactRows(steps: readonly SquadPlanStep[] | undefined): Pick<SquadLaunchPrefill, 'planSkipImpact' | 'planSkipImpactHidden'> {
  const titles = new Map((steps ?? []).map((s) => [s.id, s.title] as const));
  const rows = (steps ?? []).filter((s) => s.skippedIfFails?.length).map((s) => ({ stepId: s.id, title: s.title, skips: [...s.skippedIfFails!], skipTitles: s.skippedIfFails!.map((id) => titles.get(id) ?? '') }));
  if (!rows.length) return {};
  const shown = rows.slice(0, SQUAD_PLAN_SKIP_IMPACT_CAP);
  return { planSkipImpact: shown, ...(rows.length > shown.length ? { planSkipImpactHidden: rows.length - shown.length } : {}) };
}

/** The project, its host, the Squad, its orchestrator and slot count, as Launch will see them. */
function resolveSquad(deps: SquadProposalServiceDeps, projectId: string, teamId: string): SquadProposalOutcome<{
  project: ProjectRef; team: Team; orchestrator: Persona; slots: number;
}> {
  const project = deps.projects.get(projectId);
  if (!project) return fail('NOT_FOUND', 'Project not found.');
  const hostProblem = deps.teamHostProblem(project);
  if (hostProblem) return fail('HOST_UNSUPPORTED', hostProblem);
  const team = deps.teams.get(teamId);
  if (!team) return fail('TEAM_NOT_FOUND', `Squad ${teamId} was not found. Use list_teams to see the available Squads.`);
  const orchestrator = team.orchestratorPersonaId ? deps.personas.get(team.orchestratorPersonaId) : undefined;
  if (!orchestrator) return fail('NO_ORCHESTRATOR', `Squad ${team.name} has no orchestrator persona.`);
  const slots = deps.expandTeamSlots(team).length;
  if (slots < 1 || slots > MAX_SLOTS) return fail('INVALID', `Squad ${team.name} must have between 1 and ${MAX_SLOTS} members.`);
  return ok({ project, team, orchestrator, slots });
}

/** Every source allowed by the source policy, de-duplicated by realpath and within the size caps. */
async function confineSources(fs: SquadProposalFs, scope: SquadSourceScope | undefined, rawSources: string[]): Promise<SquadProposalOutcome<ConfinedSource[]>> {
  if (rawSources.length > SQUAD_PROPOSAL_LIMITS.maxSources) {
    return fail('TOO_MANY_SOURCES', `At most ${SQUAD_PROPOSAL_LIMITS.maxSources} source files are allowed.`);
  }
  if (rawSources.length && !scope) return fail('NOT_FOUND', 'The project folder is not available.');
  const sources: ConfinedSource[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of rawSources) {
    const confined = await confineSource(fs, scope!, raw);
    if (!confined.ok) return confined;
    if (seen.has(confined.source.path)) continue;
    seen.add(confined.source.path);
    if (confined.source.bytes > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${raw} is larger than 4 MiB.`);
    total += confined.source.bytes;
    if (total > TOTAL_MAX_BYTES) return fail('SOURCE_TOO_LARGE', 'The source files add up to more than 16 MiB.');
    sources.push({ source: confined.source, identity: confined.identity });
  }
  return ok(sources);
}

/** A provided plan must parse into steps from the sources (read through verified handles) plus the goal. */
async function checkProvidedPlan(
  deps: SquadProposalServiceDeps, scope: SquadSourceScope | undefined, sources: ConfinedSource[], goal: string,
  attachments: readonly PreparedAttachment[] = []
): Promise<SquadProposalOutcome<{ steps: SquadPlanStep[]; workUnits: readonly unknown[]; findings?: readonly PlanParserFinding[]; declaredSquad?: string }>> {
  let texts: string[];
  try { texts = await Promise.all(sources.map((s) => readConfinedSource(deps.fs, scope!, s))); } catch {
    return fail('SOURCE_UNREADABLE', 'A source file could not be read, or it changed after it was checked.');
  }
  const plan = deps.resolveSquadPlan('provided', [...texts, ...attachments.map((a) => a.text), goal]);
  // Say why no step was found, in the parser's own words, instead of the bare stable reason.
  if (plan.planError) return fail('INVALID_PLAN', plan.planError === NO_EXECUTABLE_STEPS_REASON ? `${plan.planError}. ${diagnoseNoSteps([...texts, ...attachments.map((a) => a.text), goal].join('\n\n'))}` : plan.planError);
  if (!plan.workUnits?.length) return fail('INVALID_PLAN', 'No plan steps were found in the goal or the source files.');
  return ok({ steps: toPlanSteps(plan.workUnits), workUnits: plan.workUnits, findings: plan.findings, declaredSquad: plan.declaredSquad });
}

/** Checks 4-10 of §5, shared by propose and review (which re-runs them on current files). */
async function prepare(
  deps: SquadProposalServiceDeps, projectId: string, teamId: string, goal: string, planningInput: SquadPlanning | undefined, rawSources: string[],
  rawAttachments: readonly SquadAttachmentInput[] = [], launchOptions?: LaunchOptions, proposerKind?: string
): Promise<SquadProposalOutcome<Prepared>> {
  const squad = resolveSquad(deps, projectId, teamId);
  if (!squad.ok) return squad;
  const { project, team, orchestrator, slots } = squad.value;
  const scope = await sourceScope(deps.fs, project.path, deps.sourceBases(), { remote: Boolean(project.remote) });
  // `doc://` sources are read from the Design Docs plugin and joined to the attachments (a snapshot, not a project file).
  const docSources = rawSources.filter(isDesignDocSource);
  const docAttachments: SquadAttachmentInput[] = [];
  for (const raw of docSources) {
    const doc = await readDesignDocSource(deps.designDocs, projectId, raw);
    if (!doc.ok) return doc;
    if (!docAttachments.some((a) => a.name === doc.name)) docAttachments.push({ name: doc.name, text: doc.text });
  }
  const sources = await confineSources(deps.fs, scope, rawSources.filter((raw) => !isDesignDocSource(raw)));
  if (!sources.ok) return sources;
  const attached = prepareAttachments(sources.value, [...rawAttachments, ...docAttachments]);
  if (!attached.ok) return attached;
  // Without the project folder nothing can be judged, and Launch would otherwise discover the goal's paths unchecked.
  if (!scope && goalPathTokens(goal).length) {
    return fail('NOT_FOUND', 'The project folder is not available, so the paths named in the goal can\'t be checked. Remove them from the goal, or try again once the project folder is back.');
  }
  const listed = new Set(sources.value.map((s) => s.source.path));
  const refusedGoalPath = scope ? await goalPathNotAllowed(deps.fs, scope, goal, listed) : undefined;
  if (refusedGoalPath?.reason === 'outside-project') {
    return fail('SOURCE_NOT_ALLOWED', `The goal names ${refusedGoalPath.path}, which is outside this project. Pass it in sources instead, so the user sees it on the card before Launch.`);
  }
  if (refusedGoalPath?.reason === 'hard-linked') {
    return fail('SOURCE_NOT_ALLOWED', `The goal names ${refusedGoalPath.path}, a hard-linked file, which can't be attached. Remove the path from the goal, or name a file that can be.`);
  }
  if (refusedGoalPath) {
    return fail('SOURCE_NOT_ALLOWED', `The goal names ${refusedGoalPath.path}, which can't be attached. ${sourcePolicyText(scope?.policy)} Remove the path from the goal, or name a file that can be.`);
  }
  const callerTransport = proposerKind === 'pty' ? 'CLI' : proposerKind ? 'MODERN' : undefined;
  const resolution = deps.resolveTransport?.(team, project, callerTransport);
  // An explicit Modern pin that cannot run here is refused, never quietly pinned as CLI.
  if (resolution && 'refusal' in resolution) return fail('TRANSPORT_UNAVAILABLE', resolution.refusal);
  const resolvedTransport = resolution;
  const transport = planAuthoringTransportOf(resolvedTransport ? resolvedTransport.transport : team.transport);
  const canInfer = canAuthorAndRegisterPlan(orchestrator, { transport });
  const planning: SquadPlanning = planningInput ?? team.defaultPlanning ?? (canInfer ? 'infer' : 'provided');
  if (planning === 'infer' && !canInfer) {
    const reason = transport === 'modern' ? "can't call execution.plan.register" : "can't write files";
    return fail('ORCHESTRATOR_CANNOT_PLAN',
      `${orchestrator.name} ${reason}, so Infer plan from goal can't finish. Write a portable plan, check it with squad_plan_check, and propose with planning 'provided'.`);
  }
  let planSteps: SquadPlanStep[] | undefined;
  let planFindings: SquadPlanFinding[] | undefined;
  let planBindings: SquadPlanBinding[] | undefined;
  let planCanonicalText: string | undefined;
  if (planning === 'provided') {
    const plan = await checkProvidedPlan(deps, scope, sources.value, goal, attached.value.attachments);
    if (!plan.ok) return plan;
    planSteps = plan.value.steps;
    try {
      planCanonicalText = deps.canonicalPlanText?.(plan.value.workUnits, { declaredSquad: plan.value.declaredSquad, maxBytes: SQUAD_PROPOSAL_LIMITS.planTextBytes });
    } catch (error) { deps.logError('canonical plan text', error); }
    // Advisory display data for the card. The launch itself re-runs the hard checks in main and never reads these back.
    if (deps.planFindings) {
      try {
        const judged = await deps.planFindings(projectId, teamId, plan.value);
        planFindings = judged.findings;
        planBindings = judged.bindings;
      } catch (error) { deps.logError('plan findings', error); }
    }
  }
  if (!deps.resolveLaunchPreview && launchOptions && Object.keys(launchOptions).length) {
    return fail('INVALID', 'Launch preview is unavailable; requested options and target cannot be verified.');
  }
  let launchPreview: SquadLaunchPreview | undefined;
  try { launchPreview = deps.resolveLaunchPreview ? squadLaunchPreviewSchema.parse(await deps.resolveLaunchPreview({
    teamId, projectId, planning, goal, sourcePaths: sources.value.map((s) => s.source.path),
    attachments: attached.value.attachments.map(({ name, text }) => ({ name, text })), launchOptions: launchOptions ?? {}
  })) : undefined; } catch (error) {
    if (error instanceof SquadPreviewAdmissionError) return fail('INVALID', error.message);
    throw error;
  }
  if (launchPreview && launchPreview.location.projectId !== projectId) return fail('INVALID', 'Launch preview belongs to another project.');
  return ok({
    ...(launchPreview ? { launchPreview } : {}),
    ...(resolvedTransport ? { resolvedTransport } : {}),
    project, ...(scope ? { scope } : {}), team, orchestrator, workers: Math.max(0, slots - 1), planning,
    sources: sources.value.map((s) => s.source), ...(planSteps ? { planSteps } : {}),
    ...(planFindings ? { planFindings } : {}), ...(planBindings ? { planBindings } : {}),
    ...(planCanonicalText ? { planCanonicalText } : {}),
    attachments: attached.value.attachments, attachmentMapping: attached.value.mapping
  });
}

function newRecord(
  deps: SquadProposalServiceDeps, projectId: string, input: SquadProposalInput, prepared: Prepared, proposer: SquadProposerLookup,
  staged?: { id: string; sources: SquadProposalSource[]; bytes: number }
): SquadProposalRecord {
  const at = deps.now();
  return {
    id: staged?.id ?? deps.newId(),
    projectId,
    proposer: { kind: proposer.kind, id: proposer.id, ...(proposer.title ? { title: proposer.title } : {}) },
    teamId: prepared.team.id,
    goal: input.goal,
    planning: prepared.planning,
    ...(input.launchOptions ? { launchOptions: input.launchOptions } : {}),
    ...(prepared.resolvedTransport ? { resolvedTransport: prepared.resolvedTransport } : {}),
    ...(prepared.launchPreview ? { launchPreview: prepared.launchPreview, location: prepared.launchPreview.location } : {}),
    sources: staged ? [...prepared.sources, ...staged.sources] : prepared.sources,
    title: input.title?.trim() || firstLine(input.goal, TITLE_FALLBACK_CHARS),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(prepared.planSteps ? { planSteps: prepared.planSteps } : {}),
    state: staged ? 'staging' : 'pending',
    ...(staged ? { staged: { bytes: staged.bytes } } : {}),
    createdAt: at,
    updatedAt: at,
    expiresAt: at + SQUAD_PROPOSAL_LIMITS.ttlMs
  };
}

/** The host-owned Inbox card. Its only option is Dismiss; Review is the card's own button. */
function proposalCard(record: SquadProposalRecord, prepared: Prepared, proposer: SquadProposerLookup): InboxInput {
  const { team, orchestrator, workers, planning, planSteps } = prepared;
  const sources = record.sources;
  const attached = sources.some((s) => s.attachment);
  const comments = [
    `- Squad: ${team.name} (${orchestrator.name} + ${plural(workers, 'worker')})`,
    `- Planning: ${PLANNING_LABEL[planning]}${planSteps ? ` — plan checked: ${plural(planSteps.length, 'step')}` : ''}`,
    // The plan check line is coloured, so it is drawn from `squadProposal.planCheck`, not written here.
    // Location and launch policies are in the composer under Review settings; the card stays short.
    ...(sources.length ? [`- Files: ${sources.map((s) => (s.attachment ? `${s.relPath} (attached)` : s.outsideProject ? `${s.relPath} (outside the Project)` : s.relPath)).join(', ')}`] : []),
    ...(attached ? [`- ${SQUAD_ATTACHMENT_FROZEN_NOTE}`] : []),
    '- Nothing starts until you press Launch.'
  ].join('\n');
  const origin = proposer.origin ?? (proposer.kind === 'thread' ? { threadId: proposer.id } : undefined);
  return {
    projectId: record.projectId,
    subject: `Squad launch ready: ${record.title}`,
    intent: `Prepared in "${proposer.title ?? 'a conversation'}"`,
    comments,
    // Inbox documents open inside the project; a file outside it is named in the comments instead.
    docs: sources.filter((s) => !s.outsideProject && !s.attachment).map((s) => ({ path: s.relPath })),
    hostActionRequired: true,
    squadProposal: { proposalId: record.id, ...(prepared.planFindings ? { planCheck: summarizeSquadPlanFindings(prepared.planFindings) } : {}) },
    questions: [{ prompt: 'Squad launch', options: [{ id: 'dismiss', label: 'Dismiss' }] }],
    dedupeKey: `squad-proposal:${record.id}`,
    sessionId: proposer.id,
    ...(origin ? { origin } : {})
  };
}

/** What the agent is told about the Squad, its plan and its files, proposed or started. */
function preparedSummary(prepared: Prepared): Pick<SquadProposalResult, 'team' | 'planning' | 'plan' | 'sources' | 'attachments'> {
  const { team, orchestrator, workers, planning, sources, planSteps, attachmentMapping } = prepared;
  return {
    team: { id: team.id, name: team.name, workers, orchestrator: orchestrator.name },
    planning,
    plan: planSteps ? { steps: planSteps.map((s) => ({ id: s.id, title: s.title })) } : null,
    sources: sources.map((s) => ({ path: s.relPath, bytes: s.bytes, ...(s.outsideProject ? { outsideProject: true } : {}) })),
    ...(attachmentMapping.length ? { attachments: attachmentMapping } : {})
  };
}

function proposalResult(record: SquadProposalRecord, prepared: Prepared, entry: InboxEntry): SquadProposalResult {
  return { proposalId: record.id, inboxEntryId: entry.id, ...preparedSummary(prepared), ...(record.launchPreview ? { launchPreview: record.launchPreview } : {}), expiresAt: record.expiresAt };
}

/**
 * One key per conversation, project and launch content, so a retried call can be recognised without keeping the goal.
 * Title and summary stay out: retries reword them, and catching retries is what dedupe is for.
 */
function nowDedupeKey(sessionId: string, projectId: string, input: SquadProposalInput, prepared: Prepared): string {
  return createHash('sha256').update(JSON.stringify([
    sessionId, projectId, prepared.team.id, input.goal.trim(), prepared.planning, prepared.sources.map((s) => s.path).sort(),
    prepared.attachments.map((a) => [a.name, sha256Hex(Buffer.from(a.text, 'utf8'))]).sort(),
    launchOptionsSchema.parse(input.launchOptions ?? {}), prepared.launchPreview?.fingerprint
  ])).digest('hex');
}

/** Recently started `now` runs by dedupe key, expiring after the window and capped in size. */
function createNowDedupe(now: () => number) {
  const entries = new Map<string, { at: number; result: SquadLaunchNowResult }>();
  const prune = () => {
    const cutoff = now() - NOW_DEDUPE_MS;
    for (const [key, entry] of entries) if (entry.at <= cutoff) entries.delete(key);
  };
  return {
    get(key: string): SquadLaunchNowResult | undefined {
      prune();
      return entries.get(key)?.result;
    },
    delete(key: string): void {
      entries.delete(key);
    },
    set(key: string, result: SquadLaunchNowResult): void {
      prune();
      entries.delete(key);
      entries.set(key, { at: now(), result });
      // Oldest first: Map keeps insertion order.
      while (entries.size > NOW_DEDUPE_MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    }
  };
}

/** Capped findings and binding table for the composer card, with how many were left out. */
function planDisplay(prepared: Prepared): Partial<SquadLaunchPrefill> {
  if (!prepared.planFindings && !prepared.planBindings && !prepared.planCanonicalText && !prepared.planSteps?.length) return {};
  const capped = capSquadPlanFindings(prepared.planFindings ?? []);
  const bindings = (prepared.planBindings ?? []).slice(0, SQUAD_PLAN_BINDING_CAP);
  const bindingsHidden = Math.max(0, (prepared.planBindings?.length ?? 0) - bindings.length);
  return {
    ...(capped.findings.length ? { planFindings: capped.findings } : {}),
    ...(capped.hidden ? { planFindingsHidden: capped.hidden } : {}),
    ...(bindings.length ? { planBindings: bindings } : {}),
    ...(bindingsHidden ? { planBindingsHidden: bindingsHidden } : {}),
    planSummary: formatSquadPlanSummary(prepared.planFindings ?? []),
    ...skipImpactRows(prepared.planSteps),
    ...(prepared.planCanonicalText ? { planCanonicalText: prepared.planCanonicalText } : {})
  };
}

function launchPrefill(record: SquadProposalRecord, prepared: Prepared, issued: SquadLaunchPrefill['sources']): SquadLaunchPrefill {
  return {
    proposalId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    ...(record.launchOptions ? { launchOptions: record.launchOptions } : {}),
    ...(record.launchPreview ? { launchPreview: record.launchPreview } : {}),
    coordinationMode: planningToCoordinationMode(prepared.planning),
    goal: record.goal,
    ...(record.title ? { title: record.title } : {}),
    ...(record.summary ? { summary: record.summary } : {}),
    // issueSources returns one capability per path, in order.
    sources: issued.map((s, index) => {
      const source = prepared.sources[index];
      return {
        id: s.id, name: s.name, byteSize: s.byteSize, expiresAt: s.expiresAt,
        ...(source?.attachment ? { attachment: true as const }
          : source?.outsideProject ? { path: source.relPath, outsideProject: true } : {})
      };
    }),
    ...(record.proposer.title ? { proposerTitle: record.proposer.title } : {}),
    ...(prepared.planSteps ? { planStepCount: prepared.planSteps.length } : {}),
    ...planDisplay(prepared)
  };
}

/** In-memory launch holds, one per proposal, from beginLaunch until markLaunched or releaseLaunch. */
function createLaunchLeases(now: () => number) {
  const until = new Map<string, number>();
  return {
    active(proposalId: string): boolean {
      const expiry = until.get(proposalId);
      return expiry !== undefined && expiry > now();
    },
    take(proposalId: string): void { until.set(proposalId, now() + LAUNCH_LEASE_MS); },
    release(proposalId: string): void { until.delete(proposalId); }
  };
}

export function createSquadProposalService(deps: SquadProposalServiceDeps) {
  const { store } = deps;
  const leases = createLaunchLeases(() => deps.now());
  // One `now` launch in flight per conversation; the lease timeout only frees a hung launch.
  const nowLeases = createLaunchLeases(() => deps.now());
  const nowDedupe = createNowDedupe(() => deps.now());

  /**
   * The cached result for a repeat launch, with the run's current state. A run that has finished
   * or cannot be found is evicted so the repeat starts a new one; a state lookup that throws keeps
   * the cached result, so a transient failure never starts a duplicate run.
   */
  async function liveDedupe(launchNow: SquadLaunchNowDeps, key: string): Promise<SquadLaunchNowResult | undefined> {
    const cached = nowDedupe.get(key);
    if (!cached || !launchNow.executionState) return cached;
    let state: ExecutionState | undefined;
    try {
      state = await launchNow.executionState(cached.executionId);
    } catch (error) {
      log('launch now state', error);
      return cached;
    }
    if (!state || isTerminalExecutionState(state)) {
      nowDedupe.delete(key);
      return undefined;
    }
    return { ...cached, state };
  }

  function log(context: string, error: unknown): void {
    try { deps.logError(`squad proposal ${context}`, error); } catch { /* logging must not throw */ }
  }
  /** An unexpected failure: the cause goes to the log, the caller gets a stable message without internals. */
  function unexpected<C extends SquadLaunchNowErrorCode = SquadProposalErrorCode>(context: string, error: unknown, message: string, code: C = 'INVALID' as C) {
    log(context, error);
    return fail(code, message);
  }

  /** pending → launched (never from another state), then retire the card's buttons. */
  async function recordLaunched(proposalId: string, executionId: string): Promise<void> {
    const record = await store.update(proposalId, (r) => { if (r.state === 'pending') { r.state = 'launched'; r.executionId = executionId; } });
    if (!record) return;
    if (record.state === 'launched') await removeStaged(record);
    try {
      deps.actions.markUnavailable(SQUAD_LAUNCH_PROPOSAL_ACTION, proposalId, `Launched as "${record.title ?? 'Squad'}". Open it from the Agents board.`);
    } catch { /* the card may already be gone */ }
  }

  // Serialises the pending-cap check with the create, so concurrent proposals cannot overshoot the cap.
  let createChain: Promise<unknown> = Promise.resolve();
  function serialised<T>(task: () => Promise<T>): Promise<T> {
    const run = createChain.then(task, task);
    createChain = run.catch(() => undefined);
    return run;
  }
  const pendingCapReached = async (projectId: string): Promise<boolean> =>
    (await store.listPending(projectId)).length >= SQUAD_PROPOSAL_LIMITS.maxPendingPerProject;
  const stagingInFlight = new Set<string>();
  const stagingFailures = new Map<string, number>();

  /** Remove a proposal's private attachment copies. A failure is logged; the sweep retries it. */
  async function removeStaged(record: Pick<SquadProposalRecord, 'id' | 'staged'>): Promise<void> {
    if (!record.staged || !deps.staging) return;
    try {
      await deps.staging.remove(record.id);
      stagingFailures.delete(record.id);
    } catch (error) {
      log(`${record.id} staged cleanup`, error);
    }
  }

  /**
   * Create the record unless the project is at its pending cap. With attachments, the private
   * copies are written under a `staging` record (so a crash leaves something to clean up), within
   * a global byte cap measured from disk. Nothing is ever evicted to make room.
   */
  const createWithinCap = (record: SquadProposalRecord, files: readonly StagedFile[]): Promise<SquadProposalOutcome<true>> => serialised(async () => {
    if (await pendingCapReached(record.projectId)) return tooManyProposals();
    if (!record.staged) {
      const { pruned } = await store.create(record);
      for (const gone of pruned) await removeStaged(gone);
      return ok(true as const);
    }
    const staging = deps.staging;
    if (!staging) return noStagingStore();
    const used = await staging.usedBytes();
    if (used + record.staged.bytes > SQUAD_PROPOSAL_LIMITS.maxStagedBytes) {
      return fail('TOO_MANY_PROPOSALS',
        `Attached content waiting in the Inbox is at its ${SQUAD_PROPOSAL_LIMITS.maxStagedBytes / (1024 * 1024)} MiB limit. Dismiss a pending Squad launch proposal that has attachments, or start this Squad now instead. Existing proposals were left as they are.`);
    }
    stagingInFlight.add(record.id);
    try {
      const { pruned } = await store.create(record);
      for (const gone of pruned) await removeStaged(gone);
      try {
        await staging.write(record.id, files);
        await store.update(record.id, (r) => { if (r.state === 'staging') r.state = 'pending'; });
      } catch (error) {
        await removeStaged(record);
        try { await store.update(record.id, (r) => { r.state = 'dismissed'; }); } catch (updateError) { log(`${record.id} staging dismiss`, updateError); }
        return unexpected(`${record.id} staging`, error, 'The attached content could not be kept for review. Try again.');
      }
      return ok(true as const);
    } finally {
      stagingInFlight.delete(record.id);
    }
  });

  async function sweepExpired(): Promise<number> {
    const expired = await store.expireDue(deps.now());
    for (const record of expired) {
      try { deps.actions.markUnavailable(SQUAD_LAUNCH_PROPOSAL_ACTION, record.id, 'This Squad launch proposal expired.'); } catch { /* card already gone */ }
      await removeStaged(record);
    }
    return expired.length;
  }

  /**
   * Remove staged folders whose proposal is gone or finished, abandon proposals stuck in `staging`,
   * and clear unfinished temp folders. A folder that keeps failing is logged and left after a few tries
   * (its bytes still count toward the cap, which is measured from disk).
   */
  async function sweepStaged(): Promise<number> {
    const staging = deps.staging;
    if (!staging) return 0;
    const at = deps.now();
    const stale = (since: number) => at - since > SQUAD_PROPOSAL_LIMITS.stagingTimeoutMs;
    for (const record of await store.list()) {
      if (record.state === 'staging' && !stagingInFlight.has(record.id) && stale(record.createdAt)) {
        await store.update(record.id, (r) => { if (r.state === 'staging') r.state = 'dismissed'; });
      }
    }
    // Scan the disk first, then read records: a proposal that finishes staging mid-scan is
    // already stored (or still in flight) by the time its folder is judged.
    const found = await staging.entries();
    const records = new Map((await store.list()).map((r) => [r.id, r]));
    let removed = 0;
    for (const entry of found) {
      if (entry.id && stagingInFlight.has(entry.id)) continue;
      if (entry.id) {
        const record = records.get(entry.id);
        if (record && (record.state === 'pending' || record.state === 'staging')) continue;
      } else if (!stale(entry.modifiedAt)) continue;
      if ((stagingFailures.get(entry.name) ?? 0) >= STAGING_RETRIES) continue;
      try {
        await (entry.id ? staging.remove(entry.id) : staging.removeEntry(entry.name));
        stagingFailures.delete(entry.name);
        removed += 1;
      } catch (error) {
        const failures = (stagingFailures.get(entry.name) ?? 0) + 1;
        stagingFailures.set(entry.name, failures);
        log(`${entry.name} staged sweep${failures >= STAGING_RETRIES ? ' (giving up)' : ''}`, error);
      }
    }
    return removed;
  }

  /** Create and bind the card. A failure dismisses the record; once bound, the card is live whatever else fails. */
  async function postCard(record: SquadProposalRecord, card: InboxInput): Promise<SquadProposalOutcome<InboxEntry>> {
    let entry: InboxEntry;
    try {
      entry = await deps.inbox.appendOnce(card);
      if (deps.actions.bind(entry, { kind: SQUAD_LAUNCH_PROPOSAL_ACTION, ref: record.id }) === false) {
        throw new Error('the Inbox card action could not be registered');
      }
    } catch (error) {
      await store.update(record.id, (r) => { r.state = 'dismissed'; });
      await removeStaged(record);
      return unexpected(`${record.id} card`, error, 'Could not create the Inbox card for this Squad launch. Try again.');
    }
    // The entry id is informational: a failed write must not report a live, launchable card as failed.
    try { await store.update(record.id, (r) => { r.inboxEntryId = entry.id; }); } catch (error) { log(`${record.id} inbox entry id`, error); }
    return ok(entry);
  }

  /** The pending record behind a Review or a Launch, or why it can't be used. */
  /** The proposal's files read again and its plan re-checked, as review and recheck both need. Fails when the launch target changed. */
  async function reprepareRecord(record: SquadProposalRecord): Promise<SquadProposalOutcome<Prepared>> {
    const stagedAttachments: SquadLaunchAttachment[] = [];
    for (const source of record.sources.filter((entry) => entry.attachment)) {
      const project = deps.projects.get(record.projectId);
      if (!project) return fail('NOT_FOUND', 'Project not found.');
      const scope = await sourceScope(deps.fs, project.path, deps.sourceBases(), { remote: Boolean(project.remote) });
      if (!scope) return fail('NOT_FOUND', 'The project folder is not available.');
      const confined = await confineSource(deps.fs, scope, source.path);
      if (!confined.ok) return confined;
      stagedAttachments.push({ name: basename(source.relPath), text: await readConfinedSource(deps.fs, scope, confined) });
    }
    const prepared = await prepare(deps, record.projectId, record.teamId, record.goal, record.planning,
      record.sources.filter((source) => !source.attachment).map((source) => source.path), stagedAttachments, record.launchOptions);
    if (!prepared.ok) return prepared;
    if (record.launchPreview && record.launchPreview.fingerprint !== prepared.value.launchPreview?.fingerprint) return fail('INVALID', 'Launch target changed since proposal. Prepare a new launch; no fallback was used.');
    // A staged copy is an ordinary file to the policy; here it is named and flagged as the attachment it is.
    const attachments = new Map(record.sources.filter((s) => s.attachment).map((s) => [s.path, s]));
    const reviewed: Prepared = {
      ...prepared.value,
      sources: [...prepared.value.sources, ...record.sources.filter((source) => source.attachment)].map((s) => {
        const kept = attachments.get(s.path);
        return kept ? { path: s.path, relPath: kept.relPath, bytes: s.bytes, attachment: true } : s;
      })
    };
    return ok(reviewed);
  }

  async function pendingRecord(proposalId: string, inProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadProposalRecord>> {
    await sweepExpired();
    const record = await store.get(proposalId);
    if (!record || !inProject(record.projectId)) return fail('NOT_FOUND', 'Squad launch proposal not found.');
    if (record.state === 'expired') return fail('EXPIRED', 'This Squad launch proposal expired.');
    if (record.state === 'staging') return fail('NOT_PENDING', 'This Squad launch proposal is still being prepared.');
    if (record.state !== 'pending') return fail('NOT_PENDING', 'This Squad launch proposal was already handled.');
    return ok(record);
  }

  /** A plan file named by squad_plan_check, checked and read like a source. */
  async function readPlanFile(projectId: string, path: string): Promise<SquadProposalOutcome<string>> {
    if (isDesignDocSource(path)) {
      const doc = await readDesignDocSource(deps.designDocs, projectId, path);
      return doc.ok ? ok(doc.text) : doc;
    }
    const project = deps.projects.get(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const scope = await sourceScope(deps.fs, project.path, deps.sourceBases(), { remote: Boolean(project.remote) });
    if (!scope) return fail('NOT_FOUND', 'The project folder is not available.');
    const confined = await confineSource(deps.fs, scope, path);
    if (!confined.ok) return confined;
    if (confined.source.bytes > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${path} is larger than 4 MiB.`);
    try { return ok(await readConfinedSource(deps.fs, scope, confined)); } catch {
      return fail('SOURCE_UNREADABLE', `${path} could not be read, or it changed after it was checked.`);
    }
  }

  return {
    sweepExpired,
    sweepStaged,

    async propose(route: SquadProposalRoute, input: SquadProposalInput): Promise<SquadProposalOutcome<SquadProposalResult>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launch proposals are turned off.');
        const proposer = await deps.lookupProposer(route.sessionId, route.projectId);
        if (!proposer) return fail('NOT_LIVE', 'This conversation is not live in the project.');
        if (proposer.squadMember) return fail('PROPOSER_IN_SQUAD', 'Members of a running Squad cannot propose a Squad launch.');
        const invalid = validateInput(input);
        if (invalid) return fail('INVALID', invalid);
        await sweepExpired();
        // Cheap pre-check before reading up to 16 MiB of sources; re-checked when creating.
        if (await pendingCapReached(route.projectId)) return tooManyProposals();
        const prepared = await prepare(deps, route.projectId, input.teamId, input.goal, input.planning, input.sources ?? [], input.attachments ?? [], input.launchOptions, proposer.kind);
        if (!prepared.ok) return prepared;
        // A plan with a Must fix is put to the user first; they can still choose to review it as it is.
        const decision = input.acceptFindings ? undefined : buildSquadPlanDecision(prepared.value.planFindings ?? []);
        if (decision) return fail('NEEDS_DECISION', formatSquadPlanDecision(decision));
        const files: StagedFile[] = prepared.value.attachments.map(({ name, text }) => ({ name, text }));
        let staged: Parameters<typeof newRecord>[5];
        if (files.length) {
          if (!deps.staging) return noStagingStore();
          const root = await deps.staging.prepareRoot();
          const id = deps.newId();
          staged = {
            id,
            bytes: prepared.value.attachments.reduce((sum, a) => sum + a.bytes, 0),
            sources: prepared.value.attachments.map((a) => ({ path: join(root, id, a.name), relPath: a.name, bytes: a.bytes, attachment: true as const }))
          };
        }
        const record = newRecord(deps, route.projectId, input, prepared.value, proposer, staged);
        const created = await createWithinCap(record, files);
        if (!created.ok) return created;
        const entry = await postCard(record, proposalCard(record, prepared.value, proposer));
        return entry.ok ? ok(proposalResult(record, prepared.value, entry.value)) : entry;
      } catch (error) {
        return unexpected('propose', error, 'The Squad launch proposal failed unexpectedly. Try again.');
      }
    },

    /**
     * Start the Squad straight away, owned by the calling conversation, after the same checks
     * as propose. No proposal or Inbox card: the agent gets the run and its [Squad report]s.
     */
    async launchSquadNow(route: SquadProposalRoute, input: SquadProposalInput): Promise<SquadLaunchNowOutcome> {
      let leased = false;
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        const launchNow = deps.launchNow;
        if (!launchNow) {
          return fail('LAUNCH_APPROVAL_UNAVAILABLE', 'Starting a Squad immediately is not available here, so the run was not started.');
        }
        const proposer = await deps.lookupProposer(route.sessionId, route.projectId);
        if (!proposer) return fail('NOT_LIVE', 'This conversation is not live in the project.');
        if (proposer.squadMember) return fail('PROPOSER_IN_SQUAD', 'Members of a running Squad cannot launch a Squad.');
        const invalid = validateInput(input);
        if (invalid) return fail('INVALID', invalid);
        const prepared = await prepare(deps, route.projectId, input.teamId, input.goal, input.planning, input.sources ?? [], input.attachments ?? [], input.launchOptions, proposer.kind);
        if (!prepared.ok) return prepared;
        // A Must fix cannot run unattended. Refuse before launching so no "needs correction" card reaches the Inbox;
        // the agent asks the user, and "as it is" goes through review mode where the Must fix stays visible.
        const nowDecision = buildSquadPlanDecision(prepared.value.planFindings ?? []);
        if (nowDecision) {
          // acceptFindings is ignored here: a Must fix never starts now, so the agent must ask the user and use review mode.
          return fail('NEEDS_DECISION',
            `${formatSquadPlanDecision(nowDecision)} This plan cannot start now, so do not stop here: ask the user now. The "${nowDecision.asIsLabel}" answer means calling squad_launch with mode 'review' and acceptFindings: true (not mode 'now').`);
        }
        let approval: LaunchApproval;
        try {
          approval = await launchNow.launchApproval(prepared.value.team.id, route.projectId);
        } catch (error) {
          return unexpected('launch now approval', error,
            'The Squad launch approval setting could not be read, so the run was not started.', 'LAUNCH_APPROVAL_UNAVAILABLE');
        }
        if (approval === 'review') return fail('LAUNCH_REVIEW_REQUIRED', LAUNCH_REVIEW_REQUIRED_MESSAGE);
        const key = nowDedupeKey(route.sessionId, route.projectId, input, prepared.value);
        const prior = await liveDedupe(launchNow, key);
        if (prior) return ok({ ...prior, deduped: true });
        if (nowLeases.active(route.sessionId)) {
          return fail('LAUNCH_IN_PROGRESS', 'A Squad launch from this conversation is already starting. Wait for it to finish.');
        }
        nowLeases.take(route.sessionId);
        leased = true;
        // A launch that finished while this call was preparing is found here, not started twice.
        const finished = await liveDedupe(launchNow, key);
        if (finished) return ok({ ...finished, deduped: true });
        if (await launchNow.activeOwnedRuns(route.sessionId, route.projectId) >= MAX_ACTIVE_NOW_RUNS_PER_SESSION) {
          return fail('TOO_MANY_LAUNCHES',
            `This conversation already owns ${MAX_ACTIVE_NOW_RUNS_PER_SESSION} running Squads. Wait for one to finish, or stop one, before starting another.`);
        }
        const { project, team, planning } = prepared.value;
        const started = await launchNow.launch({
          team, project, goal: input.goal.trim(), coordinationMode: planningToCoordinationMode(planning),
          ...(input.launchOptions ? { launchOptions: input.launchOptions } : {}),
          ...(prepared.value.launchPreview ? { launchPreview: prepared.value.launchPreview } : {}),
          ...(input.title?.trim() ? { title: input.title.trim() } : {}),
          ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
          completionInboxNotice: input.completionInboxNotice === true,
          sourcePaths: prepared.value.sources.map((s) => s.path),
          ...(prepared.value.attachments.length ? { attachments: prepared.value.attachments.map(({ name, text }) => ({ name, text })) } : {})
        }, {
          sources: { kind: 'session', sessionId: route.sessionId },
          // The conversation owns the run: it can answer blockers and read snapshots, and gets owner reports.
          owner: { principalId: route.sessionId, reportTo: { kind: proposer.kind, id: route.sessionId, role: 'owner' } }
        });
        if (!started.ok) return { ok: false, code: started.code, message: started.message };
        const result: SquadLaunchNowResult = {
          executionId: started.value.executionId, state: started.value.state, ...preparedSummary(prepared.value),
          ...(started.value.location ? { location: started.value.location } : {}),
          ...(started.value.path ? { path: started.value.path } : {}),
          ...(started.value.branch ? { branch: started.value.branch } : {})
        };
        nowDedupe.set(key, result);
        return ok(result);
      } catch (error) {
        return unexpected('launch now', error, 'Starting the Squad failed unexpectedly. Try again.');
      } finally {
        if (leased) nowLeases.release(route.sessionId);
      }
    },

    async checkPlan(route: SquadProposalRoute, input: { path?: string; text?: string; teamId?: string }): Promise<SquadProposalOutcome<SquadPlanCheckResult>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launch proposals are turned off.');
        if (!(await deps.lookupProposer(route.sessionId, route.projectId))) return fail('NOT_LIVE', 'This conversation is not live in the project.');
        const hasPath = typeof input?.path === 'string' && input.path.trim() !== '';
        const hasText = typeof input?.text === 'string';
        if (hasPath === hasText) return fail('INVALID', 'Provide exactly one of path or text.');
        if (hasText && Buffer.byteLength(input.text!, 'utf8') > SQUAD_PROPOSAL_LIMITS.planTextBytes) return fail('INVALID', 'The plan text is larger than 1 MiB.');
        const text = hasText ? ok(input.text!) : await readPlanFile(route.projectId, input.path!);
        if (!text.ok) return text;
        const plan = deps.resolveSquadPlan('provided', [text.value]);
        // An explicit teamId wins; otherwise the plan's own `Squad:` declaration picks the roster it is judged against.
        const judgedAgainst = input.teamId ?? (plan.declaredSquad && deps.teams.get(plan.declaredSquad) ? plan.declaredSquad : undefined);
        const unjudgedNote = (judgedFindings: boolean): { note: string } | Record<string, never> => {
          if (judgedFindings && judgedAgainst) return {};
          return { note: plan.declaredSquad && !judgedAgainst
            ? `This plan names the Squad "${plan.declaredSquad}", but no Squad by that name exists. It was NOT checked against any Squad's roster, so a pass only means the plan is readable, not that a Squad can run it. Pass a Squad to check it against.`
            : 'This plan was NOT checked against any Squad\'s roster, so a pass only means the plan is readable, not that a Squad can run it. Pass a Squad, or add a "Squad:" line to the plan, to check it.' };
        };
        const judge = async (workUnits: readonly unknown[]) => {
          if (!deps.planFindings) return undefined;
          try { return await deps.planFindings(route.projectId, judgedAgainst, { workUnits, findings: plan.findings, declaredSquad: plan.declaredSquad }); }
          catch (error) { deps.logError('plan check findings', error); return undefined; }
        };
        if (plan.planError) {
          const judged = await judge([]);
          // Say why no step was found (E8): the reason text stays the stable parse error; the diagnosis is a warning finding.
          const diagnosis: SquadPlanFinding[] = plan.planError === NO_EXECUTABLE_STEPS_REASON
            ? [{ requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '', detail: diagnoseNoSteps(text.value) }]
            : [];
          const reported = [...(judged?.findings ?? []), ...diagnosis];
          return ok({ ok: false, reason: plan.planError, ...(reported.length ? { findings: capSquadPlanFindings(reported).findings } : {}), ...(plan.declaredSquad ? { declaredSquad: plan.declaredSquad } : {}), ...unjudgedNote(!!judged) });
        }
        if (!plan.workUnits?.length) return ok({ ok: false, reason: 'No plan steps were found.', ...unjudgedNote(false) });
        const steps = toPlanSteps(plan.workUnits);
        // Advisory only: any failure here leaves the pass/fail result untouched.
        let findings: readonly SquadPlanTierFitFinding[] = [];
        if (input.teamId && deps.planTierFit) {
          try { findings = await deps.planTierFit(route.projectId, input.teamId, plan.workUnits); }
          catch (error) { deps.logError('plan check tier fit', error); }
        }
        const judged = await judge(plan.workUnits);
        // Without a Squad there are no slots to compare, so only a plan that runs strictly one step at a time is flagged.
        if (judged && !judgedAgainst && plan.workUnits.length >= 4 && planCriticalPathWidth(plan.workUnits) === 1) {
          judged.findings.push({
            requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '',
            detail: `Critical-path width is 1 across ${plan.workUnits.length} steps: every step waits for another, so a Squad with more than one worker will leave the rest idle. Pass a Squad to compare against its slots.`
          });
        }
        const capped = judged ? capSquadPlanFindings(judged.findings) : undefined;
        const bindings = judged?.bindings.slice(0, SQUAD_PLAN_BINDING_CAP);
        return ok({
          ok: true, steps, ...(findings.length ? { tierFit: { findings: [...findings] } } : {}),
          ...(capped ? { findings: capped.findings, ...(capped.hidden ? { findingsHidden: capped.hidden } : {}), summary: formatSquadPlanSummary(judged!.findings) } : {}),
          ...(judged && buildSquadPlanDecision(judged.findings) ? { decision: buildSquadPlanDecision(judged.findings)! } : {}),
          ...(bindings?.length ? { bindings, ...(judged!.bindings.length > bindings.length ? { bindingsHidden: judged!.bindings.length - bindings.length } : {}) } : {}),
          ...(plan.declaredSquad ? { declaredSquad: plan.declaredSquad } : {}),
          ...(judged && judgedAgainst ? { judgedAgainst } : {}),
          ...unjudgedNote(!!judged)
        });
      } catch (error) {
        return unexpected('plan check', error, 'The plan check failed unexpectedly. Try again.');
      }
    },

    /** Registered once as the `squad-launch-proposal` inbox action kind. */
    async handleAction({ ref, input }: { ref: string; input?: { optionId: string } }): Promise<void> {
      const record = await store.get(ref);
      if (!record || record.state !== 'pending') {
        throw new InboxActionOperatorError('This Squad launch proposal is no longer available.', true);
      }
      if (input?.optionId !== 'dismiss') throw new InboxActionOperatorError('Unknown action for this Squad launch proposal.');
      if (leases.active(ref)) throw new InboxActionOperatorError('This Squad launch is starting.');
      let changed = false;
      await store.update(ref, (r) => { if (r.state === 'pending') { r.state = 'dismissed'; changed = true; } });
      if (!changed) throw new InboxActionOperatorError('This Squad launch proposal is no longer available.', true);
      await removeStaged(record);
    },

    async review(windowId: number | string, proposalId: string, allowProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadLaunchPrefill>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        const pending = await pendingRecord(proposalId, allowProject);
        if (!pending.ok) return pending;
        const record = pending.value;
        if (leases.active(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const again = await reprepareRecord(record);
        if (!again.ok) return again;
        const reviewed = again.value;
        let issued: Awaited<ReturnType<SquadProposalServiceDeps['issueSources']>> = [];
        try {
          const { scope } = reviewed;
          if (scope) issued = await deps.issueSources(windowId, record.projectId, reviewed.sources.map((s) => s.path), scope.policy);
        } catch (error) {
          // The registry's own errors are written for users (file names only); anything else is logged.
          if (error instanceof ExecutionSourceError) return fail('SOURCE_UNREADABLE', `The source files could not be attached (${error.code}): ${error.message}`);
          return unexpected(`${proposalId} review sources`, error, 'The source files could not be attached. Try again.', 'SOURCE_UNREADABLE');
        }
        // launchPrefill maps capabilities back to paths by index, so a count mismatch must not launch.
        if (issued.length !== reviewed.sources.length) {
          return fail('SOURCE_UNREADABLE', 'The source files could not be attached. Try again.');
        }
        return ok(launchPrefill(record, reviewed, issued));
      } catch (error) {
        return unexpected(`${proposalId} review`, error, 'Opening this Squad launch failed unexpectedly. Try again.');
      }
    },

    /** Reads the plan files again and returns fresh findings, so an edited plan can clear its Must fix without a new proposal. */
    async recheck(proposalId: string, allowProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadPlanRecheck>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        const pending = await pendingRecord(proposalId, allowProject);
        if (!pending.ok) return pending;
        if (leases.active(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const again = await reprepareRecord(pending.value);
        if (!again.ok) return again;
        return ok({ ...planDisplay(again.value), ...(again.value.planSteps ? { planStepCount: again.value.planSteps.length } : {}) });
      } catch (error) {
        return unexpected(`${proposalId} recheck`, error, 'Checking the plan failed unexpectedly. Try again.');
      }
    },

    /** Sends the plan's current Must fix problems to the conversation that proposed the launch. The text is built here, never taken from the renderer. */
    async messageProposer(proposalId: string, allowProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<{ delivered: true }>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        if (!deps.sendToProposer) return fail('INVALID', 'This app cannot message the conversation. Copy the request instead.');
        const pending = await pendingRecord(proposalId, allowProject);
        if (!pending.ok) return pending;
        const record = pending.value;
        if (leases.active(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const again = await reprepareRecord(record);
        if (!again.ok) return again;
        const problems = (again.value.planFindings ?? []).filter((finding) => finding.severity === 'blocking');
        if (problems.length === 0) return fail('INVALID', 'The plan has nothing left to fix.');
        const files = record.sources.filter((source) => !source.attachment).map((source) => `${source.relPath} (full path: ${source.path})`);
        const text = [
          `The Squad launch you prepared${record.title ? ` ("${record.title}")` : ''} cannot start yet. ${problems.length === 1 ? 'One problem' : `${problems.length} problems`} in the plan:`,
          ...problems.slice(0, 10).map((finding) => `- ${formatSquadPlanFindingProblem(finding)}`),
          ...(problems.length > 10 ? [`- and ${problems.length - 10} more`] : []),
          '',
          `Please revise the plan${files.length ? ` (${files.join(', ')})` : ''}: save the fix as a copy and leave my original file alone. Check the copy with squad_plan_check, and when it has no Must fix, prepare the Squad launch again with squad_propose (do not pass acceptFindings). Use the full path above, not just the file name.`
        ].join('\n');
        const sent = await deps.sendToProposer(record.proposer, record.projectId, text);
        if (!sent.ok) return fail('NOT_FOUND', 'That conversation is no longer open. Copy the request and paste it into a new one.');
        return ok({ delivered: true });
      } catch (error) {
        return unexpected(`${proposalId} messageProposer`, error, 'Sending the request failed unexpectedly. Try again.');
      }
    },

    async beginLaunch(proposalId: string, projectId: string): Promise<SquadProposalOutcome<{
      proposal: { id: string; proposerKind: 'pty' | 'thread'; proposerId: string; proposerTitle?: string };
      /** Realpaths of the sources the reviewed card listed: the only files outside the Project a goal may add at Launch. */
      sourcePaths: string[];
      launchOptions?: LaunchOptions;
      launchPreview?: SquadLaunchPreview;
      resolvedTransport?: SquadProposalTransportPin;
    }>> {
      // Take the hold before any await, so two Launch presses (or two windows) can't both pass.
      if (leases.active(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
      leases.take(proposalId);
      let held = false;
      try {
        const pending = await pendingRecord(proposalId, (id) => id === projectId);
        if (!pending.ok) return pending;
        const existing = await deps.findLaunchedExecution?.(projectId, proposalId);
        if (existing) {
          await recordLaunched(proposalId, existing);
          return fail('NOT_PENDING', 'A Squad was already started from this proposal.');
        }
        const record = pending.value;
        if (record.launchPreview || record.launchOptions) {
          const project = deps.projects.get(projectId);
          if (!project) return fail('NOT_FOUND', 'Project not found.');
          const scope = await sourceScope(deps.fs, project.path, deps.sourceBases(), { remote: Boolean(project.remote) });
          if (!scope) return fail('NOT_FOUND', 'The project folder is not available.');
          const attachments: SquadLaunchAttachment[] = [];
          for (const source of record.sources.filter(source => source.attachment)) {
            const confined = await confineSource(deps.fs, scope, source.path);
            if (!confined.ok) return confined;
            const text = await readConfinedSource(deps.fs, scope, confined);
            attachments.push({ name: basename(source.relPath), text });
          }
          const prepared = await prepare(deps, projectId, record.teamId, record.goal, record.planning, record.sources.filter(source => !source.attachment).map((s) => s.path), attachments, record.launchOptions);
          if (!prepared.ok) return prepared;
          if (!record.launchPreview || record.launchPreview.fingerprint !== prepared.value.launchPreview?.fingerprint) return fail('INVALID', 'Launch target changed since proposal. Prepare a new launch; no fallback was used.');
        }
        held = true;
        const { proposer } = pending.value;
        return ok({
          proposal: { id: proposalId, proposerKind: proposer.kind, proposerId: proposer.id, ...(proposer.title ? { proposerTitle: proposer.title } : {}) },
          sourcePaths: pending.value.sources.map((source) => source.path),
          ...(record.launchOptions ? { launchOptions: record.launchOptions } : {}),
          ...(record.resolvedTransport ? { resolvedTransport: record.resolvedTransport } : {}),
          ...(record.launchPreview ? { launchPreview: record.launchPreview } : {})
        });
      } catch (error) {
        return unexpected(`${proposalId} launch`, error, 'This Squad launch could not start. Try again.');
      } finally {
        if (!held) leases.release(proposalId);
      }
    },

    /** The launch failed before a Squad started: let the user try again straight away. */
    releaseLaunch(proposalId: string): void {
      leases.release(proposalId);
    },

    /** Record the launch. The lease is released only after the write, so a failed write can't reopen the proposal. */
    async markLaunched(proposalId: string, executionId: string): Promise<void> {
      await recordLaunched(proposalId, executionId);
      leases.release(proposalId);
    }
  };
}

export type SquadProposalService = ReturnType<typeof createSquadProposalService>;

/**
 * Admission text that is safe to show in the launch settings banner because it only names the
 * user's own checkout setting and how to fix it. Other admission errors stay hidden from the
 * preview IPC response.
 */
export class SquadPreviewFixableError extends SquadPreviewAdmissionError {
  constructor(publicMessage: string) {
    super(publicMessage);
    this.name = 'SquadPreviewFixableError';
  }
}
