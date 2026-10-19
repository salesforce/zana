import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { callPluginRpc, useRealtime, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { Bot, Sparkles, Unlink } from 'lucide-react';
import { MAX_STUDIO_REQUEST_LENGTH, STUDIO_AGENT_ACTIONS } from '../../../lib/studio-agent-actions.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type StudioThreadLink, type StudioViewState, type ThreadRole } from '../../../lib/studio-contract.js';
import { CONTEXT_STRIP_STYLES, ContextStrip } from './ContextStrip.js';

export const ROLE_LABELS: Record<ThreadRole, string> = { author: 'Author', editor: 'Editor', reviewer: 'Reviewer', tester: 'Tester', assistant: 'Assistant' };

/** Recent agents listed in the menu; older ones stay reachable from Threads. */
const RECENT_LIMIT = 5;

export const ASK_AGENT_STYLES = `${CONTEXT_STRIP_STYLES}
.sf-ask { position:relative; display:inline-flex; }
.sf-ask-trigger { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px; border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-text); font:inherit; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; }
.sf-ask-trigger:hover:not(:disabled) { border-color:var(--sf-accent); }
.sf-ask-trigger:disabled { opacity:.5; cursor:default; }
.sf-ask-pop { position:absolute; z-index:20; top:calc(100% + 6px); right:0; width:min(340px,90vw); max-height:min(560px,70vh); overflow:auto; display:flex; flex-direction:column; border:1px solid var(--sf-border); border-radius:8px; background:var(--sf-elevated); color:var(--sf-text); font-size:12px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
.sf-ask-pop .sf-asst-ctx { border-radius:8px 8px 0 0; }
.sf-ask-section { display:flex; flex-direction:column; gap:2px; padding:6px; }
.sf-ask-section + .sf-ask-section { border-top:1px solid var(--sf-border); }
.sf-ask-label { margin:4px 6px; font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-muted); }
.sf-ask-item { display:flex; flex-direction:column; align-items:flex-start; gap:1px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; text-align:left; padding:5px 8px; cursor:pointer; }
.sf-ask-item small { color:var(--sf-muted); }
.sf-ask-item:hover:not(:disabled), .sf-ask-thread-open:hover { background:var(--sf-soft); }
.sf-ask-item:disabled { opacity:.5; cursor:not-allowed; }
.sf-ask-custom { display:flex; gap:6px; padding:2px; }
.sf-ask-custom input { flex:1; min-width:0; border:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); border-radius:6px; padding:5px 8px; font:inherit; }
.sf-ask-send { border:1px solid var(--sf-border); border-radius:6px; background:var(--sf-bg); color:var(--sf-text); font:inherit; padding:4px 10px; cursor:pointer; }
.sf-ask-send:disabled { opacity:.5; cursor:not-allowed; }
.sf-ask-error { color:var(--sf-danger); margin:4px 8px; }
.sf-ask-empty { color:var(--sf-muted); margin:2px 8px 6px; line-height:1.5; }
.sf-ask-threads { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.sf-ask-thread { display:flex; align-items:center; gap:2px; }
.sf-ask-thread-open { flex:1; min-width:0; display:flex; align-items:center; gap:8px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; text-align:left; padding:5px 8px; cursor:pointer; }
.sf-ask-thread-main { min-width:0; display:flex; flex-direction:column; gap:2px; }
.sf-ask-thread-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-ask-thread-meta { color:var(--sf-muted); font-size:10px; display:flex; gap:6px; }
.sf-ask-role { border:1px solid var(--sf-border); border-radius:999px; padding:0 6px; font-size:10px; color:var(--sf-muted); }
.sf-ask-role[data-role=reviewer] { color:var(--sf-warn); } .sf-ask-role[data-role=tester] { color:var(--sf-success); } .sf-ask-role[data-role=editor] { color:var(--sf-accent); }
.sf-ask-icon { border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:6px; display:inline-flex; border-radius:6px; }
.sf-ask-icon:hover { color:var(--sf-text); }
.sf-ask button:focus-visible, .sf-ask input:focus-visible { outline:2px solid var(--sf-accent); outline-offset:1px; }
`;

export interface AskAgentButtonProps {
  pluginId: string;
  projectId?: string;
  /** Path of the open .agent file, or null for an unsaved draft. */
  path: string | null;
  view: StudioViewState;
  onShareChange?(share: boolean): void;
}

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const failure = (result: unknown, fallback: string): string | null => {
  const r = result as { ok?: boolean; error?: string } | null;
  return r && r.ok !== false ? null : r?.error || fallback;
};

/**
 * Studio's "Ask agent" menu: one-click actions, a free-form request, what the
 * agent sees, and the agents already working on this file. Conversations open
 * in the page's side panel (`navigate.openPanelAgent`); a host without one
 * starts the thread and goes to it.
 */
export function AskAgentButton({ pluginId, projectId, path, view, onShareChange }: AskAgentButtonProps) {
  const navigate = useZccNavigate();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<StudioThreadLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await callPluginRpc(pluginId, STUDIO_RPC.threads, { projectId, ...(path ? { path } : {}) }) as { ok?: boolean; threads?: StudioThreadLink[] };
      if (alive.current && result?.ok !== false && Array.isArray(result?.threads)) setThreads(result.threads);
    } catch { /* the list is a convenience; keep what we have */ }
  }, [pluginId, projectId, path]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (open) setNow(Date.now()); }, [open]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const p = payload as { projectId?: string; kind?: string } | null;
    if (p?.kind === 'threads' && (!p.projectId || p.projectId === projectId)) void reload();
  });

  const recent = [...threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, RECENT_LIMIT);
  const unavailable: Record<string, string> = {};
  if (path === null) for (const action of STUDIO_AGENT_ACTIONS) unavailable[action.id] = 'Save the agent to a file first.';
  else if (!view.selection && !view.cursor) unavailable['explain-selection'] = 'Select some lines first.';

  /** A conversation opens in the side panel, or as its own thread when the page has none. */
  const showThread = (threadId: string, title?: string) => {
    if (!navigate.openPanelAgent?.({ threadId, ...(title ? { title } : {}) })) navigate.toThread(threadId);
  };

  const ask = async (action: string | undefined, text?: string) => {
    if (!path) return;
    setBusy(true); setError(null);
    const request = {
      projectId, path, ...(action ? { action } : {}), ...(text ? { prompt: text } : {}),
      ...(action === 'fix-problems' ? { diagnostics: view.diagnostics } : {})
    };
    try {
      // The side panel's composer takes the brief so the user picks the harness and sends it.
      if (navigate.openPanelAgent) {
        const draft = await callPluginRpc(pluginId, STUDIO_RPC.draftAgent, request) as { prompt?: string; title?: string };
        const message = failure(draft, 'Could not prepare the request.');
        if (message) { setError(message); return; }
        if (draft?.prompt && navigate.openPanelAgent({ draft: { prompt: draft.prompt, view: path, ...(projectId ? { projectId } : {}) }, ...(draft.title ? { title: draft.title } : {}) })) {
          setOpen(false);
          return;
        }
      }
      const result = await callPluginRpc(pluginId, STUDIO_RPC.askAgent, request) as { threadId?: string; title?: string };
      const message = failure(result, 'Could not start the agent.');
      if (message) setError(message);
      else if (result?.threadId) { setOpen(false); showThread(result.threadId, result.title); void reload(); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not start the agent.'); }
    finally { if (alive.current) setBusy(false); }
  };

  const unlink = async (threadId: string) => {
    setError(null);
    try { const message = failure(await callPluginRpc(pluginId, STUDIO_RPC.unlink, { projectId, threadId }), 'Could not unlink the thread.'); if (message) setError(message); else void reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not unlink the thread.'); }
  };

  const submit = () => { const text = prompt.trim(); if (text) { setPrompt(''); void ask(undefined, text); } };

  return <div className="sf-ask" ref={root} data-testid="studio-ask-agent">
    <style>{ASK_AGENT_STYLES}</style>
    <button type="button" className="sf-ask-trigger" aria-haspopup="true" aria-expanded={open} aria-controls={menuId} disabled={!projectId}
      title={projectId ? 'Ask an agent about this file' : 'Open a project to ask an agent'} onClick={() => setOpen(value => !value)}>
      <Sparkles size={13} aria-hidden="true" />{busy ? 'Starting…' : 'Ask agent'}
    </button>
    {open && <div className="sf-ask-pop" id={menuId} role="dialog" aria-label="Ask an agent">
      <ContextStrip view={view} compact onShareChange={onShareChange} />
      <section className="sf-ask-section" aria-label="Agent actions">
        {STUDIO_AGENT_ACTIONS.map(action => <button type="button" key={action.id} className="sf-ask-item" disabled={busy || Boolean(unavailable[action.id])}
          title={unavailable[action.id] ?? action.description} onClick={() => void ask(action.id)}>
          <span>{action.label}</span><small>{unavailable[action.id] ?? action.description}</small>
        </button>)}
        <form className="sf-ask-custom" onSubmit={event => { event.preventDefault(); submit(); }}>
          <input value={prompt} maxLength={MAX_STUDIO_REQUEST_LENGTH} onChange={event => setPrompt(event.target.value)} placeholder="Ask anything about this agent…"
            aria-label="Request for the agent" disabled={busy || !path} />
          <button type="submit" className="sf-ask-send" disabled={busy || !path || !prompt.trim()}>Send</button>
        </form>
        {error && <p className="sf-ask-error" role="alert">{error}</p>}
      </section>
      <section className="sf-ask-section" aria-label="Agents on this file">
        <h3 className="sf-ask-label">Agents on this file</h3>
        {recent.length === 0
          ? <p className="sf-ask-empty">No agents yet. Agents you start on this file show up here.</p>
          : <ul className="sf-ask-threads">
            {recent.map(thread => <li key={thread.threadId} className="sf-ask-thread">
              <button type="button" className="sf-ask-thread-open" title="Open this conversation" onClick={() => { setOpen(false); showThread(thread.threadId, thread.title); }}>
                <Bot size={14} aria-hidden="true" />
                <span className="sf-ask-thread-main">
                  <span className="sf-ask-thread-title">{thread.title}</span>
                  <span className="sf-ask-thread-meta"><span className="sf-ask-role" data-role={thread.role}>{ROLE_LABELS[thread.role]}</span>{timeAgo(thread.lastActivityAt, now)}</span>
                </span>
              </button>
              <button type="button" className="sf-ask-icon" aria-label={`Unlink ${thread.title}`} title="Unlink thread" onClick={() => void unlink(thread.threadId)}><Unlink size={13} aria-hidden="true" /></button>
            </li>)}
          </ul>}
      </section>
    </div>}
  </div>;
}
