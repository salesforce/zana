import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { ThreadCommandComposer } from '../../ThreadCommandComposer.js';
import { product } from '../../../lib/product-client.js';
import { getThreadRoutePath } from '../../../lib/route-paths.js';

const ThreadDetailLazy = lazy(async () => {
  const mod = await import('../../../views/threads/ThreadDetailView.js');
  return { default: mod.ThreadDetail };
});

function ago(ts: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Enough to resume recent work without turning the composer into a list view. */
export const PANEL_AGENT_RECENT_LIMIT = 5;

export interface PanelConversation {
  id: string;
  title: string | null;
  updatedAt: number;
}

/**
 * Side-panel agent: a composer until the first send, then that thread's chat.
 * Creation never navigates, so the page beside the panel stays in view. With
 * `pluginPanel`, the thread is bound to that plugin (main grounds it on the
 * page and the plugin can give it tools). Bound threads are hidden from the
 * Agents list, so the composer lists them to reopen, and the chat can be
 * promoted with Open as thread.
 */
export function PanelAgentTab({
  threadId,
  pluginPanel,
  onCreated,
  onOpenConversation
}: {
  threadId?: string;
  pluginPanel?: { pluginId: string; panel: string; view?: string };
  onCreated: (threadId: string) => void;
  onOpenConversation?: (conversation: PanelConversation) => void;
}) {
  if (threadId) {
    return (
      <div className="panel-agent-tab is-chat" data-testid="panel-agent-tab-chat">
        {pluginPanel ? <OpenAsThreadBar threadId={threadId} /> : null}
        <Suspense fallback={null}>
          <ThreadDetailLazy threadId={threadId} embedded />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="panel-agent-tab is-composer" data-testid="panel-agent-tab-composer">
      {pluginPanel && onOpenConversation ? (
        <RecentPanelConversations pluginId={pluginPanel.pluginId} panel={pluginPanel.panel} onOpen={onOpenConversation} />
      ) : null}
      <p className="panel-agent-tab-hint">
        {pluginPanel
          ? 'Ask about this page. The agent knows which plugin it is next to.'
          : 'Ask an agent without leaving this page.'}
      </p>
      <ThreadCommandComposer autoFocus navigateOnCreate={false} pluginPanel={pluginPanel} onCreated={onCreated} />
    </div>
  );
}

function RecentPanelConversations({
  pluginId,
  panel,
  onOpen
}: {
  pluginId: string;
  panel: string;
  onOpen: (conversation: PanelConversation) => void;
}) {
  const [conversations, setConversations] = useState<PanelConversation[]>([]);
  useEffect(() => {
    let cancelled = false;
    product.threads.panelConversations(pluginId, panel)
      .then((rows) => {
        if (!cancelled) setConversations(rows.slice(0, PANEL_AGENT_RECENT_LIMIT));
      })
      // Reopening is a convenience; a failed lookup leaves the composer usable.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pluginId, panel]);

  if (conversations.length === 0) return null;
  return (
    <section className="panel-agent-recents" data-testid="panel-agent-recents" aria-label="Recent conversations">
      <h3 className="panel-agent-recents-title">Recent conversations</h3>
      <ul className="panel-agent-recents-list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className="panel-agent-recent"
              data-testid="panel-agent-recent"
              onClick={() => onOpen(conversation)}
            >
              <MessageSquare size={12} aria-hidden="true" />
              <span className="panel-agent-recent-title">{conversation.title || 'Untitled conversation'}</span>
              <span className="panel-agent-recent-time">{ago(conversation.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenAsThreadBar({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="panel-agent-tab-bar">
      {error ? <span className="panel-agent-tab-error" role="alert">{error}</span> : null}
      <button
        type="button"
        className="panel-agent-tab-open"
        data-testid="panel-agent-open-as-thread"
        title="Move this conversation into the Agents list"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void product.threads.openAsThread(threadId)
            .then(() => navigate(getThreadRoutePath(threadId)))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not open as thread');
              setBusy(false);
            });
        }}
      >
        <ExternalLink size={12} aria-hidden="true" />
        Open as thread
      </button>
    </div>
  );
}
