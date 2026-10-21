import { ExternalLink, PanelLeftClose } from 'lucide-react';
import { PaneEmptyState } from '../PaneEmptyState.js';
import { isThreadViewSurface } from '../../lib/threadViewSurface.js';
import {
  closeThreadViewWindow,
  isThreadViewOpen,
  openThreadViewWindow,
  useThreadViewWindows
} from '../../lib/thread-view-windows.js';

/**
 * Whether this thread lives in its own window and this window must not run it.
 * The thread view window itself always runs its thread.
 */
export function useThreadDetached(threadId: string): boolean {
  const open = useThreadViewWindows();
  return !isThreadViewSurface() && isThreadViewOpen(open, threadId);
}

/** Shown in place of a thread that is open in its own window, so only that window runs it. */
export function DetachedThread({ threadId, projectId }: { threadId: string; projectId?: string | null }) {
  const target = projectId ? { threadId, projectId } : { threadId };
  return (
    <div className="plugin-tab-detached" data-testid="thread-detached">
      <PaneEmptyState art="desktop" title="This agent is open in its own window" hint="Work there, or bring the agent back to this window.">
        <div className="plugin-tab-detached-actions">
          <button type="button" className="btn primary" onClick={() => void openThreadViewWindow(target)} data-testid="thread-detached-focus">
            <ExternalLink size={14} aria-hidden="true" />
            Focus window
          </button>
          <button type="button" className="btn" onClick={() => void closeThreadViewWindow(target)} data-testid="thread-detached-bring-back">
            <PanelLeftClose size={14} aria-hidden="true" />
            Bring back
          </button>
        </div>
      </PaneEmptyState>
    </div>
  );
}
