import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Menu, PanelLeft, PanelLeftClose, PanelsTopLeft, Pin, Plus, Search, X } from 'lucide-react';
import { ZanaIcon } from '../icons/ZanaIcon.js';
import { SidebarResizer } from '../SidebarResizer.js';
import { SidebarFooterSlot } from '../sidebar/SidebarFooterSlot.js';
import { useMobileNavDismiss } from '../mobile-nav-context.js';
import { MobileActionSheet } from '../MobilePageHeader.js';
import { useData } from '../../store.js';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { useEnsureThreads } from '../../hooks/useEnsureThreads.js';
import { useHosts, primaryHost } from '../../hooks/useHosts.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { getNewThreadRoutePath, getRootRoutePath, getThreadRoutePath, threadIdFromPath } from '../../lib/route-paths.js';
import { isBasicUiRouteSupported, setBasicUiMode, useBasicUi, type BasicUiMode } from '../../lib/basic-ui.js';
import { threadRailStatus } from '../fleet-item.js';
import { isUnreadThread } from '../../lib/unread-threads.js';
import { basicConversationRows, groupBasicConversationRows, type BasicConversationRow } from './basic-conversation-rows.js';
import { BasicConversationMenu, basicConversationViewSummary } from './BasicConversationMenu.js';
import { BasicConversationRowActions } from './BasicConversationRowActions.js';
import { archiveThreadWithoutConfirm } from '../threadCardActions.js';
import { product } from '../../lib/product-client.js';
import { useBasicConversationView } from './basic-conversation-view.js';
import { useArchivedConversations } from './useArchivedConversations.js';
import { listNavPanels, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../../plugins/PluginSlotBoundary.js';
import './basic-ui.css';

/** Conversations shown per page in the Basic sidebar. */
const PAGE = 30;

function newChatPath(scopedProjectId: string | null) {
  return scopedProjectId ? getNewThreadRoutePath(scopedProjectId) : getRootRoutePath();
}

function useInterfaceView() {
  const basic = useBasicUi();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const view = basic ? 'basic' : 'advanced';
  function changeView(next: BasicUiMode) {
    if (next === view) return;
    if (next === 'basic' && !isBasicUiRouteSupported(pathname)) navigate(newChatPath(getScopedProjectId()));
    setBasicUiMode(next);
  }
  return { view, changeView };
}

export function BasicUiModeSwitch() {
  const { view, changeView } = useInterfaceView();
  return <div className="basic-ui-mode-switch" role="group" aria-label="Interface view">
    <button type="button" data-testid="basic-ui-mode-basic" aria-label="Basic view" title="Basic view" aria-pressed={view === 'basic'} onClick={() => changeView('basic')}><ZanaIcon size={19} /></button>
    <button type="button" data-testid="basic-ui-mode-advanced" aria-label="Advanced view" title="Advanced view" aria-pressed={view === 'advanced'} onClick={() => changeView('advanced')}><PanelsTopLeft size={15} aria-hidden="true" /></button>
  </div>;
}

export function MobileInterfaceView({ onChange }: { onChange: () => void }) {
  const { view, changeView } = useInterfaceView();
  const [open, setOpen] = useState(false);
  const choose = (next: BasicUiMode) => {
    if (next === view) return;
    changeView(next);
    onChange();
  };
  return <>
    <button type="button" className="mobile-nav-notifications mobile-interface-view" aria-haspopup="dialog" aria-expanded={open}
      onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>
      <PanelsTopLeft size={18} aria-hidden="true" /> Interface view
      <span>{view === 'basic' ? 'Basic' : 'Advanced'}</span>
    </button>
    {open && <MobileActionSheet title="Interface view" onClose={() => setOpen(false)}>
      <button type="button" aria-pressed={view === 'basic'} onClick={() => choose('basic')}>
        <ZanaIcon size={18} /> Basic {view === 'basic' && <Check className="mobile-sheet-selection" size={18} aria-hidden="true" />}
      </button>
      <button type="button" aria-pressed={view === 'advanced'} onClick={() => choose('advanced')}>
        <PanelsTopLeft size={18} aria-hidden="true" /> Advanced {view === 'advanced' && <Check className="mobile-sheet-selection" size={18} aria-hidden="true" />}
      </button>
    </MobileActionSheet>}
  </>;
}

export function BasicShellHeading({ compact, collapsed, onToggleNavigation }: { compact: boolean; collapsed: boolean; onToggleNavigation(): void }) {
  const label = compact ? 'Open conversations' : collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return <div className="basic-ui-shell-heading">
    <div className="sidebar-trigger-overlay">
      <button type="button" className="sidebar-expand-control" aria-label={label} title={label}
        aria-expanded={!collapsed} aria-controls="basic-conversation-sidebar" onClick={onToggleNavigation}>
        {compact ? <Menu size={18} aria-hidden="true" /> : collapsed ? <PanelLeft size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}

function BasicConversationProjectGroup({ name, expanded, searching, onToggle, children }: {
  name: string; expanded: boolean; searching: boolean; onToggle(): void; children: ReactNode;
}) {
  const id = useId();
  return <section className="basic-ui-project-group" aria-labelledby={`${id}-name`}>
    <h3 id={`${id}-name`}>
      <button type="button" aria-expanded={expanded} aria-controls={id} disabled={searching} onClick={onToggle}>
        <ChevronRight size={13} aria-hidden="true" /><span title={name}>{name}</span>
      </button>
    </h3>
    <div id={id} hidden={!expanded}>{children}</div>
  </section>;
}

/** Reuses the existing live roster; no second history or execution source. */
export function BasicConversationSidebar({ hidden = false, onNavigate }: { hidden?: boolean; onNavigate(): void }) {
  const dismissMobileNav = useMobileNavDismiss();
  const threads = useThreads(s => s.threads);
  const loading = useThreads(s => s.loading);
  const projects = useData(s => s.projects);
  const hosts = useHosts();
  const primaryHostId = primaryHost(hosts)?.id;
  const location = useLocation();
  const pathname = useRef(location.pathname);
  pathname.current = location.pathname;
  const activeId = threadIdFromPath(location.pathname) ?? null;
  const scopedProjectId = getScopedProjectId();
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const panels = useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const eligibleProjectIds = useMemo(() => projects.filter(project =>
    !project.remote && (!project.hostId || project.hostId === primaryHostId)
    && (!scopedProjectId || project.id === scopedProjectId)).map(project => project.id),
  [projects, primaryHostId, scopedProjectId]);
  const [sectionThreads, setSectionThreads] = useState<ReadonlySet<readonly string[]>>(() => new Set());
  const registerThreads = useCallback((ids: readonly string[]) => {
    setSectionThreads(previous => new Set(previous).add(ids));
    return () => setSectionThreads(previous => {
      const next = new Set(previous);
      next.delete(ids);
      return next;
    });
  }, []);
  const openThread = (id: string) => {
    navigate(getThreadRoutePath(id, scopedProjectId));
    onNavigate();
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const conversationsId = useId();
  const conversationsCollapsed = useBasicConversationView(s => s.conversationsCollapsed);
  const toggleConversations = useBasicConversationView(s => s.toggleConversations);
  const [limit, setLimit] = useState(PAGE);
  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set());
  const updateQuery = (value: string) => {
    setQuery(value);
    setLimit(PAGE);
  };
  useEnsureThreads();
  const view = useBasicConversationView(s => s.view);
  const archived = useArchivedConversations(view.status !== 'active', scopedProjectId, primaryHostId);
  const archiveConversation = (thread: ThreadListItem) => archiveThreadWithoutConfirm(thread, {
    get pathname() { return pathname.current; },
    projectId: scopedProjectId,
    archive: product.threads.archive,
    remove: id => {
      const roster = useThreads.getState();
      // The archive response can arrive before the roster update that refreshes history.
      if (roster.threads.some(row => row.id === id)) archived.reload();
      roster.remove(id);
    },
    navigate
  }, newChatPath(scopedProjectId));
  const conversations = useMemo(() => {
    const represented = new Set([...sectionThreads].flat());
    const live = new Set(threads.map(thread => thread.id));
    // The live roster wins over a stale archived history row for the same thread.
    const rows = view.status === 'active' ? threads : [...threads, ...archived.rows.filter(row => !live.has(row.id))];
    return basicConversationRows(rows.filter(thread => !represented.has(thread.id)), projects, primaryHostId, query, scopedProjectId, view);
  }, [threads, archived.rows, projects, primaryHostId, query, scopedProjectId, sectionThreads, view]);
  const viewSummary = basicConversationViewSummary(view);
  const listLoading = loading || archived.loading;
  const visible = conversations.slice(0, limit);
  // Keep the selected conversation reachable even when it is older than the loaded page.
  const active = conversations.find(row => row.thread.id === activeId);
  if (active && !visible.includes(active)) visible.push(active);
  // Projects only label rows; a dedicated project window already names its one project.
  const showProject = !scopedProjectId;
  const grouped = view.layout === 'project';
  const searching = Boolean(query.trim());
  const conversationsExpanded = searching || !conversationsCollapsed;
  const toggleProject = (id: string) => setCollapsedProjects(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const renderRow = ({ thread, projectName, projectColor }: BasicConversationRow) => {
    const status = threadRailStatus(thread);
    const title = thread.title || 'New conversation';
    // A live status already signals new activity. The unread dot covers finished, unseen replies.
    const unread = status === 'Idle' && activeId !== thread.id && !thread.archivedAt && isUnreadThread(thread);
    const pinned = !thread.archivedAt && thread.pinnedAt != null;
    const liveStatus = status === 'Needs you' ? 'Needs review' : status === 'Idle' ? null : status;
    const label = [title, showProject ? projectName : null, pinned ? 'pinned' : null, thread.archivedAt ? 'Archived' : null, unread ? 'unread' : liveStatus].filter(Boolean).join(', ');
    const showProjectLabel = showProject && !grouped;
    const hasStatus = liveStatus || thread.archivedAt || unread;
    return <BasicConversationRowActions key={thread.id} thread={thread} title={title} onArchive={archiveConversation}>
      <Link className={`basic-ui-chat-row${activeId === thread.id ? ' is-active' : ''}${unread ? ' is-unread' : ''}`}
        to={getThreadRoutePath(thread.id, scopedProjectId)} onClick={onNavigate} aria-current={activeId === thread.id ? 'page' : undefined}
        aria-label={label} data-row-status={thread.archivedAt ? 'Archived' : unread ? 'Unread' : status}
        data-testid={`basic-chat-row-${thread.id}`}>
        <span className="basic-ui-chat-title">{pinned && <Pin size={12} aria-hidden="true" />}<span className="basic-ui-chat-name" title={title}>{title}</span></span>
        {(showProjectLabel || hasStatus) && <span className="basic-ui-chat-meta">
          {hasStatus && <span className="basic-ui-chat-statuses">
            {thread.archivedAt ? <span className="basic-ui-chat-status">Archived</span> : null}
            {unread && <span className="basic-ui-chat-status status-unread" data-testid={`basic-chat-unread-${thread.id}`}><span>Unread</span></span>}
            {liveStatus && <span className={`basic-ui-chat-status status-${status === 'Working' ? 'working' : 'attention'}`}>{liveStatus}</span>}
          </span>}
          {showProjectLabel && <span className="basic-ui-chat-project" title={projectName}
            style={{ '--basic-chat-project-color': projectColor } as CSSProperties}>{projectName}</span>}
        </span>}
      </Link>
    </BasicConversationRowActions>;
  };
  return <aside id="basic-conversation-sidebar" className="sidebar basic-ui-sidebar" data-testid="basic-ui-sidebar" aria-label="Conversations" hidden={hidden}>
    <Link className="basic-ui-new-chat" to={newChatPath(scopedProjectId)} onClick={onNavigate}><Plus size={17} aria-hidden="true" />New chat</Link>
    <div className="basic-ui-chat-controls">
      <div className="basic-ui-chat-search list-filter">
        <Search size={14} className="list-filter-icon" aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label="Search chats" placeholder="Search chats" value={query}
          onChange={event => updateQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); updateQuery(''); } }} />
        {query && <button type="button" className="list-filter-clear" aria-label="Clear chat search"
          onClick={() => { updateQuery(''); searchRef.current?.focus(); }}><X size={12} aria-hidden="true" /></button>}
      </div>
      {dismissMobileNav && <BasicConversationMenu compact />}
    </div>
    <div className="basic-ui-conversations">
      {panels.map(panel => {
        const Section = panel.experimental_basicSidebarSection;
        return Section && <PluginSlotBoundary key={`${panel.pluginId}:${panel.id}:${panel.generation}`}
          pluginId={panel.pluginId} generation={panel.generation}>
          <Section searchQuery={query} compact={Boolean(dismissMobileNav)} activeThreadId={activeId} projectIds={eligibleProjectIds}
            openThread={openThread} registerThreads={registerThreads} />
        </PluginSlotBoundary>;
      })}
      <nav aria-label="Recent conversations" aria-busy={listLoading}>
        <div className="basic-ui-conversations-heading">
          <h2><button type="button" className="basic-ui-conversations-toggle" aria-expanded={conversationsExpanded}
            aria-controls={conversationsId} disabled={searching} onClick={toggleConversations}>
            <ChevronRight size={14} aria-hidden="true" />Conversations
          </button></h2>
          {viewSummary && <span className="basic-ui-conversations-filter" data-testid="basic-conversation-filter">{viewSummary}</span>}
          {!dismissMobileNav && <BasicConversationMenu />}
        </div>
        <div id={conversationsId} className="basic-ui-conversation-list" hidden={!conversationsExpanded}>
          {conversationsExpanded && <>
            {archived.error && <p className="basic-ui-sidebar-empty" role="alert">Archived conversations could not be loaded.</p>}
            {grouped ? [...groupBasicConversationRows(visible)].map(([projectId, rows]) =>
              <BasicConversationProjectGroup key={projectId} name={rows[0].projectName} searching={searching}
                expanded={searching || !collapsedProjects.has(projectId)} onToggle={() => toggleProject(projectId)}>
                {rows.map(renderRow)}
              </BasicConversationProjectGroup>) : visible.map(renderRow)}
            {!conversations.length && <p className="basic-ui-sidebar-empty" role="status">{listLoading ? 'Loading conversations…' : searching || viewSummary ? 'No matching conversations.' : 'Your conversations will appear here.'}</p>}
            {conversations.length > visible.length && <button type="button" className="basic-ui-more-chats" onClick={() => setLimit(value => value + PAGE)}>Show more conversations</button>}
          </>}
        </div>
      </nav>
    </div>
    <SidebarFooterSlot />
    <p className="basic-ui-sidebar-note">More tools are available in Advanced.</p>
    {!dismissMobileNav && <SidebarResizer />}
  </aside>;
}

export function BasicUnsupportedDestination() {
  return <section className="basic-ui-unsupported" data-testid="basic-ui-unsupported" role="main" aria-labelledby="basic-ui-unsupported-title">
    <ZanaIcon size={36} />
    <h1 id="basic-ui-unsupported-title">Continue in Advanced</h1>
    <p>This page uses the full workspace. Your conversation and draft stay with you when you switch views.</p>
    <button type="button" className="basic-ui-open-advanced" onClick={() => setBasicUiMode('advanced')}>Open in Advanced<ArrowRight size={16} aria-hidden="true" /></button>
  </section>;
}
