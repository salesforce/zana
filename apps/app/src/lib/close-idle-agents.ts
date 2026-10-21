import type { AgentState, CloseFollowupFailure } from '@zana-ai/zcc-domain/product';

export type { CloseFollowupFailure };

export type CloseIdleAgentsResult = {
  closed: number;
  summarized: number;
  followedUp: number;
};

/**
 * Toast text after a bulk close. When nothing was summarized the wording says why
 * if main reported `failures`; without them (older main) it keeps the generic hint.
 */
export function closedToastMessage(
  closed: number,
  summarized: number,
  followedUp: number,
  failures?: CloseFollowupFailure[]
): string {
  const bits = [`Closed ${closed} agent${closed === 1 ? '' : 's'}`];
  if (summarized > 0) bits.push(`${summarized} summarized to inbox`);
  if (followedUp > 0) {
    bits.push(`${followedUp} follow-up${followedUp === 1 ? '' : 's'} filed`);
    // The inbox summary write failed but the follow-up still went in: say the summary is lost.
    if (summarized === 0 && failures?.some((f) => f.reason === 'write-failed')) bits.push('could not save the summary');
  } else if (summarized > 0) {
    // A failed follow-up write must not read as "nothing to file".
    if (failures?.some((f) => f.reason === 'write-failed')) bits.push('could not file the follow-up');
    else bits.push('no unfinished work found');
  } else {
    // Raw CLI detail stays in the main-process log; the toast says what happened in plain words.
    if (failures?.some((f) => f.reason === 'summary-failed')) bits.push('the AI summary failed (details in the log)');
    else if (failures?.some((f) => f.reason === 'unparseable')) bits.push('the AI reply could not be understood');
    else if (failures?.some((f) => f.reason === 'write-failed')) bits.push('could not save the summary or follow-up');
    else bits.push('no readable transcript found');
  }
  return `${bits.join(' · ')}.`;
}


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
    ) => Promise<{ summarized: number; followedUp: number; failures?: CloseFollowupFailure[] }>;
    closeTerminal: (sessionId: string, projectId: string) => Promise<void>;
    pushBusyToast: (requestedCount: number) => void;
    pushErrorToast: (err: unknown) => void;
    pushClosedToast: (closed: number, summarized: number, followedUp: number, failures?: CloseFollowupFailure[]) => void;
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
    let failures: CloseFollowupFailure[] | undefined;
    if (summarize) {
      progressToastId = deps.pushProgressToast(ids.length);
      try {
        const res = await deps.closeFollowup(projectId, ids);
        summarized = res.summarized;
        followedUp = res.followedUp;
        failures = res.failures;
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
    if (closed > 0) deps.pushClosedToast(closed, summarized, followedUp, failures);
    return { closed, summarized, followedUp };
  } finally {
    if (progressToastId) deps.dismissProgressToast(progressToastId);
    deps.clearClosing(ids);
  }
}
