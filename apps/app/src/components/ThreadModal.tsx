import { useEffect, useRef, useState } from 'react';
import { product } from '../lib/product-client.js';
import { useThreads } from '../thread-store.js';
import { ThreadDetail } from '../views/threads/ThreadDetailView.js';

export function threadModalLabel(title: string | null | undefined): string {
  return title?.trim() || 'Thread';
}

export function inspectorModalClassName(fullScreen: boolean): string {
  return `modal agent-terminal-modal${fullScreen ? ' is-fullscreen' : ''}`;
}

export function applyInspectorFullScreen(next: boolean): void {
  void product.app.setFullScreen(next);
}

export function releaseInspectorFullScreen(wasFullScreen: boolean): void {
  if (wasFullScreen) applyInspectorFullScreen(false);
}

export function focusInspectorDialog(node: { focus(): void } | null): void {
  node?.focus();
}

export function stopInspectorDialogClick(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

export function toggleInspectorFullScreen(
  current: boolean,
  setFullScreen: (next: boolean) => void
): boolean {
  const next = !current;
  setFullScreen(next);
  applyInspectorFullScreen(next);
  return next;
}

/**
 * Thread-inspector modal: the same overlay chrome as the legacy agent
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
  const ref = useRef<HTMLDivElement | null>(null);
  const thread = useThreads((s) => s.threads.find((item) => item.id === threadId));
  const title = threadModalLabel(thread?.title);

  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenRef = useRef(false);
  fullScreenRef.current = fullScreen;
  useEffect(() => product.app.onFullScreenChanged(setFullScreen), []);
  const toggleFullScreen = () => toggleInspectorFullScreen(fullScreen, setFullScreen);
  useEffect(() => {
    return () => releaseInspectorFullScreen(fullScreenRef.current);
  }, []);
  useEffect(() => {
    focusInspectorDialog(ref.current);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        data-testid="thread-modal"
        className={inspectorModalClassName(fullScreen)}
        onClick={stopInspectorDialogClick}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="agent-modal-body">
          <ThreadDetail
            threadId={threadId}
            embedded
            onClose={onClose}
            fullScreen={fullScreen}
            onToggleFullScreen={toggleFullScreen}
          />
        </div>
      </div>
    </div>
  );
}
