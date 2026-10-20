import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { shouldReplaySquadWorktreeTerminalEffects } from '../squad-worktree-lifecycle.js';
import { createPtyReportQueue, type PtyReportQueueDeps } from './pty-report-queue.js';
import { buildSquadBlockerReport, buildSquadReport, squadOutcomeLabel, type SquadWorktreeOutcome } from './report.js';

type Proposal = NonNullable<ExecutionRecord['proposal']>;
type Blocker = NonNullable<ExecutionRecord['blockers']>[number];

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
/** Blocker ids are remembered per execution; this bounds how many executions are tracked at once. */
const MAX_TRACKED_EXECUTIONS = 256;

export interface SquadProposalNotifierDeps extends PtyReportQueueDeps {
  getRecord(executionId: string): Promise<ExecutionRecord | undefined>;
  markReported(executionId: string, attempt: number): Promise<unknown>;
  listUnreported(): Promise<ExecutionRecord[]>;
  threadLive(threadId: string, projectId: string): Promise<boolean>;
  queueThreadTurn(threadId: string, projectId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
  appendInbox(input: InboxInput): Promise<unknown>;
  pathExists(path: string): boolean;
  log(message: string, error?: unknown): void;
}

export interface SquadProposalNotifier {
  /**
   * Report a terminal run. `worktree` is what the Squad worktree terminal handler did in
   * this call. A run with a worktree is only reported once its terminal effects are applied
   * (merge/retain/remove), so the report never points at a checkout that is about to go.
   */
  onTerminal(record: ExecutionRecord, opts?: { worktree?: SquadWorktreeOutcome }): Promise<void>;
  onHumanBlocker(record: ExecutionRecord, blocker: Blocker): Promise<void>;
  onState(sessionId: string, state: AgentState): void;
  forget(sessionId: string): void;
  dispose(): void;
  /**
   * Boot entry point, called once sessions and the server runtime are back. Until it runs,
   * `onTerminal` leaves records unreported (boot-time transitions would otherwise see every
   * proposer as gone). It then delivers to live proposers, and for gone ones posts the
   * Inbox result before marking the run reported.
   */
  replayUnreported(): Promise<void>;
}

export function createSquadProposalNotifier(deps: SquadProposalNotifierDeps): SquadProposalNotifier {
  /** Attempts being reported, or delivered without a durable Inbox result (left for boot replay). */
  const claimed = new Set<string>();
  const seenBlockers = new Map<string, Set<string>>();
  let disposed = false;
  let ready = false;

  const safeLog = (message: string, error?: unknown) => { try { if (error === undefined) deps.log(message); else deps.log(message, error); } catch { /* logging must not throw */ } };
  const ptyQueue = createPtyReportQueue(deps, safeLog);

  /** Hand `text` to the proposer. `settle` runs once it is delivered or dropped for good, never on dispose. */
  async function deliver(proposal: Proposal, projectId: string, text: string, settle: () => void = () => undefined): Promise<void> {
    let queued = false;
    try {
      if (proposal.proposerKind === 'pty') {
        if (!deps.ptyLive(proposal.proposerId)) return;
        queued = true;
        ptyQueue.enqueue(proposal.proposerId, { text, settle });
        return;
      }
      if (!(await deps.threadLive(proposal.proposerId, projectId))) return;
      const result = await deps.queueThreadTurn(proposal.proposerId, projectId, text);
      if (!result.ok) safeLog(`squad proposal thread report not queued for ${proposal.proposerId}: ${result.reason ?? 'unknown'}`);
    } finally {
      if (!queued) settle();
    }
  }

  /** Worktree outcome for the report, or `undefined` while terminal effects are still pending. */
  function worktreeOutcome(record: ExecutionRecord, given: SquadWorktreeOutcome | undefined): SquadWorktreeOutcome | 'none' | undefined {
    if (!record.squadWorktree) return 'none';
    if (given) return given;
    // Called without an outcome (boot replay, or an engine call whose handler bailed early).
    if (shouldReplaySquadWorktreeTerminalEffects(record)) return undefined;
    // Without the handler's own result, a missing checkout is reported as removed: a merge is
    // never inferred from a path that is gone.
    return deps.pathExists(record.squadWorktree.path) ? 'kept' : 'missing';
  }

  /** The durable result entry; false when it could not be written. */
  async function postResult(record: ExecutionRecord, text: string): Promise<boolean> {
    try {
      await deps.appendInbox({
        projectId: record.projectId,
        subject: `Squad ${squadOutcomeLabel(record.state)}: ${record.jobTitle}`,
        comments: text,
        executionId: record.id,
        // Routes Open to Squad details and hides the reply box: the run, not an agent, is the subject.
        squadNotice: 'proposal-result',
        dedupeKey: `squad-proposal-result:${record.id}:${record.attempt}`,
        report: true
      });
      return true;
    } catch (error) {
      safeLog(`squad proposal result entry failed for ${record.id}`, error);
      return false;
    }
  }

  /**
   * Runs once the report is delivered or dropped for good. The run is marked reported only
   * when its Inbox result is durable; otherwise it stays claimed here (no second delivery in
   * this process) and unmarked, so boot replay posts and delivers it again.
   */
  function settler(record: ExecutionRecord, key: string, posted: boolean): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      seenBlockers.delete(record.id);
      if (!posted) return;
      void Promise.resolve()
        .then(() => deps.markReported(record.id, record.attempt))
        .catch((error: unknown) => safeLog(`squad proposal report failed for ${record.id}`, error))
        .finally(() => claimed.delete(key));
    };
  }

  async function report(record: ExecutionRecord, given: SquadWorktreeOutcome | undefined, proposerLive: boolean | undefined): Promise<void> {
    if (disposed || !record?.proposal || record.proposalNoticeVersion === record.attempt || !TERMINAL.has(record.state)) return;
    const key = `${record.id}:${record.attempt}`;
    if (claimed.has(key)) return;
    claimed.add(key);
    let handedOff = false;
    try {
      const fresh = (await deps.getRecord(record.id)) ?? record;
      const proposal = fresh.proposal;
      if (!proposal || fresh.proposalNoticeVersion === fresh.attempt || !TERMINAL.has(fresh.state)) return;
      const outcome = worktreeOutcome(fresh, given);
      if (outcome === undefined) return;
      const text = buildSquadReport(fresh, outcome === 'none' ? {} : { worktree: outcome });
      const settle = settler(fresh, key, await postResult(fresh, text));
      handedOff = true;
      if (proposerLive === false) { settle(); return; }
      try { await deliver(proposal, fresh.projectId, text, settle); } catch (error) { safeLog(`squad proposal delivery failed for ${fresh.id}`, error); }
    } catch (error) {
      safeLog(`squad proposal report failed for ${record.id}`, error);
    } finally {
      if (!handedOff) claimed.delete(key);
    }
  }

  /** True the first time this blocker of this execution is seen. */
  function firstSighting(executionId: string, blockerId: string): boolean {
    let seen = seenBlockers.get(executionId);
    if (seen?.has(blockerId)) return false;
    if (!seen) {
      seen = new Set();
      seenBlockers.set(executionId, seen);
      // The terminal report normally forgets an execution first; this only bounds runs that never end here.
      while (seenBlockers.size > MAX_TRACKED_EXECUTIONS) seenBlockers.delete(seenBlockers.keys().next().value as string);
    }
    seen.add(blockerId);
    return true;
  }

  async function onTerminal(record: ExecutionRecord, opts?: { worktree?: SquadWorktreeOutcome }): Promise<void> {
    // Before boot replay, proposers have not been restored yet; leave the record unreported.
    if (!ready) return;
    await report(record, opts?.worktree, undefined);
  }

  async function onHumanBlocker(record: ExecutionRecord, blocker: Blocker): Promise<void> {
    if (disposed || !record?.proposal || !firstSighting(record.id, blocker.id)) return;
    try {
      await deliver(record.proposal, record.projectId, buildSquadBlockerReport(record, blocker));
    } catch (error) {
      safeLog(`squad proposal blocker report failed for ${record.id}`, error);
    }
  }

  async function proposerLive(record: ExecutionRecord, proposal: Proposal): Promise<boolean> {
    try {
      return proposal.proposerKind === 'pty'
        ? deps.ptyLive(proposal.proposerId)
        : await deps.threadLive(proposal.proposerId, record.projectId);
    } catch (error) {
      safeLog(`squad proposal replay liveness check failed for ${record.id}`, error);
      return false;
    }
  }

  async function replayUnreported(): Promise<void> {
    if (disposed) return;
    ready = true;
    let records: ExecutionRecord[];
    try { records = await deps.listUnreported(); } catch (error) { safeLog('squad proposal replay list failed', error); return; }
    for (const record of records) {
      try {
        if (record.proposal) await report(record, undefined, await proposerLive(record, record.proposal));
      } catch (error) {
        safeLog(`squad proposal replay failed for ${record.id}`, error);
      }
    }
  }

  return {
    onTerminal,
    onHumanBlocker,
    onState(sessionId, state) { if (!disposed) ptyQueue.flush(sessionId, state); },
    forget(sessionId) { ptyQueue.forget(sessionId); },
    dispose() {
      disposed = true;
      ptyQueue.dispose();
      claimed.clear();
      seenBlockers.clear();
    },
    replayUnreported
  };
}
