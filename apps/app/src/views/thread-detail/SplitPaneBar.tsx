import { useMemo, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { listNavPanels, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import type { PaneContent } from '../../lib/split-layout/types.js';
import { paneBarTitle } from './split-pane-bar-title.js';

export function SplitPaneBar({
  content,
  isMaximized,
  onClose,
  onToggleMaximize,
  onBeginDrag
}: {
  content: PaneContent;
  isMaximized: boolean;
  onClose: () => void;
  onToggleMaximize: () => void;
  onBeginDrag: (event: ReactPointerEvent, label: string) => void;
}) {
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const pluginTitle = useMemo(() => {
    if (content.kind !== 'plugin-panel') return undefined;
    const match = panels.find(
      (panel) =>
        panel.pluginId === content.pluginId && (panel.path ?? panel.id) === content.panelPath
    );
    return match?.title;
  }, [content, panels]);
  const title = paneBarTitle(content, pluginTitle);

  const handleTitlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('a, button') !== null) {
      return;
    }
    onBeginDrag(event, title);
  };

  return (
    <div className="split-pane-bar" data-testid="split-pane-bar">
      <p
        className="split-pane-bar-title"
        title={title}
        onPointerDown={handleTitlePointerDown}
      >
        {title}
      </p>
      <div className="split-pane-bar-actions">
        <button
          type="button"
          className="icon-btn"
          title={isMaximized ? 'Restore pane' : 'Maximize pane'}
          aria-label={isMaximized ? 'Restore pane' : 'Maximize pane'}
          data-testid="split-pane-maximize"
          onClick={onToggleMaximize}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Close pane (⌘⌥W)"
          aria-label="Close pane"
          data-testid="split-pane-close"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
