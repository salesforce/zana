import { product } from '../lib/product-client.js';
import { useEffect, useRef, useState } from 'react';
import { Clock, RefreshCw, Sparkles } from 'lucide-react';
import type { ConversationHistorySnapshot } from '@zana-ai/zcc-domain/product';

interface Props {
  projectId: string;
  unavailableProviders: string[];
  onResumed: () => void;
}

export function historySnapshotForDisplay(
  current: ConversationHistorySnapshot,
  next: ConversationHistorySnapshot,
  refreshing: boolean
): ConversationHistorySnapshot {
  // Refresh must not erase usable rows before native readers return a replacement.
  if (refreshing && current.rows.length > 0 && next.rows.length === 0) return current;
  return next;
}

function timeAgo(ms: number | null): string {
  if (!ms) return 'Unknown activity';
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initialSnapshot(): ConversationHistorySnapshot {
  return { snapshotId: '', status: 'pending', rows: [], coverage: [], hasNextPage: false };
}

/** Generic, opaque native-history picker. Main alone owns native ids, paths, and resume argv. */
export function AgentConversationHistory({ projectId, unavailableProviders, onResumed }: Props) {
  const [snapshot, setSnapshot] = useState<ConversationHistorySnapshot>(initialSnapshot);
  const [resuming, setResuming] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const snapshotId = useRef('');
  const generation = useRef(0);
  const refreshingRef = useRef(false);

  const setRefreshState = (value: boolean) => {
    refreshingRef.current = value;
    setRefreshing(value);
  };

  const showSnapshot = (next: ConversationHistorySnapshot, isRefresh = false) =>
    setSnapshot((current) => historySnapshotForDisplay(current, next, isRefresh));

  const load = async (refresh = false) => {
    const currentGeneration = generation.current;
    if (refresh) setRefreshState(true);
    let next: ConversationHistorySnapshot;
    try {
      next = refresh && snapshotId.current
        ? await product.history.refresh(snapshotId.current)
        : await product.history.start({ projectId, filter: 'project' });
    } catch {
      if (currentGeneration === generation.current) setSnapshot({ ...initialSnapshot(), status: 'ready' });
      if (currentGeneration === generation.current) setRefreshState(false);
      return;
    }
    if (currentGeneration !== generation.current) {
      if (next.snapshotId) void product.history.release(next.snapshotId);
      return;
    }
    if (snapshotId.current && snapshotId.current !== next.snapshotId) {
      void product.history.release(snapshotId.current);
    }
    snapshotId.current = next.snapshotId;
    showSnapshot(next, refresh);
    if (next.status === 'ready') setRefreshState(false);
  };

  useEffect(() => {
    generation.current += 1;
    const currentGeneration = generation.current;
    void load();
    const poll = window.setInterval(async () => {
      const id = snapshotId.current;
      if (!id) return;
      let next: ConversationHistorySnapshot;
      try {
        next = await product.history.page(id);
      } catch {
        return;
      }
      if (currentGeneration !== generation.current || next.status === 'expired') return;
       showSnapshot(next, refreshingRef.current);
       if (next.status === 'ready') {
         setRefreshState(false);
         window.clearInterval(poll);
       }
    }, 250);
    return () => {
      generation.current += 1;
      window.clearInterval(poll);
      if (snapshotId.current) void product.history.release(snapshotId.current);
      snapshotId.current = '';
    };
    // History is scoped to the project, not to form edits or provider settlement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loading = snapshot.status === 'pending' || snapshot.status === 'provisional';

  return (
    <section className="conversation-history" aria-label="Recent conversations">
      <div className="conversation-history-header">
        <div>
          <div className="sessions-title">Recent conversations</div>
          <p className="conversation-history-status" aria-live="off">
            {refreshing ? 'Refreshing recent conversations' : loading ? 'Updating recent conversations' : snapshot.snapshotAt ? `Updated ${timeAgo(snapshot.snapshotAt)}` : 'Recent conversations'}
          </p>
        </div>
        <button type="button" className="settings-btn" onClick={() => void load(true)}>
          <RefreshCw size={12} /> {refreshing ? 'Refreshing history' : 'Refresh history'}
        </button>
      </div>
      <div className="conversation-history-list" role="list">
        {snapshot.rows.map((row) => (
          <div key={row.historyId} className="conversation-history-row" role="listitem">
            <span className={`agents-row-icon tab-profile-icon profile-${row.source}`} aria-hidden="true"><Sparkles size={13} /></span>
            <span className="agents-row-text">
              <span className="agents-row-title" title={row.title}>{row.title}</span>
              <span className="agents-row-meta"><span><Clock size={11} /> {timeAgo(row.lastActiveAt)}</span><span>{row.source === 'claude' ? 'Claude' : 'OpenCode'}</span></span>
            </span>
            {row.availability === 'available' ? (
              <button
                type="button"
                className="settings-btn"
                disabled={resuming === row.historyId}
                onClick={async () => {
                  setResuming(row.historyId);
                  const result = await product.history.resume(snapshotId.current, row.historyId);
                  setResuming(null);
                  if (result.ok) onResumed();
                }}
              >
                Resume
              </button>
            ) : <span className="conversation-history-unavailable">{row.unavailableReason ?? 'Unavailable'}</span>}
          </div>
        ))}
        {loading && <div className="sessions-empty">Updating recent conversations…</div>}
        {!loading && snapshot.rows.length === 0 && <div className="sessions-empty">No recent conversations in this project.</div>}
      </div>
      <p className="conversation-history-coverage">
        {snapshot.coverage.map((entry) => {
          if (entry.state === 'empty') return `${entry.source === 'claude' ? 'Claude' : 'OpenCode'}: no conversations`;
          if (entry.state === 'failed' || entry.state === 'timed-out') return `${entry.source === 'claude' ? 'Claude' : 'OpenCode'} history unavailable`;
          return `${entry.source === 'claude' ? 'Claude' : 'OpenCode'} history`;
        }).join(' · ')}
      </p>
      {unavailableProviders.length > 0 && (
        <p className="conversation-history-coverage">
          History is not available yet for {unavailableProviders.join(', ')}.
        </p>
      )}
    </section>
  );
}
