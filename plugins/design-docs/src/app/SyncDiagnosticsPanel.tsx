import { useCallback, useEffect, useState } from 'react';
import { boundSyncError } from '../shared/sync-classify.js';
import type { SyncDiagnostics } from './api.js';
import { errorMessage, toast, useApi } from './api.js';
import { copyText } from './clipboard.js';
import { relativeTime } from '../shared/display.js';

/** Plain-text diagnostics for support or an agent: counts, per-computer queue and last errors. Redacted again here. */
export function formatDiagnostics(data: SyncDiagnostics, nameOf: (peerId: string) => string = (id) => id, now = Date.now()): string {
  const { counts } = data;
  const lines = [`This computer: ${counts.total} docs, ${counts.unmapped} unmapped`,
    `By status: ${Object.entries(counts.byStatus).map(([status, n]) => `${status} ${n}`).join(', ')}`];
  for (const peer of data.peers) {
    lines.push('', `${nameOf(peer.peerId)} (${peer.peerId})`,
      `  queued ${peer.queueDepth} (${peer.queuedDocs} docs): ${peer.failed} failed, ${peer.waiting} waiting` +
      (peer.oldestQueuedAt ? `, oldest ${relativeTime(peer.oldestQueuedAt, now)}` : ''));
    for (const error of peer.recentErrors) lines.push(`  ${error.docId} x${error.attempts} ${relativeTime(error.at, now)}: ${boundSyncError(error.error)}`);
  }
  return lines.join('\n');
}

/** Per computer queue and last errors, this computer's counts, and a button that copies it all. Owner UI only. */
export function SyncDiagnosticsPanel({ nameOf }: { nameOf(peerId: string): string }) {
  const api = useApi();
  const [data, setData] = useState<SyncDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.syncDiagnostics().then((value) => { setData(value); setError(null); }, (failure) => setError(errorMessage(failure)));
  }, [api]);
  useEffect(() => { load(); }, [load]);
  // Diagnostics are an aid: a failed read is shown as a quiet note, never as the page's error banner.
  if (error) return <p className="dd-peers-hint" data-testid="diagnostics-unavailable">{`Diagnostics unavailable: ${error}`}</p>;
  if (!data) return null;
  const copy = () => { void copyText(formatDiagnostics(data, nameOf)).then((ok) => toast(ok ? 'Diagnostics copied' : 'Could not copy diagnostics', ok ? 'info' : 'error')); };
  return (
    <section className="dd-peers-block" aria-label="Sync diagnostics">
      <h4>Diagnostics</h4>
      <p>{`This computer: ${data.counts.total} docs${data.counts.unmapped ? `, ${data.counts.unmapped} unmapped` : ''}`}</p>
      <p className="dd-peers-hint">{Object.entries(data.counts.byStatus).map(([status, n]) => `${status} ${n}`).join(' · ')}</p>
      {data.peers.map((peer) => (
        <div key={peer.replicaId} className="dd-peers-diag" data-testid="peer-diagnostics">
          <strong>{nameOf(peer.peerId)}</strong>
          <p className="dd-peers-hint">
            {peer.queueDepth ? `${peer.queueDepth} queued for ${peer.queuedDocs} docs (${peer.failed} failed, ${peer.waiting} waiting)` : 'Nothing queued'}
            {peer.oldestQueuedAt ? `, oldest ${relativeTime(peer.oldestQueuedAt, Date.now())}` : ''}
          </p>
          {peer.recentErrors.length ? (
            <ul className="dd-peers-list" aria-label={`Last errors for ${nameOf(peer.peerId)}`}>
              {peer.recentErrors.map((entry) => <li key={`${entry.docId}-${entry.at}`}>{entry.docId}: {boundSyncError(entry.error)}</li>)}
            </ul>
          ) : null}
        </div>
      ))}
      <div className="dd-actions">
        <button type="button" className="btn" onClick={copy}>Copy diagnostics</button>
        <button type="button" className="btn" onClick={load}>Refresh</button>
      </div>
    </section>
  );
}
