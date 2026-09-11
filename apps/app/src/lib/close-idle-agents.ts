import type { AgentState } from '@zana-ai/zcc-domain/product';

export type CloseIdleAgentsResult = {
  closed: number;
  summarized: number;
  followedUp: number;
};

export function selectCloseableIdleIds(
  sessionIds: string[],
  statusById: Record<string, AgentState | undefined>,
  force: boolean
): string[] {
  if (force) return [...sessionIds];
  return sessionIds.filter((id) => {
    const st = statusById[id];
    return st !== 'working' && st !== 'blocked';
  });
}

/** Sticky progress copy while Close with follow-up waits on the LLM paper trail. */
export function closeFollowupProgressMessage(count: number): string {
  return count === 1
    ? 'Closing… filing a follow-up if work is left.'
    : `Closing ${count} agents… filing follow-ups.`;
}

export async function runCloseIdleAgents(input: {
  projectId: string;
  sessionIds: string[];
  summarize: boolean;
  force: boolean;
  deps: {
    statusById: Record<string, AgentState | undefined>;
    alreadyClosingIds: ReadonlySet<string>;
    markClosing: (ids: string[]) => void;
    clearClosing: (ids: string[]) => void;
    closeFollowup: (
      projectId: string,
      ids: string[]
    ) => Promise<{ summarized: number; followedUp: number }>;
    closeTerminal: (sessionId: string, projectId: string) => Promise<void>;
    pushBusyToast: (requestedCount: number) => void;
    pushErrorToast: (err: unknown) => void;
    pushClosedToast: (closed: number, summarized: number, followedUp: number) => void;
    pushProgressToast: (count: number) => string;
    dismissProgressToast: (id: string) => void;
  };
}): Promise<CloseIdleAgentsResult> {
  const { projectId, sessionIds, summarize, force, deps } = input;
  if (sessionIds.length === 0) return { closed: 0, summarized: 0, followedUp: 0 };
  const eligible = selectCloseableIdleIds(sessionIds, deps.statusById, force);
  if (eligible.length === 0) {
    deps.pushBusyToast(sessionIds.length);
    return { closed: 0, summarized: 0, followedUp: 0 };
  }
  const ids = eligible.filter((id) => !deps.alreadyClosingIds.has(id));
  if (ids.length === 0) return { closed: 0, summarized: 0, followedUp: 0 };

  deps.markClosing(ids);
  let progressToastId: string | undefined;
  try {
    let summarized = 0;
    let followedUp = 0;
    if (summarize) {
      progressToastId = deps.pushProgressToast(ids.length);
      try {
        const res = await deps.closeFollowup(projectId, ids);
        summarized = res.summarized;
        followedUp = res.followedUp;
      } catch (err) {
        deps.pushErrorToast(err);
      }
    }

    let closed = 0;
    for (const id of ids) {
      try {
        await deps.closeTerminal(id, projectId);
        closed++;
      } catch {
        /* closeTerminal already toasts */
      }
    }
    if (progressToastId) {
      deps.dismissProgressToast(progressToastId);
      progressToastId = undefined;
    }
    if (closed > 0) deps.pushClosedToast(closed, summarized, followedUp);
    return { closed, summarized, followedUp };
  } finally {
    if (progressToastId) deps.dismissProgressToast(progressToastId);
    deps.clearClosing(ids);
  }
}
