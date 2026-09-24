import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { useUi } from '../store';
import { copyText } from '../lib/copy-text.js';

interface Props {
  projectId: string;
  executionId: string;
  onClose: () => void;
}

const terminal = new Set(['COMPLETED', 'FAILED', 'STOPPED']);

function formatTimestamp(ms?: number): string {
  return typeof ms === 'number' ? new Date(ms).toISOString() : '—';
}

function formatCost(usd?: number): string {
  return usd === undefined ? '—' : `$${usd.toFixed(4)}`;
}

/** Events dumped are bounded to the newest N (Rule 5): a stuck run can have a long tail. */
const JOB_DETAILS_EVENT_TAIL = 25;

type ExecutionProjection = ExecutionBoardSnapshot['execution'];

/** Identity / lifecycle header block. */
function jobHeaderLines(projectId: string, execution: ExecutionProjection): string[] {
  const lines: string[] = [];
  lines.push(`Job: ${execution.jobTitle}`);
  lines.push(`Execution ID: ${execution.executionId}`);
  lines.push(`Project ID: ${projectId}`);
  lines.push(`Team ID: ${execution.teamId ?? '—'}`);
  lines.push(`Team name: ${execution.teamName ?? '—'}`);
  lines.push(`Kind: ${execution.launchDisplay?.label ?? '—'}`);
  lines.push(`State: ${execution.state} (attempt ${execution.attempt})`);
  lines.push(`State version: ${execution.stateVersion ?? '—'}`);
  lines.push(`Objective: ${execution.objective ?? '—'}`);
  lines.push(`Summary: ${execution.summary ?? '—'}`);
  lines.push(`Coordinator: ${execution.coordinator?.status ?? 'unknown'}${execution.coordinator?.sessionId ? ` (session ${execution.coordinator.sessionId})` : ''}`);
  lines.push(`Recovery: ${execution.recovery?.status ?? '—'}${execution.recoveryAttention ? ' · attention required' : ''}`);
  if (execution.resourceBlock) {
    lines.push(`Resource block: ${execution.resourceBlock.kind} · ${execution.resourceBlock.reason} (at ${formatTimestamp(execution.resourceBlock.blockedAt)})`);
  }
  lines.push(`Telemetry gap count: ${execution.usage?.gapCount ?? 0}`);
  return lines;
}

/** Work units + per-assignment claim/churn lines. */
function workUnitLines(work: ExecutionProjection['work']): string[] {
  const lines: string[] = [];
  lines.push(`Work units: ${work?.completed ?? 0}/${work?.total ?? 0} complete`);
  if (work?.counts) lines.push(`  counts: ${Object.entries(work.counts).map(([state, count]) => `${state}=${count}`).join(' · ')}`);
  const assignments = work?.assignments ?? [];
  if (assignments.length === 0) lines.push('  (none)');
  for (const assignment of assignments) {
    lines.push(`  - ${assignment.title} [${assignment.workUnitId}]`);
    lines.push(`      state: ${assignment.state} · assignedSlotId: ${assignment.slotId ?? 'unassigned'}${assignment.failureCode ? ` · failureCode: ${assignment.failureCode}` : ''}`);
    lines.push(`      claimedAt: ${formatTimestamp(assignment.claimedAt)} · heartbeatAt: ${formatTimestamp(assignment.heartbeatAt)} · progressAt: ${formatTimestamp(assignment.progressAt)} · leaseExpiresAt: ${formatTimestamp(assignment.leaseExpiresAt)}`);
    lines.push(`      attempt: ${assignment.attempt ?? '—'} · turnCount: ${assignment.turnCount ?? '—'} · claimGeneration: ${assignment.claimGeneration ?? '—'} · claimId: ${assignment.claimId ?? '—'}`);
    if (assignment.dependencies?.length) lines.push(`      dependencies: ${assignment.dependencies.join(', ')}`);
    if (assignment.result) lines.push(`      result: ${assignment.result}`);
  }
  return lines;
}

/** Aggregate + per-role token/cost usage. */
function usageLines(usage: ExecutionProjection['usage']): string[] {
  const lines: string[] = ['Usage:'];
  if (!usage) { lines.push('  (unavailable)'); return lines; }
  lines.push(`  completeness: ${usage.completeness} · observations: ${usage.observationCount} · gaps: ${usage.gapCount}`);
  lines.push(`  tokens: input ${usage.inputTokens ?? '—'} · output ${usage.outputTokens ?? '—'} · cacheRead ${usage.cacheReadTokens ?? '—'} · cacheWrite ${usage.cacheWriteTokens ?? '—'} · cost ${formatCost(usage.providerCostUsd)}`);
  for (const role of usage.byRole) {
    lines.push(`    ${role.role}: input ${role.inputTokens ?? '—'} · output ${role.outputTokens ?? '—'} · cacheRead ${role.cacheReadTokens ?? '—'} · cacheWrite ${role.cacheWriteTokens ?? '—'} · cost ${formatCost(role.providerCostUsd)}`);
  }
  return lines;
}

/** Historical blockers + the current blocker's delivery state. */
function blockerLines(execution: ExecutionProjection): string[] {
  const lines: string[] = ['Blockers:'];
  const blockers = execution.blockers ?? [];
  if (blockers.length === 0 && !execution.currentBlocker) lines.push('  (none)');
  for (const blocker of blockers) {
    lines.push(`  - ${blocker.id} · resolved: ${blocker.resolved} · deliveryState: ${blocker.deliveryState ?? '—'}`);
  }
  const currentBlocker = execution.currentBlocker;
  if (currentBlocker) {
    lines.push(`  Current blocker [${currentBlocker.id}] unit ${currentBlocker.workUnitId} · slot ${currentBlocker.slotId}`);
    lines.push(`      question: ${currentBlocker.question}`);
    if (currentBlocker.options?.length) lines.push(`      options: ${currentBlocker.options.join(' · ')}`);
    if (currentBlocker.response) lines.push(`      response: ${currentBlocker.response}`);
    if (currentBlocker.delivery) {
      lines.push(`      delivery: ${currentBlocker.delivery.state} · attempt ${currentBlocker.delivery.attempt}/${currentBlocker.delivery.maxAttempts}${currentBlocker.delivery.error ? ` · error: ${currentBlocker.delivery.error}` : ''} · retryEligible: ${currentBlocker.delivery.retryEligible}`);
    }
  }
  return lines;
}

/**
 * Delivery strands (metadata only — payload text is never projected). A delivery
 * stuck FAILED/PENDING at max attempts is the "answer never reached the worker" wedge.
 */
function deliveryLines(deliveries: ExecutionProjection['deliveries']): string[] {
  const list = deliveries ?? [];
  const lines: string[] = [`Deliveries (${list.length}):`];
  if (list.length === 0) lines.push('  (none)');
  for (const delivery of list) {
    lines.push(`  - ${delivery.id} · ${delivery.state} · attempt ${delivery.attempt}/${delivery.maxAttempts}${delivery.manualRetryCount ? ` · manualRetries ${delivery.manualRetryCount}` : ''}`);
    lines.push(`      blocker ${delivery.blockerId} · unit ${delivery.workUnitId} · slot ${delivery.slotId} · updatedAt ${formatTimestamp(delivery.updatedAt)}${delivery.error ? ` · error: ${delivery.error}` : ''}`);
  }
  return lines;
}

/**
 * Coordinator wakes — a repeated same-cause wake with nothing advancing is the
 * orchestrator-side wedge. Count plus a bounded newest-first tail.
 */
function coordinatorWakeLines(wakes: ExecutionProjection['coordinatorWakes']): string[] {
  const lines: string[] = [`Coordinator wakes (${wakes?.total ?? 0}):`];
  if (!wakes || wakes.recent.length === 0) { lines.push('  (none)'); return lines; }
  for (const wake of wakes.recent) {
    lines.push(`  - ${wake.cause}${wake.workUnitId ? ` · unit ${wake.workUnitId}` : ''} · stateOrClaimGeneration ${wake.stateOrClaimGeneration} · ${formatTimestamp(wake.createdAt)}`);
  }
  return lines;
}

/** Assembled roll-up: outcome, per-unit states, failures, verification, policy. */
function assembledResultLines(assembled: ExecutionProjection['assembledResult']): string[] {
  const lines: string[] = ['Assembled result:'];
  if (!assembled) { lines.push('  (not assembled)'); return lines; }
  lines.push(`  outcome: ${assembled.outcome} · digest: ${assembled.digest}`);
  lines.push(`  summary: ${assembled.summary}`);
  for (const unit of assembled.units) lines.push(`    - ${unit.title} [${unit.id}] ${unit.state}${unit.failureCode ? ` · failureCode: ${unit.failureCode}` : ''}${unit.result ? ` · ${unit.result}` : ''}`);
  for (const failure of assembled.failures) lines.push(`    failure: ${failure.workUnitId} · ${failure.code}`);
  for (const check of assembled.verification) lines.push(`    verification: ${check.workUnitId} · ${check.checks.join(', ')}`);
  if (assembled.policy) lines.push(`  policy: ${assembled.policy.status} · ${assembled.policy.summary}`);
  return lines;
}

/** Route-fit proposal (when present) + the final summary. */
function routeAndFinalLines(execution: ExecutionProjection): string[] {
  const lines: string[] = [];
  const routeFit = execution.routeFitProposal;
  if (routeFit) lines.push(`Route fit: ${routeFit.fit} · ${routeFit.reason} (evaluator ${routeFit.evaluatorVersion}, samples ${routeFit.samples})`);
  lines.push(`Final summary: ${execution.finalSummary ?? '—'}`);
  return lines;
}

/** Bounded newest-N event tail (Rule 5). */
function eventLines(events: ExecutionBoardSnapshot['events']): string[] {
  const all = events ?? [];
  const tail = all.slice(-JOB_DETAILS_EVENT_TAIL);
  const lines: string[] = [`Events (last ${tail.length} of ${all.length}):`];
  if (tail.length === 0) lines.push('  (none)');
  for (const event of tail) {
    const meta = [event.producerRole, event.slotId, event.eventType].filter(Boolean).join(' · ');
    lines.push(`  - ${event.severity}: ${event.summary}${meta ? ` (${meta})` : ''}`);
  }
  return lines;
}

/** Artifact manifest — name + mediaType + digest only, never bodies. */
function artifactLines(artifacts: ExecutionBoardSnapshot['artifacts']): string[] {
  const list = artifacts ?? [];
  const lines: string[] = [`Artifacts (${list.length}):`];
  if (list.length === 0) lines.push('  (none)');
  for (const artifact of list) lines.push(`  - ${artifact.name} · ${artifact.mediaType} · ${artifact.contentDigest}`);
  return lines;
}

/**
 * Readable, copy-paste-friendly plain-text dump of the job details shown in this view.
 * Purpose is wedge diagnosis — dump every liveness / claim / usage / blocker signal the
 * projection carries so a stalled run can be pasted for analysis. Bounded (Rule 5): events
 * are a last-N tail; artifacts are name+mediaType+digest only (never bodies). Composed from
 * per-section helpers joined by a blank line between sections (no trailing blank).
 */
export function buildJobDetailsText(projectId: string, snapshot: ExecutionBoardSnapshot): string {
  const execution = snapshot.execution;
  return [
    ...jobHeaderLines(projectId, execution),
    '',
    ...workUnitLines(execution.work),
    '',
    ...usageLines(execution.usage),
    '',
    ...blockerLines(execution),
    '',
    ...deliveryLines(execution.deliveries),
    '',
    ...coordinatorWakeLines(execution.coordinatorWakes),
    '',
    ...assembledResultLines(execution.assembledResult),
    '',
    ...routeAndFinalLines(execution),
    '',
    ...eventLines(snapshot.events),
    '',
    ...artifactLines(snapshot.artifacts)
  ].join('\n');
}

export function ExecutionJobDetails({ projectId, executionId, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<ExecutionBoardSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const snapshotRef = useRef<ExecutionBoardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const requestIdentityRef = useRef<{ blockerId: string; text: string; id: string } | undefined>(undefined);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [artifactContent, setArtifactContent] = useState<Record<string, string>>({});
  const refresh = useCallback(async (after = 0) => {
    try {
      const next = await window.cc.executionBoard.snapshot(projectId, executionId, after);
      setLoaded(true);
      if (!next) {
        if (!snapshotRef.current) setUnavailable(true);
        return;
      }
      setUnavailable(false);
      const current = snapshotRef.current;
      const updated = after > 0 && current
        ? { ...next, events: [...current.events, ...next.events.filter((event) => !current.events.some((existing) => existing.id === event.id))] }
        : next;
      snapshotRef.current = updated;
      setSnapshot(updated);
    } catch {
      setLoaded(true);
      if (!snapshotRef.current) setUnavailable(true);
    }
  }, [projectId, executionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!snapshot || terminal.has(snapshot.execution.state)) return;
    const timer = window.setInterval(() => { void refresh(snapshot.nextAfter); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot?.execution.state, snapshot?.nextAfter]);
  if (!snapshot) return (
    <section className="execution-details" aria-label="Squad details">
      {loaded && unavailable ? <p role="alert">Squad details unavailable.</p> : <p>Loading Squad details…</p>}
      <button className="btn" type="button" onClick={() => { setLoaded(false); setUnavailable(false); void refresh(); }}>Retry</button>
      <button className="btn" type="button" onClick={onClose}>Close details</button>
    </section>
  );
  const execution = snapshot.execution;
  const isTerminal = terminal.has(execution.state);
  const deliveryPending = snapshot.execution.currentBlocker?.delivery?.state === 'PENDING' || snapshot.execution.currentBlocker?.delivery?.state === 'LEASED';
  const replyBytes = new TextEncoder().encode(replyDraft).byteLength;
  const replyTooLarge = replyBytes > 16 * 1024;
  const mutate = async (action: () => Promise<{ ok: boolean; code?: string; message?: string }>, clearReply = false) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) useUi.getState().pushToast(`Squad control failed: ${result.message ?? result.code}`, 'error');
      else if (clearReply) {
        setReplyDraft('');
        requestIdentityRef.current = undefined;
      }
      await refresh();
    } catch {
      useUi.getState().pushToast('Squad control failed: response status unknown', 'error');
    } finally { setBusy(false); }
  };
  const copyJobDetails = () => {
    // buildJobDetailsText is SYNCHRONOUS — a null snapshot would throw before the
    // promise chain, escaping the .catch below. The component early-returns on
    // !snapshot above, so this is belt-and-suspenders against a future refactor that
    // hoists this handler out of the narrowed scope.
    if (!snapshot) {
      useUi.getState().pushToast('No job details to copy', 'error');
      return;
    }
    void copyText(buildJobDetailsText(projectId, snapshot))
      .then(() => useUi.getState().pushToast('Job details copied', 'info'))
      .catch(() => useUi.getState().pushToast('Failed to copy job details', 'error'));
  };

  return (
    <section className="execution-details" aria-label="Squad details">
      <header><strong>Squad · {execution.jobTitle}</strong><button className="btn execution-details-close" type="button" onClick={onClose}>Close details</button></header>
      <div className="execution-details-copy"><button className="btn" type="button" onClick={copyJobDetails}>Copy details</button></div>
      <dl className="execution-details-meta">
        <dt>Run ID</dt><dd><code>{execution.executionId}</code></dd>
        <dt>Kind</dt><dd>{execution.launchDisplay?.label ?? 'Squad execution'}</dd>
        <dt>Status</dt><dd>{execution.state} · attempt {execution.attempt}</dd>
        <dt>Goal</dt><dd>{execution.objective ?? execution.jobTitle}</dd>
        <dt>Summary</dt><dd>{execution.summary ?? '—'}</dd>
        <dt>Squad</dt><dd>{execution.teamName ?? execution.teamId ?? '—'}</dd>
        <dt>Orchestrator</dt><dd>{execution.coordinator?.status ?? 'unknown'}{execution.coordinator?.sessionId ? ` · ${execution.coordinator.sessionId}` : ''}</dd>
      </dl>
      {execution.recoveryAttention && <p role="alert">Orchestrator lost. {execution.recovery?.status === 'available'
        ? 'Recovery available. Rotation creates a replacement credential; no cached token is required.'
        : 'Recovery deadline expired.'}</p>}
      <h4>Sources</h4>
      {execution.sources?.length ? execution.sources.map((source) => (
        <div key={source.id}>{source.name} · {source.contentDigest}{source.extractionWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      )) : <p>No execution sources.</p>}
      <h4>Work units</h4>
      <p>{execution.work?.completed ?? 0}/{execution.work?.total ?? 0} complete · Progress {execution.work?.total ? Math.round(execution.work.completed / execution.work.total * 100) : 0}%</p>
      <p>{Object.entries(execution.work?.counts ?? {}).map(([state, count]) => `${state}: ${count}`).join(' · ')}</p>
      <h4>Assignments</h4>
      {execution.work?.assignments.map((assignment) => {
        const assignedSlotId = assignmentDrafts[assignment.workUnitId] ?? assignment.slotId ?? execution.work?.rosterSlotIds[0] ?? '';
        return <div key={assignment.workUnitId}>
          {assignment.title} → {assignment.slotId ?? 'unassigned'} · {assignment.state}
          {!isTerminal && (assignment.state === 'FAILED' || assignment.state === 'BLOCKED') && <>
            <select aria-label={`Assignment for ${assignment.title}`} value={assignedSlotId} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [assignment.workUnitId]: event.target.value }))}>
              <option value="">Unassigned</option>{execution.work?.rosterSlotIds.map((slotId) => <option key={slotId} value={slotId}>{slotId}</option>)}
            </select>
            <button className="btn" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.retryWork(projectId, executionId, execution.stateVersion ?? 0, assignment.workUnitId, assignedSlotId || undefined))}>Retry work</button>
          </>}
          {assignment.state === 'CLAIMED' && <button className="btn" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.releaseWork(projectId, executionId, execution.stateVersion ?? 0, assignment.workUnitId))}>Release work</button>}
          {assignment.state === 'READY' && <>
            <select aria-label={`Assignment for ${assignment.title}`} value={assignedSlotId} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [assignment.workUnitId]: event.target.value }))}>
              {execution.work?.rosterSlotIds.map((slotId) => <option key={slotId} value={slotId}>{slotId}</option>)}
            </select>
            <button className="btn" type="button" disabled={busy || !assignedSlotId} onClick={() => void mutate(() => window.cc.executionBoard.reassignWork(projectId, executionId, execution.stateVersion ?? 0, assignment.workUnitId, assignedSlotId))}>Reassign work</button>
          </>}
        </div>;
      })}
      {snapshot.execution.currentBlocker && (
        <form className="execution-blocker" onSubmit={(event) => {
          event.preventDefault();
          if (isTerminal) return;
          const blocker = snapshot.execution.currentBlocker!;
          const message = replyDraft.trim();
          if (!message) return;
          if (requestIdentityRef.current?.blockerId !== blocker.id || requestIdentityRef.current.text !== message) {
            requestIdentityRef.current = { blockerId: blocker.id, text: message, id: `${blocker.id}:${crypto.randomUUID()}` };
          }
          void mutate(() => window.cc.executionBoard.respond(projectId, executionId, execution.stateVersion ?? 0, blocker.id, requestIdentityRef.current!.id, message), true);
        }}>
          <div className="execution-blocker-heading"><h4>Current blocker</h4><span>{isTerminal ? 'Squad run closed' : 'Needs your response'}</span></div>
          <p className="execution-blocker-question">{snapshot.execution.currentBlocker.question}</p>
          {snapshot.execution.currentBlocker.options?.length ? <p className="execution-blocker-options">{snapshot.execution.currentBlocker.options.join(' · ')}</p> : null}
          {isTerminal && <p className="execution-blocker-terminal" role="status">Squad run {execution.state.toLowerCase()}. This blocker is retained as history and can no longer receive a response.</p>}
          {snapshot.execution.currentBlocker.delivery && <p className="execution-delivery-status"
            role={snapshot.execution.currentBlocker.delivery.state === 'FAILED' ? 'alert' : 'status'}
            aria-live="polite"
            aria-atomic="true"
          >
            {snapshot.execution.currentBlocker.delivery.state === 'PENDING' && 'Pending delivery'}
            {snapshot.execution.currentBlocker.delivery.state === 'LEASED' && 'Awaiting worker acknowledgement'}
            {snapshot.execution.currentBlocker.delivery.state === 'FAILED' && 'Delivery failed'}
            {snapshot.execution.currentBlocker.delivery.state === 'DELIVERED' && 'Delivered'}
            {' · Attempt '}{snapshot.execution.currentBlocker.delivery.attempt}/{snapshot.execution.currentBlocker.delivery.maxAttempts}
            {snapshot.execution.currentBlocker.delivery.error ? ` · ${snapshot.execution.currentBlocker.delivery.error}` : ''}
            {!isTerminal && snapshot.execution.currentBlocker.delivery.retryEligible && <button className="btn" type="button" disabled={busy} onClick={() => {
              const blocker = snapshot.execution.currentBlocker!;
              void mutate(() => window.cc.executionBoard.retryDelivery(projectId, executionId, execution.stateVersion ?? 0, blocker.id, blocker.delivery!.id));
            }}>Retry</button>}
          </p>}
          {!isTerminal && <><label className="execution-blocker-label" htmlFor="execution-blocker-response">Response</label>
          <textarea id="execution-blocker-response" aria-label="Blocker response" aria-invalid={replyTooLarge || undefined} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Give worker decision, missing detail, or approval…" rows={3} />
          <div className="execution-blocker-actions"><span role="status" aria-live="polite" aria-atomic="true">{replyBytes}/16384 UTF-8 bytes{replyTooLarge ? ' · Response is too large' : deliveryPending ? ' · Answer queued; waiting for worker acknowledgement' : ''}</span>
          <button className="btn primary" type="submit" disabled={busy || replyTooLarge || deliveryPending} title={deliveryPending ? 'Answer is already queued for this worker. Wait for acknowledgement or retry after delivery fails.' : undefined}>Respond</button></div></>}
        </form>
      )}
      <h4>Progress</h4>
      {snapshot.events.map((event) => (
        <details key={event.id}><summary>{event.severity}: {event.summary}</summary>
          <p>{[event.producerRole, event.slotId, event.eventType].filter(Boolean).join(' · ')}</p>
          {event.detail && <p>{event.detail}</p>}{event.progress && <p>{event.progress.completed}/{event.progress.total}</p>}
          {event.references?.map((reference) => <p key={reference.uri}>{reference.label}: {reference.uri}</p>)}
        </details>
      ))}
      <h4>Artifacts</h4>
      {snapshot.artifacts.map((artifact) => <details key={artifact.id} onToggle={(event) => {
        if (!event.currentTarget.open || artifactContent[artifact.id] !== undefined) return;
        void window.cc.executionBoard.readArtifact(projectId, executionId, artifact.id).then((result) => {
          if (result.ok) setArtifactContent((current) => ({ ...current, [artifact.id]: result.value.content }));
          else {
            console.error(`[ExecutionJobDetails] artifact read failed (execution ${executionId}, artifact ${artifact.id}): ${result.message}`);
            useUi.getState().pushToast(`Artifact read failed: ${result.message}`, 'error');
            // Mirror the failure into the same state the successful path uses, so the
            // <pre> below shows the error instead of "Loading…" forever.
            setArtifactContent((current) => ({ ...current, [artifact.id]: `Error: ${result.message ?? 'read failed'}` }));
          }
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ExecutionJobDetails] artifact read rejected (execution ${executionId}, artifact ${artifact.id})`, err);
          useUi.getState().pushToast(`Artifact read failed: ${message}`, 'error');
          setArtifactContent((current) => ({ ...current, [artifact.id]: `Error: ${message}` }));
        });
      }}><summary>{artifact.name} · {artifact.mediaType} · {artifact.contentDigest}</summary><pre>{artifactContent[artifact.id] ?? 'Loading…'}</pre></details>)}
      <h4>Usage</h4>
      <p>Attribution: {execution.usage?.completeness ?? 'unavailable'} · Observations {execution.usage?.observationCount ?? 0} · Gaps {execution.usage?.gapCount ?? 0}</p>
      {execution.usage?.byRole.map((usage) => <p key={usage.role}>{usage.role}: input {usage.inputTokens ?? 'unknown'} · output {usage.outputTokens ?? 'unknown'} · cache read {usage.cacheReadTokens ?? 'unknown'} · cache write {usage.cacheWriteTokens ?? 'unknown'} · provider cost {usage.providerCostUsd === undefined ? 'unknown' : `$${usage.providerCostUsd.toFixed(4)}`}</p>)}
      <h4>Assembled result</h4>
      {execution.assembledResult ? <div>
        <p>{execution.assembledResult.outcome} · <code>{execution.assembledResult.digest}</code></p>
        <p>{execution.assembledResult.summary}</p>
        {execution.assembledResult.units.map((unit) => <details key={unit.id}><summary>{unit.title} · {unit.state}</summary>
          {unit.result && <p>{unit.result}</p>}
        </details>)}
      </div> : <p>Not assembled.</p>}
      <h4>Route fit</h4>
      {execution.routeFitProposal ? <p>{execution.routeFitProposal.fit} · {execution.routeFitProposal.reason} · inactive proposal ({execution.routeFitProposal.evaluatorVersion})</p> : <p>Not evaluated.</p>}
      <h4>Final summary</h4><p>{execution.finalSummary ?? 'Not completed.'}</p>
      <div className="execution-details-actions">
        {!terminal.has(execution.state) && <button className="btn danger" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.stop(projectId, executionId, execution.stateVersion ?? 0))}>Stop Squad run</button>}
        {execution.state === 'BLOCKED' && !execution.currentBlocker && !execution.resourceBlock && <button className="btn" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.retry(projectId, executionId, execution.stateVersion ?? 0))}>Retry Squad run</button>}
        {execution.recoveryAttention && execution.recovery?.status === 'available' && <button className="btn primary" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.relaunchMonitor(projectId, executionId))}>Recover orchestrator</button>}
      </div>
    </section>
  );
}
