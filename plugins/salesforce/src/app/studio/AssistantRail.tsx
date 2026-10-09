import { useCallback, useEffect, useRef, useState } from 'react';
import { callPluginRpc, ThreadChat, useRealtime, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { ArrowLeft, Bot, ExternalLink, Unlink } from 'lucide-react';
import { MAX_STUDIO_REQUEST_LENGTH, STUDIO_AGENT_ACTIONS } from '../../../lib/studio-agent-actions.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type StudioThreadLink, type StudioViewState, type ThreadRole } from '../../../lib/studio-contract.js';
import { AskAgentMenu } from './AskAgentMenu.js';
import { CONTEXT_STRIP_STYLES, ContextStrip } from './ContextStrip.js';

export const ROLE_LABELS: Record<ThreadRole, string> = { author: 'Author', editor: 'Editor', reviewer: 'Reviewer', tester: 'Tester', assistant: 'Assistant' };

export const ASSISTANT_STYLES = `${CONTEXT_STRIP_STYLES}
.sf-asst { display:flex; flex-direction:column; min-height:0; height:100%; background:var(--sf-bg); color:var(--sf-text); font-size:12px; }
.sf-asst-scroll { flex:1; min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:12px; }
.sf-asst-label { font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-muted); margin:0 0 6px; }
.sf-asst-chips { display:flex; flex-wrap:wrap; gap:6px; }
.sf-asst-chip, .sf-asst-btn, .sf-asst-item { border:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); font:inherit; border-radius:999px; padding:4px 10px; cursor:pointer; }
.sf-asst-btn { border-radius:6px; }
.sf-asst-chip:hover:not(:disabled), .sf-asst-btn:hover:not(:disabled), .sf-asst-item:hover:not(:disabled) { border-color:var(--sf-accent); }
.sf-asst-chip:focus-visible, .sf-asst-btn:focus-visible, .sf-asst-item:focus-visible, .sf-asst-thread-open:focus-visible, .sf-asst-icon:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-asst-chip:disabled, .sf-asst-btn:disabled, .sf-asst-item:disabled { opacity:.5; cursor:not-allowed; }
.sf-asst-ask { display:flex; gap:6px; }
.sf-asst-ask input, .sf-asst-custom input { flex:1; min-width:0; border:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); border-radius:6px; padding:5px 8px; font:inherit; }
.sf-asst-error { color:var(--sf-danger); margin:0; }
.sf-asst-empty { color:var(--sf-muted); margin:0; line-height:1.5; }
.sf-asst-threads { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.sf-asst-thread { display:flex; align-items:center; gap:4px; border:1px solid var(--sf-border); border-radius:6px; }
.sf-asst-thread-open { flex:1; min-width:0; display:flex; align-items:center; gap:8px; border:0; background:transparent; color:inherit; font:inherit; text-align:left; padding:6px 8px; cursor:pointer; }
.sf-asst-thread-main { min-width:0; display:flex; flex-direction:column; gap:2px; }
.sf-asst-thread-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-asst-thread-meta { color:var(--sf-muted); font-size:10px; display:flex; gap:6px; }
.sf-asst-role { border:1px solid var(--sf-border); border-radius:999px; padding:0 6px; font-size:10px; color:var(--sf-muted); }
.sf-asst-role[data-role=reviewer] { color:var(--sf-warn); } .sf-asst-role[data-role=tester] { color:var(--sf-success); } .sf-asst-role[data-role=editor] { color:var(--sf-accent); }
.sf-asst-icon { border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:6px; display:inline-flex; }
.sf-asst-icon:hover { color:var(--sf-text); }
.sf-asst-chat { display:flex; flex-direction:column; min-height:0; height:100%; }
.sf-asst-chat-head { display:flex; align-items:center; gap:6px; padding:4px 6px; border-bottom:1px solid var(--sf-border); }
.sf-asst-chat-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.sf-asst-chat-body { flex:1; min-height:0; }
.sf-asst-menu { position:relative; }
.sf-asst-pop { position:absolute; z-index:5; top:calc(100% + 4px); left:0; width:min(300px,90vw); display:flex; flex-direction:column; gap:2px; padding:6px; border:1px solid var(--sf-border); border-radius:8px; background:var(--sf-bg); }
.sf-asst-item { display:flex; flex-direction:column; align-items:flex-start; border-radius:6px; border-color:transparent; text-align:left; }
.sf-asst-item small { color:var(--sf-muted); }
.sf-asst-custom { display:flex; gap:6px; padding-top:6px; border-top:1px solid var(--sf-border); }
`;

export interface AssistantRailProps {
  pluginId: string;
  projectId?: string;
  /** Path of the open .agent file, or null for an unsaved draft. */
  path: string | null;
  view: StudioViewState;
  compact?: boolean;
  /** Controlled thread list; when omitted the rail loads and live-refreshes it (studio.threads). */
  threads?: StudioThreadLink[];
  /** Replaces the built-in studio.askAgent call (for hosts that want to intercept). */
  onAskAgent?(action: string, prompt?: string): void;
  /** Replaces the default "navigate to thread" for Open full thread. */
  onOpenThread?(threadId: string): void;
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

export function AssistantRail({ pluginId, projectId, path, view, compact = false, threads: controlled, onAskAgent, onOpenThread, onShareChange }: AssistantRailProps) {
  const navigate = useZccNavigate();
  const [loaded, setLoaded] = useState<StudioThreadLink[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (controlled || !projectId) return;
    try {
      const result = await callPluginRpc(pluginId, STUDIO_RPC.threads, { projectId, ...(path ? { path } : {}) }) as { ok?: boolean; threads?: StudioThreadLink[] };
      if (alive.current && result?.ok !== false && Array.isArray(result?.threads)) setLoaded(result.threads);
    } catch { /* the list is a convenience; keep what we have */ }
  }, [controlled, pluginId, projectId, path]);
  useEffect(() => { void reload(); setNow(Date.now()); }, [reload]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const p = payload as { projectId?: string; kind?: string } | null;
    if (p?.kind === 'threads' && (!p.projectId || p.projectId === projectId)) { void reload(); setNow(Date.now()); }
  });

  const threads = [...(controlled ?? loaded)].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const hasSelection = Boolean(view.selection);
  const noFile = path === null ? 'Save the agent to a file first.' : '';
  const unavailable: Record<string, string> = {};
  if (noFile) for (const action of STUDIO_AGENT_ACTIONS) unavailable[action.id] = noFile;
  else if (!hasSelection && !view.cursor) unavailable['explain-selection'] = 'Select some lines first.';

  const ask = async (action: string | undefined, text?: string) => {
    if (!path) return;
    if (onAskAgent) { onAskAgent(action ?? '', text); return; }
    setBusy(true); setError(null);
    try {
      const result = await callPluginRpc(pluginId, STUDIO_RPC.askAgent, {
        projectId, path, ...(action ? { action } : {}), ...(text ? { prompt: text } : {}),
        ...(action === 'fix-problems' ? { diagnostics: view.diagnostics } : {})
      }) as { threadId?: string };
      const message = failure(result, 'Could not start the agent.');
      if (message) setError(message);
      else if (result?.threadId) { setChatId(result.threadId); void reload(); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not start the agent.'); }
    finally { if (alive.current) setBusy(false); }
  };

  const unlink = async (threadId: string) => {
    setError(null);
    try { const message = failure(await callPluginRpc(pluginId, STUDIO_RPC.unlink, { projectId, threadId }), 'Could not unlink the thread.'); if (message) setError(message); else void reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not unlink the thread.'); }
  };
  const openFull = (threadId: string) => (onOpenThread ? onOpenThread(threadId) : navigate.toThread(threadId));

  const chat = chatId ? threads.find(thread => thread.threadId === chatId) ?? { threadId: chatId, title: 'Agent thread', role: 'assistant' as const, path: path ?? '', lastActivityAt: now } : null;
  if (chat) {
    return <div className="sf-asst sf-asst-chat" data-testid="studio-assistant-chat">
      <style>{ASSISTANT_STYLES}</style>
      <div className="sf-asst-chat-head">
        <button type="button" className="sf-asst-icon" aria-label="All agents" title="All agents" onClick={() => setChatId(null)}><ArrowLeft size={13} aria-hidden="true" /></button>
        <span className="sf-asst-chat-title" title={chat.title}>{chat.title}</span>
        <span className="sf-asst-role" data-role={chat.role}>{ROLE_LABELS[chat.role]}</span>
        <button type="button" className="sf-asst-icon" aria-label="Open full thread" title="Open full thread" onClick={() => openFull(chat.threadId)}><ExternalLink size={13} aria-hidden="true" /></button>
      </div>
      <ThreadChat threadId={chat.threadId} variant="compact" layout="contained" className="sf-asst-chat-body" />
    </div>;
  }

  return <div className="sf-asst" data-compact={compact ? 'true' : 'false'} data-testid="studio-assistant">
    <style>{ASSISTANT_STYLES}</style>
    <ContextStrip view={view} compact={compact} onShareChange={onShareChange} />
    <div className="sf-asst-scroll">
      <section aria-label="Agent actions">
        <h3 className="sf-asst-label">Ask the agent</h3>
        {compact
          ? <AskAgentMenu busy={busy} disabled={!projectId || !path} unavailable={unavailable} onAsk={(action, text) => void ask(action, text)} />
          : <>
            <div className="sf-asst-chips">
              {STUDIO_AGENT_ACTIONS.map(action => <button type="button" key={action.id} className="sf-asst-chip" disabled={busy || !projectId || Boolean(unavailable[action.id])} title={unavailable[action.id] ?? action.description} onClick={() => void ask(action.id)}>{action.label}</button>)}
            </div>
            <form className="sf-asst-ask" onSubmit={event => { event.preventDefault(); const text = prompt.trim(); if (text) { void ask(undefined, text); setPrompt(''); } }}>
              <input value={prompt} maxLength={MAX_STUDIO_REQUEST_LENGTH} onChange={event => setPrompt(event.target.value)} placeholder="Ask anything about this agent…" aria-label="Request for the agent" disabled={busy || !path} />
              <button type="submit" className="sf-asst-btn" disabled={busy || !path || !projectId || !prompt.trim()}>Send</button>
            </form>
          </>}
        {error && <p className="sf-asst-error" role="alert">{error}</p>}
      </section>
      <section aria-label="Linked threads">
        <h3 className="sf-asst-label">Agents on this file</h3>
        {threads.length === 0
          ? <p className="sf-asst-empty">No agents yet. Pick an action above to start one; threads that work on this file show up here.</p>
          : <ul className="sf-asst-threads">
            {threads.map(thread => <li key={thread.threadId} className="sf-asst-thread">
              <button type="button" className="sf-asst-thread-open" title="Open chat beside the editor" onClick={() => setChatId(thread.threadId)}>
                <Bot size={14} aria-hidden="true" />
                <span className="sf-asst-thread-main">
                  <span className="sf-asst-thread-title">{thread.title}</span>
                  <span className="sf-asst-thread-meta"><span className="sf-asst-role" data-role={thread.role}>{ROLE_LABELS[thread.role]}</span>{timeAgo(thread.lastActivityAt, now)}</span>
                </span>
              </button>
              <button type="button" className="sf-asst-icon" aria-label={`Unlink ${thread.title}`} title="Unlink thread" onClick={() => void unlink(thread.threadId)}><Unlink size={13} aria-hidden="true" /></button>
            </li>)}
          </ul>}
      </section>
    </div>
  </div>;
}
