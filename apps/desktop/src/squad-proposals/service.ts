import { isAbsolute, relative, resolve, sep } from 'node:path';
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
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import type { SquadProposalStore } from './store.js';

export const SQUAD_LAUNCH_PROPOSAL_ACTION = 'squad-launch-proposal';

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const FILE_MAX_BYTES = 4 * 1024 * 1024;
const TOTAL_MAX_BYTES = 16 * 1024 * 1024;
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

export interface SquadProposalFs {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

export interface SquadProposalServiceDeps {
  store: SquadProposalStore;
  enabled(): boolean;
  lookupProposer(sessionId: string, projectId: string): Promise<SquadProposerLookup | null>;
  projects: { get(id: string): { id: string; name: string; path: string } | undefined };
  teams: { get(id: string): Team | undefined };
  personas: { get(id: string): Persona | undefined };
  teamHostProblem(project: { id: string; name: string; path: string }): string | undefined;
  expandTeamSlots(team: Team): readonly unknown[];
  resolveSquadPlan(
    planSource: 'provided',
    texts: string[]
  ): { workUnits?: Array<{ id: string; title: string; dependencies: string[]; files?: string[] }>; planError?: string };
  fs: SquadProposalFs;
  inbox: { appendOnce(input: InboxInput): Promise<InboxEntry> };
  actions: {
    /** Returns false when the action could not be bound (e.g. inert registry). */
    bind(entry: InboxEntry, action: { kind: string; ref: string }): boolean | void;
    markUnavailable(kind: string, ref: string, message: string): void;
  };
  /** `withinRoot` confines each source to the project at capability time (re-checked against the issued realpath). */
  issueSources(windowId: number | string, projectId: string, paths: string[], withinRoot: string): Promise<Array<{ id: string; name: string; byteSize: number; expiresAt: number }>>;
  now(): number;
  newId(): string;
  /**
   * The execution already started from this proposal, if any. Guards a second launch when
   * recording the first failed or the app crashed between start and markLaunched.
   */
  findLaunchedExecution?(projectId: string, proposalId: string): Promise<string | undefined>;
}

const fail = (code: SquadProposalErrorCode, message: string): { ok: false; code: SquadProposalErrorCode; message: string } => ({ ok: false, code, message });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

type Confined = { ok: true; source: SquadProposalSource } | { ok: false; code: SquadProposalErrorCode; message: string };

/** Resolve `rawPath` against the project root and require a regular file strictly inside it (symlinks resolved). */
export async function confineToProject(fs: SquadProposalFs, projectRoot: string, rawPath: string): Promise<Confined> {
  let root: string;
  try { root = await fs.realpath(projectRoot); } catch { return fail('NOT_FOUND', 'The project folder is not available.'); }
  const candidate = isAbsolute(rawPath) ? rawPath : resolve(projectRoot, rawPath);
  let real: string;
  try { real = await fs.realpath(candidate); } catch { return fail('SOURCE_NOT_FILE', `${rawPath} does not exist or is not a file.`); }
  const rel = relative(root, real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return fail('SOURCE_OUTSIDE_PROJECT', `${rawPath} is outside the project. Files must be inside this project.`);
  }
  let stat: { isFile(): boolean; size: number };
  try { stat = await fs.lstat(real); } catch { return fail('SOURCE_NOT_FILE', `${rawPath} does not exist or is not a file.`); }
  if (!stat.isFile()) return fail('SOURCE_NOT_FILE', `${rawPath} is not a regular file.`);
  return { ok: true, source: { path: real, relPath: rel, bytes: stat.size } };
}

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '').slice(0, max);
}

/**
 * Absolute paths named in a goal are attached as sources at Launch. A proposal's goal is
 * agent-written, so every existing absolute path it names must resolve inside the project
 * (D3); paths that don't exist are ignored, as Launch ignores them too. Same token rules
 * as the host's goal-source discovery: quoted paths, then unquoted ones.
 */
export async function goalPathOutsideProject(fs: SquadProposalFs, projectRoot: string, goal: string): Promise<string | undefined> {
  const raw: string[] = [];
  for (const m of goal.matchAll(/["'`]((?:[A-Za-z]:[/\\]|\/)[^"'`]+)["'`]/g)) if (m[1]) raw.push(m[1]);
  for (const m of goal.matchAll(/(?:^|[\s(])((?:[A-Za-z]:[/\\]|\/)[^\s`'"),;:]+)/g)) if (m[1]) raw.push(m[1]);
  if (raw.length === 0) return undefined;
  let root: string;
  try { root = await fs.realpath(projectRoot); } catch { return undefined; }
  for (const token of raw) {
    const cleaned = token.trim().replace(/^[`'"(]+|[`'"),;:]+$/g, '');
    for (const candidate of cleaned.endsWith('.') ? [cleaned, cleaned.slice(0, -1)] : [cleaned]) {
      let real: string;
      try { real = await fs.realpath(candidate); } catch { continue; }
      const rel = relative(root, real);
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return cleaned;
      break;
    }
  }
  return undefined;
}

export function createSquadProposalService(deps: SquadProposalServiceDeps) {
  const { store, fs } = deps;
  const launching = new Map<string, number>();
  const leaseActive = (proposalId: string): boolean => {
    const until = launching.get(proposalId);
    return until !== undefined && until > deps.now();
  };
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

  async function sweepExpired(): Promise<number> {
    const expired = await store.expireDue(deps.now());
    for (const record of expired) {
      try { deps.actions.markUnavailable(SQUAD_LAUNCH_PROPOSAL_ACTION, record.id, 'This Squad launch proposal expired.'); } catch { /* card already gone */ }
    }
    return expired.length;
  }

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
    project: { id: string; name: string; path: string };
    team: Team;
    orchestrator: Persona;
    workers: number;
    planning: SquadPlanning;
    sources: SquadProposalSource[];
    planSteps?: SquadPlanStep[];
  }

  /** Checks 4-10 of §5, shared by propose and review (which re-runs them on current files). */
  async function prepare(
    projectId: string, teamId: string, goal: string, planningInput: SquadPlanning | undefined, rawSources: string[]
  ): Promise<SquadProposalOutcome<Prepared>> {
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
    if (rawSources.length > SQUAD_PROPOSAL_LIMITS.maxSources) {
      return fail('TOO_MANY_SOURCES', `At most ${SQUAD_PROPOSAL_LIMITS.maxSources} source files are allowed.`);
    }

    const sources: SquadProposalSource[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const raw of rawSources) {
      const confined = await confineToProject(fs, project.path, raw);
      if (!confined.ok) return confined;
      if (seen.has(confined.source.path)) continue;
      seen.add(confined.source.path);
      if (confined.source.bytes > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${raw} is larger than 4 MiB.`);
      total += confined.source.bytes;
      if (total > TOTAL_MAX_BYTES) return fail('SOURCE_TOO_LARGE', 'The source files add up to more than 16 MiB.');
      sources.push(confined.source);
    }
    const outsideGoalPath = await goalPathOutsideProject(fs, project.path, goal);
    if (outsideGoalPath) {
      return fail('SOURCE_OUTSIDE_PROJECT', `The goal names ${outsideGoalPath}, which is outside this project. Move the file into the project, or remove the path from the goal.`);
    }

    const planning: SquadPlanning = planningInput ?? team.defaultPlanning ?? (personaCanWriteFiles(orchestrator) ? 'infer' : 'provided');
    if (planning === 'infer' && !personaCanWriteFiles(orchestrator)) {
      return fail('ORCHESTRATOR_CANNOT_PLAN',
        `${orchestrator.name} can't write files, so Infer plan from goal can't finish. Write a portable plan, check it with squad_plan_check, and propose with planning 'provided'.`);
    }

    let planSteps: SquadPlanStep[] | undefined;
    if (planning === 'provided') {
      let texts: string[];
      try { texts = await Promise.all(sources.map((s) => fs.readFile(s.path, 'utf8'))); } catch {
        return fail('SOURCE_UNREADABLE', 'A source file could not be read.');
      }
      const plan = deps.resolveSquadPlan('provided', [...texts, goal]);
      if (plan.planError) return fail('INVALID_PLAN', plan.planError);
      if (!plan.workUnits?.length) return fail('INVALID_PLAN', 'No plan steps were found in the goal or the source files.');
      planSteps = plan.workUnits.map((u) => ({ id: u.id, title: u.title, dependencies: [...u.dependencies], writeScope: [...(u.files ?? [])] }));
    }
    return ok({ project, team, orchestrator, workers: Math.max(0, slots - 1), planning, sources, ...(planSteps ? { planSteps } : {}) });
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
        if ((await store.listPending(route.projectId)).length >= SQUAD_PROPOSAL_LIMITS.maxPendingPerProject) {
          return fail('TOO_MANY_PROPOSALS', `This project already has ${SQUAD_PROPOSAL_LIMITS.maxPendingPerProject} pending Squad launch proposals. Dismiss some in the Inbox first.`);
        }
        const prepared = await prepare(route.projectId, input.teamId, input.goal, input.planning, input.sources ?? []);
        if (!prepared.ok) return prepared;
        const { project, team, orchestrator, workers, planning, sources, planSteps } = prepared.value;
        const at = deps.now();
        const id = deps.newId();
        const title = input.title?.trim() || firstLine(input.goal, TITLE_FALLBACK_CHARS);
        const proposerRef: SquadProposer = { kind: proposer.kind, id: proposer.id, ...(proposer.title ? { title: proposer.title } : {}) };
        const record: SquadProposalRecord = {
          id, projectId: route.projectId, proposer: proposerRef, teamId: team.id, goal: input.goal, planning, sources,
          title, ...(input.summary ? { summary: input.summary } : {}), ...(planSteps ? { planSteps } : {}),
          state: 'pending', createdAt: at, updatedAt: at, expiresAt: at + SQUAD_PROPOSAL_LIMITS.ttlMs
        };
        const capped = await serialised(async () => {
          if ((await store.listPending(route.projectId)).length >= SQUAD_PROPOSAL_LIMITS.maxPendingPerProject) return true;
          await store.create(record);
          return false;
        });
        if (capped) {
          return fail('TOO_MANY_PROPOSALS', `This project already has ${SQUAD_PROPOSAL_LIMITS.maxPendingPerProject} pending Squad launch proposals. Dismiss some in the Inbox first.`);
        }

        const comments = [
          `- Squad: ${team.name} (${orchestrator.name} + ${plural(workers, 'worker')})`,
          `- Planning: ${PLANNING_LABEL[planning]}${planSteps ? ` — plan checked: ${plural(planSteps.length, 'step')}` : ''}`,
          ...(sources.length ? [`- Files: ${sources.map((s) => s.relPath).join(', ')}`] : []),
          '- Nothing starts until you press Launch.'
        ].join('\n');
        const origin = proposer.origin ?? (proposer.kind === 'thread' ? { threadId: proposer.id } : undefined);
        let entry: InboxEntry;
        try {
          entry = await deps.inbox.appendOnce({
            projectId: route.projectId,
            subject: `Squad launch ready: ${title}`,
            intent: `Prepared in "${proposer.title ?? 'a conversation'}"`,
            comments,
            docs: sources.map((s) => ({ path: s.relPath })),
            hostActionRequired: true,
            squadProposal: { proposalId: id },
            questions: [{ prompt: 'Squad launch', options: [{ id: 'dismiss', label: 'Dismiss' }] }],
            dedupeKey: `squad-proposal:${id}`,
            sessionId: proposer.id,
            ...(origin ? { origin } : {})
          });
          if (deps.actions.bind(entry, { kind: SQUAD_LAUNCH_PROPOSAL_ACTION, ref: id }) === false) {
            throw new Error('the Inbox card action could not be registered');
          }
        } catch (error) {
          await store.update(id, (r) => { r.state = 'dismissed'; });
          return fail('INVALID', `Could not create the Inbox card: ${error instanceof Error ? error.message : String(error)}`);
        }
        await store.update(id, (r) => { r.inboxEntryId = entry.id; });
        return ok({
          proposalId: id,
          inboxEntryId: entry.id,
          team: { id: team.id, name: team.name, workers, orchestrator: orchestrator.name },
          planning,
          plan: planSteps ? { steps: planSteps.map((s) => ({ id: s.id, title: s.title })) } : null,
          sources: sources.map((s) => ({ path: s.relPath, bytes: s.bytes })),
          expiresAt: record.expiresAt
        });
      } catch (error) {
        return fail('INVALID', `Squad proposal failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async checkPlan(route: SquadProposalRoute, input: { path?: string; text?: string }): Promise<SquadProposalOutcome<SquadPlanCheckResult>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launch proposals are turned off.');
        if (!(await deps.lookupProposer(route.sessionId, route.projectId))) return fail('NOT_LIVE', 'This conversation is not live in the project.');
        const hasPath = typeof input?.path === 'string' && input.path.trim() !== '';
        const hasText = typeof input?.text === 'string';
        if (hasPath === hasText) return fail('INVALID', 'Provide exactly one of path or text.');
        let text: string;
        if (hasText) {
          if (Buffer.byteLength(input.text!, 'utf8') > SQUAD_PROPOSAL_LIMITS.planTextBytes) return fail('INVALID', 'The plan text is larger than 1 MiB.');
          text = input.text!;
        } else {
          const project = deps.projects.get(route.projectId);
          if (!project) return fail('NOT_FOUND', 'Project not found.');
          const confined = await confineToProject(fs, project.path, input.path!);
          if (!confined.ok) return confined;
          if (confined.source.bytes > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${input.path} is larger than 4 MiB.`);
          try { text = await fs.readFile(confined.source.path, 'utf8'); } catch { return fail('SOURCE_UNREADABLE', `${input.path} could not be read.`); }
        }
        const plan = deps.resolveSquadPlan('provided', [text]);
        if (plan.planError) return ok({ ok: false, reason: plan.planError });
        if (!plan.workUnits?.length) return ok({ ok: false, reason: 'No plan steps were found.' });
        return ok({
          ok: true,
          steps: plan.workUnits.map((u) => ({ id: u.id, title: u.title, dependencies: [...u.dependencies], writeScope: [...(u.files ?? [])] }))
        });
      } catch (error) {
        return fail('INVALID', `Plan check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /** Registered once as the `squad-launch-proposal` inbox action kind. */
    async handleAction({ ref, input }: { ref: string; input?: { optionId: string } }): Promise<void> {
      const record = await store.get(ref);
      if (!record || record.state !== 'pending') {
        throw new InboxActionOperatorError('This Squad launch proposal is no longer available.', true);
      }
      if (input?.optionId !== 'dismiss') throw new InboxActionOperatorError('Unknown action for this Squad launch proposal.');
      if (leaseActive(ref)) throw new InboxActionOperatorError('This Squad launch is starting.');
      let changed = false;
      await store.update(ref, (r) => { if (r.state === 'pending') { r.state = 'dismissed'; changed = true; } });
      if (!changed) throw new InboxActionOperatorError('This Squad launch proposal is no longer available.', true);
    },

    async review(windowId: number | string, proposalId: string, allowProject: (projectId: string) => boolean): Promise<SquadProposalOutcome<SquadLaunchPrefill>> {
      try {
        if (!deps.enabled()) return fail('DISABLED', 'Squad launches are turned off in Settings.');
        await sweepExpired();
        const record = await store.get(proposalId);
        if (!record || !allowProject(record.projectId)) return fail('NOT_FOUND', 'Squad launch proposal not found.');
        if (record.state === 'expired') return fail('EXPIRED', 'This Squad launch proposal expired.');
        if (record.state !== 'pending') return fail('NOT_PENDING', 'This Squad launch proposal was already handled.');
        if (leaseActive(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const prepared = await prepare(record.projectId, record.teamId, record.goal, record.planning, record.sources.map((s) => s.path));
        if (!prepared.ok) return prepared;
        let issued: Awaited<ReturnType<SquadProposalServiceDeps['issueSources']>>;
        try {
          issued = await deps.issueSources(windowId, record.projectId, prepared.value.sources.map((s) => s.path), prepared.value.project.path);
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code;
          const reason = error instanceof Error ? error.message : String(error);
          return fail('SOURCE_UNREADABLE', `The source files could not be attached${typeof code === 'string' ? ` (${code})` : ''}: ${reason}`);
        }
        return ok({
          proposalId: record.id,
          projectId: record.projectId,
          teamId: record.teamId,
          coordinationMode: planningToCoordinationMode(prepared.value.planning),
          goal: record.goal,
          ...(record.title ? { title: record.title } : {}),
          ...(record.summary ? { summary: record.summary } : {}),
          sources: issued.map((s) => ({ id: s.id, name: s.name, byteSize: s.byteSize, expiresAt: s.expiresAt })),
          ...(record.proposer.title ? { proposerTitle: record.proposer.title } : {}),
          ...(prepared.value.planSteps ? { planStepCount: prepared.value.planSteps.length } : {})
        });
      } catch (error) {
        return fail('INVALID', `Review failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async beginLaunch(proposalId: string, projectId: string): Promise<SquadProposalOutcome<{
      proposal: { id: string; proposerKind: 'pty' | 'thread'; proposerId: string; proposerTitle?: string };
    }>> {
      try {
        await sweepExpired();
        const record = await store.get(proposalId);
        if (!record || record.projectId !== projectId) return fail('NOT_FOUND', 'Squad launch proposal not found.');
        if (record.state === 'expired') return fail('EXPIRED', 'This Squad launch proposal expired.');
        if (record.state !== 'pending') return fail('NOT_PENDING', 'This Squad launch proposal was already handled.');
        if (leaseActive(proposalId)) return fail('NOT_PENDING', 'This Squad launch is already starting.');
        const existing = await deps.findLaunchedExecution?.(projectId, proposalId);
        if (existing) {
          await recordLaunched(proposalId, existing);
          return fail('NOT_PENDING', 'A Squad was already started from this proposal.');
        }
        launching.set(proposalId, deps.now() + LAUNCH_LEASE_MS);
        return ok({
          proposal: {
            id: record.id, proposerKind: record.proposer.kind, proposerId: record.proposer.id,
            ...(record.proposer.title ? { proposerTitle: record.proposer.title } : {})
          }
        });
      } catch (error) {
        return fail('INVALID', `Launch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /** The launch failed before a Squad started: let the user try again straight away. */
    releaseLaunch(proposalId: string): void {
      launching.delete(proposalId);
    },

    /** Record the launch. The lease is released only after the write, so a failed write can't reopen the proposal. */
    async markLaunched(proposalId: string, executionId: string): Promise<void> {
      await recordLaunched(proposalId, executionId);
      launching.delete(proposalId);
    }
  };
}

export type SquadProposalService = ReturnType<typeof createSquadProposalService>;
