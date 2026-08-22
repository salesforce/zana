import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Check, Trash2, ChevronsDownUp, ChevronsUpDown, InboxIcon, Bookmark, FolderTree, Clock, FileText, MoreHorizontal } from 'lucide-react';
import { useInbox, useInboxRead, useInboxKeep, useInboxCollapsed, useInboxScopeProjectId, clearInbox, useSaved, useUi, INBOX_LIST_MIN } from '../../store.js';
import { groupByBucketThenProject, subGroupKey } from '@zana-ai/zcc-domain/inbox-grouping';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { InboxSidebar } from '../InboxSidebar.js';
import { SavedSidebar } from '../SavedSidebar.js';

function tabAriaLabel(name: string, count: number, countKind?: string): string {
  if (count <= 0) return name;
  return countKind ? `${name}, ${count} ${countKind}` : `${name}, ${count}`;
}

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
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
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
  const showCollapseAll = showingFeed && inboxGrouping === 'project' && subgroupKeys.length > 1;
  const collapseTitle = anyCollapsed ? 'Expand all projects' : 'Collapse all projects';
  const unreadTitle = unreadOnly ? 'Show all messages' : `Show only unread (${unreadCount})`;
  const markReadTitle = `Mark ${unreadCount} as read`;
  const clearTitle =
    clearableCount === 0
      ? 'Nothing to clear (all kept or empty)'
      : `Clear ${clearableCount} ${clearableCount === 1 ? 'message' : 'messages'}${keptCount > 0 ? ` (keeps ${keptCount})` : ''}`;
  const feedAria = tabAriaLabel('Feed', unreadCount, 'unread');
  const reportsAria = tabAriaLabel('Reports', reportCount);
  const savedAria = tabAriaLabel('Saved', savedCount);

  const onClear = () => {
    if (clearableCount === 0) return;
    const keepNote = keptCount > 0 ? ` ${keptCount} kept ${keptCount === 1 ? 'entry' : 'entries'} will remain.` : '';
    const ok = window.confirm(
      `Clear ${clearableCount} inbox ${clearableCount === 1 ? 'message' : 'messages'}?${keepNote} This can't be undone.`
    );
    if (ok) void clearInbox(scopeProjectId);
  };

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (actionsMenuRef.current?.contains(e.target as Node)) return;
      setActionsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [actionsMenuOpen]);

  useEffect(() => {
    if (showingSaved) setActionsMenuOpen(false);
  }, [showingSaved]);

  return (
    <section className="list-pane inbox-list-pane">
      {/* Tab strip: the live feed vs. durable saved-for-later reports. Feed
          actions always live in the ⋯ menu beside the tabs — never as a
          second icon row — so a wide pane stays one chrome strip. */}
      <div className="inbox-tabs-row">
        <div className="inbox-tabs" role="tablist" aria-label="Inbox view">
          <button
            type="button"
            role="tab"
            aria-selected={inboxTab === 'feed'}
            aria-label={feedAria}
            title={feedAria}
            className={`inbox-tab ${inboxTab === 'feed' ? 'active' : ''}`}
            onClick={() => setInboxTab('feed')}
          >
            <InboxIcon size={13} aria-hidden />
            <span className="inbox-tab-label">Feed</span>
            {unreadCount > 0 && <span className="inbox-tab-count">{unreadCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showingReports}
            aria-label={reportsAria}
            title={reportsAria}
            className={`inbox-tab ${showingReports ? 'active' : ''}`}
            onClick={() => setInboxTab('reports')}
          >
            <FileText size={13} aria-hidden />
            <span className="inbox-tab-label">Reports</span>
            {reportCount > 0 && <span className="inbox-tab-count">{reportCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showingSaved}
            aria-label={savedAria}
            title={savedAria}
            className={`inbox-tab ${showingSaved ? 'active' : ''}`}
            onClick={() => setInboxTab('saved')}
          >
            <Bookmark size={13} aria-hidden />
            <span className="inbox-tab-label">Saved</span>
            {savedCount > 0 && <span className="inbox-tab-count">{savedCount}</span>}
          </button>
        </div>
        {!showingSaved && (
          <div className="inbox-actions-more" ref={actionsMenuRef}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Inbox actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              title="Inbox actions"
              onClick={() => setActionsMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={14} />
            </button>
            {actionsMenuOpen && (
              <div className="inbox-actions-menu" role="menu" aria-label="Inbox actions">
                {showingFeed && (
                  <>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={inboxGrouping === 'project'}
                      className="inbox-actions-menu-item"
                      onClick={() => {
                        setInboxGrouping('project');
                        setActionsMenuOpen(false);
                      }}
                    >
                      <FolderTree size={14} aria-hidden />
                      <span>Group by project</span>
                      {inboxGrouping === 'project' && <Check size={14} aria-hidden />}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={inboxGrouping === 'time'}
                      className="inbox-actions-menu-item"
                      onClick={() => {
                        setInboxGrouping('time');
                        setActionsMenuOpen(false);
                      }}
                    >
                      <Clock size={14} aria-hidden />
                      <span>Sort by time</span>
                      {inboxGrouping === 'time' && <Check size={14} aria-hidden />}
                    </button>
                  </>
                )}
                {showCollapseAll && (
                  <button
                    type="button"
                    role="menuitem"
                    className="inbox-actions-menu-item"
                    onClick={() => {
                      setManyCollapsed(subgroupKeys, !anyCollapsed);
                      setActionsMenuOpen(false);
                    }}
                  >
                    {anyCollapsed ? <ChevronsUpDown size={14} aria-hidden /> : <ChevronsDownUp size={14} aria-hidden />}
                    <span>{collapseTitle}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  className="inbox-actions-menu-item"
                  aria-checked={unreadOnly}
                  disabled={unreadCount === 0 && !unreadOnly}
                  onClick={() => {
                    setUnreadOnly((v) => !v);
                    setActionsMenuOpen(false);
                  }}
                >
                  <InboxIcon size={14} aria-hidden />
                  <span>{unreadTitle}</span>
                </button>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    className="inbox-actions-menu-item"
                    onClick={() => {
                      markAllRead(entries.map((e) => e.id));
                      setActionsMenuOpen(false);
                    }}
                  >
                    <Check size={14} aria-hidden />
                    <span>{markReadTitle}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="inbox-actions-menu-item inbox-actions-menu-item--danger"
                  disabled={clearableCount === 0}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    onClear();
                  }}
                >
                  <Trash2 size={14} aria-hidden />
                  <span>{clearableCount === 0 ? 'Clear inbox' : clearTitle}</span>
                </button>
              </div>
            )}
          </div>
        )}
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
      <ListPaneResizer minWidth={INBOX_LIST_MIN} resetWidth={INBOX_LIST_MIN} />
    </section>
  );
}
