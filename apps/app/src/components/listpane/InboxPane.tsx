import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, Trash2, ChevronsDownUp, ChevronsUpDown, InboxIcon, Bookmark, FolderTree, Clock, MoreHorizontal, MailCheck, LayoutDashboard, RefreshCw } from 'lucide-react';
import { useInbox, useInboxRead, useInboxKeep, useInboxCollapsed, useInboxScopeProjectId, clearInbox, reloadInbox, useSaved, useUi, INBOX_LIST_MIN } from '../../store.js';
import { groupByBucketThenProject, subGroupKey } from '@zana-ai/zcc-domain/inbox-grouping';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { InboxSidebar } from '../InboxSidebar.js';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { MobilePageHeader } from '../MobilePageHeader.js';
import { SavedSidebar } from '../SavedSidebar.js';

function tabAriaLabel(name: string, count: number, countKind?: string): string {
  if (count <= 0) return name;
  return countKind ? `${name}, ${count} ${countKind}` : `${name}, ${count}`;
}

export function InboxPane({ onShowOverview, mobileHeaderEnabled = true }: { onShowOverview?: () => void; mobileHeaderEnabled?: boolean } = {}) {
  const compact = useCompactLayout();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (compact && searchOpen) searchRef.current?.focus(); }, [compact, searchOpen]);
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
  const [reportsOnly, setReportsOnly] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionsMenuPos, setActionsMenuPos] = useState<CSSProperties>({});
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsPanelRef = useRef<HTMLDivElement>(null);
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
  // The live feed (not Saved) — toolbar group/collapse/mark-read/clear apply here.
  const showingFeed = !showingSaved;
  const unreadCount = entries.reduce((n, e) => (readIds[e.id] ? n : n + 1), 0);
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
  const unreadChipLabel = unreadOnly ? 'Show all messages' : `Unread${unreadCount > 0 ? ` ${unreadCount}` : ''}`;
  const reportsChipLabel = reportsOnly ? 'Show all messages' : `Reports${reportCount > 0 ? ` ${reportCount}` : ''}`;
  const markReadTitle = `Mark ${unreadCount} as read`;
  const clearTitle =
    clearableCount === 0
      ? 'Nothing to clear (all kept or empty)'
      : `Clear ${clearableCount} ${clearableCount === 1 ? 'message' : 'messages'}${keptCount > 0 ? ` (keeps ${keptCount})` : ''}`;
  const feedAria = tabAriaLabel('Feed', unreadCount, 'unread');
  const savedAria = tabAriaLabel('Saved', savedCount);

  const onClear = () => {
    if (clearableCount === 0) return;
    const keepNote = keptCount > 0 ? ` ${keptCount} kept ${keptCount === 1 ? 'entry' : 'entries'} will remain.` : '';
    const ok = window.confirm(
      `Clear ${clearableCount} inbox ${clearableCount === 1 ? 'message' : 'messages'}?${keepNote} This can't be undone.`
    );
    if (ok) void clearInbox(scopeProjectId);
  };

  const onRefresh = () => {
    setActionsMenuOpen(false);
    if (refreshing) return;
    setRefreshing(true);
    void reloadInbox({ notify: true }).finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (actionsMenuRef.current?.contains(target) || actionsPanelRef.current?.contains(target)) {
        return;
      }
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

  const feedActions = <>
    {compact && showingFeed && (
      <button type="button" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw size={13} className={refreshing ? 'spin' : undefined} aria-hidden />
        Refresh inbox
      </button>
    )}
    {showingFeed && (
      <div role={compact ? "radiogroup" : "group"} aria-label="Inbox grouping">
        <button
          type="button"
          role={compact ? "radio" : "menuitemradio"}
          aria-checked={inboxGrouping === 'project'}
          onClick={() => {
            setInboxGrouping('project');
            setActionsMenuOpen(false);
          }}
        >
          <FolderTree size={13} aria-hidden />
          Group by project
          {inboxGrouping === 'project' && <Check size={13} className="inbox-menu-check" aria-hidden />}
        </button>
        <button
          type="button"
          role={compact ? "radio" : "menuitemradio"}
          aria-checked={inboxGrouping === 'time'}
          onClick={() => {
            setInboxGrouping('time');
            setActionsMenuOpen(false);
          }}
        >
          <Clock size={13} aria-hidden />
          Group by time
          {inboxGrouping === 'time' && <Check size={13} className="inbox-menu-check" aria-hidden />}
        </button>
      </div>
    )}
    {(showCollapseAll || unreadCount > 0) && <div className="tab-context-sep" />}
    {showCollapseAll && (
      <button
        type="button"
        role={compact ? undefined : "menuitem"}
        onClick={() => {
          setManyCollapsed(subgroupKeys, !anyCollapsed);
          setActionsMenuOpen(false);
        }}
      >
        {anyCollapsed ? <ChevronsUpDown size={13} aria-hidden /> : <ChevronsDownUp size={13} aria-hidden />}
        {collapseTitle}
      </button>
    )}
    {unreadCount > 0 && (
      <button
        type="button"
        role={compact ? undefined : "menuitem"}
        onClick={() => {
          markAllRead(entries.map((e) => e.id));
          setActionsMenuOpen(false);
        }}
      >
        <MailCheck size={13} aria-hidden />
        {markReadTitle}
      </button>
    )}
    <div className="tab-context-sep" />
    <button
      type="button"
      role={compact ? undefined : "menuitem"}
      className="tab-context-danger"
      disabled={clearableCount === 0}
      title={clearTitle}
      onClick={() => {
        setActionsMenuOpen(false);
        onClear();
      }}
    >
      <Trash2 size={13} aria-hidden />
      Clear inbox
    </button>
  </>;
  const unreadFilter = (
    <button
      type="button"
      className={`inbox-filter-chip ${unreadOnly ? 'on' : ''}`}
      aria-pressed={unreadOnly}
      aria-label={unreadChipLabel}
      title={unreadChipLabel}
      disabled={unreadCount === 0 && !unreadOnly}
      onClick={() => setUnreadOnly((v) => !v)}
    >
      Unread{unreadCount > 0 ? ` ${unreadCount}` : ''}
    </button>
  );
  const reportsFilter = (
    <button
      type="button"
      className={`inbox-filter-chip ${reportsOnly ? 'on' : ''}`}
      aria-pressed={reportsOnly}
      aria-label={reportsChipLabel}
      title={reportsChipLabel}
      disabled={reportCount === 0 && !reportsOnly}
      onClick={() => setReportsOnly((v) => !v)}
    >
      Reports{reportCount > 0 ? ` ${reportCount}` : ''}
    </button>
  );

  return (
    <section className="list-pane inbox-list-pane">
      <MobilePageHeader title="Inbox" enabled={mobileHeaderEnabled}
        primary={<button type="button" className="icon-btn" aria-label={searchOpen ? 'Close inbox search' : 'Search inbox'} aria-expanded={searchOpen} onClick={() => { setSearchOpen((open) => !open); if (searchOpen) setQuery(''); }}>{searchOpen ? <X size={20} /> : <Search size={20} />}</button>}>
        {showingFeed && <>
          {onShowOverview && <button type="button" onClick={onShowOverview}><LayoutDashboard size={18} /> Inbox overview</button>}
          {reportsFilter}
          {feedActions}
        </>}
        {showingSaved && <button type="button" onClick={() => setInboxTab('feed')}><InboxIcon size={18} /> Open feed</button>}
      </MobilePageHeader>
      {/* Tab strip: live feed vs durable saved reports. Feed actions live in
          the ⋯ menu; Unread / Reports are filter chips under the search. */}
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
        {compact && !showingSaved && unreadFilter}
        {!compact && !showingSaved && onShowOverview && (
          <button type="button" className="inbox-mobile-overview" aria-label="Inbox overview" title="Inbox overview" onClick={onShowOverview}>
            <LayoutDashboard size={16} aria-hidden />
          </button>
        )}
        {!compact && !showingSaved && (
          <div className="inbox-actions-more" ref={actionsMenuRef}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Refresh inbox"
              title="Refresh inbox"
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : undefined} aria-hidden />
            </button>
            <button
              type="button"
              ref={actionsTriggerRef}
              className="icon-btn"
              aria-label="Inbox actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              title="Inbox actions"
              onClick={() => {
                const rect = actionsTriggerRef.current?.getBoundingClientRect();
                if (rect) {
                  setActionsMenuPos({
                    top: rect.bottom + 4,
                    right: Math.max(8, window.innerWidth - rect.right)
                  });
                }
                setActionsMenuOpen((open) => !open);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            {actionsMenuOpen &&
              (typeof document === 'undefined'
                ? null
                : createPortal(
                    <div
                      ref={actionsPanelRef}
                      className="tab-context-menu"
                      role="menu"
                      aria-label="Inbox actions"
                      style={actionsMenuPos}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {feedActions}
                    </div>,
                    document.body
                  ))}
          </div>
        )}
      </div>
      <div className="inbox-filter-row">
        {(!compact || searchOpen) && <div className="inbox-filter-search">
          <Search size={12} className="inbox-filter-icon" aria-hidden />
          <input
            type="text"
            ref={searchRef}
            className="inbox-filter-input"
            aria-label={showingSaved ? 'Search saved reports' : 'Search inbox'}
            placeholder={showingSaved ? 'Filter saved reports…' : reportsOnly ? 'Filter reports…' : 'Filter inbox…'}
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
        </div>}
        {!showingSaved && (
          <>
            {!compact && unreadFilter}
            {!compact && reportsFilter}
          </>
        )}
      </div>
      <div className="list-body">
        {showingSaved ? (
          <SavedSidebar query={query} scopeProjectId={scopeProjectId} />
        ) : (
          // The AI summary card sits on the detail landing (see InboxOverview)
          // so the list column stays a scannable feed. Reports is a filter chip,
          // not a tab — same sidebar, `reportsOnly` on.
          <InboxSidebar
            query={query}
            unreadOnly={unreadOnly}
            reportsOnly={reportsOnly}
            scopeProjectId={scopeProjectId}
            grouping={inboxGrouping}
          />
        )}
      </div>
      <ListPaneResizer minWidth={INBOX_LIST_MIN} resetWidth={INBOX_LIST_MIN} />
    </section>
  );
}
