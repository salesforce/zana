import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, Folder, Menu, PanelLeft, PanelLeftClose, PanelsTopLeft, Plus, Search, X } from 'lucide-react';
import { ZanaIcon } from '../icons/ZanaIcon.js';
import { SidebarResizer } from '../SidebarResizer.js';
import { useMobileNavDismiss } from '../mobile-nav-context.js';
import { useData } from '../../store.js';
import { useThreads } from '../../thread-store.js';
import { useEnsureThreads } from '../../hooks/useEnsureThreads.js';
import { useHosts, primaryHost } from '../../hooks/useHosts.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { getNewThreadRoutePath, getRootRoutePath, getThreadRoutePath, threadIdFromPath } from '../../lib/route-paths.js';
import { setBasicUiMode, useBasicUi } from '../../lib/basic-ui.js';
import { threadRailStatus } from '../fleet-item.js';
import { basicConversationGroups, type BasicConversationGroup } from './basic-conversation-groups.js';
import { listNavPanels, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../../plugins/PluginSlotBoundary.js';
import './basic-ui.css';

export function BasicUiModeSwitch() {
  const basic = useBasicUi();
  return <div className="basic-ui-mode-switch" role="group" aria-label="Interface view">
    <button type="button" data-testid="basic-ui-mode-basic" aria-label="Basic view" title="Basic view" aria-pressed={basic} onClick={() => setBasicUiMode('basic')}><ZanaIcon size={19} /></button>
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

function BasicProjectConversations({ group, activeId, collapsed, onToggle, scopedProjectId, onNavigate }: {
  group: BasicConversationGroup;
  activeId: string | null;
  collapsed: boolean;
  onToggle(): void;
  scopedProjectId: string | null;
  onNavigate(): void;
}) {
  const contentId = useId();
  const [limit, setLimit] = useState(10);
  const active = group.threads.find(thread => thread.id === activeId);
  const expanded = !collapsed;
  const rows = group.threads.slice(0, limit);
  // Keep the selected conversation reachable even when it is older than the first page.
  if (active && !rows.includes(active)) rows.push(active);
  return <section className="basic-ui-project-group" aria-label={group.name} data-testid={`basic-project-group-${group.projectId}`}>
    <h3><button type="button" className="basic-ui-project-toggle" aria-label={group.name}
      aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
      {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
      <Folder size={15} aria-hidden="true" />
      <span className="basic-ui-project-name" title={group.name}>{group.name}</span>
      <span className="basic-ui-project-count" aria-hidden="true">{group.threads.length}</span>
    </button></h3>
    <div id={contentId} className="basic-ui-project-chats" hidden={!expanded}>
      {rows.map(thread => {
        const status = threadRailStatus(thread);
        return <Link key={thread.id} className={`basic-ui-chat-row${activeId === thread.id ? ' is-active' : ''}`}
          to={getThreadRoutePath(thread.id, scopedProjectId)} onClick={onNavigate} aria-current={activeId === thread.id ? 'page' : undefined}>
          <span className="basic-ui-chat-name" title={thread.title || 'New conversation'}>{thread.title || 'New conversation'}</span>
          {status !== 'Idle' && <span className={`basic-ui-chat-status status-${status === 'Working' ? 'working' : 'attention'}`}>{status === 'Needs you' ? 'Needs review' : status}</span>}
        </Link>;
      })}
      {group.threads.length > rows.length && <button type="button" className="basic-ui-more-chats"
        aria-label={`Show more conversations in ${group.name}`} onClick={() => setLimit(value => value + 50)}>Show more conversations</button>}
    </div>
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
  const [limit, setLimit] = useState(50);
  const [collapsedProjects, setCollapsedProjects] = useState(() => new Set<string>());
  const [collapsedSearchProjects, setCollapsedSearchProjects] = useState(() => new Set<string>());
  const updateQuery = (value: string) => {
    setQuery(value);
    setLimit(50);
    setCollapsedSearchProjects(new Set());
  };
  const searching = Boolean(query.trim());
  const activeProjectId = threads.find(thread => thread.id === activeId)?.projectId;
  useEffect(() => {
    setCollapsedProjects(previous => {
      if (!activeProjectId || !previous.has(activeProjectId)) return previous;
      const next = new Set(previous);
      next.delete(activeProjectId);
      return next;
    });
  }, [activeId, activeProjectId]);
  useEnsureThreads();
  const groups = useMemo(() => {
    const represented = new Set([...sectionThreads].flat());
    return basicConversationGroups(threads.filter(thread => !represented.has(thread.id)), projects, primaryHostId, query, scopedProjectId);
  }, [threads, projects, primaryHostId, query, scopedProjectId, sectionThreads]);
  const visibleGroups = groups.slice(0, limit);
  const activeGroup = groups.find(group => group.threads.some(thread => thread.id === activeId));
  if (activeGroup && !visibleGroups.includes(activeGroup)) visibleGroups.push(activeGroup);
  const newChatPath = scopedProjectId ? getNewThreadRoutePath(scopedProjectId) : getRootRoutePath();
  return <aside id="basic-conversation-sidebar" className="sidebar basic-ui-sidebar" data-testid="basic-ui-sidebar" aria-label="Conversations" hidden={hidden}>
    <Link className="basic-ui-new-chat" to={newChatPath} onClick={onNavigate}><Plus size={17} aria-hidden="true" />New chat</Link>
    <div className="basic-ui-chat-search list-filter">
      <Search size={14} className="list-filter-icon" aria-hidden="true" />
      <input ref={searchRef} type="search" aria-label="Search chats" placeholder="Search chats" value={query}
        onChange={event => updateQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); updateQuery(''); } }} />
      {query && <button type="button" className="list-filter-clear" aria-label="Clear chat search"
        onClick={() => { updateQuery(''); searchRef.current?.focus(); }}><X size={12} aria-hidden="true" /></button>}
    </div>
    <nav className="basic-ui-conversations" aria-label="Recent conversations" aria-busy={loading}>
      {panels.map(panel => {
        const Section = panel.experimental_basicSidebarSection;
        return Section && <PluginSlotBoundary key={`${panel.pluginId}:${panel.id}:${panel.generation}`}
          pluginId={panel.pluginId} generation={panel.generation}>
          <Section searchQuery={query} activeThreadId={activeId} projectIds={eligibleProjectIds}
            openThread={openThread} registerThreads={registerThreads} />
        </PluginSlotBoundary>;
      })}
      <h2>Conversations</h2>
      {visibleGroups.map(group => <BasicProjectConversations key={group.projectId} group={group} activeId={activeId}
        collapsed={(searching ? collapsedSearchProjects : collapsedProjects).has(group.projectId)} onToggle={() => (searching ? setCollapsedSearchProjects : setCollapsedProjects)(previous => {
          const next = new Set(previous);
          if (next.has(group.projectId)) next.delete(group.projectId);
          else next.add(group.projectId);
          return next;
        })} scopedProjectId={scopedProjectId} onNavigate={onNavigate} />)}
      {!groups.length && <p className="basic-ui-sidebar-empty" role="status">{loading ? 'Loading conversations…' : query.trim() ? 'No matching conversations.' : 'Your conversations will appear here.'}</p>}
      {groups.length > visibleGroups.length && <button type="button" className="basic-ui-more-chats" onClick={() => setLimit(value => value + 50)}>Show more projects</button>}
    </nav>
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
