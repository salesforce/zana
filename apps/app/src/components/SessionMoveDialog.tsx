import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Folder, Search, Square } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useData, useUi, errorMessage } from '../store.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import { primaryHost, useHosts } from '../hooks/useHosts.js';
import { product } from '../lib/product-client.js';
import { getThreadRoutePath, threadIdFromPath, projectIdFromThreadPath } from '../lib/route-paths.js';
import { useSplitWorkspace } from '../lib/split-layout/store.js';
import { sessionMoveReason, sessionNeedsStop, useSessionMove } from '../lib/session-move.js';
import { composerProjectLabel } from './composer-project-default.js';
import { Modal } from './Modal.js';
import './session-move.css';

/** One dialog host for context menus, drag/drop and Undo, including mobile. */
export function SessionMoveDialog() {
  const request = useSessionMove(s => s.request);
  const projects = useData(s => s.projects);
  const threads = useThreads(s => s.threads);
  const hosts = useHosts();
  const primaryHostId = primaryHost(hosts)?.id;
  useEffect(() => { useSessionMove.setState({ primaryHostId }); }, [primaryHostId]);
  const thread = request && threads.find(row => row.id === request.threadId);
  return request ? thread ? (
    <MoveDialog key={`${request.threadId}/${request.destinationId ?? ''}`}
      thread={thread} projects={projects} destinationId={request.destinationId} primaryHostId={primaryHostId} />
  ) : (
    <Modal title="Session unavailable" onClose={() => useSessionMove.getState().close()}>
      This session is no longer available. Refresh the session list and try again.
    </Modal>
  ) : null;
}

function MoveDialog({ thread, projects, destinationId, primaryHostId }: {
  thread: ThreadListItem; projects: Project[]; destinationId?: string; primaryHostId?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(destinationId);
  const [needsStop, setNeedsStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const automatic = useRef(false);
  const destination = projects.find(row => row.id === selectedId);
  const source = projects.find(row => row.id === thread.projectId);
  const running = needsStop || sessionNeedsStop(thread);
  const close = () => { if (!inFlight.current) useSessionMove.getState().close(); };

  const move = async (project: Project, stop: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const from = thread.projectId;
      const response = await product.threads.move(thread.id, {
        projectId: project.id, expectedProjectId: from, stop
      });
      useThreads.getState().upsert(response.thread);
      useSplitWorkspace.getState().closePanesForThreads([thread.id]);
      useUi.getState().setProjectExpanded(project.id, true);
      if (threadIdFromPath(location.pathname) === thread.id) {
        navigate(getThreadRoutePath(thread.id, projectIdFromThreadPath(location.pathname) ? project.id : null), { replace: true });
      }
      useSessionMove.getState().close();
      useUi.getState().pushToast(`Session moved to ${composerProjectLabel(project)}`, 'info', {
        action: { label: 'Undo', onClick: () => useSessionMove.getState().open(thread.id, from) }
      });
    } catch (caught) {
      if ((caught as { code?: string }).code === 'session-running') {
        setSelectedId(project.id);
        setNeedsStop(true);
      } else {
        setError(errorMessage(caught, 'Could not move this session'));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // An idle drop (or Undo) moves immediately. Running sessions always stop at confirmation.
  useEffect(() => {
    if (!destinationId || !destination || running || automatic.current) return;
    automatic.current = true;
    void move(destination, false);
  });

  const choose = (project: Project) => {
    setSelectedId(project.id);
    if (!running) void move(project, false);
  };
  const filtered = projects.filter(project =>
    `${composerProjectLabel(project)} ${project.path}`.toLowerCase().includes(query.trim().toLowerCase()));
  const confirm = Boolean(destination && running);

  return (
    <Modal title={confirm ? 'Stop and move this session?' : 'Move to project'} onClose={close}
      className="session-move-modal" closeOnBackdrop={!busy}
      footer={confirm ? <>
        <button className="btn" disabled={busy} onClick={close}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void move(destination!, true)}>
          {busy ? 'Moving…' : 'Stop & move'}
        </button>
      </> : undefined}>
      <p className="session-move-title">{thread.title || 'Untitled session'}</p>
      {confirm ? <>
        <div className="session-move-route"><span>{source ? composerProjectLabel(source) : 'Current project'}</span>
          <ArrowRight size={15} aria-hidden="true" /><strong>{composerProjectLabel(destination!)}</strong></div>
        <div className="session-move-warning"><Square size={15} aria-hidden="true" /><p>
          The current task and any background processes will stop. Your conversation and attachments are kept.
          Your next message uses the destination project’s directory, instructions, and tools.
        </p></div>
      </> : <>
        <label className="session-move-search"><Search size={15} aria-hidden="true" />
          <input autoFocus aria-label="Search destination projects" placeholder="Search projects…" value={query}
            disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
        <div className="session-move-projects" aria-label="Destination projects">
          {filtered.map(project => {
            const reason = sessionMoveReason(thread, project, primaryHostId);
            return <button key={project.id} type="button" className="session-move-project"
              disabled={busy || Boolean(reason)} onClick={() => choose(project)}>
              <Folder size={18} aria-hidden="true" /><span><strong>{composerProjectLabel(project)}</strong><small>{project.path}</small></span>
              {reason ? <span className="session-move-reason">{reason}</span> : <ArrowRight size={14} aria-hidden="true" />}
            </button>;
          })}
          {filtered.length === 0 && <p className="session-move-empty">No matching projects</p>}
        </div>
        <p className="session-move-hint">Move between projects on the same machine. Your conversation stays with you.</p>
      </>}
      {busy && !confirm && <p role="status">Moving session…</p>}
      {error && <div className="session-move-error" role="alert">{error}</div>}
    </Modal>
  );
}
