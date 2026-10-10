import type { ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';

type WithActivity = { activity?: ThreadActivityState } | null | undefined;

/** Background shells (dev servers, watchers) the agent launched that are still open. */
export function runningProcessCount(thread: WithActivity): number {
  return Math.max(0, thread?.activity?.activeBackgroundCommandCount ?? 0);
}

export function runningProcessLabel(count: number): string {
  return count === 1 ? '1 background process running' : `${count} background processes running`;
}

/**
 * Archiving or closing ends the agent session, and the shells it launched end
 * with it. Say so before the user confirms, so a dev server never vanishes
 * silently.
 */
export function withRunningProcessWarning(message: string, thread: WithActivity): string {
  const count = runningProcessCount(thread);
  if (count === 0) return message;
  const what = count === 1 ? 'a background process' : `${count} background processes`;
  return `${message}\n\nThis agent still has ${what} running, like a dev server. `
    + `Ending its session stops ${count === 1 ? 'it' : 'them'}.`;
}
