import { useEffect, useRef } from 'react';
import { ArrowLeft, FileText, Maximize2, Minimize2, PanelRightClose, X } from 'lucide-react';
import { type ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';

/** Presentation only: an omitted tab remains owned and mounted by the native panel. */
export function basicPanelTabSupported(kind: string): boolean {
  return kind === 'file-preview' || kind === 'storage-preview' || kind === 'browser' || kind === 'plugin';
}

export function basicPanelActiveSupported(state: ThreadSecondaryPanelState): boolean {
  if (state.activeId === 'info' || state.activeId === 'plan') return true;
  const active = state.tabs.find(tab => tab.id === state.activeId);
  return active != null && basicPanelTabSupported(active.kind);
}

export function BasicPanelChrome({ state, showInfo, showPlan, onSelectInfo, onSelectPlan, onActivateTab,
  onCloseTab, onToggleMaximized, onHide, compact = false }: {
  state: ThreadSecondaryPanelState;
  compact?: boolean;
  showInfo: boolean;
  showPlan: boolean;
  onSelectInfo: () => void;
  onSelectPlan?: () => void;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onToggleMaximized: () => void;
  onHide: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (compact) backRef.current?.focus({ preventScroll: true }); }, [compact]);
  return <div className="thread-secondary-chrome basic-secondary-chrome" data-testid="thread-secondary-chrome">
    {compact ? <button type="button" className="basic-panel-back" ref={backRef} onClick={onHide}><ArrowLeft size={15} aria-hidden />Back to chat</button> : null}
    <div className="thread-secondary-tabs" role="toolbar" aria-label="Preview tabs" onKeyDown={event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        || !(event.target instanceof HTMLElement) || !event.target.matches('.thread-secondary-tab-label')) return;
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.thread-secondary-tab-label'));
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
    }}>
      {showInfo ? <span className={`thread-secondary-tab${state.activeId === 'info' ? ' is-active' : ''}`}>
        <button type="button" className="thread-secondary-tab-label basic-panel-files-label" aria-pressed={state.activeId === 'info'}
          onClick={onSelectInfo} data-testid="thread-info-pin"><FileText size={14} aria-hidden="true" /><span>Files</span></button>
      </span> : null}
      {showPlan ? <span className={`thread-secondary-tab${state.activeId === 'plan' ? ' is-active' : ''}`}>
        <button type="button" className="thread-secondary-tab-label" aria-pressed={state.activeId === 'plan'}
          onClick={onSelectPlan} data-testid="thread-plan-pin">Plan</button>
      </span> : null}
      {state.tabs.filter(tab => basicPanelTabSupported(tab.kind)).map(tab => <span key={tab.id}
        className={`thread-secondary-tab${state.activeId === tab.id ? ' is-active' : ''}`}>
        <button type="button" className="thread-secondary-tab-label" title={tab.title}
          aria-pressed={state.activeId === tab.id} onClick={() => onActivateTab(tab.id)}>{tab.title}</button>
        <button type="button" className="thread-secondary-tab-close" aria-label={`Close ${tab.title}`}
          onClick={() => onCloseTab(tab.id)}><X size={12} /></button>
      </span>)}
    </div>
    <div className="thread-secondary-controls">
      {!compact ? <button type="button" className="thread-secondary-pin" data-testid="thread-secondary-maximize"
        aria-label={state.isMaximized ? 'Restore conversation' : 'Maximize panel'} onClick={onToggleMaximized}>
        {state.isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button> : null}
      {!compact ? <button type="button" className="thread-secondary-pin" data-testid="thread-secondary-hide"
        aria-label="Hide right panel" onClick={onHide}><PanelRightClose size={15} /></button> : null}
    </div>
  </div>;
}
