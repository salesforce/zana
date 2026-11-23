import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Menu, PanelLeft, PanelLeftClose, PanelsTopLeft, Plus, Search, X } from 'lucide-react';
import { ZanaIcon } from '../icons/ZanaIcon.js';
import { SidebarResizer } from '../SidebarResizer.js';
import { SidebarFooterSlot } from '../sidebar/SidebarFooterSlot.js';
import { useMobileNavDismiss } from '../mobile-nav-context.js';
import { useData } from '../../store.js';
import { useThreads } from '../../thread-store.js';
import { useEnsureThreads } from '../../hooks/useEnsureThreads.js';
import { useHosts, primaryHost } from '../../hooks/useHosts.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { getNewThreadRoutePath, getRootRoutePath, getThreadRoutePath, threadIdFromPath } from '../../lib/route-paths.js';
import { isBasicUiRouteSupported, setBasicUiMode, useBasicUi } from '../../lib/basic-ui.js';
import { threadRailStatus } from '../fleet-item.js';
import { basicConversationRows } from './basic-conversation-rows.js';
import { BasicConversationMenu, basicConversationViewSummary } from './BasicConversationMenu.js';
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

export function BasicUiModeSwitch() {
  const basic = useBasicUi();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  function enterBasic() {
    if (basic) return;
    if (!isBasicUiRouteSupported(pathname)) navigate(newChatPath(getScopedProjectId()));
    setBasicUiMode('basic');
  }
  return <div className="basic-ui-mode-switch" role="group" aria-label="Interface view">
    <button type="button" data-testid="basic-ui-mode-basic" aria-label="Basic view" title="Basic view" aria-pressed={basic} onClick={enterBasic}><ZanaIcon size={19} /></button>
    <button type="button" data-testid="basic-ui-mode-advanced" aria-label="Advanced view" title="Advanced view" aria-pressed={!basic} onClick={() => setBasicUiMode('advanced')}><PanelsTopLeft size={15} aria-hidden="true" /></button>
  </div>;
}

export function BasicShellHeading({ compact, collapsed, onToggleNavigation }: { compact: boolean; collapsed: boolean; onToggleNavigation(): void }) {
  const label = compact ? 'Open conversations' : collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return <div className="basic-ui-shell-heading">
    <div className={compact ? undefined : 'sidebar-trigger-overlay'}>
      <button type="button" className="sidebar-expand-control" aria-label={label} title={label}
        aria-expanded={!collapsed} aria-controls="basic-conversation-sidebar" onClick={onToggleNavigation}>
        {compact ? <Menu size={18} aria-hidden="true" /> : collapsed ? <PanelLeft size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
    </div>
  </div>;
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
  const [limit, setLimit] = useState(PAGE);
  const updateQuery = (value: string) => {
    setQuery(value);
    setLimit(PAGE);
  };
  useEnsureThreads();
  const view = useBasicConversationView(s => s.view);
  const archived = useArchivedConversations(view.status !== 'active', scopedProjectId, primaryHostId);
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
  return <aside id="basic-conversation-sidebar" className="sidebar basic-ui-sidebar" data-testid="basic-ui-sidebar" aria-label="Conversations" hidden={hidden}>
    <Link className="basic-ui-new-chat" to={newChatPath(scopedProjectId)} onClick={onNavigate}><Plus size={17} aria-hidden="true" />New chat</Link>
    <div className="basic-ui-chat-search list-filter">
      <Search size={14} className="list-filter-icon" aria-hidden="true" />
      <input ref={searchRef} type="search" aria-label="Search chats" placeholder="Search chats" value={query}
        onChange={event => updateQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); updateQuery(''); } }} />
      {query && <button type="button" className="list-filter-clear" aria-label="Clear chat search"
        onClick={() => { updateQuery(''); searchRef.current?.focus(); }}><X size={12} aria-hidden="true" /></button>}
    </div>
    <nav className="basic-ui-conversations" aria-label="Recent conversations" aria-busy={listLoading}>
      {panels.map(panel => {
        const Section = panel.experimental_basicSidebarSection;
        return Section && <PluginSlotBoundary key={`${panel.pluginId}:${panel.id}:${panel.generation}`}
          pluginId={panel.pluginId} generation={panel.generation}>
          <Section searchQuery={query} activeThreadId={activeId} projectIds={eligibleProjectIds}
            openThread={openThread} registerThreads={registerThreads} />
        </PluginSlotBoundary>;
      })}
      <div className="basic-ui-conversations-heading">
        <h2>Conversations</h2>
        {viewSummary && <span className="basic-ui-conversations-filter" data-testid="basic-conversation-filter">{viewSummary}</span>}
        <BasicConversationMenu />
      </div>
      {archived.error && <p className="basic-ui-sidebar-empty" role="alert">Archived conversations could not be loaded.</p>}
      {visible.map(({ thread, projectName }) => {
        const status = threadRailStatus(thread);
        const title = thread.title || 'New conversation';
        return <Link key={thread.id} className={`basic-ui-chat-row${activeId === thread.id ? ' is-active' : ''}`}
          to={getThreadRoutePath(thread.id, scopedProjectId)} onClick={onNavigate} aria-current={activeId === thread.id ? 'page' : undefined}
          aria-label={showProject ? `${title}, ${projectName}` : title} data-testid={`basic-chat-row-${thread.id}`}>
          <span className="basic-ui-chat-name" title={title}>{title}</span>
          {(showProject || status !== 'Idle' || thread.archivedAt) && <span className="basic-ui-chat-meta">
            {showProject && <span className="basic-ui-chat-project" title={projectName}>{projectName}</span>}
            {thread.archivedAt ? <span className="basic-ui-chat-status">Archived</span> : null}
            {status !== 'Idle' && <span className={`basic-ui-chat-status status-${status === 'Working' ? 'working' : 'attention'}`}>{status === 'Needs you' ? 'Needs review' : status}</span>}
          </span>}
        </Link>;
      })}
      {!conversations.length && <p className="basic-ui-sidebar-empty" role="status">{listLoading ? 'Loading conversations…' : query.trim() || viewSummary ? 'No matching conversations.' : 'Your conversations will appear here.'}</p>}
      {conversations.length > visible.length && <button type="button" className="basic-ui-more-chats" onClick={() => setLimit(value => value + PAGE)}>Show more conversations</button>}
    </nav>
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
