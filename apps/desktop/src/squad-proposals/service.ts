import type { InboxEntry, Persona, Team } from '@zana-ai/zcc-domain/product';
import {
  SQUAD_PROPOSAL_LIMITS,
  personaCanWriteFiles,
  planningToCoordinationMode,
  type SquadLaunchPrefill,
  type SquadPlanCheckResult,
  type SquadPlanStep,
  type SquadPlanning,
  type SquadProposalErrorCode,
  type SquadProposalInput,
  type SquadProposalRecord,
  type SquadProposalResult,
  type SquadProposalSource,
  type SquadProposer
} from '@zana-ai/zcc-domain/squad-proposal';
import { ExecutionSourceError } from '@zana-ai/zcc-server/services/execution/source-registry';
import { sourcePolicyText, type SourcePolicy } from '@zana-ai/zcc-server/services/execution/source-policy';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import {
  FILE_MAX_BYTES,
  TOTAL_MAX_BYTES,
  confineSource,
  goalPathNotAllowed,
  goalPathTokens,
  readConfinedSource,
  sourceScope,
  type ConfinedSource,
  type SquadProposalFs,
  type SquadSourceBases,
  type SquadSourceScope
} from './sources.js';
import type { SquadProposalStore } from './store.js';

export const SQUAD_LAUNCH_PROPOSAL_ACTION = 'squad-launch-proposal';

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const MAX_SLOTS = 32;
const PATH_MAX_CHARS = 4096;
const TITLE_FALLBACK_CHARS = 80;
/**
 * A launch holds its proposal from beginLaunch until markLaunched or releaseLaunch. The
 * timeout only frees a lease whose launch hung; it is far above any real start time.
 */
const LAUNCH_LEASE_MS = 10 * 60_000;
const PLANNING_LABEL: Record<SquadPlanning, string> = { infer: 'Infer plan from goal', provided: 'Plan provided in goal' };

export type SquadProposalOutcome<T> = { ok: true; value: T } | { ok: false; code: SquadProposalErrorCode; message: string };

export interface SquadProposalRoute { projectId: string; sessionId: string }
export type SquadProposerLookup = SquadProposer & { squadMember: boolean; origin?: InboxEntry['origin'] };
export type { SquadProposalFs } from './sources.js';

type ProjectRef = { id: string; name: string; path: string };

export interface SquadProposalServiceDeps {
  store: SquadProposalStore;
  enabled(): boolean;
  lookupProposer(sessionId: string, projectId: string): Promise<SquadProposerLookup | null>;
  projects: { get(id: string): ProjectRef | undefined };
  teams: { get(id: string): Team | undefined };
  personas: { get(id: string): Persona | undefined };
  teamHostProblem(project: ProjectRef): string | undefined;
  expandTeamSlots(team: Team): readonly unknown[];
  resolveSquadPlan(
    planSource: 'provided',
    texts: string[]
  ): { workUnits?: Array<{ id: string; title: string; dependencies: string[]; files?: string[] }>; planError?: string };
  fs: SquadProposalFs;
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
}

const fail = (code: SquadProposalErrorCode, message: string): { ok: false; code: SquadProposalErrorCode; message: string } => ({ ok: false, code, message });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const tooManyProposals = () => fail('TOO_MANY_PROPOSALS',
  `This project already has ${SQUAD_PROPOSAL_LIMITS.maxPendingPerProject} pending Squad launch proposals. Dismiss some in the Inbox first.`);

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '').slice(0, max);
}

/** Field checks on an agent's proposal input; undefined when it is well formed. */
function validateInput(input: SquadProposalInput): string | undefined {
  const L = SQUAD_PROPOSAL_LIMITS;
  if (!input || typeof input !== 'object') return 'Proposal input is required.';
  if (typeof input.teamId !== 'string' || !input.teamId.trim()) return 'teamId is required.';
  if (typeof input.goal !== 'string' || !input.goal.trim()) return 'goal is required.';
  if (input.goal.length > L.goalChars) return `goal must be at most ${L.goalChars} characters.`;
  if (input.planning !== undefined && input.planning !== 'infer' && input.planning !== 'provided') return "planning must be 'infer' or 'provided'.";
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > L.titleChars)) return `title must be at most ${L.titleChars} characters.`;
  if (input.summary !== undefined && (typeof input.summary !== 'string' || input.summary.length > L.summaryChars)) return `summary must be at most ${L.summaryChars} characters.`;
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) return 'sources must be a list of paths.';
    if (input.sources.length <= L.maxSources && input.sources.some((s) => typeof s !== 'string' || !s.trim() || s.length > PATH_MAX_CHARS)) {
      return 'Each source must be a non-empty path.';
    }
  }
  return undefined;
}

interface Prepared {
  project: ProjectRef;
  /** Undefined only when the project folder is unavailable and nothing needed it. */
  scope?: SquadSourceScope;
  team: Team;
  orchestrator: Persona;
  workers: number;
  planning: SquadPlanning;
  sources: SquadProposalSource[];
  planSteps?: SquadPlanStep[];
}

const toPlanSteps = (units: Array<{ id: string; title: string; dependencies: string[]; files?: string[] }>): SquadPlanStep[] =>
  units.map((u) => ({ id: u.id, title: u.title, dependencies: [...u.dependencies], writeScope: [...(u.files ?? [])] }));

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
  deps: SquadProposalServiceDeps, scope: SquadSourceScope | undefined, sources: ConfinedSource[], goal: string
): Promise<SquadProposalOutcome<SquadPlanStep[]>> {
  let texts: string[];
  try { texts = await Promise.all(sources.map((s) => readConfinedSource(deps.fs, scope!, s))); } catch {
    return fail('SOURCE_UNREADABLE', 'A source file could not be read, or it changed after it was checked.');
  }
  const plan = deps.resolveSquadPlan('provided', [...texts, goal]);
  if (plan.planError) return fail('INVALID_PLAN', plan.planError);
  if (!plan.workUnits?.length) return fail('INVALID_PLAN', 'No plan steps were found in the goal or the source files.');
  return ok(toPlanSteps(plan.workUnits));
}

/** Checks 4-10 of §5, shared by propose and review (which re-runs them on current files). */
async function prepare(
  deps: SquadProposalServiceDeps, projectId: string, teamId: string, goal: string, planningInput: SquadPlanning | undefined, rawSources: string[]
): Promise<SquadProposalOutcome<Prepared>> {
  const squad = resolveSquad(deps, projectId, teamId);
  if (!squad.ok) return squad;
  const { project, team, orchestrator, slots } = squad.value;
  const scope = await sourceScope(deps.fs, project.path, deps.sourceBases());
  const sources = await confineSources(deps.fs, scope, rawSources);
  if (!sources.ok) return sources;
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
  const planning: SquadPlanning = planningInput ?? team.defaultPlanning ?? (personaCanWriteFiles(orchestrator) ? 'infer' : 'provided');
  if (planning === 'infer' && !personaCanWriteFiles(orchestrator)) {
    return fail('ORCHESTRATOR_CANNOT_PLAN',
      `${orchestrator.name} can't write files, so Infer plan from goal can't finish. Write a portable plan, check it with squad_plan_check, and propose with planning 'provided'.`);
  }
  let planSteps: SquadPlanStep[] | undefined;
  if (planning === 'provided') {
    const plan = await checkProvidedPlan(deps, scope, sources.value, goal);
    if (!plan.ok) return plan;
    planSteps = plan.value;
  }
  return ok({
    project, ...(scope ? { scope } : {}), team, orchestrator, workers: Math.max(0, slots - 1), planning,
    sources: sources.value.map((s) => s.source), ...(planSteps ? { planSteps } : {})
  });
}

function newRecord(
  deps: SquadProposalServiceDeps, projectId: string, input: SquadProposalInput, prepared: Prepared, proposer: SquadProposerLookup
): SquadProposalRecord {
  const at = deps.now();
  return {
    id: deps.newId(),
    projectId,
    proposer: { kind: proposer.kind, id: proposer.id, ...(proposer.title ? { title: proposer.title } : {}) },
    teamId: prepared.team.id,
    goal: input.goal,
    planning: prepared.planning,
    sources: prepared.sources,
    title: input.title?.trim() || firstLine(input.goal, TITLE_FALLBACK_CHARS),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(prepared.planSteps ? { planSteps: prepared.planSteps } : {}),
    state: 'pending',
    createdAt: at,
    updatedAt: at,
    expiresAt: at + SQUAD_PROPOSAL_LIMITS.ttlMs
  };
}

/** The host-owned Inbox card. Its only option is Dismiss; Review is the card's own button. */
function proposalCard(record: SquadProposalRecord, prepared: Prepared, proposer: SquadProposerLookup): InboxInput {
  const { team, orchestrator, workers, planning, sources, planSteps } = prepared;
  const comments = [
    `- Squad: ${team.name} (${orchestrator.name} + ${plural(workers, 'worker')})`,
    `- Planning: ${PLANNING_LABEL[planning]}${planSteps ? ` — plan checked: ${plural(planSteps.length, 'step')}` : ''}`,
    ...(sources.length ? [`- Files: ${sources.map((s) => (s.outsideProject ? `${s.relPath} (outside the Project)` : s.relPath)).join(', ')}`] : []),
    '- Nothing starts until you press Launch.'
  ].join('\n');
  const origin = proposer.origin ?? (proposer.kind === 'thread' ? { threadId: proposer.id } : undefined);
  return {
    projectId: record.projectId,
    subject: `Squad launch ready: ${record.title}`,
    intent: `Prepared in "${proposer.title ?? 'a conversation'}"`,
    comments,
    // Inbox documents open inside the project; a file outside it is named in the comments instead.
    docs: sources.filter((s) => !s.outsideProject).map((s) => ({ path: s.relPath })),
    hostActionRequired: true,
    squadProposal: { proposalId: record.id },
    questions: [{ prompt: 'Squad launch', options: [{ id: 'dismiss', label: 'Dismiss' }] }],
    dedupeKey: `squad-proposal:${record.id}`,
    sessionId: proposer.id,
    ...(origin ? { origin } : {})
  };
}

function proposalResult(record: SquadProposalRecord, prepared: Prepared, entry: InboxEntry): SquadProposalResult {
  const { team, orchestrator, workers, planning, sources, planSteps } = prepared;
  return {
    proposalId: record.id,
    inboxEntryId: entry.id,
    team: { id: team.id, name: team.name, workers, orchestrator: orchestrator.name },
    planning,
    plan: planSteps ? { steps: planSteps.map((s) => ({ id: s.id, title: s.title })) } : null,
    sources: sources.map((s) => ({ path: s.relPath, bytes: s.bytes, ...(s.outsideProject ? { outsideProject: true } : {}) })),
    expiresAt: record.expiresAt
  };
}

function launchPrefill(record: SquadProposalRecord, prepared: Prepared, issued: SquadLaunchPrefill['sources']): SquadLaunchPrefill {
  return {
    proposalId: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    coordinationMode: planningToCoordinationMode(prepared.planning),
    goal: record.goal,
    ...(record.title ? { title: record.title } : {}),
    ...(record.summary ? { summary: record.summary } : {}),
    // issueSources returns one capability per path, in order.
    sources: issued.map((s, index) => {
      const source = prepared.sources[index];
      return {
        id: s.id, name: s.name, byteSize: s.byteSize, expiresAt: s.expiresAt,
        ...(source?.outsideProject ? { path: source.relPath, outsideProject: true } : {})
      };
    }),
    ...(record.proposer.title ? { proposerTitle: record.proposer.title } : {}),
    ...(prepared.planSteps ? { planStepCount: prepared.planSteps.length } : {})
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

  function log(context: string, error: unknown): void {
    try { deps.logError(`squad proposal ${context}`, error); } catch { /* logging must not throw */ }
  }
  /** An unexpected failure: the cause goes to the log, the caller gets a stable message without internals. */
  function unexpected(context: string, error: unknown, message: string, code: SquadProposalErrorCode = 'INVALID') {
    log(context, error);
    return fail(code, message);
  }

  /** pending → launched (never from another state), then retire the card's buttons. */
  async function recordLaunched(proposalId: string, executionId: string): Promise<void> {
    const record = await store.update(proposalId, (r) => { if (r.state === 'pending') { r.state = 'launched'; r.executionId = executionId; } });
    if (!record) return;
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
  /** Create the record unless the project is at its pending cap; false when it is. */
  const createWithinCap = (record: SquadProposalRecord): Promise<boolean> => serialised(async () => {
    if (await pendingCapReached(record.projectId)) return false;
    await store.create(record);
    return true;
  });

  async function sweepExpired(): Promise<number> {
    const expired = await store.expireDue(deps.now());
    for (const record of expired) {
      try { deps.actions.markUnavailable(SQUAD_LAUNCH_PROPOSAL_ACTION, record.id, 'This Squad launch proposal expired.'); } catch { /* card already gone */ }
    }
    return expired.length;
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
      return unexpected(`${record.id} card`, error, 'Could not create the Inbox card for this Squad launch. Try again.');
    }
    // The entry id is informational: a failed write must not report a live, launchable card as failed.
    try { await store.update(record.id, (r) => { r.inboxEntryId = entry.id; }); } catch (error) { log(`${record.id} inbox entry id`, error); }
    return ok(entry);
  }

  /** The pending record behind a Review or a Launch, or why it can't be used. */
  async function pendingRecord(proposalId: string, inProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadProposalRecord>> {
    await sweepExpired();
    const record = await store.get(proposalId);
    if (!record || !inProject(record.projectId)) return fail('NOT_FOUND', 'Squad launch proposal not found.');
    if (record.state === 'expired') return fail('EXPIRED', 'This Squad launch proposal expired.');
    if (record.state !== 'pending') return fail('NOT_PENDING', 'This Squad launch proposal was already handled.');
    return ok(record);
  }

  /** A plan file named by squad_plan_check, checked and read like a source. */
  async function readPlanFile(projectId: string, path: string): Promise<SquadProposalOutcome<string>> {
    const project = deps.projects.get(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const scope = await sourceScope(deps.fs, project.path, deps.sourceBases());
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
        const prepared = await prepare(deps, route.projectId, input.teamId, input.goal, input.planning, input.sources ?? []);
        if (!prepared.ok) return prepared;
        const record = newRecord(deps, route.projectId, input, prepared.value, proposer);
        if (!(await createWithinCap(record))) return tooManyProposals();
        const entry = await postCard(record, proposalCard(record, prepared.value, proposer));
        return entry.ok ? ok(proposalResult(record, prepared.value, entry.value)) : entry;
      } catch (error) {
        return unexpected('propose', error, 'The Squad launch proposal failed unexpectedly. Try again.');
      }
    },

    async checkPlan(route: SquadProposalRoute, input: { path?: string; text?: string }): Promise<SquadProposalOutcome<SquadPlanCheckResult>> {
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
        if (plan.planError) return ok({ ok: false, reason: plan.planError });
        if (!plan.workUnits?.length) return ok({ ok: false, reason: 'No plan steps were found.' });
        return ok({ ok: true, steps: toPlanSteps(plan.workUnits) });
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
    },

    async review(windowId: number | string, proposalId: string, allowProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadLaunchPrefill>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        const pending = await pendingRecord(proposalId, allowProject);
        if (!pending.ok) return pending;
        const record = pending.value;
        if (leases.active(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const prepared = await prepare(deps, record.projectId, record.teamId, record.goal, record.planning, record.sources.map((s) => s.path));
        if (!prepared.ok) return prepared;
        let issued: Awaited<ReturnType<SquadProposalServiceDeps['issueSources']>> = [];
        try {
          const { scope } = prepared.value;
          if (scope) issued = await deps.issueSources(windowId, record.projectId, prepared.value.sources.map((s) => s.path), scope.policy);
        } catch (error) {
          // The registry's own errors are written for users (file names only); anything else is logged.
          if (error instanceof ExecutionSourceError) return fail('SOURCE_UNREADABLE', `The source files could not be attached (${error.code}): ${error.message}`);
          return unexpected(`${proposalId} review sources`, error, 'The source files could not be attached. Try again.', 'SOURCE_UNREADABLE');
        }
        // launchPrefill maps capabilities back to paths by index, so a count mismatch must not launch.
        if (issued.length !== prepared.value.sources.length) {
          return fail('SOURCE_UNREADABLE', 'The source files could not be attached. Try again.');
        }
        return ok(launchPrefill(record, prepared.value, issued));
      } catch (error) {
        return unexpected(`${proposalId} review`, error, 'Opening this Squad launch failed unexpectedly. Try again.');
      }
    },

    async beginLaunch(proposalId: string, projectId: string): Promise<SquadProposalOutcome<{
      proposal: { id: string; proposerKind: 'pty' | 'thread'; proposerId: string; proposerTitle?: string };
      /** Realpaths of the sources the reviewed card listed: the only files outside the Project a goal may add at Launch. */
      sourcePaths: string[];
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
        held = true;
        const { proposer } = pending.value;
        return ok({
          proposal: { id: proposalId, proposerKind: proposer.kind, proposerId: proposer.id, ...(proposer.title ? { proposerTitle: proposer.title } : {}) },
          sourcePaths: pending.value.sources.map((source) => source.path)
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
