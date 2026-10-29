import { useEffect, useRef, type ReactNode } from 'react';
import { Play, Plus, X, ArrowUpRight } from 'lucide-react';
import { VIEW_LABEL, type AgentRef, type ViewTarget } from './studio-layout.js';
import { SalesforceToolsLink } from '../salesforce-tools-link.js';

/**
 * One tab per open agent, above that agent's documents. A dot marks unsaved edits, a play mark a running
 * preview. The org pill and "Salesforce ↗" sit at the end, outside the scrolling strip.
 */
export function AgentTabs({ agents, active, dirtyPaths, runningPaths, projectId, orgPill, onSelect, onClose, onOpenAgent, onOpenView, lockedPath, onDetach, showToolsLink = true }: {
  agents: AgentRef[];
  active: string | null;
  dirtyPaths?: ReadonlySet<string>;
  runningPaths?: ReadonlySet<string>;
  projectId: string;
  orgPill?: ReactNode;
  showToolsLink?: boolean;
  onSelect(path: string): void;
  onClose(path: string): void;
  lockedPath?: string;
  onDetach?(path: string): void;
  /** "+ Open agent": quick open, or focus on the explorer when it is the only surface. */
  onOpenAgent(): void;
  /** View launchers for hosts without a side panel. Modern hosts list these in the panel's tool menu. */
  onOpenView?(target: ViewTarget): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { strip.current?.querySelector('.sf-atab.is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active, agents.length]);
  return <div className="sf-atabs-bar" data-testid="salesforce-agent-tabs">
    <div ref={strip} className="sf-atabs" role="tablist" aria-label="Open agents">
      {agents.map((agent, index) => {
        const selected = agent.path === active;
        const dirty = dirtyPaths?.has(agent.path); const running = runningPaths?.has(agent.path);
        return <span key={agent.path} className={`sf-atab${selected ? ' is-active' : ''}`}>
          <button type="button" role="tab" className="sf-atab-label" aria-selected={selected} tabIndex={selected ? 0 : -1} title={agent.path} onClick={() => onSelect(agent.path)}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % agents.length : event.key === 'ArrowLeft' ? (index + agents.length - 1) % agents.length : null;
              if (next === null) return;
              event.preventDefault(); onSelect(agents[next].path);
              event.currentTarget.closest('.sf-atabs')?.querySelectorAll<HTMLButtonElement>('.sf-atab-label')[next]?.focus();
            }}>
            <span className="sf-atab-name">{agent.label}</span>
            {dirty && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
            {running && <span className="sf-atab-running" role="img" aria-label="Preview running"><Play size={9} fill="currentColor" aria-hidden="true" /></span>}
          </button>
          {onDetach && <button type="button" className="sf-etab-close" aria-label={`Open ${agent.label} in its own window`} title="Open in its own window" onClick={() => onDetach(agent.path)}><ArrowUpRight size={13} aria-hidden="true" /></button>}
          {agent.path !== lockedPath && <button type="button" className="sf-etab-close" aria-label={`Close agent ${agent.label}`} onClick={() => onClose(agent.path)}><X size={11} aria-hidden="true" /></button>}
        </span>;
      })}
      <button type="button" className="sf-atab-add" onClick={onOpenAgent}><Plus size={13} aria-hidden="true" />{lockedPath ? 'Open another agent' : 'Open agent'}</button>
    </div>
    <div className="sf-atabs-actions">
      {onOpenView && (['graph', 'preview', 'tests'] as const).map(target => (
        <button key={target} type="button" className="sf-atab-view" aria-label={`Open ${VIEW_LABEL[target]} view`} title={`Open ${VIEW_LABEL[target]} for this agent`} disabled={!active} onClick={() => onOpenView(target)}>{VIEW_LABEL[target]}</button>
      ))}
      {orgPill}
      {showToolsLink && <SalesforceToolsLink projectId={projectId} />}
    </div>
  </div>;
}
