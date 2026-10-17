import { useState } from 'react';
import type { PeerConflictReview, PeerResolutionChoice } from '../shared/contract.js';
import { errorMessage, useApi } from './api.js';
import { useResource } from './hooks.js';
import { Dialog } from './ui.js';

function ForkReview({ docId, remoteHead, onResolved }: { docId: string; remoteHead: string; onResolved(): void }) {
  const api = useApi();
  const review = useResource(`${docId}\0${remoteHead}`, () => api.peerConflictReview(docId, remoteHead));
  const [path, setPath] = useState('');
  const [choice, setChoice] = useState<PeerResolutionChoice>('merge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = review.data;
  const paths = [...new Set([...(data?.local.paths ?? []), ...(data?.remote.paths ?? [])])].sort();
  const selected = paths.includes(path) ? path : paths[0] ?? '';
  const file = useResource(data && selected ? `${docId}\0${remoteHead}\0${selected}\0${data.localHead}` : null,
    () => api.peerConflictFile(docId, remoteHead, selected));
  const staleFile = !!data && !!file.data && file.data.localHead !== data.localHead;
  const resolve = async (snapshot: PeerConflictReview) => {
    setBusy(true); setError(null);
    try {
      await api.resolvePeerConflict(docId, { expectedHead: snapshot.localHead, remoteHead, choice });
      onResolved();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  if (review.error) return <p role="alert">{review.error}</p>;
  if (!data) return <p role="status">Loading fork...</p>;
  return <section aria-label="Review peer fork">
    <p>Local: {data.local.title} ({data.local.status}). Peer: {data.remote.title} ({data.remote.status}).</p>
    <p>Local summary: {data.local.summary || '(empty)'}</p>
    <p>Peer summary: {data.remote.summary || '(empty)'}</p>
    {data.conflicts.length ? <p role="status">{data.conflicts.join('; ')}</p> : <p>Disjoint changes can merge.</p>}
    {data.conflicts.includes('history causal order conflict') ? <p>History order differs. Explicit selection keeps the selected branch's order and retains remaining snapshots.</p> : null}
    <label className="dd-field"><span>File</span><select className="dd-input" value={selected} onChange={(event) => setPath(event.target.value)}>
      {paths.map((path) => <option key={path}>{path}</option>)}
    </select></label>
    {file.error ? <p role="alert">{file.error}</p> : file.loading ? <p role="status">Loading file...</p> : file.data ?
      (['local', 'remote', 'candidate'] as const).map((side) => <details key={side}><summary>{side === 'remote' ? 'Peer' : side === 'local' ? 'Local' : 'Merged candidate'}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{file.data![side] ?
          file.data![side]!.encoding === 'base64' ? 'Binary content (retained in fork).' : file.data![side]!.content : '(absent)'}</pre>
      </details>) : null}
    <label className="dd-field"><span>Resolution</span><select className="dd-input" value={choice} disabled={busy} onChange={(event) => setChoice(event.target.value as PeerResolutionChoice)}>
      <option value="merge" disabled={!data.mergeAvailable}>Merge disjoint changes</option>
      <option value="local">Keep local version</option>
      <option value="remote">Use peer version</option>
    </select></label>
    <p>Both original versions remain in peer history. Resolution saves locally, does not share unsaved editor buffers, and does not trigger automatic sync. Use Sync Now to share it.</p>
    {error ? <p role="alert">{error}</p> : null}
    {staleFile ? <p role="alert">Document head changed while loading the file. Review again before resolving.</p> : null}
    <button type="button" className="btn primary" disabled={busy || review.loading || file.loading || !!file.error || !file.data ||
      file.data.localHead !== data.localHead || (choice === 'merge' && !data.mergeAvailable)} onClick={() => void resolve(data)}>Resolve reviewed fork</button>
    {error || staleFile || file.error ? <button type="button" className="btn" disabled={busy} onClick={() => { setError(null); review.reload(); file.reload(); }}>Review again</button> : null}
  </section>;
}

export function PeerConflictView({ docId, onClose }: { docId: string; onClose(): void }) {
  const api = useApi();
  const [cursor, setCursor] = useState('');
  const page = useResource(`${docId}\0${cursor}`, () => api.peerConflicts(docId, cursor));
  const [remoteHead, setRemoteHead] = useState('');
  const selected = remoteHead || page.data?.remoteHeads[0] || '';
  return <Dialog title="Peer conflicts" onClose={onClose} wide>
    {page.error ? <p role="alert">{page.error}</p> : page.loading ? <p role="status">Loading conflicts...</p> :
      page.data?.remoteHeads.length ? <>
        <label className="dd-field"><span>Peer version</span><select className="dd-input" value={selected} onChange={(event) => setRemoteHead(event.target.value)}>
          {page.data.remoteHeads.map((head) => <option key={head}>{head}</option>)}
        </select></label>
        <ForkReview key={selected} docId={docId} remoteHead={selected} onResolved={() => { setRemoteHead(''); page.reload(); }} />
        {page.data.nextCursor ? <button type="button" className="btn" onClick={() => { setRemoteHead(''); setCursor(page.data!.nextCursor!); }}>Next conflicts</button> : null}
        {cursor ? <button type="button" className="btn" onClick={() => { setRemoteHead(''); setCursor(''); }}>First conflicts</button> : null}
      </> : <p>No unresolved peer forks.</p>}
  </Dialog>;
}
