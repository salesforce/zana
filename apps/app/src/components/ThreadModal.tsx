import { AppWindow, X } from 'lucide-react';
import { useThreads } from '../thread-store.js';
import { FavoriteStar } from './FavoriteStar.js';
import { InspectorResizeHandles } from './InspectorResizeHandles.js';
import { stopInspectorDialogClick } from './inspector-window.js';
import { useInspectorWindow } from './useInspectorWindow.js';
import { ThreadDetail } from '../views/threads/ThreadDetailView.js';

export function threadModalLabel(title: string | null | undefined): string {
  return title?.trim() || 'Agent';
}

export {
  applyInspectorFullScreen,
  focusInspectorDialog,
  inspectorModalClassName,
  releaseInspectorFullScreen,
  stopInspectorDialogClick,
  toggleInspectorFullScreen
} from './inspector-window.js';

/**
 * Thread-inspector modal: the same overlay chrome as the CLI agent
 * inspector, hosting the conversation ThreadDetail surface. Opened from the
 * Agents kanban so a card click peeks the thread without navigating away.
 */
export function ThreadModal({
  threadId,
  onClose
}: {
  threadId: string;
  onClose: () => void;
}) {
  const windowState = useInspectorWindow();
  const thread = useThreads((s) => s.threads.find((item) => item.id === threadId));
  const title = threadModalLabel(thread?.title);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={windowState.ref}
        data-testid="thread-modal"
        className={windowState.className}
        style={windowState.style}
        onClick={stopInspectorDialogClick}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header agent-modal-header thread-modal-header" data-testid="thread-modal-header">
          <FavoriteStar session={{ id: threadId, kind: 'thread' }} size={16} className="agent-modal-fav" />
          <div className="agent-modal-window-controls">
            <button
              type="button"
              className="agent-modal-fullscreen-button"
              onClick={windowState.toggleFullScreen}
              aria-label={windowState.fullScreen ? 'Exit full screen' : 'Full screen'}
              title={windowState.fullScreen ? 'Exit full screen for the agent window' : 'Show the entire agent window in full screen'}
              data-testid="thread-modal-fullscreen"
            >
              <AppWindow size={14} aria-hidden="true" />
              <span>{windowState.fullScreen ? 'Exit full screen' : 'Full screen'}</span>
            </button>
            <span className="agent-modal-window-divider" aria-hidden="true" />
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close"
              title="Close agent window"
              data-testid="thread-modal-close"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="agent-modal-body">
          <ThreadDetail threadId={threadId} modal />
        </div>
        <InspectorResizeHandles
          hidden={windowState.fullScreen}
          onBegin={windowState.beginResize}
          onMove={windowState.moveResize}
          onEnd={windowState.endResize}
          onReset={windowState.resetFrame}
          onKey={windowState.keyResize}
        />
      </div>
    </div>
  );
}
