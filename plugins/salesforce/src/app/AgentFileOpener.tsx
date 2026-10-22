import { useEffect, useState, type ComponentType } from 'react';
import { AppWindow, MessageSquare, Play } from 'lucide-react';
import { callPluginRpc, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { ActionCodePreview } from './ActionCodePreview.js';
import { routeStudioIntent, type StudioIntent } from './studio/studio-intents.js';
import { openAgentInStudioWindow } from './studio-window-route.js';

export const AGENT_FILE_OPENER_STYLES = `
.sf-agent-opener { display:flex; flex-direction:column; min-height:0; height:100%; }
.sf-agent-opener-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border, rgba(127,127,127,.25)); }
.sf-agent-opener-file { flex:1; min-width:0; display:flex; flex-direction:column; }
.sf-agent-opener-name { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-agent-opener-hint { font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-agent-opener-hint[data-tone="warn"] { color:var(--warning, #b7791f); white-space:normal; }
.sf-agent-opener-btn { display:inline-flex; align-items:center; gap:6px; flex:none; border:1px solid var(--border, rgba(127,127,127,.35)); border-radius:6px; background:transparent; color:inherit; font:inherit; font-size:12px; padding:4px 10px; cursor:pointer; }
.sf-agent-opener-btn:hover { border-color:var(--accent, #0176d3); }
.sf-agent-opener-btn.is-icon { padding:4px 6px; }
.sf-agent-opener-btn:disabled { opacity:.5; cursor:default; }
.sf-agent-opener-btn.is-primary { background:var(--accent, #0176d3); border-color:var(--accent, #0176d3); color:#fff; }
.sf-agent-opener-body { flex:1; min-height:0; overflow:auto; }
.sf-agent-opener-body.is-editor { display:flex; overflow:hidden; }
.sf-agent-opener-code { flex:1; width:100%; min-height:0; border:0; background:transparent; }
`;

const PANEL_REFUSED = 'Open this agent from a project to use the Agentforce side panel or Studio.';
const WINDOW_FAILED = 'The Studio window did not open this agent. Try again, or open it from the window\'s explorer.';

export interface AgentFileOpenerProps {
  pluginId: string;
  path: string;
  source?: { kind?: string; threadId: string | null; projectId: string | null };
  lineNumber?: number | null;
  experimental_Original: ComponentType;
}

type Loaded = { state: 'loading' } | { state: 'ready'; content: string } | { state: 'fallback' };

/** The project file through the plugin's own read; anything else keeps the host's text preview. */
function useAgentSource(pluginId: string, projectId: string | null, path: string, workspace: boolean): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    if (!projectId || !workspace) { setLoaded({ state: 'fallback' }); return; }
    let current = true;
    setLoaded({ state: 'loading' });
    void (callPluginRpc(pluginId, 'agentFiles.read', { projectId, path }) as Promise<{ ok?: boolean; file?: { content?: unknown } } | null>)
      .then(result => typeof result?.file?.content === 'string' && result.ok ? { state: 'ready' as const, content: result.file.content } : { state: 'fallback' as const })
      .catch(() => ({ state: 'fallback' as const }))
      .then(next => { if (current) setLoaded(next); });
    return () => { current = false; };
  }, [pluginId, projectId, path, workspace]);
  return loaded;
}

/**
 * "Open with Agentforce": the file preview with a toolbar that opens the agent in the thread's
 * Agent side panel (File or Preview view). The host resolves the panel owner (thread or agent
 * session); without one the Studio opens instead.
 * The window button opens the agent in the project's Studio window, starting one when none runs.
 * The file itself shows in a read-only Agent Script editor.
 */
export function AgentFileOpener(props: AgentFileOpenerProps) {
  const navigate = useZccNavigate();
  const context = useZccContext();
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const Original = props.experimental_Original;
  const threadId = context.threadId ?? props.source?.threadId ?? undefined;
  const name = props.path.split('/').pop() || props.path;
  const projectId = context.projectId ?? props.source?.projectId ?? null;
  // The thread's Agent side panel; without a thread (or in a window) the Studio.
  const open = async (intent: StudioIntent, from: Element) => {
    const route = await routeStudioIntent({ pluginId: props.pluginId, projectId, threadId: threadId ?? null, intent, from, navigate });
    setNotice(route ? null : PANEL_REFUSED);
  };
  const loaded = useAgentSource(props.pluginId, projectId, props.path, props.source?.kind !== 'thread-storage');
  // A plugin view window is the Studio window already; hosts without windows get no button.
  const canDetach = Boolean(projectId && navigate.openInWindow && context.surface !== 'plugin-view');
  const openWindow = async () => {
    if (!projectId) return;
    setOpening(true);
    const opened = await openAgentInStudioWindow({ pluginId: props.pluginId, projectId, path: props.path, navigate });
    setOpening(false);
    setNotice(opened ? null : WINDOW_FAILED);
  };
  return (
    <div className="sf-agent-opener" data-testid="salesforce-agent-opener">
      <style>{AGENT_FILE_OPENER_STYLES}</style>
      <div className="sf-agent-opener-bar">
        <div className="sf-agent-opener-file" title={props.path}>
          <span className="sf-agent-opener-name">{name}</span>
          {notice
            ? <span className="sf-agent-opener-hint" data-tone="warn" role="status">{notice}</span>
            : <span className="sf-agent-opener-hint">{props.path}</span>}
        </div>
        <button type="button" className="sf-agent-opener-btn is-primary" onClick={event => void open({ kind: 'agent', path: props.path, ...(props.lineNumber ? { line: props.lineNumber } : {}) }, event.currentTarget)}>
          <Play size={13} aria-hidden="true" />Open agent view
        </button>
        <button type="button" className="sf-agent-opener-btn" onClick={event => void open({ kind: 'preview', path: props.path }, event.currentTarget)}>
          <MessageSquare size={13} aria-hidden="true" />Preview
        </button>
        {canDetach && <button type="button" className="sf-agent-opener-btn is-icon" title="Open in Studio window" aria-label="Open in Studio window" disabled={opening} onClick={() => void openWindow()}>
          <AppWindow size={14} aria-hidden="true" />
        </button>}
      </div>
      {loaded.state === 'ready'
        ? <div className="sf-agent-opener-body is-editor"><ActionCodePreview content={loaded.content} language="agentscript" line={props.lineNumber ?? undefined} title="Agent Script source" className="sf-agent-opener-code" /></div>
        : loaded.state === 'fallback' ? <div className="sf-agent-opener-body"><Original /></div> : <div className="sf-agent-opener-body" aria-busy="true" />}
    </div>
  );
}
