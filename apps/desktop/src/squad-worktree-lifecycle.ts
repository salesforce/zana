export type SquadWorktreeDisposition = 'leave' | 'instruct' | 'confirm' | 'delete' | 'force' | 'invalid';

/**
 * Serializes lifecycle side effects for one retained squad execution. This lock
 * deliberately sits outside Git's checkout/worktree locks: lifecycle callers
 * acquire it first, then Git helpers take their existing locks.
 */
const lifecycleLockTails = new Map<string, Promise<void>>();

/**
 * Live normal follow-up agents own their retained checkout until PtyManager
 * confirms exit. Lifecycle actions must observe this only while holding the
 * matching execution lock.
 */
const activeFollowUpSessions = new Map<string, Set<string>>();

export async function withSquadWorktreeLifecycleLock<T>(executionId: string, run: () => Promise<T>): Promise<T> {
  const key = `squad-worktree-lifecycle:${executionId}`;
  const previous = lifecycleLockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  lifecycleLockTails.set(key, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (lifecycleLockTails.get(key) === tail) lifecycleLockTails.delete(key);
  }
}

export function claimSquadWorktreeFollowUp(executionId: string, sessionId: string): void {
  const sessions = activeFollowUpSessions.get(executionId) ?? new Set<string>();
  sessions.add(sessionId);
  activeFollowUpSessions.set(executionId, sessions);
}

/** Rebuild a durable follow-up claim before a restored terminal can expose its worktree. */
export function restoreSquadWorktreeFollowUp(executionId: string, sessionId: string): void {
  claimSquadWorktreeFollowUp(executionId, sessionId);
}

/** Call only from PtyManager's confirmed `exit` event while holding lifecycle lock. */
export function releaseSquadWorktreeFollowUp(executionId: string, sessionId: string): void {
  const sessions = activeFollowUpSessions.get(executionId);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) activeFollowUpSessions.delete(executionId);
}

export function squadWorktreeHasActiveFollowUp(executionId: string): boolean {
  return (activeFollowUpSessions.get(executionId)?.size ?? 0) > 0;
}

export function squadWorktreeFollowUpExecution(sessionId: string): string | undefined {
  for (const [executionId, sessions] of activeFollowUpSessions) {
    if (sessions.has(sessionId)) return executionId;
  }
  return undefined;
}

/** What a terminal Squad worktree handler did once its effects were durably applied. */
export type SquadWorktreeTerminalOutcome = 'merged' | 'kept' | 'missing';

/** Terminal effects replay once per durable execution generation after a crash. */
export function shouldReplaySquadWorktreeTerminalEffects(record: {
  state: string;
  stateVersion: number;
  squadWorktree?: unknown;
  dismissedAt?: number;
  terminalWorktreeEffectsStateVersion?: number;
}): boolean {
  return record.squadWorktree !== undefined
    && record.dismissedAt === undefined
    && (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED')
    && record.terminalWorktreeEffectsStateVersion !== record.stateVersion;
}

/**
 * Resolves shared squad isolation without changing project or global worktree
 * semantics. An explicit launch request wins, then squad policy; an unset squad
 * policy delegates to existing project-over-global resolution.
 */
export function resolveSquadWorktreeIsolation(input: {
  launch?: boolean;
  project?: boolean;
  global?: boolean;
  squad?: boolean;
}): boolean {
  return input.launch ?? input.squad ?? input.project ?? input.global ?? false;
}

/** A recorded checkout is durable execution state, not a current isolation preference. */
export function resolveSquadWorktreePreparation(input: {
  retained: boolean;
  launch?: boolean;
  project?: boolean;
  global?: boolean;
  squad?: boolean;
}): 'reattach' | 'create' | 'project-root' {
  if (input.retained) return 'reattach';
  return resolveSquadWorktreeIsolation(input) ? 'create' : 'project-root';
}

/** Only an explicit second-step choice can delete a shared worktree. */
export function resolveSquadWorktreeDisposition(
  phase: string | undefined,
  input: string | undefined
): SquadWorktreeDisposition {
  if (input === 'leave') return 'leave';
  if (phase === 'choose' && input === 'instruct') return 'instruct';
  if (phase === 'choose' && input === 'delete') return 'confirm';
  if (phase === 'confirm' && input === 'confirm-delete') return 'delete';
  if (phase === 'confirm' && input === 'force-delete') return 'force';
  return 'invalid';
}

export const SQUAD_WORKTREE_FALLBACK_NOTICE = {
  subject: 'Squad ran in the project folder',
  comments: 'Worktrees need a local Git project, so this squad worked in the project folder. Its changes are in your working copy.'
} as const;

/** Releasing the push guard requires lifecycle-confirmed cohort termination. */
export function mayReleaseSquadWorktreeGuard(result: {
  ok: boolean;
  value?: { lifecycleState?: string; pendingSessionIds?: readonly string[] };
}): boolean {
  return result.ok
    && result.value?.lifecycleState === 'canceled'
    && result.value.pendingSessionIds?.length === 0;
}

type SquadWorktreeProject = {
  path: string;
  remote?: unknown;
  quickAgent?: boolean;
};

/** Returns no worktree for targets that cannot safely host a local Git checkout. */
export async function ineligibleSquadWorktreeFallback(
  project: SquadWorktreeProject,
  isGitRepo: (path: string) => Promise<boolean>
): Promise<{ squadWorktree: undefined; notice: typeof SQUAD_WORKTREE_FALLBACK_NOTICE } | undefined> {
  if (project.remote || project.quickAgent || !(await isGitRepo(project.path))) {
    return { squadWorktree: undefined, notice: SQUAD_WORKTREE_FALLBACK_NOTICE };
  }
  return undefined;
}
