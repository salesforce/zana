import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { useUi } from '../store';

interface Props {
  projectId: string;
  executionId: string;
  onClose: () => void;
}

const terminal = new Set(['COMPLETED', 'FAILED', 'STOPPED']);

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
    <section className="execution-details" aria-label="Job details">
      {loaded && unavailable ? <p role="alert">Job details unavailable.</p> : <p>Loading job details…</p>}
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
      if (!result.ok) useUi.getState().pushToast(`Job control failed: ${result.message ?? result.code}`, 'error');
      else if (clearReply) {
        setReplyDraft('');
        requestIdentityRef.current = undefined;
      }
      await refresh();
    } catch {
      useUi.getState().pushToast('Job control failed: response status unknown', 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="execution-details" aria-label="Job details">
      <header><strong>Job · {execution.jobTitle}</strong><button className="btn execution-details-close" type="button" onClick={onClose}>Close details</button></header>
      <dl className="execution-details-meta">
        <dt>Run ID</dt><dd><code>{execution.executionId}</code></dd>
        <dt>Kind</dt><dd>{execution.launchDisplay?.label ?? (execution.coordinationMode === 'job-team' ? 'Job Team' : 'Team execution')}</dd>
        <dt>Status</dt><dd>{execution.state} · attempt {execution.attempt}</dd>
        <dt>Goal</dt><dd>{execution.goal ?? execution.jobTitle}</dd>
        <dt>Summary</dt><dd>{execution.summary ?? '—'}</dd>
        <dt>Team</dt><dd>{execution.teamName ?? execution.teamId ?? '—'}</dd>
        <dt>Coordinator</dt><dd>{execution.coordinator?.status ?? 'unknown'}{execution.coordinator?.sessionId ? ` · ${execution.coordinator.sessionId}` : ''}</dd>
      </dl>
      {execution.recoveryAttention && <p role="alert">Coordinator lost. {execution.recovery?.status === 'available'
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
          {(assignment.state === 'FAILED' || assignment.state === 'BLOCKED') && <>
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
          <div className="execution-blocker-heading"><h4>Current blocker</h4><span>{isTerminal ? 'Job closed' : 'Needs your response'}</span></div>
          <p className="execution-blocker-question">{snapshot.execution.currentBlocker.question}</p>
          {snapshot.execution.currentBlocker.options?.length ? <p className="execution-blocker-options">{snapshot.execution.currentBlocker.options.join(' · ')}</p> : null}
          {isTerminal && <p className="execution-blocker-terminal" role="status">Job {execution.state.toLowerCase()}. This blocker is retained as history and can no longer receive a response.</p>}
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
          else useUi.getState().pushToast(`Artifact read failed: ${result.message}`, 'error');
        });
      }}><summary>{artifact.name} · {artifact.mediaType} · {artifact.contentDigest}</summary><pre>{artifactContent[artifact.id] ?? 'Loading…'}</pre></details>)}
      <h4>Final summary</h4><p>{execution.finalSummary ?? 'Not completed.'}</p>
      <div>
        {!terminal.has(execution.state) && <button className="btn danger" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.stop(projectId, executionId, execution.stateVersion ?? 0))}>Stop job</button>}
        {execution.state === 'BLOCKED' && !execution.currentBlocker && <button className="btn" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.retry(projectId, executionId, execution.stateVersion ?? 0))}>Retry job</button>}
        {execution.recoveryAttention && execution.recovery?.status === 'available' && <button className="btn primary" type="button" disabled={busy} onClick={() => void mutate(() => window.cc.executionBoard.relaunchMonitor(projectId, executionId))}>Recover coordinator</button>}
      </div>
    </section>
  );
}
