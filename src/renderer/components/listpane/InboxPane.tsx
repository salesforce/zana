import { useMemo, useState } from 'react';
import { Search, X, Check, Trash2, ChevronsDownUp, ChevronsUpDown, InboxIcon, Bookmark, FolderTree, Clock, FileText } from 'lucide-react';
import { useInbox, useInboxRead, useInboxKeep, useInboxCollapsed, useInboxScopeProjectId, clearInbox, useSaved, useUi } from '../../store';
import { groupByBucketThenProject, subGroupKey } from '../../util/inboxGrouping';
import { isReport } from '../../util/feedCategories';
import { ListPaneResizer } from '../ListPaneResizer';
import { InboxSidebar } from '../InboxSidebar';
import { SavedSidebar } from '../SavedSidebar';

export function InboxPane() {
  const allEntries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  const markAllRead = useInboxRead((s) => s.markAllRead);
  const keptIds = useInboxKeep((s) => s.keptIds);
  const collapsedByProject = useInboxCollapsed((s) => s.byKey);
  const setManyCollapsed = useInboxCollapsed((s) => s.setMany);
  const inboxTab = useUi((s) => s.inboxTab);
  const setInboxTab = useUi((s) => s.setInboxTab);
  const inboxGrouping = useUi((s) => s.inboxGrouping);
  const setInboxGrouping = useUi((s) => s.setInboxGrouping);
  const savedRecords = useSaved((s) => s.records);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  // When the shell is drilled into one project (focused or scoped window), the
  // inbox shows only that project — so every count/action here works off the
  // scoped slice, not the full store.
  const scopeProjectId = useInboxScopeProjectId();
  const entries = useMemo(
    () => (scopeProjectId ? allEntries.filter((e) => e.projectId === scopeProjectId) : allEntries),
    [allEntries, scopeProjectId]
  );
  // Saved reports honor the same scope as the feed (a focused/scoped window
  // shows only that project's saved reports).
  const savedCount = useMemo(
    () =>
      scopeProjectId
        ? savedRecords.filter((r) => r.projectId === scopeProjectId).length
        : savedRecords.length,
    [savedRecords, scopeProjectId]
  );
  const showingSaved = inboxTab === 'saved';
  const showingReports = inboxTab === 'reports';
  // The plain live feed (not Reports filter, not Saved) — the toolbar's
  // group/collapse/unread/mark-read/clear actions apply only here.
  const showingFeed = !showingSaved && !showingReports;
  const unreadCount = entries.reduce((n, e) => (readIds[e.id] ? n : n + 1), 0);
  // How many entries are explicitly-flagged reports (drives the Reports tab count).
  const reportCount = useMemo(() => entries.reduce((n, e) => (isReport(e) ? n + 1 : n), 0), [entries]);
  // Distinct (bucket,project) subgroups present in the inbox — collapse-all /
  // expand-all should apply to visible subgroup rows, not globally by project.
  const subgroupKeys = useMemo(
    () =>
      groupByBucketThenProject(entries).flatMap(([bucket, subgroups]) =>
        subgroups.map((sg) => subGroupKey(bucket, sg.projectId))
      ),
    [entries]
  );
  // "Expand all" when any project is explicitly collapsed; else "collapse all".
  // A purely explicit read (the auto-fold default isn't represented here), which
  // keeps the button intent obvious: it sets every project's explicit flag.
  const anyCollapsed = subgroupKeys.some((key) => collapsedByProject[key]);
  // How many would a Clear remove (everything not flagged Keep).
  const clearableCount = entries.reduce((n, e) => (keptIds[e.id] ? n : n + 1), 0);
  const keptCount = entries.length - clearableCount;

  const onClear = () => {
    if (clearableCount === 0) return;
    const keepNote = keptCount > 0 ? ` ${keptCount} kept ${keptCount === 1 ? 'entry' : 'entries'} will remain.` : '';
    const ok = window.confirm(
      `Clear ${clearableCount} inbox ${clearableCount === 1 ? 'message' : 'messages'}?${keepNote} This can't be undone.`
    );
    if (ok) void clearInbox(scopeProjectId);
  };

  return (
    <section className="list-pane inbox-list-pane">
      <header className="list-header">
        <h2>Inbox</h2>
        <div className="list-header-actions">
          {/* Group-by toggle: per-project subgroups vs. a flat chronological
              stream. A persisted view preference (store.inboxGrouping). */}
          {showingFeed && (
            <div className="inbox-grouping-toggle" role="group" aria-label="Group inbox by">
              <button
                type="button"
                className={`icon-btn ${inboxGrouping === 'project' ? 'on' : ''}`}
                title="Group by project"
                aria-pressed={inboxGrouping === 'project'}
                onClick={() => setInboxGrouping('project')}
              >
                <FolderTree size={14} />
              </button>
              <button
                type="button"
                className={`icon-btn ${inboxGrouping === 'time' ? 'on' : ''}`}
                title="Sort by time (latest first)"
                aria-pressed={inboxGrouping === 'time'}
                onClick={() => setInboxGrouping('time')}
              >
                <Clock size={14} />
              </button>
            </div>
          )}
          {showingFeed && inboxGrouping === 'project' && subgroupKeys.length > 1 && (
            <button
              type="button"
              className="icon-btn inbox-collapse-all"
              title={anyCollapsed ? 'Expand all projects' : 'Collapse all projects'}
              onClick={() => setManyCollapsed(subgroupKeys, !anyCollapsed)}
            >
              {anyCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
          )}
          {!showingSaved && (
            <button
              type="button"
              className={`icon-btn inbox-unread-toggle ${unreadOnly ? 'on' : ''}`}
              title={unreadOnly ? 'Show all messages' : `Show only unread (${unreadCount})`}
              onClick={() => setUnreadOnly((v) => !v)}
              disabled={unreadCount === 0 && !unreadOnly}
            >
              <InboxIcon size={14} />
            </button>
          )}
          {!showingSaved && unreadCount > 0 && (
            <button
              type="button"
              className="icon-btn inbox-mark-read-all"
              title={`Mark ${unreadCount} as read`}
              onClick={() => markAllRead(entries.map((e) => e.id))}
            >
              <Check size={14} />
            </button>
          )}
          {!showingSaved && (
            <button
              type="button"
              className="icon-btn inbox-clear-all"
              title={
                clearableCount === 0
                  ? 'Nothing to clear (all kept or empty)'
                  : `Clear ${clearableCount} ${clearableCount === 1 ? 'message' : 'messages'}${keptCount > 0 ? ` (keeps ${keptCount})` : ''}`
              }
              onClick={onClear}
              disabled={clearableCount === 0}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>
      {/* Tab strip: the live feed vs. durable saved-for-later reports. */}
      <div className="inbox-tabs" role="tablist" aria-label="Inbox view">
        <button
          type="button"
          role="tab"
          aria-selected={inboxTab === 'feed'}
          className={`inbox-tab ${inboxTab === 'feed' ? 'active' : ''}`}
          onClick={() => setInboxTab('feed')}
        >
          <InboxIcon size={13} aria-hidden />
          <span>Feed</span>
          {unreadCount > 0 && <span className="inbox-tab-count">{unreadCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showingReports}
          className={`inbox-tab ${showingReports ? 'active' : ''}`}
          onClick={() => setInboxTab('reports')}
        >
          <FileText size={13} aria-hidden />
          <span>Reports</span>
          {reportCount > 0 && <span className="inbox-tab-count">{reportCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showingSaved}
          className={`inbox-tab ${showingSaved ? 'active' : ''}`}
          onClick={() => setInboxTab('saved')}
        >
          <Bookmark size={13} aria-hidden />
          <span>Saved reports</span>
          {savedCount > 0 && <span className="inbox-tab-count">{savedCount}</span>}
        </button>
      </div>
      <div className="inbox-filter-row">
        <Search size={12} className="inbox-filter-icon" aria-hidden />
        <input
          type="text"
          className="inbox-filter-input"
          placeholder={showingSaved ? 'Filter saved reports…' : showingReports ? 'Filter reports…' : 'Filter inbox…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="inbox-filter-clear"
            aria-label="Clear filter"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="list-body">
        {showingSaved ? (
          <SavedSidebar query={query} scopeProjectId={scopeProjectId} />
        ) : (
          // The AI summary card used to sit here, atop the list — it moved to the
          // detail column's Overview landing page (see `InboxView`/`InboxOverview`)
          // so the list column is a pure, scannable feed. The Reports tab reuses
          // the same sidebar with `reportsOnly` — flagged deliverables only.
          <InboxSidebar
            query={query}
            unreadOnly={unreadOnly}
            reportsOnly={showingReports}
            scopeProjectId={scopeProjectId}
            grouping={showingReports ? 'time' : inboxGrouping}
          />
        )}
      </div>
      <ListPaneResizer />
    </section>
  );
}
