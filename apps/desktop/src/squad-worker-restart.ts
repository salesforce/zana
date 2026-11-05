import { realpathSync } from 'node:fs';
import type {
  CreateTerminalRequest,
  Project,
  Result,
  TeamCoordinationMode,
  TerminalSession
} from '@zana-ai/zcc-domain/product';
import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import { isWithinRetainedSquadWorktreeBase } from './inbox-actions/squad-instruct.js';
import {
  restoreCapabilityLaunch,
  type CapabilityReservations,
  type FollowUpClaimOps,
  type RestoreLaunchInput,
  type RestoreLaunchPrincipal
} from './terminal-restore-launch.js';

export type SquadWorkerRestartResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not-found' | 'not-a-worker' | 'remote' | 'no-capability' | 'busy' | 'exit-timeout' | 'restart-timeout' | 'relaunch-failed';
      message?: string;
    };
type RestartFailure = Extract<SquadWorkerRestartResult, { ok: false }>;

/** The slice of an execution record a restart needs. */
export interface RestartExecutionRecord {
  squadWorktree?: { path: string; branch: string };
  coordinationMode?: TeamCoordinationMode;
}

export interface SquadWorkerRestartDeps {
  getSession(sessionId: string): TerminalSession | undefined;
  getProject(projectId: string): Pick<Project, 'path' | 'remote'> | undefined;
  getExecution(projectId: string, executionId: string): Promise<RestartExecutionRecord | undefined>;
  teamLaunchEnabled(): boolean;
  restoreCapabilities: CapabilityReservations & {
    reserve(id: string): { capability: RestoreCapability; reservationId: string } | undefined;
  };
  followUp: FollowUpClaimOps;
  restorePrincipal(capability: RestoreCapability): RestoreLaunchPrincipal;
  isTeamWorkerRestore(request: CreateTerminalRequest): boolean;
  /**
   * The host's launch seam, parameter for parameter, so a shifted position fails to compile.
   * A restart passes no commit hook, pre-issued authorization or task, deadline or spawn lifecycle.
   */
  launchAuthorizedTerminal(
    request: CreateTerminalRequest,
    principal: RestoreLaunchPrincipal,
    spawnOpts: Record<string, unknown>,
    teamId: string | undefined,
    onCommitted: undefined,
    preissuedAuthorizationId: undefined,
    preissuedInitialTask: undefined,
    deadlineAt: undefined,
    legacyPersonaFacetCompatibility: boolean,
    spawnLifecycle: undefined,
    followUpExecutionId: string | undefined
  ): Promise<Result<TerminalSession>>;
  /** Expected close plus tmux kill, without dropping the restore capability. */
  closeSession(sessionId: string): Promise<unknown>;
  /**
   * True once nothing is left to re-attach to. The PTY exit is only the tmux CLIENT going away;
   * a relaunch's `new-session -A` would otherwise attach the old, still-stuck agent.
   */
  sessionGone?(sessionId: string): Promise<boolean>;
  /** Runs after a successful relaunch, once the exit listener has already cleaned up. */
  onRelaunched(session: TerminalSession): void;
  exitTimeoutMs?: number;
  /** Bound on the whole restart, close to relaunch; past it the attempt is abandoned. */
  restartTimeoutMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

const DEFAULT_EXIT_TIMEOUT_MS = 10_000;
const DEFAULT_RESTART_TIMEOUT_MS = 60_000;

/** Same rule as the team launch: autonomous teams, or freeform with the team-launch setting on. */
export function squadWorkerAutonomous(mode: TeamCoordinationMode, teamLaunchEnabled: boolean): boolean {
  return mode === 'autonomous-team' || (mode === 'freeform' && teamLaunchEnabled);
}

/** Same rule as the team launch: durable modes suppress the persona's typed-in initial prompt. */
export function squadWorkerDurableCoordination(mode: TeamCoordinationMode): boolean {
  return mode === 'job-team' || mode === 'structured' || mode === 'freeform';
}

function fail(code: string, message: string): Result<never> {
  return { ok: false, code, message } as Result<never>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ExecutionLookup = () => Promise<RestartExecutionRecord | undefined>;

/** Puts the request back in the execution's Squad worktree, realpath-confined to the project's retained base. */
async function resolveSquadWorktree(
  deps: SquadWorkerRestartDeps,
  session: TerminalSession,
  lookup: ExecutionLookup,
  request: CreateTerminalRequest
): Promise<Result<CreateTerminalRequest>> {
  try {
    const record = await lookup();
    if (!record?.squadWorktree) return { ok: true, value: request };
    const project = deps.getProject(session.projectId);
    if (!project || project.remote) throw new Error('project unavailable');
    const root = realpathSync(project.path);
    const path = realpathSync(record.squadWorktree.path);
    if (!isWithinRetainedSquadWorktreeBase(path, root)) throw new Error('squad worktree is outside the project');
    return { ok: true, value: { ...request, worktreeInfo: { path, branch: record.squadWorktree.branch } } };
  } catch (error) {
    return fail('WORKTREE_UNAVAILABLE', `squad worktree unavailable: ${errorMessage(error)}`);
  }
}

/** Launches with the spawn options the team launch derives from the execution's coordination mode. */
async function launchWithTeamOptions(
  deps: SquadWorkerRestartDeps,
  session: TerminalSession,
  lookup: ExecutionLookup,
  input: RestoreLaunchInput
): Promise<Result<TerminalSession>> {
  const record = await lookup().catch(() => undefined);
  const coordinationMode = record?.coordinationMode ?? session.cohort?.coordinationMode ?? 'interactive-team';
  const spawnOpts = {
    ...input.spawnOpts,
    coordinationMode,
    autonomous: squadWorkerAutonomous(coordinationMode, deps.teamLaunchEnabled()),
    suppressPersonaInitialPrompt: squadWorkerDurableCoordination(coordinationMode),
    tabNamerPrompt: null
  };
  return deps.launchAuthorizedTerminal(
    input.request, input.principal, spawnOpts, input.teamId,
    undefined, undefined, undefined, undefined,
    input.legacyPersonaFacetCompatibility, undefined, input.followUpExecutionId
  );
}

/** Relaunch one Squad worker through its restore capability, back in its Squad worktree. */
export async function relaunchSquadWorker(
  deps: SquadWorkerRestartDeps,
  session: TerminalSession
): Promise<Result<TerminalSession>> {
  const reserved = session.restoreCapabilityId
    ? deps.restoreCapabilities.reserve(session.restoreCapabilityId)
    : undefined;
  if (!reserved) return fail('DENIED', 'restore capability unavailable or already reserved');
  const executionId = session.cohort?.executionId;
  const lookup: ExecutionLookup = executionId
    ? () => deps.getExecution(session.projectId, executionId)
    : async () => undefined;
  return restoreCapabilityLaunch({
    capability: reserved.capability,
    reservationId: reserved.reservationId,
    reservations: deps.restoreCapabilities,
    followUp: deps.followUp,
    restorePrincipal: (capability) => deps.restorePrincipal(capability),
    isTeamWorkerRestore: (request) => deps.isTeamWorkerRestore(request),
    resolveWorktree: (request) => resolveSquadWorktree(deps, session, lookup, request),
    launch: (input) => launchWithTeamOptions(deps, session, lookup, input)
  });
}

interface PendingRestart {
  session: TerminalSession;
  /** The host's exit path, held back while the relaunch is tried. */
  finalizeExit?: () => Promise<void>;
  exitTimer?: unknown;
  deadlineTimer?: unknown;
  relaunchTimer?: unknown;
  /** Settles once `closeSession` (expected close + tmux kill) has finished. */
  closed?: Promise<unknown>;
  /** Set once the attempt is over: every later step of it stops. */
  over: boolean;
  resolve(result: SquadWorkerRestartResult): void;
}

/**
 * Restarts a Squad worker in place: closes its session, holds back the host's exit path while the
 * worker is relaunched with the same session id, and runs that exit path after all if the relaunch
 * does not happen. Every attempt settles within `restartTimeoutMs`, plus at most `exitTimeoutMs`
 * spent waiting for a held-back exit path to finish.
 */
export class SquadWorkerRestarter {
  private readonly pending = new Map<string, PendingRestart>();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly exitTimeoutMs: number;
  private readonly restartTimeoutMs: number;
  private disposed = false;

  constructor(private readonly deps: SquadWorkerRestartDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.exitTimeoutMs = deps.exitTimeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS;
    this.restartTimeoutMs = deps.restartTimeoutMs ?? DEFAULT_RESTART_TIMEOUT_MS;
  }

  async restart(sessionId: string): Promise<SquadWorkerRestartResult> {
    const refused = this.refusal(sessionId);
    if (refused) return refused;
    const session = this.deps.getSession(sessionId)!;
    return new Promise<SquadWorkerRestartResult>((resolve) => {
      const entry: PendingRestart = { session, over: false, resolve };
      this.pending.set(sessionId, entry);
      entry.exitTimer = this.setTimer(() => {
        if (entry.relaunchTimer === undefined) void this.abandon(sessionId, entry, { ok: false, reason: 'exit-timeout' });
      }, this.exitTimeoutMs);
      entry.deadlineTimer = this.setTimer(() => void this.abandon(sessionId, entry, {
        ok: false, reason: 'restart-timeout', message: `the restart did not finish within ${Math.round(this.restartTimeoutMs / 1000)} s`
      }), this.restartTimeoutMs);
      entry.closed = Promise.resolve()
        .then(() => this.deps.closeSession(sessionId))
        .catch((error) => this.abandon(sessionId, entry, { ok: false, reason: 'relaunch-failed', message: errorMessage(error) }));
    });
  }

  onSessionExit(sessionId: string, finalizeExit: () => Promise<void>): void {
    const entry = this.pending.get(sessionId);
    if (!entry) {
      void finalizeExit();
      return;
    }
    if (entry.relaunchTimer !== undefined) {
      // A second exit while the relaunch is pending: the relaunched process died before it was handed
      // over. Its exit path is the one that must run; the late relaunch result is then closed.
      entry.finalizeExit = finalizeExit;
      void this.abandon(sessionId, entry, { ok: false, reason: 'relaunch-failed', message: 'the relaunched session exited' });
      return;
    }
    if (entry.exitTimer !== undefined) this.clearTimer(entry.exitTimer);
    entry.exitTimer = undefined;
    entry.finalizeExit = finalizeExit;
    // Let the rest of the exit listener (refreshRestoreCapability included) run first.
    entry.relaunchTimer = this.setTimer(() => void this.runRelaunch(sessionId, entry), 0);
  }

  isRestarting(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  dispose(): void {
    this.disposed = true;
    // At quit the execution services are disposed straight after this, so a held-back exit is
    // dropped rather than run against them.
    for (const [sessionId, entry] of [...this.pending]) {
      this.end(sessionId, entry);
      entry.finalizeExit = undefined;
      entry.resolve({ ok: false, reason: 'relaunch-failed', message: 'disposed' });
    }
  }

  private refusal(sessionId: string): SquadWorkerRestartResult | undefined {
    const session = this.deps.getSession(sessionId);
    if (!session || session.status === 'exited') return { ok: false, reason: 'not-found' };
    const cohort = session.cohort;
    if (cohort?.role !== 'worker' || !cohort.executionId || !cohort.slotId) return { ok: false, reason: 'not-a-worker' };
    if (session.remoteTmuxId || this.deps.getProject(session.projectId)?.remote) return { ok: false, reason: 'remote' };
    if (session.workspaceEnvironmentId || (session.environment && session.environment !== 'local')) {
      return { ok: false, reason: 'remote', message: 'session runs in a managed environment' };
    }
    if (!session.restoreCapabilityId) return { ok: false, reason: 'no-capability' };
    if (this.pending.has(sessionId)) return { ok: false, reason: 'busy' };
    return undefined;
  }

  /** True while this attempt may still act: not over, still the session's restart, restarter not disposed. */
  private current(sessionId: string, entry: PendingRestart): boolean {
    return !this.disposed && !entry.over && this.pending.get(sessionId) === entry;
  }

  /** Marks the attempt over and stops its timers; the caller settles it. */
  private end(sessionId: string, entry: PendingRestart): void {
    entry.over = true;
    if (this.pending.get(sessionId) === entry) this.pending.delete(sessionId);
    for (const timer of [entry.exitTimer, entry.deadlineTimer, entry.relaunchTimer]) {
      if (timer !== undefined) this.clearTimer(timer);
    }
  }

  /**
   * Ends an attempt that did not relaunch, once. A held-back exit runs first, so the engine learns
   * the worker is gone before the recovery ladder records the failure.
   */
  private async abandon(sessionId: string, entry: PendingRestart, failure: RestartFailure): Promise<void> {
    if (entry.over) return;
    this.end(sessionId, entry);
    const finalize = entry.finalizeExit;
    entry.finalizeExit = undefined;
    if (finalize) await this.within(finalize().catch(() => undefined), this.exitTimeoutMs);
    entry.resolve(failure);
  }

  /** Waits for `work`, but no longer than `ms`; the work itself keeps running. */
  private within(work: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.setTimer(resolve, ms);
      void work.then(() => { this.clearTimer(timer); resolve(); });
    });
  }

  private async runRelaunch(sessionId: string, entry: PendingRestart): Promise<void> {
    let message: string | undefined;
    try {
      // The exit can arrive before the tmux kill has finished: wait for it, then make sure
      // nothing is left that the relaunch would re-attach to.
      await entry.closed;
      if (!this.current(sessionId, entry)) return;
      if (this.deps.sessionGone && !await this.deps.sessionGone(sessionId)) throw new Error('the old session is still running');
      if (!this.current(sessionId, entry)) return;
      const result = await relaunchSquadWorker(this.deps, entry.session);
      if (result.ok) {
        await this.relaunched(sessionId, entry, result.value);
        return;
      }
      message = `${result.code}: ${result.message}`;
    } catch (error) {
      message = errorMessage(error);
    }
    await this.abandon(sessionId, entry, { ok: false, reason: 'relaunch-failed', message });
  }

  private async relaunched(sessionId: string, entry: PendingRestart, session: TerminalSession): Promise<void> {
    if (!this.current(sessionId, entry)) {
      // The attempt timed out and its exit already ran, so the worker counts as gone: close the late
      // session too. At quit it is left to the shutdown path like every other session.
      if (!this.disposed) await this.deps.closeSession(session.id).catch(() => undefined);
      return;
    }
    this.end(sessionId, entry);
    entry.finalizeExit = undefined;
    try {
      this.deps.onRelaunched(entry.session);
    } finally {
      entry.resolve({ ok: true });
    }
  }
}

export function createSquadWorkerRestarter(deps: SquadWorkerRestartDeps): SquadWorkerRestarter {
  return new SquadWorkerRestarter(deps);
}
