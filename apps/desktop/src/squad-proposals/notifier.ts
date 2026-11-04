import type { AgentState } from '@zana-ai/zcc-domain/product';
import { executionReportTarget, isLocalReportRecord, isUserOwnedSquadWorktree, LOCAL_COMPOSER_PRINCIPAL, reportedAttempt, type ExecutionRecord, type ExecutionReportTarget } from '@zana-ai/zcc-server/services/execution/store';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { shouldReplaySquadWorktreeTerminalEffects } from '../squad-worktree-lifecycle.js';
import { createPtyReportQueue, type PtyReportQueueDeps } from './pty-report-queue.js';
import { buildSquadBlockerReport, buildSquadReport, squadOutcomeLabel, type SquadWorktreeOutcome } from './report.js';

type Blocker = NonNullable<ExecutionRecord['blockers']>[number];

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'STOPPED']);
/** Blocker ids are remembered per execution; this bounds how many executions are tracked at once. */
const MAX_TRACKED_EXECUTIONS = 256;
export interface SquadProposalNotifierDeps extends PtyReportQueueDeps {
  getRecord(executionId: string): Promise<ExecutionRecord | undefined>;
  markReported(executionId: string, attempt: number): Promise<unknown>;
  listUnreported(): Promise<ExecutionRecord[]>;
  /** Remember that a human blocker was reported, so a restart neither repeats nor drops it. */
  markBlockerReported(executionId: string, blockerId: string): Promise<unknown>;
  /** Live runs with an open human blocker that was not reported yet. */
  listUnreportedBlockers(): Promise<ExecutionRecord[]>;
  threadLive(threadId: string, projectId: string): Promise<boolean>;
  queueThreadTurn(threadId: string, projectId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
  appendInbox(input: InboxInput): Promise<unknown>;
  pathExists(path: string): boolean;
  log(message: string, error?: unknown): void;
}

/**
 * `[Squad report]` delivery to the conversation a run reports to: the agent that owns it
 * (`execution.start`) or the one that proposed it (the Inbox card).
 */
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
   * conversation as gone). It then delivers to live ones; for a gone proposer it still posts
   * the Inbox result before marking the run reported.
   */
  replayUnreported(): Promise<void>;
}

export function createSquadProposalNotifier(deps: SquadProposalNotifierDeps): SquadProposalNotifier {
  /** Attempts being reported, or delivered without a durable Inbox result (left for boot replay). */
  const claimed = new Set<string>();
  /** Local Composer attempts whose Inbox result is posted or in flight (`id:attempt`). */
  const localClaimed = new Set<string>();
  const seenBlockers = new Map<string, Set<string>>();
  let disposed = false;
  let ready = false;

  const safeLog = (message: string, error?: unknown) => { try { if (error === undefined) deps.log(message); else deps.log(message, error); } catch { /* logging must not throw */ } };
  const ptyQueue = createPtyReportQueue(deps, safeLog);

  /**
   * Hand `text` to the conversation. `settle` runs once it is delivered or the conversation is
   * definitively gone, never on dispose and never on a transient failure (a liveness check that
   * throws, a thread turn that was not queued, a PTY that refused the text): those stay
   * unmarked so boot replay delivers them again.
   */
  async function deliver(
    target: ExecutionReportTarget, projectId: string, text: string, settle: () => void = () => undefined,
    opts: { onGone?: () => void; stillWanted?: () => Promise<boolean> } = {}
  ): Promise<void> {
    // `onGone` replaces settling when the conversation is gone: the item stays unreported.
    const gone = opts.onGone ?? settle;
    if (target.kind === 'pty') {
      if (!deps.ptyLive(target.id)) { gone(); return; }
      ptyQueue.enqueue(target.id, { text, settle, ...(opts.stillWanted ? { stillWanted: opts.stillWanted } : {}), ...(opts.onGone ? { onDrop: opts.onGone } : {}) });
      return;
    }
    if (!(await deps.threadLive(target.id, projectId))) { gone(); return; }
    const result = await deps.queueThreadTurn(target.id, projectId, text);
    if (!result.ok) {
      safeLog(`squad proposal thread report not queued for ${target.id}: ${result.reason ?? 'unknown'}`);
      return;
    }
    settle();
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

  /** An Inbox entry carrying a report's text for the run's project; false when it could not be written. */
  async function postEntry(kind: 'result' | 'blocker', record: ExecutionRecord, subject: string, text: string, dedupeKey: string): Promise<boolean> {
    try {
      await deps.appendInbox({
        projectId: record.projectId,
        subject,
        comments: text,
        executionId: record.id,
        // Routes Open to Squad details and hides the reply box: the run, not an agent, is the subject.
        squadNotice: 'proposal-result',
        dedupeKey,
        report: true
      });
      return true;
    } catch (error) {
      safeLog(`squad proposal ${kind} entry failed for ${record.id}`, error);
      return false;
    }
  }

  /** The durable result entry; false when it could not be written. */
  const postResult = (record: ExecutionRecord, text: string): Promise<boolean> =>
    postEntry('result', record, `Squad ${squadOutcomeLabel(record.state)}: ${record.jobTitle}`, text, `squad-proposal-result:${record.id}:${record.attempt}`);

  /** The Inbox copy of a human blocker whose conversation is gone, so the question still reaches the user. */
  const postBlocker = (record: ExecutionRecord, blocker: Blocker, text: string): Promise<boolean> =>
    postEntry('blocker', record, `Squad needs an answer: ${record.jobTitle}`, text, `squad-proposal-blocker:${record.id}:${blocker.id}`);

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

  const unreported = (record: ExecutionRecord): boolean =>
    !!executionReportTarget(record) && reportedAttempt(record) !== record.attempt && TERMINAL.has(record.state);

  /**
   * A run started from the local Composer: no `reportTo`, no proposal. A plan-correction stop is
   * not a result and is never reported.
   */
  const isLocalComposerRun = (record: ExecutionRecord): boolean =>
    !executionReportTarget(record) && !record.proposal && record.callerPrincipalId === LOCAL_COMPOSER_PRINCIPAL
    && TERMINAL.has(record.state) && record.timeoutReason !== 'plan-correction-cancelled'
    && !(record.localReport && reportedAttempt(record) === record.attempt);

  /**
   * One Inbox result for a local Composer run. Idempotent per execution attempt (in-process set plus
   * the Inbox dedupe key); waits for worktree settlement; a failed post releases the claim for replay.
   */
  async function reportLocal(record: ExecutionRecord, given: SquadWorktreeOutcome | undefined): Promise<void> {
    if (disposed || !record || !isLocalComposerRun(record)) return;
    const key = `${record.id}:${record.attempt}`;
    if (localClaimed.has(key)) return;
    localClaimed.add(key);
    let posted = false;
    try {
      const fresh = (await deps.getRecord(record.id)) ?? record;
      if (!isLocalComposerRun(fresh) || fresh.attempt !== record.attempt) return;
      const outcome = worktreeOutcome(fresh, given);
      if (outcome === undefined) return;
      const text = buildSquadReport(fresh, { ...(outcome === 'none' ? {} : { worktree: outcome }), role: 'proposer' });
      // A retained Zana-managed checkout is not a finished hand-off: say so instead of calling it completed.
      // A user-owned target (project root or linked worktree) was never created here, so nothing is "kept".
      const label = outcome === 'kept' && fresh.state === 'COMPLETED' && !isUserOwnedSquadWorktree(fresh.squadWorktree) ? 'ended, worktree kept' : squadOutcomeLabel(fresh.state);
      posted = await postEntry('result', fresh, `Squad ${label}: ${fresh.jobTitle}`, text, `squad-local-result:${fresh.id}:${fresh.attempt}`);
      // Durable mark so a restart does not revisit it. A failed mark only costs a deduped re-post on replay.
      if (posted && fresh.localReport) {
        try { await deps.markReported(fresh.id, fresh.attempt); } catch (error) { safeLog(`squad local report mark failed for ${fresh.id}`, error); }
      }
    } catch (error) {
      safeLog(`squad local report failed for ${record.id}`, error);
    } finally {
      if (!posted) localClaimed.delete(key);
    }
  }

  async function report(record: ExecutionRecord, given: SquadWorktreeOutcome | undefined, targetLive: boolean | undefined): Promise<void> {
    if (disposed || !record) return;
    if (!executionReportTarget(record)) { await reportLocal(record, given); return; }
    if (!unreported(record)) return;
    const key = `${record.id}:${record.attempt}`;
    if (claimed.has(key)) return;
    claimed.add(key);
    let handedOff = false;
    try {
      const fresh = (await deps.getRecord(record.id)) ?? record;
      const target = executionReportTarget(fresh);
      if (!target || !unreported(fresh)) return;
      const outcome = worktreeOutcome(fresh, given);
      if (outcome === undefined) return;
      const text = buildSquadReport(fresh, { ...(outcome === 'none' ? {} : { worktree: outcome }), role: target.role });
      // A proposer always gets the Inbox result entry. An owner has the run on its board, so it
      // only gets one once its conversation is confirmed gone; a transient failure never posts.
      const owner = target.role === 'owner';
      const settle = settler(fresh, key, owner ? true : await postResult(fresh, text));
      // A failed Inbox post releases the claim, so a later report of this run tries again.
      const gone = owner
        ? () => { void postResult(fresh, text).then((posted) => { if (posted) settle(); else claimed.delete(key); }); }
        : settle;
      handedOff = true;
      if (targetLive === false) { gone(); return; }
      try { await deliver(target, fresh.projectId, text, settle, { onGone: gone }); } catch (error) { safeLog(`squad proposal delivery failed for ${fresh.id}`, error); }
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
    const target = record ? executionReportTarget(record) : undefined;
    // Before boot replay the conversations are not restored: leave it to replayBlockers instead of reading them as gone.
    if (disposed || !ready || !target || record.reportedBlockerIds?.includes(blocker.id) || !firstSighting(record.id, blocker.id)) return;
    // Marked once delivered or dropped for good; a dispose before that leaves it for boot replay.
    // Not marked when the report target moved while it waited: the new target still has to get it.
    let moved = false;
    const settle = () => {
      if (moved) return;
      void Promise.resolve()
        .then(() => deps.markBlockerReported(record.id, blocker.id))
        .catch((error: unknown) => safeLog(`squad proposal blocker mark failed for ${record.id}`, error));
    };
    // An owner that is gone may come back through resume_binding, which moves the target and
    // re-offers the blocker: it stays unreported (and forgotten here) until some session gets it.
    const owner = target.role === 'owner';
    const text = buildSquadBlockerReport(record, blocker, target.role);
    // A confirmed-gone conversation still leaves the question in the Inbox (one entry per blocker).
    // Only a proposer's blocker is then marked: an owner may come back and still gets it.
    // A failed Inbox post forgets the sighting, so a later offer of this blocker tries again.
    const onGone = () => {
      if (owner) seenBlockers.get(record.id)?.delete(blocker.id);
      void postBlocker(record, blocker, text).then((posted) => {
        if (!posted) seenBlockers.get(record.id)?.delete(blocker.id);
        else if (!owner) settle();
      });
    };
    const stillWanted = async () => {
      const fresh = await deps.getRecord(record.id);
      const current = fresh?.blockers?.find((candidate) => candidate.id === blocker.id);
      // Only a blocker the store says is resolved is dropped; anything unclear is still delivered.
      if (current?.resolved === true) return false;
      const now = fresh ? executionReportTarget(fresh) : undefined;
      if (fresh && now && (now.kind !== target.kind || now.id !== target.id)) {
        // resume_binding moved the target while this report waited for a quiet old session: drop this
        // item unmarked and offer the blocker to the current target (its first offer was ignored as seen).
        moved = true;
        seenBlockers.get(record.id)?.delete(blocker.id);
        void onHumanBlocker(fresh, blocker).catch((error: unknown) => safeLog(`squad proposal blocker re-offer failed for ${record.id}`, error));
        return false;
      }
      return true;
    };
    try {
      await deliver(target, record.projectId, text, settle, { stillWanted, onGone });
    } catch (error) {
      safeLog(`squad proposal blocker report failed for ${record.id}`, error);
    }
  }

  /** Whether the target conversation is live; undefined when the check itself failed (not the same as gone). */
  async function targetLive(record: ExecutionRecord, target: ExecutionReportTarget): Promise<boolean | undefined> {
    try {
      return target.kind === 'pty'
        ? deps.ptyLive(target.id)
        : await deps.threadLive(target.id, record.projectId);
    } catch (error) {
      safeLog(`squad proposal replay liveness check failed for ${record.id}`, error);
      return undefined;
    }
  }

  async function replayUnreported(): Promise<void> {
    if (disposed) return;
    ready = true;
    let records: ExecutionRecord[];
    try { records = await deps.listUnreported(); } catch (error) { safeLog('squad proposal replay list failed', error); return; }
    for (const record of records) {
      try {
        const target = executionReportTarget(record);
        if (!target) {
          // Target-less: a local Composer run tracked by the durable mark.
          if (isLocalReportRecord(record)) await reportLocal(record, undefined);
          continue;
        }
        const live = await targetLive(record, target);
        // A failed check is not a gone conversation: leave the report unmarked for the next boot.
        if (live !== undefined) await report(record, undefined, live);
      } catch (error) {
        safeLog(`squad proposal replay failed for ${record.id}`, error);
      }
    }
    await replayBlockers();
  }

  /** Open human blockers raised before a restart that were not reported yet. */
  async function replayBlockers(): Promise<void> {
    let records: ExecutionRecord[];
    try { records = await deps.listUnreportedBlockers(); } catch (error) { safeLog('squad proposal blocker replay list failed', error); return; }
    for (const record of records) {
      // Records from before report-back have no target of their own: their blockers were already delivered.
      if (!record.reportTo) continue;
      for (const blocker of record.blockers ?? []) {
        if (blocker.resolved || blocker.audience === 'coordinator') continue;
        try {
          await onHumanBlocker(record, blocker);
        } catch (error) {
          safeLog(`squad proposal blocker replay failed for ${record.id}`, error);
        }
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
      localClaimed.clear();
      seenBlockers.clear();
    },
    replayUnreported
  };
}
