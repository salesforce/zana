import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, Trash2, ChevronsDownUp, ChevronsUpDown, InboxIcon, Bookmark, FolderTree, Clock, MoreHorizontal, MailCheck, LayoutDashboard, LayoutList, PanelsTopLeft, RefreshCw } from 'lucide-react';
import { useData, useInbox, useInboxRead, useInboxKeep, useInboxCollapsed, useInboxScopeProjectId, clearInbox, reloadInbox, useSaved, useUi, INBOX_LIST_MIN } from '../../store.js';
import { groupByBucketThenProject, subGroupKey } from '@zana-ai/zcc-domain/inbox-grouping';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { InboxSidebar } from '../InboxSidebar.js';
import { useCompactLayout } from '../../hooks/useCompactLayout.js';
import { MobilePageHeader } from '../MobilePageHeader.js';
import { SavedSidebar } from '../SavedSidebar.js';
import { InboxPendingThreads, useInboxPendingThreads } from '../InboxPendingThreads.js';

function tabAriaLabel(name: string, count: number, countKind?: string): string {
  if (count <= 0) return name;
  return countKind ? `${name}, ${count} ${countKind}` : `${name}, ${count}`;
}

export function InboxPane({ onShowOverview, mobileHeaderEnabled = true, fullWidth = false, onChangeLayout, toolbarLayout }: {
  onShowOverview?: () => void;
  mobileHeaderEnabled?: boolean;
  fullWidth?: boolean;
  onChangeLayout?: (wide: boolean) => void;
  toolbarLayout?: 'split' | 'wide';
} = {}) {
  const compact = useCompactLayout();
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
  const [searchByTab, setSearchByTab] = useState({
    feed: { open: false, query: '' },
    saved: { open: false, query: '' }
  });
  const { open: searchOpen, query } = searchByTab[inboxTab];
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  useEffect(() => {
    if (compact && searchOpen && focusSearch.current) searchRef.current?.focus();
    focusSearch.current = false;
  }, [compact, searchOpen]);
  function setQuery(query: string) {
    setSearchByTab((previous) => ({
      ...previous,
      [inboxTab]: { ...previous[inboxTab], query }
    }));
  }
  function toggleSearch() {
    focusSearch.current = !searchOpen;
    setSearchByTab((previous) => ({
      ...previous,
      [inboxTab]: { open: !searchOpen, query: '' }
    }));
  }
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reportsOnly, setReportsOnly] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
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
  const projects = useData((s) => s.projects);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const pendingThreads = useInboxPendingThreads(!!onChangeLayout, scopeProjectId, query, projectNames);
  const showPendingThreads = showingFeed && !unreadOnly && !reportsOnly && pendingThreads.length > 0;
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
  const showGroupActions = showingFeed && !fullWidth && !needsActionOnly;
  const showCollapseAll = showGroupActions && inboxGrouping === 'project' && subgroupKeys.length > 1;
  const collapseTitle = anyCollapsed ? 'Expand all projects' : 'Collapse all projects';
  const unreadChipLabel = `Unread${unreadCount > 0 ? ` ${unreadCount}` : ''}`;
  const reportsChipLabel = `Reports${reportCount > 0 ? ` ${reportCount}` : ''}`;
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

  const closeActionsMenu = () => {
    setActionsMenuOpen(false);
    actionsTriggerRef.current?.focus();
  };

  function onActionsMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopPropagation();
      closeActionsMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!buttons.length) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const panel = actionsPanelRef.current;
    const first = panel?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (first ?? panel)?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (actionsMenuRef.current?.contains(target) || actionsPanelRef.current?.contains(target)) {
        return;
      }
      setActionsMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
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
    {showGroupActions && (
      <div role={compact ? "radiogroup" : "group"} aria-label="Inbox grouping">
        <button
          type="button"
          role={compact ? "radio" : "menuitemradio"}
          tabIndex={compact ? undefined : -1}
          aria-checked={inboxGrouping === 'project'}
          onClick={() => {
            setInboxGrouping('project');
            closeActionsMenu();
          }}
        >
          <FolderTree size={13} aria-hidden />
          Group by project
          {inboxGrouping === 'project' && <Check size={13} className="inbox-menu-check" aria-hidden />}
        </button>
        <button
          type="button"
          role={compact ? "radio" : "menuitemradio"}
          tabIndex={compact ? undefined : -1}
          aria-checked={inboxGrouping === 'time'}
          onClick={() => {
            setInboxGrouping('time');
            closeActionsMenu();
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
        tabIndex={compact ? undefined : -1}
        onClick={() => {
          setManyCollapsed(subgroupKeys, !anyCollapsed);
          closeActionsMenu();
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
        tabIndex={compact ? undefined : -1}
        onClick={() => {
          markAllRead(entries.map((e) => e.id));
          closeActionsMenu();
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
      tabIndex={compact ? undefined : -1}
      className="tab-context-danger"
      disabled={clearableCount === 0}
      title={clearTitle}
      onClick={() => {
        closeActionsMenu();
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
      title={unreadOnly ? 'Clear unread filter' : 'Filter to unread messages'}
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
      title={reportsOnly ? 'Clear reports filter' : 'Filter to reports'}
      disabled={reportCount === 0 && !reportsOnly}
      onClick={() => setReportsOnly((v) => !v)}
    >
      Reports{reportCount > 0 ? ` ${reportCount}` : ''}
    </button>
  );

  const toolbar = (
    <div className="inbox-pane-toolbar">
      <MobilePageHeader title="Inbox" enabled={mobileHeaderEnabled}
        primary={<button type="button" className="icon-btn" aria-label={searchOpen ? 'Close inbox search' : 'Search inbox'} aria-expanded={searchOpen} onClick={toggleSearch}>{searchOpen ? <X size={20} /> : <Search size={20} />}</button>}>
        {showingFeed && <>
          {onShowOverview && <button type="button" onClick={onShowOverview}><LayoutDashboard size={18} /> Inbox overview</button>}
          {reportsFilter}
          {feedActions}
        </>}
        {showingSaved && <button type="button" onClick={() => setInboxTab('feed')}><InboxIcon size={18} /> Open feed</button>}
      </MobilePageHeader>
      {(toolbarLayout === 'wide' || fullWidth) && !compact && (
        <header className="inbox-feed-heading">
          <h1>Inbox</h1>
          <p>{scopeProjectId ? projectNames.get(scopeProjectId) : 'Updates and requests across your projects'}</p>
        </header>
      )}
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
        {showingFeed && onChangeLayout && (
          <div className="inbox-layout-controls" role="group" aria-label="Inbox layout">
            <button type="button" aria-label="Full-width" title="Full-width" aria-pressed={fullWidth} onClick={() => onChangeLayout(true)}>
              <LayoutList size={14} aria-hidden />
              <span>Full-width</span>
            </button>
            <button type="button" aria-label="Split view" title="Split view" aria-pressed={!fullWidth} onClick={() => onChangeLayout(false)}>
              <PanelsTopLeft size={14} aria-hidden />
              <span>Split view</span>
            </button>
          </div>
        )}
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
              aria-disabled={refreshing}
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
                      tabIndex={-1}
                      aria-label="Inbox actions"
                      style={actionsMenuPos}
                      onMouseDown={(e) => e.stopPropagation()}
                      onKeyDown={onActionsMenuKeyDown}
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
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>}
        {!showingSaved && (
          <>
            {unreadFilter}
            {!compact && reportsFilter}
            {onChangeLayout && (
              <button
                type="button"
                className="inbox-filter-chip inbox-filter-chip--attention"
                aria-pressed={needsActionOnly}
                onClick={() => setNeedsActionOnly((value) => !value)}
              >
                Needs action
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {toolbarLayout && toolbar}
      <section className="list-pane inbox-list-pane">
        {!toolbarLayout && toolbar}
        <div className="list-body">
          {showingSaved ? (
            <SavedSidebar query={query} scopeProjectId={scopeProjectId} />
          ) : (
            <>
              {showPendingThreads && <InboxPendingThreads threads={pendingThreads} projectNames={projectNames} scope={scopeProjectId} />}
              <InboxSidebar
                query={query}
                unreadOnly={unreadOnly}
                reportsOnly={reportsOnly}
                needsActionOnly={needsActionOnly}
                fullWidth={fullWidth}
                hideEmpty={showPendingThreads}
                scopeProjectId={scopeProjectId}
                grouping={inboxGrouping}
              />
            </>
          )}
        </div>
        {!fullWidth && <ListPaneResizer minWidth={INBOX_LIST_MIN} resetWidth={INBOX_LIST_MIN} />}
      </section>
    </>
  );
}
