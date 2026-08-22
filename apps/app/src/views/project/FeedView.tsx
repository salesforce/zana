import { product } from '../../lib/product-client.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GitCommit,
  FileText,
  CheckCircle2,
  CircleDot,
  Target,
  BookText,
  Clock,
  Puzzle,
  FolderPlus,
  Sparkles,
  RefreshCw,
  Activity,
  Search,
  ChevronRight,
  X,
  type LucideIcon
} from 'lucide-react';
import type { FeedEvent, FeedEventKind, FeedDigest, Project } from '@zana-ai/zcc-domain/product';
import {
  groupFeedByBucket,
  clusterFeedNodes,
  type FeedBucket,
  type FeedNode
} from '@/lib/feedGrouping';
import { mdToPlainText } from '@/lib/plainText';
import { MarkdownContent } from '@/components/MarkdownContent';

/**
 * The per-project Activity Feed — a read-only, LinkedIn/Facebook-style history
 * of what happened on a project: commits, agent reports, finished sessions,
 * resolved follow-ups, achieved goals, library docs, scheduled runs, extension
 * lifecycle. Assembled on demand by main's FeedService (persisted greenfield
 * slice + events derived live from the inbox / followups / goals / library
 * stores + an on-demand `git log` snapshot), so the renderer only reads.
 *
 * Distinct from the Inbox: the Inbox is "needs your attention" (unread dots,
 * questions); the Feed is passive history — no unread state, denser rows (icon
 * + one-line label + relative time), grouped by day. It never notifies. An
 * optional AI "recap" card sits on top (the `builtin:feed-digest` micro-call).
 */

const PAGE_SIZE = 60;

/** Per-kind icon + accent class for the timeline rows. */
const KIND_META: Record<FeedEventKind, { icon: LucideIcon; cls: string }> = {
  commit: { icon: GitCommit, cls: 'feed-ico--commit' },
  report: { icon: FileText, cls: 'feed-ico--report' },
  'session-finished': { icon: CheckCircle2, cls: 'feed-ico--session' },
  'followup-created': { icon: CircleDot, cls: 'feed-ico--followup' },
  'followup-resolved': { icon: CheckCircle2, cls: 'feed-ico--followup' },
  'goal-achieved': { icon: Target, cls: 'feed-ico--goal' },
  'library-doc': { icon: BookText, cls: 'feed-ico--library' },
  'schedule-run': { icon: Clock, cls: 'feed-ico--schedule' },
  'extension-installed': { icon: Puzzle, cls: 'feed-ico--ext' },
  'extension-uninstalled': { icon: Puzzle, cls: 'feed-ico--ext' },
  'project-created': { icon: FolderPlus, cls: 'feed-ico--project' }
};

/** Plural noun for a collapsed cluster of `n` same-kind events. */
function clusterLabel(kind: FeedEventKind, n: number): string {
  const nouns: Partial<Record<FeedEventKind, [string, string]>> = {
    'followup-created': ['follow-up opened', 'follow-ups opened'],
    'followup-resolved': ['follow-up resolved', 'follow-ups resolved'],
    'session-finished': ['session finished', 'sessions finished'],
    'schedule-run': ['scheduled run', 'scheduled runs'],
    'extension-installed': ['extension installed', 'extensions installed'],
    'extension-uninstalled': ['extension removed', 'extensions removed']
  };
  const pair = nouns[kind] ?? ['event', 'events'];
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function absTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

const BUCKET_LABEL: Record<FeedBucket, string> = {
  Today: 'Today',
  Yesterday: 'Yesterday',
  'This week': 'This week',
  Older: 'Older'
};

export function FeedView({ project }: { project: Project }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // The AI recap card. `undefined` = not yet fetched; a result once loaded.
  const [digest, setDigest] = useState<FeedDigest | null>(null);
  const [digestState, setDigestState] = useState<'idle' | 'loading' | 'empty' | 'failed'>('idle');
  // Free-text filter over event title/detail (client-side, on loaded events).
  const [query, setQuery] = useState('');
  // Ids of clusters the user expanded in place.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Ids of individual event rows expanded for full detail.
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  // Guard against a stale project's async result landing after a project switch.
  const projectIdRef = useRef(project.id);
  projectIdRef.current = project.id;

  /** Load the first page, forcing a git-log snapshot (a fresh open should show commits). */
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const page = await product.feed.refresh(project.id, { limit: PAGE_SIZE });
      if (projectIdRef.current !== project.id) return;
      setEvents(page.events);
      setHasMore(page.hasMore);
    } finally {
      if (projectIdRef.current === project.id) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [project.id]);

  // Initial load + live refresh when main signals this project's feed changed.
  useEffect(() => {
    setLoading(true);
    setEvents([]);
    setDigest(null);
    setDigestState('idle');
    setQuery('');
    setExpanded(new Set());
    setExpandedEvents(new Set());
    void load();
    const off = product.feed.onChanged((changedId) => {
      if (changedId === project.id) void load();
    });
    return off;
  }, [project.id, load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || events.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = events[events.length - 1]!.ts;
      const page = await product.feed.list(project.id, { limit: PAGE_SIZE, before: oldest });
      if (projectIdRef.current !== project.id) return;
      // De-dupe by id in case an event shares the boundary timestamp.
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.events.filter((e) => !seen.has(e.id))];
      });
      setHasMore(page.hasMore);
    } finally {
      if (projectIdRef.current === project.id) setLoadingMore(false);
    }
  }, [events, loadingMore, project.id]);

  const generateRecap = useCallback(async () => {
    setDigestState('loading');
    try {
      const res = await product.feed.digest(project.id);
      if (projectIdRef.current !== project.id) return;
      if (res.ok) {
        setDigest(res.digest);
        setDigestState('idle');
      } else {
        setDigest(null);
        setDigestState(res.reason === 'empty' ? 'empty' : 'failed');
      }
    } catch {
      if (projectIdRef.current === project.id) setDigestState('failed');
    }
  }, [project.id]);

  // A filter query suppresses clustering (you're hunting a specific event, so
  // every match should be a visible row) and matches title + detail.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? events.filter(
        (e) =>
          e.title.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false)
      )
    : events;
  const grouped = groupFeedByBucket(filtered);
  // Collapse noisy same-kind runs into clusters per bucket. A search suppresses
  // clustering so every match is a visible row. Then flatten to a global node
  // index so the continuous spine can trim only its very first / last overhang.
  const bucketed = grouped.map(
    ([bucket, list]) => [bucket, q ? list.map((event) => ({ type: 'event', event }) as FeedNode) : clusterFeedNodes(list)] as const
  );
  const totalNodes = bucketed.reduce((n, [, nodes]) => n + nodes.length, 0);

  const toggleCluster = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleEvent = useCallback((id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="feed-view">
      <header className="feed-header">
        <div className="feed-header-title">
          <Activity size={15} />
          <span>Activity</span>
          <span className="feed-header-sub">a read-only history of this project</span>
        </div>
        <div className="feed-header-actions">
          <div className="feed-search">
            <Search size={13} className="feed-search-ico" aria-hidden />
            <input
              type="text"
              className="feed-search-input"
              placeholder="Search activity…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search activity"
            />
            {query && (
              <button
                type="button"
                className="feed-search-clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="feed-refresh-btn"
            onClick={() => void load()}
            disabled={refreshing}
            title="Refresh (re-reads git log)"
          >
            <RefreshCw size={13} className={refreshing ? 'feed-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* The scroll body. Kept SEPARATE from the header so the header is
          structurally fixed (no sticky/negative-margin hacks) — the recap and
          timeline scroll away beneath it. */}
      <div className="feed-scroll">
      {/* AI recap card — on-demand (never auto-warmed), mirrors the Inbox digest. */}
      <FeedRecapCard
        digest={digest}
        state={digestState}
        hasEvents={events.length > 0}
        onGenerate={() => void generateRecap()}
      />

      {loading ? (
        <div className="feed-empty">Loading feed…</div>
      ) : events.length === 0 ? (
        <div className="feed-empty">
          No activity yet. Commits, agent reports, finished sessions, resolved
          follow-ups and achieved goals will show up here.
        </div>
      ) : totalNodes === 0 ? (
        <div className="feed-empty">No activity matches “{query.trim()}”.</div>
      ) : (
        <div className="feed-timeline">
          {(() => {
            // Running index across ALL buckets so the spine trims only the very
            // first / very last node's overhang (continuous across buckets).
            let idx = -1;
            return bucketed.map(([bucket, nodes]) => (
              <section key={bucket} className="feed-bucket">
                <h4 className="feed-bucket-label">{BUCKET_LABEL[bucket]}</h4>
                <ul className="feed-rows">
                  {nodes.map((node) => {
                    idx += 1;
                    const isFirst = idx === 0;
                    // Don't cap the spine at the last node while more can load — a
                    // trailing segment hints the timeline continues into "Load older".
                    const isLast = !hasMore && idx === totalNodes - 1;
                    const spineCls = `${isFirst ? ' feed-row--first' : ''}${
                      isLast ? ' feed-row--last' : ''
                    }`;
                    if (node.type === 'cluster') {
                      return (
                        <ClusterRow
                          key={`cluster:${node.kind}:${node.latest.id}`}
                          node={node}
                          spineCls={spineCls}
                          open={expanded.has(node.latest.id)}
                          onToggle={() => toggleCluster(node.latest.id)}
                        />
                      );
                    }
                    return (
                      <EventRow
                        key={node.event.id}
                        event={node.event}
                        spineCls={spineCls}
                        open={expandedEvents.has(node.event.id)}
                        onToggle={() => toggleEvent(node.event.id)}
                      />
                    );
                  })}
                </ul>
              </section>
            ));
          })()}
          {hasMore && (
            <button
              type="button"
              className="feed-more-btn"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load older activity'}
            </button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

/** A single feed event as a timeline row. Click to expand full detail. */
function EventRow({
  event,
  spineCls,
  open,
  onToggle
}: {
  event: FeedEvent;
  spineCls: string;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[event.kind] ?? { icon: Activity, cls: '' };
  const Icon = meta.icon;
  const title = mdToPlainText(event.title);
  // A one-line, markdown-stripped preview for the collapsed row (clamped to 2
  // lines in CSS). The expanded panel renders the raw markdown properly.
  const preview = event.detail ? mdToPlainText(event.detail) : '';
  const hasDetail = !!event.detail || !!event.context;
  return (
    <li className={`feed-row feed-row--event${open ? ' is-open' : ''}${spineCls}`}>
      <span className={`feed-ico ${meta.cls}`} aria-hidden>
        <Icon size={14} />
      </span>
      <div className="feed-row-body">
        {/* The clickable summary. The expanded panel is a SIBLING (not nested)
            so its markdown links/code aren't illegally inside a <button>. */}
        <button
          type="button"
          className="feed-row-summary"
          onClick={onToggle}
          aria-expanded={open}
          title={hasDetail ? (open ? 'Hide details' : 'Show details') : undefined}
        >
          <span className="feed-row-summary-text">
            <span className="feed-row-title">{title}</span>
            {!open && preview && <span className="feed-row-detail">{preview}</span>}
          </span>
          <time className="feed-row-ts" title={absTime(event.ts)}>
            {formatRelative(event.ts)}
          </time>
        </button>
        {open && (
          <div className="feed-row-expanded">
            {event.context && (
              <div className="feed-row-context">
                <span className="feed-row-context-label">Context</span>
                {event.context}
              </div>
            )}
            {event.detail ? (
              <div className="feed-row-expanded-body feed-row-expanded-body--md">
                <MarkdownContent text={event.detail} />
              </div>
            ) : (
              !event.context && (
                <div className="feed-row-expanded-body">No extra details on this event.</div>
              )
            )}
            <div className="feed-row-expanded-meta">{event.kind}</div>
          </div>
        )}
      </div>
    </li>
  );
}

/** A collapsed run of same-kind events; expands its members in place. */
function ClusterRow({
  node,
  spineCls,
  open,
  onToggle
}: {
  node: Extract<FeedNode, { type: 'cluster' }>;
  spineCls: string;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[node.kind] ?? { icon: Activity, cls: '' };
  const Icon = meta.icon;
  const first = node.events[node.events.length - 1]!;
  const span =
    first.ts === node.latest.ts ? '' : ` · ${formatRelative(first.ts)}–${formatRelative(node.latest.ts)}`;
  return (
    <li className={`feed-row feed-row--cluster${spineCls}`}>
      <button
        type="button"
        className={`feed-ico feed-ico--cluster ${meta.cls}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse group' : 'Expand group'}
      >
        <Icon size={14} />
        {!open && <span className="feed-cluster-badge">{node.events.length}</span>}
      </button>
      <div className="feed-row-body">
        <button type="button" className="feed-cluster-toggle" onClick={onToggle} aria-expanded={open}>
          <ChevronRight size={13} className={`feed-cluster-chev${open ? ' feed-cluster-chev--open' : ''}`} />
          <span className="feed-row-title">{clusterLabel(node.kind, node.events.length)}</span>
        </button>
        {open && (
          <ul className="feed-cluster-members">
            {node.events.map((ev) => (
              <li key={ev.id} className="feed-cluster-member">
                <span className="feed-cluster-member-title">{mdToPlainText(ev.title)}</span>
                {ev.detail && <span className="feed-row-detail">{mdToPlainText(ev.detail)}</span>}
                <time className="feed-cluster-member-ts" title={absTime(ev.ts)}>
                  {formatRelative(ev.ts)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!open && (
        <time className="feed-row-ts" title={absTime(node.latest.ts)}>
          {formatRelative(node.latest.ts)}
          {span}
        </time>
      )}
    </li>
  );
}

function FeedRecapCard({
  digest,
  state,
  hasEvents,
  onGenerate
}: {
  digest: FeedDigest | null;
  state: 'idle' | 'loading' | 'empty' | 'failed';
  hasEvents: boolean;
  onGenerate: () => void;
}) {
  if (!hasEvents) return null;
  return (
    <div className="feed-recap">
      <div className="feed-recap-head">
        <span className="feed-recap-title">
          <Sparkles size={13} />
          Recap
        </span>
        <button
          type="button"
          className="feed-recap-btn"
          onClick={onGenerate}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Summarizing…' : digest ? 'Regenerate' : 'Generate recap'}
        </button>
      </div>
      {digest ? (
        <div className="feed-recap-body">
          <p className="feed-recap-headline">{digest.headline}</p>
          {digest.highlights.length > 0 && (
            <ul className="feed-recap-highlights">
              {digest.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      ) : state === 'failed' ? (
        <p className="feed-recap-note">Couldn’t summarize the feed right now.</p>
      ) : state === 'empty' ? (
        <p className="feed-recap-note">Not enough activity to summarize yet.</p>
      ) : (
        <p className="feed-recap-note">
          Generate a short AI summary of what’s happened on this project.
        </p>
      )}
    </div>
  );
}

export { FeedView as ProjectFeedView };
