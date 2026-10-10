import { relative, sep } from 'node:path';

export interface RetainedSquadWorktree {
  path: string;
  branch: string;
}

export interface RetainedSquadWorktreeAction {
  executionId: string;
  phase: string;
  stateVersion: number;
}

export function isTerminalSquadExecution(state: string): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'STOPPED';
}

/** Terminal inbox actions are capabilities for one immutable terminal generation. */
export function isCurrentRetainedSquadWorktreeAction(
  action: RetainedSquadWorktreeAction,
  record: { id: string; state: string; stateVersion: number; squadWorktree?: RetainedSquadWorktree; dismissedAt?: number }
): boolean {
  return record.id === action.executionId
    && record.stateVersion === action.stateVersion
    && record.dismissedAt === undefined
    && record.squadWorktree !== undefined
    && isTerminalSquadExecution(record.state);
}

/** Re-read durable state at each async side-effect boundary. */
export async function currentRetainedSquadWorktreeAction<T extends {
  id: string;
  state: string;
  stateVersion: number;
  squadWorktree?: RetainedSquadWorktree;
  dismissedAt?: number;
}>(action: RetainedSquadWorktreeAction, get: () => Promise<T | undefined>): Promise<T> {
  const record = await get();
  if (!record || !isCurrentRetainedSquadWorktreeAction(action, record)) {
    throw new Error('stale squad worktree action');
  }
  return record;
}

export function isWithinRetainedSquadWorktreeBase(path: string, projectRoot: string): boolean {
  const worktreeBase = `${projectRoot}${sep}.worktrees`;
  const fromBase = relative(worktreeBase, path);
  return fromBase !== '' && !fromBase.startsWith(`..${sep}`) && fromBase !== '..';
}

export function squadFollowUpPrompt(input: {
  instruction: string;
  executionId: string;
  teamId: string;
  branch: string;
}): string {
  return [
    input.instruction.trim(),
    '',
    'Context:',
    `- Source execution: ${input.executionId}`,
    `- Source squad: ${input.teamId}`,
    `- Source branch: ${input.branch}`,
    '- Work in retained squad worktree. Review existing changes before acting.'
  ].join('\n');
}
