import { Maximize2, Minimize2, X } from 'lucide-react';
import { useOptionalPaneContext } from './PaneContext.js';

/** Close (and maximize) for split panes that already have a header row. Always
 *  visible while the pane can close — same as BB’s header actions. */
export function SplitPaneHeaderActions() {
  const pane = useOptionalPaneContext();
  if (!pane?.onRequestClose && !pane?.onToggleMaximize) return null;
  return (
    <div className="split-pane-header-actions" data-testid="split-pane-header-actions">
      {pane.onToggleMaximize ? (
        <button
          type="button"
          className="icon-btn"
          title={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
          aria-label={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
          data-testid="split-pane-maximize"
          onClick={(event) => {
            event.stopPropagation();
            pane.onToggleMaximize?.();
          }}
        >
          {pane.isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      ) : null}
      {pane.onRequestClose ? (
        <button
          type="button"
          className="icon-btn"
          title="Close pane (⌘⌥W)"
          aria-label="Close pane"
          data-testid="split-pane-close"
          onClick={(event) => {
            event.stopPropagation();
            pane.onRequestClose?.();
          }}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
