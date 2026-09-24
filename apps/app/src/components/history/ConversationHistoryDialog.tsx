import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConversationHistorySnapshot, ConversationHistoryRow, ConversationTranscript, ThreadHistoryPage, ThreadHistoryRow } from '@zana-ai/zcc-domain/product';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { getAgentSessionRoutePath, getThreadRoutePath } from '../../lib/route-paths.js';
import { useData } from '../../store.js';
import { Modal } from '../Modal.js';
import { HistoryContext } from './HistoryContext.js';
import { HistoryPreview } from './HistoryPreview.js';
import { threadHistoryTranscript } from './thread-history-transcript.js';
import { useConversationHistory } from './history-store.js';
import './history.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not load conversation history.';
const date = (time: number | null) => time ? new Date(time).toLocaleString() : 'Unknown date';

export function ConversationHistoryDialog() {
  const scope = useConversationHistory((s) => s.scope);
  return scope ? <HistoryBrowser key={`${scope.projectId ?? 'all'}:${scope.tab}`} initialProjectId={scope.projectId} initialTab={scope.tab} /> : null;
}

export function HistoryBrowser({ initialProjectId, initialTab }: { initialProjectId?: string; initialTab: 'threads' | 'cli' }) {
  const projects = useData((s) => s.projects);
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [tab, setTab] = useState(initialTab);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQuery(draft), 200); return () => clearTimeout(timer); }, [draft]);
  return <Modal title="Conversation history" onClose={() => useConversationHistory.getState().close()} className="history-modal">
    <div className="history-toolbar">
      <div role="group" aria-label="Conversation type">
        <button className="btn" aria-pressed={tab === 'threads'} onClick={() => setTab('threads')}>Threads</button>
        <button className="btn" aria-pressed={tab === 'cli'} onClick={() => setTab('cli')}>CLI Agents</button>
      </div>
      <label className="history-project-filter">Project
        <select aria-label="History project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <input aria-label="Search conversation history" placeholder={tab === 'threads' ? 'Search titles and messages…' : 'Search conversation titles…'} value={draft} onChange={(e) => setDraft(e.target.value)} />
    </div>
    {tab === 'threads' ? <ThreadHistory key={projectId} projectId={projectId || undefined} query={query} />
      : <CliHistory key={projectId} projectId={projectId || undefined} query={query} />}
  </Modal>;
}

function ThreadHistory({ projectId, query }: { projectId?: string; query: string }) {
  const [archived, setArchived] = useState<'all' | 'active' | 'archived'>('all');
  const [page, setPage] = useState<ThreadHistoryPage>({ rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [selected, setSelected] = useState<ThreadHistoryRow | null>(null);
  const [transcript, setTranscript] = useState<ConversationTranscript | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const navigate = useNavigate();
  const projects = useData((s) => s.projects);
  const open = (id: string, owner: string) => {
    useConversationHistory.getState().close();
    navigate(getThreadRoutePath(id, owner));
  };
  const load = async (offset = 0, version = generation.current) => {
    setLoading(true); setError('');
    try {
      const next = await product.threads.history({ projectId, query, archived, offset });
      if (version === generation.current) setPage((previous) => ({ ...next, rows: offset ? [...previous.rows, ...next.rows] : next.rows }));
    } catch (error) { if (version === generation.current) setError(errorText(error)); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => {
    const version = ++generation.current;
    previewGeneration.current++;
    setSelected(null); setTranscript(null); setPreviewError('');
    setPage({ rows: [] }); void load(0, version);
    return () => { generation.current++; previewGeneration.current++; };
    // Query changes start a fresh bounded page; old requests cannot replace it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, query, archived, refresh]);
  return <>
    <div className="history-toolbar history-controls">
      <select aria-label="Thread history status" value={archived} onChange={(e) => setArchived(e.target.value as typeof archived)}>
        <option value="all">All threads</option><option value="active">Unarchived</option><option value="archived">Archived</option>
      </select>
      <button className="btn history-refresh" onClick={() => setRefresh((n) => n + 1)}>Refresh history</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="history-workbench">
    <div className="history-results" aria-label="Thread history">
      {page.rows.map((row) => <article className="history-row" key={row.id}>
        <button className="history-open" disabled={!!restoring} aria-pressed={selected?.id === row.id} onClick={async () => {
          const version = ++previewGeneration.current;
          setSelected(row); setTranscript(null); setPreviewError('');
          try {
            const timeline = await product.threads.timeline(row.id, { segmentLimit: 20, includeNestedRows: 'true', summaryOnly: 'false' });
            if (version === previewGeneration.current) setTranscript(threadHistoryTranscript(timeline.rows as TimelineRow[], timeline.timelinePage?.hasOlderRows));
          } catch (error) { if (version === previewGeneration.current) setPreviewError(errorText(error)); }
        }}>
          <strong>{row.title || 'Untitled conversation'}</strong>
          <HistoryContext harnessId={row.providerId} harnessName={row.providerLabel} projectName={projects.find((p) => p.id === row.projectId)?.name} />
          <span className="history-meta">{date(row.updatedAt)} · {row.archivedAt ? 'Archived' : 'Unarchived'}</span>
          {row.unavailableReason && <span className="history-meta">{row.unavailableReason} Saved history is still readable.</span>}
        </button>
      </article>)}
      {!loading && !error && page.rows.length === 0 && <p>No conversations match these filters.</p>}
      {loading && <p role="status">Loading history…</p>}
      {page.nextOffset !== undefined && <button className="btn" disabled={loading} onClick={() => void load(page.nextOffset)}>Load more</button>}
    </div>
    <HistoryPreview selection={selected && {
      id: selected.id, title: selected.title || 'Untitled conversation', harnessId: selected.providerId,
      harnessName: selected.providerLabel, projectName: projects.find((p) => p.id === selected.projectId)?.name,
      meta: `${date(selected.updatedAt)} · ${selected.archivedAt ? 'Archived' : 'Unarchived'}`
    }} transcript={transcript} error={previewError}
      notice={selected?.unavailableReason && <p>{selected.unavailableReason} Saved history is still readable.</p>}
      truncatedNotice="This preview is shortened. Open the conversation to read the full history."
      actions={selected && <>
        {!!selected.archivedAt && <button className="btn primary" disabled={!!restoring || !!selected.unavailableReason} title={selected.unavailableReason} onClick={async () => {
          setRestoring(selected.id); setError('');
          try { await product.threads.unarchive(selected.id); open(selected.id, selected.projectId); }
          catch (error) { setError(errorText(error)); }
          finally { setRestoring(null); }
        }}>{restoring ? 'Restoring…' : 'Restore conversation'}</button>}
        <button className={`btn${selected.archivedAt ? '' : ' primary'}`} disabled={!!restoring} onClick={() => open(selected.id, selected.projectId)}>Open conversation</button>
      </>} />
    </div>
  </>;
}

function CliHistory({ projectId, query }: { projectId?: string; query: string }) {
  const [snapshot, setSnapshot] = useState<ConversationHistorySnapshot | null>(null);
  const [selected, setSelected] = useState<ConversationHistoryRow | null>(null);
  const [transcript, setTranscript] = useState<ConversationTranscript | null>(null);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const navigate = useNavigate();
  useEffect(() => {
    const version = ++generation.current;
    previewGeneration.current++;
    let id = '';
    let timer: ReturnType<typeof setTimeout>;
    setSnapshot(null); setSelected(null); setTranscript(null); setError(''); setPreviewError(''); setBusy(false);
    if (!hasDesktopBridge()) return;
    const apply = async (next: ConversationHistorySnapshot) => {
      if (version !== generation.current) { if (next.snapshotId) void product.history.release(next.snapshotId); return; }
      id = next.snapshotId; setSnapshot(next);
      if (next.status === 'expired') { setError('History expired. Refresh to try again.'); return; }
      if (next.status !== 'ready') timer = setTimeout(() => {
        void product.history.page(id).then(apply).catch((error) => { if (version === generation.current) setError(errorText(error)); });
      }, 250);
    };
    void product.history.start({ projectId, filter: projectId ? 'project' : 'all', query }).then(apply)
      .catch((error) => { if (version === generation.current) setError(errorText(error)); });
    return () => { generation.current++; previewGeneration.current++; clearTimeout(timer); if (id) void product.history.release(id); };
  }, [projectId, query, refresh]);
  if (!hasDesktopBridge()) return <p>CLI Agent history is available in the desktop app on the machine where the conversations were saved.</p>;
  const ready = snapshot?.status === 'ready';
  return <>
    <div className="history-toolbar history-controls"><span className="history-meta">Saved local conversations</span>
    {!!snapshot?.coverage.length && <details className="history-coverage">
      <summary>Harness support</summary>
      <div className="history-coverage-popover">
      <p>Saved local conversations in registered projects. Remote CLI history is not available yet.</p>
      <ul>{snapshot.coverage.map((entry) => <li key={entry.source}>
        <strong>{entry.sourceLabel || entry.source}</strong>: {entry.state === 'unsupported' ? entry.description
          : `${entry.supportsTranscript ? 'Transcript preview' : 'No transcript preview'} · ${entry.supportsExactResume ? 'Exact resume' : 'Read only'}`}
      </li>)}</ul>
      </div>
    </details>}
    <button className="btn history-refresh" onClick={() => setRefresh((n) => n + 1)}>Refresh history</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="history-workbench">
      <div className="history-results" aria-label="CLI Agent history">
        {snapshot?.rows.map((row) => <article className="history-row" key={row.historyId}>
          <button className="history-open" disabled={!ready || busy} aria-pressed={selected?.historyId === row.historyId} onClick={async () => {
            const version = ++previewGeneration.current;
            setSelected(row); setTranscript(null); setPreviewError(''); setError('');
            if (row.supportsTranscript === false) {
              setTranscript({ messages: [], truncated: false, unavailableReason: `Transcript previews are unavailable for this harness.${row.supportsExactResume ? ' Resume to read the conversation in its original harness.' : ''}` });
              return;
            }
            try { const next = await product.history.transcript(snapshot.snapshotId, row.historyId); if (version === previewGeneration.current) setTranscript(next); }
            catch (error) { if (version === previewGeneration.current) setPreviewError(errorText(error)); }
          }}><strong>{row.title}</strong>
            <HistoryContext harnessId={row.iconId || row.source} harnessName={row.sourceLabel} projectName={row.projectName} />
            <span className="history-meta">{date(row.lastActiveAt)}</span>
          </button>
        </article>)}
        {!ready && !error && <p role="status">Loading saved conversations…</p>}
        {ready && !snapshot.rows.length && <p>No saved conversations match these filters.</p>}
        {ready && snapshot.hasNextPage && <button className="btn" disabled={busy} onClick={async () => {
          const version = generation.current; setBusy(true);
          try {
            const next = await product.history.page(snapshot.snapshotId, snapshot.nextPageCursor);
            if (version === generation.current) {
              if (next.status === 'expired') throw new Error('History expired. Refresh to try again.');
              setSnapshot({ ...next, rows: [...snapshot.rows, ...next.rows] });
            }
          } catch (error) { if (version === generation.current) setError(errorText(error)); }
          finally { if (version === generation.current) setBusy(false); }
        }}>Load more</button>}
        {snapshot?.coverage.filter((c) => ['failed', 'timed-out'].includes(c.state)).map((c) => <p key={c.source}>{c.sourceLabel || c.source} history could not be loaded. Try refreshing.</p>)}
      </div>
      <HistoryPreview selection={selected && {
        id: selected.historyId, title: selected.title, harnessId: selected.iconId || selected.source,
        harnessName: selected.sourceLabel, projectName: selected.projectName, meta: date(selected.lastActiveAt)
      }} transcript={transcript} error={previewError}
        notice={selected?.supportsExactResume === false && <p>This harness does not support resuming this exact conversation.</p>}
        truncatedNotice="This preview is shortened. Resume the conversation to open the provider’s saved history."
        actions={selected && <button className="btn primary" disabled={busy || selected.availability !== 'available' || selected.supportsExactResume === false || (selected.supportsTranscript !== false && (!transcript || !!transcript.unavailableReason))} onClick={async () => {
            setBusy(true); setError('');
            try {
              const result = await product.history.resume(snapshot!.snapshotId, selected.historyId);
              if (!result.ok) throw new Error(result.message);
              useConversationHistory.getState().close();
              navigate(getAgentSessionRoutePath(result.value.id, result.value.projectId));
            } catch (error) { setError(errorText(error)); }
            finally { setBusy(false); }
          }}>{busy ? 'Opening…' : 'Resume conversation'}</button>} />
    </div>
  </>;
}
