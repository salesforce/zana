import { existsSync as nodeExistsSync, realpathSync as nodeRealpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { validateSquadExecutionTarget } from '@zana-ai/zcc-domain/product';
import type { LaunchProfileId, Persona, Project, ProjectSettings, Team, TerminalSession, CreateTerminalRequest, Result, SquadExecutionTargetSelector } from '@zana-ai/zcc-domain/product';
import { isUserOwnedSquadWorktree, type ExecutionRecord, type SquadWorktreeRecord } from '@zana-ai/zcc-server/services/execution/store';
import type * as GitModule from '@zana-ai/zcc-server/services/projects/git';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { InboxActionOperatorError } from './inbox-actions/registry.js';
import {
  currentRetainedSquadWorktreeAction,
  isTerminalSquadExecution,
  isWithinRetainedSquadWorktreeBase,
  squadFollowUpPrompt,
  type RetainedSquadWorktreeAction
} from './inbox-actions/squad-instruct.js';
import { squadWorktreeRetainedNotice, squadWorktreeUnavailableNotice } from './squad-worktree-notice.js';
import {
  claimSquadWorktreeFollowUp,
  ineligibleSquadWorktreeFallback,
  mayReleaseSquadWorktreeGuard,
  resolveSquadWorktreeDisposition,
  resolveSquadWorktreePreparation,
  shouldReplaySquadWorktreeTerminalEffects,
  squadWorktreeHasActiveFollowUp,
  withSquadWorktreeLifecycleLock,
  type SquadWorktreeTerminalOutcome
} from './squad-worktree-lifecycle.js';

export const SQUAD_WORKTREE_ACTION = 'squad-worktree-lifecycle';

const ACTIVE_FOLLOW_UP_MESSAGE = 'Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.';
const RETAINED_UNAVAILABLE_MESSAGE = 'Retained Squad worktree or branch is unavailable.';
const CONFIRMATION_UNAVAILABLE_MESSAGE = 'This confirmation is unavailable because the retained Squad worktree or branch no longer exists.';
const FOLLOW_UP_REASON_MAX = 300;
const USER_TARGET_NOT_DELETED_MESSAGE = 'This Squad ran in your own checkout. Zana never deletes, merges, or cleans a user-owned target.';
/** Error message for any selected-target resolution failure; never falls back to a generated worktree. */
export const TARGET_UNAVAILABLE = 'TARGET_UNAVAILABLE';

function sameTargetSelector(
  recorded: SquadExecutionTargetSelector | undefined,
  supplied: SquadExecutionTargetSelector
): boolean {
  return recorded?.kind === supplied.kind
    && (recorded.kind !== 'worktree' || supplied.kind === 'worktree' && recorded.branch === supplied.branch);
}

/**
 * Operator-facing launch denial: the launcher's own reason with control characters
 * stripped, whitespace collapsed and length capped, so it can be shown verbatim.
 */
export function followUpLaunchDeniedMessage(reason: string | undefined): string {
  const cleaned = (reason ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const bounded = cleaned.length > FOLLOW_UP_REASON_MAX ? `${cleaned.slice(0, FOLLOW_UP_REASON_MAX - 1)}…` : cleaned;
  return `Follow-up agent was not launched: ${bounded || 'launch was refused'}`;
}

/** Realpath of a project's managed squad worktree base, or undefined when absent. */
export function squadWorktreeBaseRoot(projectRoot: string, realpath: (path: string) => string = nodeRealpathSync): string | undefined {
  try {
    return realpath(join(projectRoot, '.worktrees'));
  } catch {
    return undefined;
  }
}

/** True when `candidate` lies inside the project's existing managed worktree base. */
export function isWithinSquadWorktreeBase(candidate: string, projectRoot: string, realpath: (path: string) => string = nodeRealpathSync): boolean {
  const base = squadWorktreeBaseRoot(projectRoot, realpath);
  return base !== undefined && isWithin(candidate, base);
}

/** Squad worktree base trusted as a launch root for `cwd`, or null when `cwd` is elsewhere. */
export function trustedSquadWorktreeRoot(cwd: string, projectRoot: string, realpath: (path: string) => string = nodeRealpathSync): string | null {
  const base = squadWorktreeBaseRoot(projectRoot, realpath);
  return base !== undefined && isWithin(cwd, base) ? base : null;
}

export function squadWorktreeSlug(
  teamId: string,
  executionId: string,
  sanitizeBranchSlug: (value: string) => string | null | undefined
): string {
  return sanitizeBranchSlug(`${teamId}-${executionId}`) ?? `squad-${executionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

type GitOps = Pick<typeof GitModule,
  'getGitStatus' | 'setWorktreePushProtection' | 'createWorktree' | 'mergeWorktree' | 'removeWorktree' | 'worktreeState' | 'isGitRepo' | 'sanitizeBranchSlug'>
  // Selected-target resolution only; when absent every selector is unavailable.
  & Partial<Pick<typeof GitModule, 'listWorktrees' | 'gitCommonDir'>>;

type SpawnLifecycle = {
  maySpawn: () => Promise<boolean>;
  claimRunning: () => Promise<boolean>;
  withSpawnLock?: <T>(spawn: () => Promise<T>) => Promise<T>;
  onSessionCreated?: (session: TerminalSession) => void;
};

export interface SquadWorktreeRuntimeDeps {
  executionStore: {
    get(executionId: string): Promise<ExecutionRecord | undefined>;
    getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
    setSquadWorktree(executionId: string, expectedStateVersion: number, worktree: SquadWorktreeRecord): Promise<ExecutionRecord>;
    markSquadWorktreeTerminalEffects(executionId: string, stateVersion: number): Promise<unknown>;
    disposeSquadWorktree(executionId: string, stateVersion: number, disposition: 'left' | 'deleted'): Promise<unknown>;
    listUndisposedSquadWorktrees(): Promise<ExecutionRecord[]>;
  };
  inboxStore: {
    append(input: InboxInput): Promise<{ id: string }>;
    appendOnce(input: InboxInput): Promise<{ id: string }>;
  };
  inboxActionRegistry: {
    bind(entry: any, action: { kind: string; ref: string; textOptionId?: string }): unknown;
    markUnavailable(kind: string, ref: string, message: string): unknown;
  };
  projects: { listProjects(): Project[] };
  teams: { list(): Team[] };
  personas: { list(): Persona[] };
  config: { getConfig(): { worktreeIsolationDefault?: boolean } };
  getProjectSettings(projectId: string): Promise<Pick<ProjectSettings, 'worktreeIsolation'>>;
  resolveTeamProfile(project: Project, personas: readonly Persona[], persona: Persona): LaunchProfileId;
  cancelTeamLaunch(principalId: string, launchRequestId: string): Promise<Parameters<typeof mayReleaseSquadWorktreeGuard>[0]>;
  launchFollowUpTerminal(request: CreateTerminalRequest, lifecycle: SpawnLifecycle, executionId: string): Promise<Result<TerminalSession>>;
  git: GitOps;
  fs?: { existsSync(path: string): boolean; realpathSync(path: string): string };
  /** Main's managed-workspace trust check for a canonical path outside the project checkout. */
  isTrustedWorkspacePath?: (realPath: string) => boolean;
}

type RetainedActionRecord = ExecutionRecord & { squadWorktree: SquadWorktreeRecord };

/**
 * Retained Squad worktree lifecycle: prepare a checkout at launch, apply the
 * terminal policy (merge / leave / delete) and serve the Inbox and Squad-details
 * actions. Every mutation runs under the per-execution lifecycle lock, re-reading
 * durable state at each async boundary; the renderer never supplies a path (rule 1).
 */
export function createSquadWorktreeRuntime(deps: SquadWorktreeRuntimeDeps) {
  const fs = deps.fs ?? { existsSync: nodeExistsSync, realpathSync: nodeRealpathSync };
  const { executionStore, inboxStore, inboxActionRegistry, git } = deps;
  const findProject = (projectId: string) => deps.projects.listProjects().find((candidate) => candidate.id === projectId);
  const withinBase = (candidate: string, projectRoot: string) => isWithinSquadWorktreeBase(candidate, projectRoot, fs.realpathSync);

  /**
   * Resolve a trusted selector to one canonical, user-owned target of the registered
   * local project's own repository. Every failure is TARGET_UNAVAILABLE: there is no
   * fallback to the project root or a generated worktree.
   */
  async function resolveUserTarget(project: Project | undefined, selector: SquadExecutionTargetSelector | undefined): Promise<SquadWorktreeRecord> {
    try {
      if (!project || project.remote || project.quickAgent || !selector) throw new Error(TARGET_UNAVAILABLE);
      const root = fs.realpathSync(project.path);
      const rootCommon = await git.gitCommonDir?.(root);
      if (!rootCommon) throw new Error(TARGET_UNAVAILABLE);
      let path = root;
      if (selector.kind === 'worktree') {
        const matches = (await git.listWorktrees?.(root) ?? []).filter((entry) =>
          !entry.isMain && !entry.bare && !entry.detached && entry.branch === selector.branch);
        if (matches.length !== 1) throw new Error(TARGET_UNAVAILABLE);
        path = fs.realpathSync(matches[0]!.path);
        if (path === root) throw new Error(TARGET_UNAVAILABLE);
        // Project-contained, or inside a main-managed workspace; never an arbitrary host path.
        if (!isWithin(path, root) && !deps.isTrustedWorkspacePath?.(path)) throw new Error(TARGET_UNAVAILABLE);
        const common = await git.gitCommonDir?.(path);
        if (!common || fs.realpathSync(common) !== fs.realpathSync(rootCommon)) throw new Error(TARGET_UNAVAILABLE);
      }
      const status = await git.getGitStatus(path);
      if (!status?.branch || status.detached) throw new Error(TARGET_UNAVAILABLE);
      if (selector.kind === 'worktree' && status.branch !== selector.branch) throw new Error(TARGET_UNAVAILABLE);
      return { path, branch: status.branch, ownership: 'user', targetKind: selector.kind };
    } catch {
      throw new Error(TARGET_UNAVAILABLE);
    }
  }

  /** Re-resolve a recorded user-owned target; it must still be the same canonical path and branch. */
  async function revalidateUserTarget(record: ExecutionRecord): Promise<SquadWorktreeRecord> {
    const recorded = record.squadWorktree;
    if (!recorded || !isUserOwnedSquadWorktree(recorded)) throw new Error(TARGET_UNAVAILABLE);
    const resolved = await resolveUserTarget(findProject(record.projectId), record.request.target);
    if (resolved.path !== recorded.path || resolved.branch !== recorded.branch || resolved.targetKind !== recorded.targetKind) {
      throw new Error(TARGET_UNAVAILABLE);
    }
    return resolved;
  }

  async function bindUserTarget(record: ExecutionRecord, project: Project | undefined, selector: SquadExecutionTargetSelector): Promise<ExecutionRecord> {
    if (record.squadWorktree) {
      // A record that already owns a generated worktree can never switch to a user target.
      if (!isUserOwnedSquadWorktree(record.squadWorktree)) throw new Error(TARGET_UNAVAILABLE);
      if (!sameTargetSelector(record.request.target, selector)) throw new Error(TARGET_UNAVAILABLE);
      await revalidateUserTarget(record);
      return record;
    }
    const resolved = await resolveUserTarget(project, selector);
    const latest = await executionStore.get(record.id);
    if (!latest || latest.stateVersion !== record.stateVersion || latest.squadWorktree) throw new Error(TARGET_UNAVAILABLE);
    return executionStore.setSquadWorktree(record.id, record.stateVersion, resolved);
  }

  async function prepareSquadWorktree(
    initial: ExecutionRecord,
    request: { worktree?: boolean; onComplete?: 'leave' | 'merge' | 'delete'; target?: SquadExecutionTargetSelector }
  ): Promise<ExecutionRecord> {
    return withSquadWorktreeLifecycleLock(initial.id, async () => {
      // Lifecycle lock precedes Git's existing worktree locks, avoiding inversion.
      const current = await executionStore.get(initial.id);
      if (!current || current.stateVersion !== initial.stateVersion) return current ?? initial;
      const record = current;
      const project = findProject(record.projectId);
      const retainedWorktree = record.squadWorktree;
      const selector = request.target ?? record.request.target;
      if (selector !== undefined || isUserOwnedSquadWorktree(retainedWorktree)) {
        // Admission already applied this rule; repeat it so no caller can skip it.
        const checked = validateSquadExecutionTarget({
          target: selector,
          worktree: request.worktree ?? record.request.worktree,
          onComplete: request.onComplete ?? record.request.onComplete
        });
        if (!checked.ok || !checked.target) throw new Error(TARGET_UNAVAILABLE);
        return bindUserTarget(record, project, checked.target);
      }
      const team = deps.teams.list().find((candidate) => candidate.id === record.teamId);
      const projectSettings = project ? await deps.getProjectSettings(project.id) : undefined;
      const preparation = resolveSquadWorktreePreparation({
        retained: retainedWorktree !== undefined,
        launch: request.worktree,
        project: projectSettings?.worktreeIsolation,
        global: deps.config.getConfig().worktreeIsolationDefault,
        squad: team?.worktreeIsolation
      });
      if (preparation === 'reattach') return reattach(record, project, retainedWorktree);
      if (!project || !team) return record;
      if (preparation === 'project-root') return record;
      return create(record, project, team, retainedWorktree);
    });
  }

  async function reattach(record: ExecutionRecord, project: Project | undefined, retainedWorktree: SquadWorktreeRecord | undefined): Promise<ExecutionRecord> {
    try {
      if (!project || !retainedWorktree) throw new Error('WORKTREE_UNAVAILABLE');
      const path = fs.realpathSync(retainedWorktree.path);
      if (path !== retainedWorktree.path || !withinBase(path, project.path)) throw new Error('WORKTREE_UNAVAILABLE');
      const status = await git.getGitStatus(path);
      if (!status || status.branch !== retainedWorktree.branch) throw new Error('WORKTREE_UNAVAILABLE');
      const latest = await executionStore.get(record.id);
      if (!latest || latest.stateVersion !== record.stateVersion || !latest.squadWorktree
        || latest.squadWorktree.path !== retainedWorktree.path || latest.squadWorktree.branch !== retainedWorktree.branch) {
        throw new Error('WORKTREE_UNAVAILABLE');
      }
      const protection = await git.setWorktreePushProtection(project.path, path, true);
      if (!protection.ok) throw new Error('WORKTREE_UNAVAILABLE');
      return latest;
    } catch {
      // A retained execution may only resume in its recorded managed checkout.
      throw new Error('WORKTREE_UNAVAILABLE');
    }
  }

  async function create(record: ExecutionRecord, project: Project, team: Team, retainedWorktree: SquadWorktreeRecord | undefined): Promise<ExecutionRecord> {
    const fallback = await ineligibleSquadWorktreeFallback(project, git.isGitRepo);
    if (fallback) {
      await inboxStore.appendOnce({
        projectId: project.id,
        projectLabel: project.name,
        subject: fallback.notice.subject,
        comments: fallback.notice.comments,
        executionId: record.id,
        dedupeKey: `squad-worktree-fallback:${record.id}`
      });
      return record;
    }
    const slug = squadWorktreeSlug(team.id, record.id, git.sanitizeBranchSlug);
    const expectedTarget = join(project.path, '.worktrees', slug);
    // A durable record may outlive its checkout after cleanup or a machine restart.
    // Only restore its original managed location; a different branch checkout remains
    // a concurrent replacement and createWorktree rejects it.
    if (retainedWorktree && resolve(retainedWorktree.path) !== resolve(expectedTarget)) {
      throw new Error('WORKTREE_UNAVAILABLE');
    }
    const target = retainedWorktree?.path ?? expectedTarget;
    const branch = retainedWorktree?.branch ?? `zcc/${slug}`;
    const beforeCreate = await executionStore.get(record.id);
    if (!beforeCreate || beforeCreate.stateVersion !== record.stateVersion) return beforeCreate ?? record;
    if (beforeCreate.squadWorktree && beforeCreate.squadWorktree.branch !== branch) return beforeCreate;
    const created = await git.createWorktree(project.path, target, branch, join(project.path, '.worktrees'), true);
    if (!created.ok) {
      if (retainedWorktree) throw new Error('WORKTREE_UNAVAILABLE');
      await inboxStore.appendOnce(squadWorktreeUnavailableNotice(project, record.id, created.reason));
      return record;
    }
    const path = fs.realpathSync(created.path);
    if (!withinBase(path, project.path)) {
      throw new Error('squad worktree escaped registered project worktree base');
    }
    const baseBranch = retainedWorktree?.baseBranch ?? (await git.getGitStatus(project.path))?.branch;
    if (!baseBranch) throw new Error('squad worktree base branch is unavailable');
    const latest = await executionStore.get(record.id);
    if (!latest || latest.stateVersion !== record.stateVersion || latest.squadWorktree) return latest ?? record;
    return executionStore.setSquadWorktree(record.id, record.stateVersion, {
      path,
      branch: created.branch,
      baseBranch
    } satisfies SquadWorktreeRecord);
  }

  async function appendSquadWorktreeNotice(
    record: ExecutionRecord,
    comments: string,
    options: Array<{ id: string; label: string }>,
    phase: 'choose' | 'confirm' = 'choose'
  ): Promise<void> {
    const project = findProject(record.projectId);
    if (!project || !record.squadWorktree) return;
    const notice = {
      projectId: project.id,
      projectLabel: project.name,
      executionId: record.id,
      hostActionRequired: true as const,
      subject: 'Squad worktree ready',
      comments,
      // Same execution may become terminal again after resume. A new terminal
      // generation needs a new entry; prior generation entries stay fenced.
      questions: [{ prompt: 'Choose worktree disposition', options }]
    };
    // Every Delete request gets an independent confirmation. This prevents a stale
    // confirmation from becoming implicit authority over a later user request.
    const entry = phase === 'confirm'
      ? await inboxStore.append(notice)
      : await inboxStore.appendOnce({ ...notice, dedupeKey: `squad-worktree-lifecycle:${record.id}:${record.stateVersion}:${phase}` });
    inboxActionRegistry.bind(entry, {
      kind: SQUAD_WORKTREE_ACTION,
      // Resume advances stateVersion, invalidating every terminal action issued for
      // the prior attempt before it can delete or launch inside that worktree.
      ref: JSON.stringify({ executionId: record.id, phase, stateVersion: record.stateVersion }),
      ...(phase === 'choose' ? { textOptionId: 'instruct' } : {})
    });
  }

  /**
   * Apply a terminal run's worktree policy. Resolves with what was done once the terminal
   * effects are durably marked ('merged', 'kept' or 'missing'), and `undefined` when this
   * call applied nothing (no worktree, not terminal, an active follow-up, or team teardown
   * still pending; a later call applies them).
   */
  async function handleSquadWorktreeTerminal(initial: ExecutionRecord): Promise<SquadWorktreeTerminalOutcome | undefined> {
    return withSquadWorktreeLifecycleLock(initial.id, async (): Promise<SquadWorktreeTerminalOutcome | undefined> => {
      let record = initial;
      const currentTerminal = async () => {
        const current = await executionStore.get(record.id);
        if (!current || current.stateVersion !== record.stateVersion || !current.squadWorktree || !isTerminalSquadExecution(current.state)) return undefined;
        return current;
      };
      const first = await currentTerminal();
      if (!first) return;
      if (!shouldReplaySquadWorktreeTerminalEffects(first)) return;
      record = first;
      if (squadWorktreeHasActiveFollowUp(record.id)) return;
      const teardown = await deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      if (!mayReleaseSquadWorktreeGuard(teardown)) return;
      const latest = await currentTerminal();
      if (!latest) return;
      record = latest;
      const worktree = latest.squadWorktree;
      if (!worktree) return;
      const project = findProject(record.projectId);
      if (isUserOwnedSquadWorktree(worktree)) {
        // A user-owned target is never push-guarded, merged, or removed by Zana.
        await executionStore.markSquadWorktreeTerminalEffects(record.id, record.stateVersion);
        return 'kept';
      }
      // A crash can land after Git removes the checkout but before the durable
      // completion marker. Missing recorded checkout is the idempotent delete
      // result, never a reason to retry another terminal policy action.
      if (!fs.existsSync(worktree.path)) {
        await executionStore.markSquadWorktreeTerminalEffects(record.id, record.stateVersion);
        return 'missing';
      }
      if (project) {
        const protection = await git.setWorktreePushProtection(project.path, worktree.path, false);
        if (!protection.ok) throw new Error(`could not disable squad worktree push guard: ${protection.reason}`);
      }
      const requested = record.request.onComplete ?? 'leave';
      if (record.state === 'COMPLETED' && requested === 'merge') {
        const base = worktree.baseBranch;
        const beforeMerge = await currentTerminal();
        if (project && base && beforeMerge) {
          if (squadWorktreeHasActiveFollowUp(record.id)) return;
          const merged = await git.mergeWorktree(project.path, beforeMerge.squadWorktree!.path, base);
          if (merged.ok) {
            const beforeRemove = await currentTerminal();
            if (!beforeRemove) return;
            const removed = await git.removeWorktree(project.path, beforeRemove.squadWorktree!.path, false);
            if (removed.ok) {
              await executionStore.markSquadWorktreeTerminalEffects(beforeRemove.id, beforeRemove.stateVersion);
              return 'merged';
            }
          }
        }
      }
      // Inbox records the terminal outcome only. Recovery and retained-worktree
      // lifecycle controls belong to Squad details, where their run state is visible.
      await inboxStore.appendOnce(squadWorktreeRetainedNotice({
        projectId: record.projectId,
        projectLabel: project?.name,
        executionId: record.id,
        stateVersion: record.stateVersion,
        jobTitle: record.jobTitle,
        state: record.state,
        worktreePath: worktree.path
      }));
      await executionStore.markSquadWorktreeTerminalEffects(record.id, record.stateVersion);
      return 'kept';
    });
  }

  async function replayUndisposedTerminalEffects(): Promise<void> {
    const retained = await executionStore.listUndisposedSquadWorktrees();
    for (const record of retained) {
      if (!shouldReplaySquadWorktreeTerminalEffects(record)) continue;
      await handleSquadWorktreeTerminal(record);
    }
  }

  async function retainedSquadWorktreeForInstruct(record: ExecutionRecord): Promise<{ project: Project; worktree: SquadWorktreeRecord }> {
    if (!record.squadWorktree || !isTerminalSquadExecution(record.state)) {
      throw new Error('retained squad worktree is unavailable');
    }
    const project = findProject(record.projectId);
    if (!project || project.remote || project.quickAgent) throw new Error('retained squad worktree is unavailable');
    if (isUserOwnedSquadWorktree(record.squadWorktree)) {
      return { project, worktree: await revalidateUserTarget(record) };
    }
    let path: string;
    try {
      if (fs.realpathSync(project.path) !== project.path) throw new Error('project path changed');
      path = fs.realpathSync(record.squadWorktree.path);
    } catch {
      throw new Error('retained squad worktree is unavailable');
    }
    if (path !== record.squadWorktree.path || !isWithinRetainedSquadWorktreeBase(path, project.path)) {
      throw new Error('retained squad worktree is unavailable');
    }
    const status = await git.getGitStatus(path);
    if (!status || status.branch !== record.squadWorktree.branch) {
      throw new Error('retained squad worktree is unavailable');
    }
    return { project, worktree: { ...record.squadWorktree, path } };
  }

  /**
   * The one persona a follow-up may run as. An explicit pick must belong to this
   * Squad's roster; otherwise the Squad's coordinator is inherited. A coordinator
   * that no longer resolves refuses rather than falling back to a bare profile,
   * which would drop the persona's restrictions.
   */
  function followUpPersona(record: RetainedActionRecord, personaId: string | undefined): Persona | undefined {
    const team = deps.teams.list().find((candidate) => candidate.id === record.teamId);
    if (!team) throw new InboxActionOperatorError('This Squad is no longer configured, so its follow-up agent cannot be chosen.');
    const roster = new Set([team.orchestratorPersonaId, ...(team.slots ?? []).map((slot) => slot.personaId)].filter((id): id is string => Boolean(id)));
    const wanted = personaId ?? team.orchestratorPersonaId;
    if (personaId !== undefined && !roster.has(personaId)) {
      throw new InboxActionOperatorError('The selected persona is not a member of this Squad. Choose one of its personas.');
    }
    if (!wanted) return undefined;
    const persona = deps.personas.list().find((candidate) => candidate.id === wanted);
    if (!persona) {
      throw new InboxActionOperatorError(personaId === undefined
        ? "This Squad's coordinator persona is no longer available. Choose another persona from the Squad for the follow-up."
        : 'The selected persona is no longer available. Choose another persona from the Squad.');
    }
    return persona;
  }

  async function instruct(
    record: RetainedActionRecord,
    currentRecord: () => Promise<RetainedActionRecord>,
    text: string | undefined,
    personaId?: string
  ): Promise<void> {
    if (squadWorktreeHasActiveFollowUp(record.id)) throw new InboxActionOperatorError(ACTIVE_FOLLOW_UP_MESSAGE);
    const instruction = text?.trim();
    if (!instruction) throw new Error('agent instruction is required');
    let project: Project;
    let worktree: SquadWorktreeRecord;
    try {
      ({ project, worktree } = await retainedSquadWorktreeForInstruct(record));
    } catch {
      throw new InboxActionOperatorError(RETAINED_UNAVAILABLE_MESSAGE, true);
    }
    const persona = followUpPersona(record, personaId);
    const profile = persona ? deps.resolveTeamProfile(project, deps.personas.list(), persona) : 'claude';
    const launched = await deps.launchFollowUpTerminal({
      projectId: project.id,
      profile,
      ...(persona ? { personaId: persona.id } : {}),
      cols: 80,
      rows: 24,
      prompt: squadFollowUpPrompt({ instruction, executionId: record.id, teamId: record.teamId, branch: worktree.branch }),
      title: `Follow-up: ${record.jobTitle}`,
      worktreeInfo: worktree
    } as CreateTerminalRequest, {
      // launchAuthorizedTerminal rechecks this directly before spawning, after all
      // async preflight. Resume or disposition during that interval cancels spawn.
      maySpawn: async () => {
        try {
          await currentRecord();
          await retainedSquadWorktreeForInstruct(await currentRecord());
          return true;
        } catch {
          return false;
        }
      },
      claimRunning: async () => {
        try {
          await currentRecord();
          return true;
        } catch {
          return false;
        }
      },
      // Final ownership check and terminal creation share lifecycle lock.
      withSpawnLock: async (spawn) => withSquadWorktreeLifecycleLock(record.id, async () => {
        const latest = await currentRecord();
        if (squadWorktreeHasActiveFollowUp(latest.id)) throw new InboxActionOperatorError(ACTIVE_FOLLOW_UP_MESSAGE);
        try {
          await retainedSquadWorktreeForInstruct(latest);
        } catch {
          throw new InboxActionOperatorError(RETAINED_UNAVAILABLE_MESSAGE, true);
        }
        return spawn();
      }),
      onSessionCreated: (session) => claimSquadWorktreeFollowUp(record.id, session.id)
    }, record.id);
    // The launcher's preflight is the compatibility authority. A denial spawned
    // nothing; surface its reason and never retry under another persona/profile.
    if (!launched.ok) throw new InboxActionOperatorError(followUpLaunchDeniedMessage(launched.message));
  }

  async function deleteWorktree(
    record: RetainedActionRecord,
    disposition: 'delete' | 'force',
    currentRecord: () => Promise<RetainedActionRecord>
  ): Promise<void> {
    await withSquadWorktreeLifecycleLock(record.id, async () => {
      const current = await currentRecord();
      if (isUserOwnedSquadWorktree(current.squadWorktree)) throw new InboxActionOperatorError(USER_TARGET_NOT_DELETED_MESSAGE);
      if (squadWorktreeHasActiveFollowUp(current.id)) throw new InboxActionOperatorError(ACTIVE_FOLLOW_UP_MESSAGE);
      let retained: { project: Project; worktree: SquadWorktreeRecord };
      try {
        retained = await retainedSquadWorktreeForInstruct(current);
      } catch {
        throw new InboxActionOperatorError(CONFIRMATION_UNAVAILABLE_MESSAGE, true);
      }
      const state = await git.worktreeState(retained.worktree.path);
      if (state.dirty && disposition !== 'force') {
        throw new InboxActionOperatorError('Worktree has uncommitted changes. Clean or commit them, then try again.');
      }
      if (state.commits > 0 && disposition !== 'force') {
        throw new InboxActionOperatorError('Worktree has unmerged commits. Choose Force delete unmerged work to continue.');
      }
      let latest: { project: Project; worktree: SquadWorktreeRecord };
      try {
        latest = await retainedSquadWorktreeForInstruct(await currentRecord());
      } catch {
        throw new InboxActionOperatorError(CONFIRMATION_UNAVAILABLE_MESSAGE, true);
      }
      const removed = await git.removeWorktree(latest.project.path, latest.worktree.path, disposition === 'force');
      if (!removed.ok) throw new Error(removed.message ?? 'could not delete squad worktree');
      await executionStore.disposeSquadWorktree(current.id, current.stateVersion, 'deleted');
      const unavailable = 'This confirmation is unavailable because the retained Squad worktree was deleted.';
      inboxActionRegistry.markUnavailable(SQUAD_WORKTREE_ACTION, JSON.stringify({ executionId: current.id, phase: 'confirm', stateVersion: current.stateVersion }), unavailable);
      inboxActionRegistry.markUnavailable(SQUAD_WORKTREE_ACTION, JSON.stringify({ executionId: current.id, phase: 'choose', stateVersion: current.stateVersion }), unavailable);
    });
  }

  async function runSquadWorktreeAction(
    fencedAction: RetainedSquadWorktreeAction,
    input?: { optionId?: string; text?: string; personaId?: string }
  ): Promise<void | { keepPending: true }> {
    const currentRecord = async (): Promise<RetainedActionRecord> => {
      try {
        return (await currentRetainedSquadWorktreeAction(
          fencedAction,
          () => executionStore.get(fencedAction.executionId)
        )) as RetainedActionRecord;
      } catch {
        throw new InboxActionOperatorError('This action is unavailable because the Squad run resumed or changed state.', true);
      }
    };
    const record = await currentRecord();
    const disposition = resolveSquadWorktreeDisposition(fencedAction.phase, input?.optionId);
    if (disposition === 'leave') {
      await executionStore.disposeSquadWorktree(record.id, record.stateVersion, 'left');
      return;
    }
    if (disposition === 'instruct') return instruct(record, currentRecord, input?.text, input?.personaId);
    const project = findProject(record.projectId);
    if (!project) throw new Error('project is unavailable');
    if ((disposition === 'confirm' || disposition === 'delete' || disposition === 'force') && isUserOwnedSquadWorktree(record.squadWorktree)) {
      throw new InboxActionOperatorError(USER_TARGET_NOT_DELETED_MESSAGE);
    }
    if (disposition === 'confirm') {
      if (squadWorktreeHasActiveFollowUp(record.id)) throw new InboxActionOperatorError(ACTIVE_FOLLOW_UP_MESSAGE);
      await appendSquadWorktreeNotice(
        record,
        `Confirm deletion of \`${record.squadWorktree.path}\`. Unmerged commits require Force delete; dirty worktrees are never deleted.`,
        [
          { id: 'confirm-delete', label: 'Delete permanently' },
          { id: 'force-delete', label: 'Force delete unmerged work' },
          { id: 'leave', label: 'Leave' }
        ],
        'confirm'
      );
      return { keepPending: true };
    }
    if (disposition !== 'delete' && disposition !== 'force') throw new Error('unknown squad worktree action');
    await deleteWorktree(record, disposition, currentRecord);
  }

  /** Inbox host-action handler: the ref is renderer-visible, so every field is revalidated. */
  async function handleInboxAction({ ref, input }: { ref: string; input?: { optionId?: string; text?: string; personaId?: string } }) {
    let action: Partial<RetainedSquadWorktreeAction>;
    try { action = JSON.parse(ref) as Partial<RetainedSquadWorktreeAction>; } catch { throw new Error('invalid squad worktree action'); }
    if (!action.executionId || !action.phase || !Number.isInteger(action.stateVersion)) throw new Error('invalid squad worktree action');
    if (input?.personaId !== undefined && (typeof input.personaId !== 'string' || !input.personaId.trim() || input.personaId.length > 200)) {
      throw new Error('invalid squad worktree action');
    }
    return runSquadWorktreeAction(action as RetainedSquadWorktreeAction, input);
  }

  /** Squad-details IPC entry. main re-reads the project-scoped record and fences stateVersion. */
  async function squadWorktreeAction(
    projectId: string,
    executionId: string,
    stateVersion: number,
    action: 'leave' | 'instruct' | 'delete' | 'force-delete',
    instruction?: string,
    /** Explicit follow-up persona; main confines it to the Squad roster. */
    personaId?: string
  ): Promise<Result<true>> {
    const phase = action === 'instruct' ? 'choose' : 'confirm';
    const optionId = action === 'delete' ? 'confirm-delete' : action === 'force-delete' ? 'force-delete' : action;
    try {
      const record = await executionStore.getInProject(projectId, executionId);
      if (!record || record.stateVersion !== stateVersion) return { ok: false, code: 'CONFLICT', message: 'Squad run changed. Refresh details and try again.' };
      await runSquadWorktreeAction({ executionId, phase, stateVersion }, {
        optionId,
        ...(instruction === undefined ? {} : { text: instruction }),
        ...(action === 'instruct' && personaId !== undefined ? { personaId } : {})
      });
      return { ok: true, value: true };
    } catch (error) {
      return { ok: false, code: error instanceof InboxActionOperatorError ? 'CONFLICT' : 'UNAVAILABLE', message: error instanceof Error ? error.message : 'squad worktree action failed' };
    }
  }

  return {
    prepareSquadWorktree,
    revalidateUserTarget,
    handleSquadWorktreeTerminal,
    replayUndisposedTerminalEffects,
    handleInboxAction,
    squadWorktreeAction,
    // Exposed for focused tests of the action state machine.
    runSquadWorktreeAction
  };
}

export type SquadWorktreeRuntime = ReturnType<typeof createSquadWorktreeRuntime>;
