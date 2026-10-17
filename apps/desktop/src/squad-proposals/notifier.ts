import type { AgentState } from '@zana-ai/zcc-domain/product';
import { SQUAD_PROPOSAL_LIMITS } from '@zana-ai/zcc-domain/squad-proposal';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { shouldReplaySquadWorktreeTerminalEffects } from '../squad-worktree-lifecycle.js';
import { buildSquadBlockerReport, buildSquadReport, squadOutcomeLabel, type SquadWorktreeOutcome } from './report.js';

type Proposal = NonNullable<ExecutionRecord['proposal']>;
type Blocker = NonNullable<ExecutionRecord['blockers']>[number];
type Delivery = 'delivered' | 'queued' | 'dropped';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'STOPPED']);

export interface SquadProposalNotifierDeps {
  getRecord(executionId: string): Promise<ExecutionRecord | undefined>;
  markReported(executionId: string, attempt: number): Promise<unknown>;
  listUnreported(): Promise<ExecutionRecord[]>;
  reply(sessionId: string, text: string): boolean;
  ptyLive(id: string): boolean;
  ptyState(id: string): AgentState | undefined;
  lastInputAt(id: string): number | undefined;
  /** True for non-OSC harnesses (Codex, Cursor, Pi, OpenCode), which sit in `waiting` at rest. */
  deliverableWhenWaiting(id: string): boolean;
  threadLive(threadId: string, projectId: string): Promise<boolean>;
  queueThreadTurn(threadId: string, projectId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
  appendInbox(input: InboxInput): Promise<unknown>;
  pathExists(path: string): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
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
  const inFlight = new Set<string>();
  const seenBlockers = new Set<string>();
  const queues = new Map<string, string[]>();
  const timers = new Map<string, unknown>();
  let disposed = false;
  let ready = false;

  const safeLog = (message: string, error?: unknown) => { try { if (error === undefined) deps.log(message); else deps.log(message, error); } catch { /* logging must not throw */ } };

  function clearSession(sessionId: string): void {
    queues.delete(sessionId);
    const handle = timers.get(sessionId);
    if (handle !== undefined) {
      timers.delete(sessionId);
      try { deps.clearTimer(handle); } catch (error) { safeLog(`squad proposal timer clear failed for ${sessionId}`, error); }
    }
  }

  function atRest(sessionId: string, state: AgentState | undefined): boolean {
    return state === 'idle' || state === 'done' || (state === 'waiting' && deps.deliverableWhenWaiting(sessionId));
  }

  /** Deliver at most one queued item when the session is live, at rest and quiet. */
  function flush(sessionId: string, stateHint?: AgentState): void {
    const queue = queues.get(sessionId);
    if (!queue?.length) return;
    try {
      if (!deps.ptyLive(sessionId)) { clearSession(sessionId); return; }
      if (!atRest(sessionId, stateHint ?? deps.ptyState(sessionId))) return;
      const lastInput = deps.lastInputAt(sessionId);
      if (lastInput !== undefined) {
        const wait = lastInput + SQUAD_PROPOSAL_LIMITS.ptyQuietMs - deps.now();
        if (wait > 0) {
          if (!timers.has(sessionId)) {
            timers.set(sessionId, deps.setTimer(() => { timers.delete(sessionId); if (!disposed) flush(sessionId); }, wait));
          }
          return;
        }
      }
      const text = queue.shift() as string;
      if (!deps.reply(sessionId, text)) safeLog(`squad proposal report not accepted by session ${sessionId}`);
      if (!queue.length) clearSession(sessionId);
    } catch (error) {
      safeLog(`squad proposal flush failed for ${sessionId}`, error);
    }
  }

  async function deliver(proposal: Proposal, projectId: string, text: string): Promise<Delivery> {
    if (proposal.proposerKind === 'pty') {
      if (!deps.ptyLive(proposal.proposerId)) return 'dropped';
      const queue = queues.get(proposal.proposerId) ?? [];
      queue.push(text);
      while (queue.length > SQUAD_PROPOSAL_LIMITS.ptyQueueMax) queue.shift();
      queues.set(proposal.proposerId, queue);
      const before = queue.length;
      flush(proposal.proposerId);
      return (queues.get(proposal.proposerId)?.length ?? 0) < before ? 'delivered' : 'queued';
    }
    if (!(await deps.threadLive(proposal.proposerId, projectId))) return 'dropped';
    const result = await deps.queueThreadTurn(proposal.proposerId, projectId, text);
    if (!result.ok) safeLog(`squad proposal thread report not queued for ${proposal.proposerId}: ${result.reason ?? 'unknown'}`);
    return result.ok ? 'delivered' : 'dropped';
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

  async function postResult(record: ExecutionRecord, text: string): Promise<void> {
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
    } catch (error) {
      safeLog(`squad proposal result entry failed for ${record.id}`, error);
    }
  }

  async function report(record: ExecutionRecord, given: SquadWorktreeOutcome | undefined, proposerLive: boolean | undefined): Promise<void> {
    if (disposed || !record?.proposal || record.proposalNoticeVersion === record.attempt || !TERMINAL.has(record.state)) return;
    const key = `${record.id}:${record.attempt}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const fresh = (await deps.getRecord(record.id)) ?? record;
      const proposal = fresh.proposal;
      if (!proposal || fresh.proposalNoticeVersion === fresh.attempt || !TERMINAL.has(fresh.state)) return;
      const outcome = worktreeOutcome(fresh, given);
      if (outcome === undefined) return;
      const text = buildSquadReport(fresh, outcome === 'none' ? {} : { worktree: outcome });
      await postResult(fresh, text);
      if (proposerLive !== false) {
        try { await deliver(proposal, fresh.projectId, text); } catch (error) { safeLog(`squad proposal delivery failed for ${fresh.id}`, error); }
      }
      await deps.markReported(fresh.id, fresh.attempt);
    } catch (error) {
      safeLog(`squad proposal report failed for ${record.id}`, error);
    } finally {
      inFlight.delete(key);
    }
  }

  async function onTerminal(record: ExecutionRecord, opts?: { worktree?: SquadWorktreeOutcome }): Promise<void> {
    // Before boot replay, proposers have not been restored yet; leave the record unreported.
    if (!ready) return;
    await report(record, opts?.worktree, undefined);
  }

  async function onHumanBlocker(record: ExecutionRecord, blocker: Blocker): Promise<void> {
    if (disposed || !record?.proposal) return;
    const key = `${record.id}:${blocker.id}`;
    if (seenBlockers.has(key)) return;
    seenBlockers.add(key);
    try {
      await deliver(record.proposal, record.projectId, buildSquadBlockerReport(record, blocker));
    } catch (error) {
      safeLog(`squad proposal blocker report failed for ${record.id}`, error);
    }
  }

  function onState(sessionId: string, state: AgentState): void {
    if (disposed) return;
    flush(sessionId, state);
  }

  function forget(sessionId: string): void {
    clearSession(sessionId);
  }

  function dispose(): void {
    disposed = true;
    for (const sessionId of [...new Set([...queues.keys(), ...timers.keys()])]) clearSession(sessionId);
    inFlight.clear();
    seenBlockers.clear();
  }

  async function replayUnreported(): Promise<void> {
    if (disposed) return;
    ready = true;
    let records: ExecutionRecord[];
    try { records = await deps.listUnreported(); } catch (error) { safeLog('squad proposal replay list failed', error); return; }
    for (const record of records) {
      try {
        const proposal = record.proposal;
        if (!proposal) continue;
        let live = false;
        try {
          live = proposal.proposerKind === 'pty'
            ? deps.ptyLive(proposal.proposerId)
            : await deps.threadLive(proposal.proposerId, record.projectId);
        } catch (error) {
          safeLog(`squad proposal replay liveness check failed for ${record.id}`, error);
        }
        await report(record, undefined, live);
      } catch (error) {
        safeLog(`squad proposal replay failed for ${record.id}`, error);
      }
    }
  }

  return { onTerminal, onHumanBlocker, onState, forget, dispose, replayUnreported };
}
