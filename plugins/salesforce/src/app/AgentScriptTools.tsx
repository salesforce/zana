import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PanelRight, Plus, X } from 'lucide-react';

export const AGENT_SCRIPT_TOOLS = [
  { id: 'agents', title: 'Agents', description: 'Browse org agents and retrieve source versions', icon: 'M9 4h6 M12 2v2 M4 8h16v12H4z M8 12h.01 M16 12h.01 M8 16h8' },
  { id: 'files', title: 'File explorer', description: 'Project scripts and examples', icon: 'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3' },
  { id: 'graph', title: 'Graph view', description: 'Topics, actions, and conversation routes', icon: 'M6 3v6h12V3 M12 9v6 M9 15h6v6H9z' },
  { id: 'preview', title: 'Preview', description: 'Try the current draft in a conversation', icon: 'm8 4 12 8-12 8z' },
  { id: 'test', title: 'Tests', description: 'Run scenarios and review evaluations', icon: 'M9 3h6 M10 3v7L4 20h16l-6-10V3 M7 16h10' },
  { id: 'actions', title: 'Actions', description: 'Inspect Apex, Flow, inputs, and outputs', icon: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18' },
  { id: 'org-preview', title: 'Org preview', description: 'Talk to an agent in your connected org', icon: 'M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-3 5.5 5.5 0 0 0 0 11Z' },
] as const;
export type AgentScriptTool = typeof AGENT_SCRIPT_TOOLS[number]['id'];
type ToolState = { tabs: AgentScriptTool[]; active: AgentScriptTool | 'new'; open: boolean };
const initialState: ToolState = { tabs: ['files'], active: 'files', open: true };
const isTool = (value: unknown): value is AgentScriptTool => AGENT_SCRIPT_TOOLS.some(tool => tool.id === value);

function readState(key: string): ToolState {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || !Array.isArray(value.tabs)) return initialState;
    const tabs = [...new Set<AgentScriptTool>(value.tabs.filter(isTool))];
    return { tabs, active: tabs.includes(value.active) ? value.active : 'new', open: value.open !== false };
  } catch { return initialState; }
}

/** Only layout is persisted here. Each tool retains its own draft/session state. */
export function useAgentScriptTools(scope: string) {
  const key = `salesforce:agent-tools:${scope}`;
  const [state, setState] = useState(() => readState(key));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Layout persistence is optional. */ } }, [key, state]);
  const openTool = useCallback((id: AgentScriptTool) => setState(current => ({
    tabs: current.tabs.includes(id) ? current.tabs : [...current.tabs, id], active: id, open: true,
  })), []);
  return { state, openTool,
    setOpen: (open: boolean) => setState(current => ({ ...current, open })),
    select: (active: ToolState['active']) => setState(current => ({ ...current, active, open: true })),
    toggle: () => setState(current => ({ ...current, open: !current.open })),
    close: (id: AgentScriptTool) => setState(current => {
      const tabs = current.tabs.filter(tab => tab !== id);
      return { ...current, tabs, active: current.active === id ? tabs[Math.max(0, current.tabs.indexOf(id) - 1)] ?? 'new' : current.active };
    }),
  };
}

export function AgentScriptTools({ tools, render }: {
  tools: ReturnType<typeof useAgentScriptTools>;
  render: (id: AgentScriptTool, visible: boolean) => ReactNode;
}) {
  const prefix = useId();
  const strip = useRef<HTMLDivElement>(null);
  const { state } = tools;
  useEffect(() => {
    strip.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state.active, state.open]);
  const title = (id: AgentScriptTool) => AGENT_SCRIPT_TOOLS.find(tool => tool.id === id)!.title;
  return <aside className="af-tools" aria-label="AgentScript side panel" hidden={!state.open}>
    <div className="thread-secondary-chrome">
      <div className="thread-secondary-tabs" role="tablist" aria-label="AgentScript tools" ref={strip}>
        {state.tabs.map(id => <span className={`thread-secondary-tab${state.active === id ? ' is-active' : ''}`} key={id}>
          <button type="button" className="thread-secondary-tab-label" title={title(id)} role="tab" id={`${prefix}-${id}`} aria-controls={`${prefix}-${id}-panel`} aria-selected={state.active === id}
            tabIndex={state.active === id ? 0 : -1} onClick={() => tools.select(id)} onKeyDown={event => {
              const index = state.tabs.indexOf(id);
              const next = event.key === 'ArrowRight' ? (index + 1) % state.tabs.length : event.key === 'ArrowLeft' ? (index + state.tabs.length - 1) % state.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); tools.select(state.tabs[next]); document.getElementById(`${prefix}-${state.tabs[next]}`)?.focus(); }
              if (event.key === 'Delete') { event.preventDefault(); tools.close(id); strip.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-label="Add side panel tab"]')?.focus(); }
            }}>{title(id)}</button>
          <button type="button" className="thread-secondary-tab-close" title={`Close ${title(id)}`} aria-label={`Close ${title(id)}`} onClick={() => { tools.close(id); strip.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-label="Add side panel tab"]')?.focus(); }}><X size={11} aria-hidden="true" /></button>
        </span>)}
      </div>
      <div className="thread-secondary-controls">
        <button type="button" className="thread-secondary-pin" aria-label="Add side panel tab" title="Add a tool" onClick={() => tools.select('new')}><Plus size={15} aria-hidden="true" /></button>
        <button type="button" className="thread-secondary-pin" aria-label="Hide side panel" title="Hide side panel" onClick={tools.toggle}><PanelRight size={15} aria-hidden="true" /></button>
      </div>
    </div>
    {state.active === 'new' && <div className="af-tool-picker">
      <h2>Add a tool</h2><p>Open beside your AgentScript editor.</p>
      <div>{AGENT_SCRIPT_TOOLS.map(tool => <button type="button" key={tool.id} onClick={() => tools.openTool(tool.id)}>
        <svg className="af-tool-icon" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={tool.icon} /></svg><span><strong>{tool.title}</strong><small>{tool.description}</small></span>
        {state.tabs.includes(tool.id) && <span className="af-tool-open">Open</span>}
      </button>)}</div>
    </div>}
    {state.tabs.map(id => <div key={id} className="af-tool-content" role="tabpanel" id={`${prefix}-${id}-panel`} aria-labelledby={`${prefix}-${id}`} hidden={state.active !== id}>
      {render(id, state.open && state.active === id)}
    </div>)}
  </aside>;
}
