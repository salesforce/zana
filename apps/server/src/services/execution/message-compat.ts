import type { ExecutionBlocker } from './store.js';

export type ExecutionMessageArgs =
  | { blockerId: string; clientRequestId: string; message: string }
  | { error: string };

export function resolveExecutionMessageArgs(
  executionId: string,
  expectedStateVersion: number,
  blockers: readonly ExecutionBlocker[],
  args: readonly string[]
): ExecutionMessageArgs | undefined {
  if (args.length === 3) return { blockerId: args[0], clientRequestId: args[1], message: args[2] };
  if (args.length !== 2) return undefined;
  const [slotId, message] = args;
  const matches = blockers.filter((blocker) => !blocker.resolved && blocker.slotId === slotId);
  if (matches.length !== 1) return matches.length > 1
    ? { error: 'execution slot has multiple unresolved blockers; select exact blocker' }
    : undefined;
  return { blockerId: matches[0].id, clientRequestId: `${executionId}:${expectedStateVersion}:${matches[0].id}`, message };
}
