import { type MouseEvent, type ReactNode, useRef } from 'react';
import { GitCompare, Info, Maximize2, Minimize2, PanelRight, Plus, X } from 'lucide-react';
import {
  activeClosableTab,
  activePinnedView,
  SECONDARY_PANEL_MIN_WIDTH_PX,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';
import { startColumnResize } from './threadSecondaryPanelLogic.js';

export function ThreadSecondaryPanel({
  state,
  showDiffPin,
  children,
  onSelectInfo,
  onSelectDiff,
  onNewTab,
  onCloseTab,
  onActivateTab,
  onToggleMaximized,
  onHide,
  onResize
}: {
  state: ThreadSecondaryPanelState;
  showDiffPin?: boolean;
  children: ReactNode;
  onSelectInfo: () => void;
  onSelectDiff: () => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onToggleMaximized: () => void;
  onHide: () => void;
  onResize: (widthPx: number, containerWidthPx: number) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const pin = activePinnedView(state);
  const activeTab = activeClosableTab(state);

  const onResizeMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    startColumnResize(
      event,
      () => panelRef.current?.parentElement,
      onResize,
      (name) => document.body.classList.add(name),
      (name) => document.body.classList.remove(name),
      (type, fn) => window.addEventListener(type, fn),
      (type, fn) => window.removeEventListener(type, fn)
    );
  };

  return (
    <aside
      ref={panelRef}
      className={`thread-secondary-panel${state.isMaximized ? ' is-maximized' : ''}`}
      data-testid="thread-secondary-panel"
      style={{ ['--thread-secondary-width' as string]: `${Math.max(SECONDARY_PANEL_MIN_WIDTH_PX, state.widthPx)}px` }}
    >
      <div
        className="thread-secondary-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        onMouseDown={onResizeMouseDown}
      />
      <div className="thread-secondary-chrome" data-testid="thread-secondary-chrome">
        <div className="thread-secondary-pins">
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label="Show thread info"
            aria-pressed={pin === 'info'}
            data-testid="thread-info-pin"
            onClick={onSelectInfo}
          >
            <Info size={15} />
          </button>
          {showDiffPin ? (
            <button
              type="button"
              className="thread-secondary-pin"
              aria-label="Show workspace diff"
              aria-pressed={pin === 'diff'}
              data-testid="thread-diff-pin"
              onClick={onSelectDiff}
            >
              <GitCompare size={15} />
            </button>
          ) : null}
          {state.tabs.map((tab) => (
            <span
              key={tab.id}
              className={`thread-secondary-tab${activeTab?.id === tab.id ? ' is-active' : ''}`}
            >
              <button type="button" className="thread-secondary-tab-label" onClick={() => onActivateTab(tab.id)}>
                {tab.title}
              </button>
              <button
                type="button"
                className="thread-secondary-tab-close"
                aria-label={`Close ${tab.title}`}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label="New tab"
            data-testid="thread-secondary-new-tab"
            onClick={onNewTab}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="thread-secondary-controls">
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label={state.isMaximized ? 'Restore conversation' : 'Maximize panel'}
            data-testid="thread-secondary-maximize"
            onClick={onToggleMaximized}
          >
            {state.isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label="Hide right panel"
            data-testid="thread-secondary-hide"
            onClick={onHide}
          >
            <PanelRight size={15} />
          </button>
        </div>
      </div>
      <div className="thread-secondary-body">{children}</div>
    </aside>
  );
}
