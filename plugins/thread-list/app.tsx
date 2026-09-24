import React, { useState } from 'react';
import {
  definePluginApp, experimental_useSidebarThreads, experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit, type PluginThreadListProps, type PluginSidebarThread
} from '@zana-ai/zcc-plugin-sdk/app';

export function groupThreads(threads: PluginSidebarThread[], projects: { id: string; name: string }[], projectId: string | null, query: string) {
  const names = new Map(projects.map(project => [project.id, project.name]));
  const needle = query.trim().toLocaleLowerCase();
  const visible = threads.filter(thread => (!projectId || thread.projectId === projectId)
    && (!needle || [thread.title, names.get(thread.projectId), thread.branchName].some(value => value?.toLocaleLowerCase().includes(needle))));
  const pinned = visible.filter(thread => thread.pinnedAt != null).sort((a, b) =>
    (a.pinOrder ?? a.pinnedAt ?? 0) - (b.pinOrder ?? b.pinnedAt ?? 0) || a.id.localeCompare(b.id));
  const groups = new Map<string, { id: string; name: string; threads: PluginSidebarThread[] }>();
  for (const thread of visible.filter(thread => thread.pinnedAt == null)) {
    const group = groups.get(thread.projectId) ?? { id: thread.projectId, name: names.get(thread.projectId) ?? 'Unknown project', threads: [] };
    group.threads.push(thread);
    groups.set(thread.projectId, group);
  }
  return [
    ...(pinned.length ? [{ id: 'pinned', name: 'Pinned', threads: pinned }] : []),
    ...[...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  ];
}

function ThreadRow({ thread, active, onNavigate }: { thread: PluginSidebarThread; active: boolean; onNavigate(): void }) {
  const actions = experimental_useSidebarThreadActions();
  const split = experimental_useSidebarThreadSplit(thread.id);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unread = (thread.maxSeq ?? 0) > (thread.lastReadSeq ?? 0);
  const working = ['active', 'starting', 'stopping', 'provisioning', 'host-reconnecting'].includes(thread.status);
  const labels: Record<string, string> = { pending: 'Not started', idle: 'Idle', starting: 'Starting',
    active: 'Working', stopping: 'Stopping', provisioning: 'Starting', error: 'Error',
    'host-reconnecting': 'Reconnecting', 'waiting-for-host': 'Waiting for host' };
  const status = thread.hasPendingInteraction ? 'Needs you' : labels[thread.status] ?? thread.status;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); setMenu(false); setRenaming(false); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update thread'); }
    finally { setBusy(false); }
  };
  return <div data-thread-id={thread.id} onKeyDown={event => {
    if (event.key === 'Escape') { setMenu(false); setRenaming(false); }
  }}>
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button type="button" className={`agents-row is-thread ${active ? 'active' : ''}`}
        data-testid="thread-list-entry" data-kind="thread" data-status={thread.status}
        aria-current={active ? 'true' : undefined}
        {...split.splitProps}
        onContextMenu={event => { event.preventDefault(); setMenu(true); }}
        onClick={event => {
          if (split.consumeClick?.()) return;
          if ((event.metaKey || event.ctrlKey) && split.isAvailable) split.openInSplit?.();
          else actions.open(thread.id);
          onNavigate();
        }}>
        <span className="agents-row-text">
          <span className="agents-row-title-line">
            <span className={`tab-agent-dot agent-${thread.hasPendingInteraction ? 'blocked' : working ? 'working' : thread.status === 'error' ? 'blocked' : 'idle'}`} aria-hidden="true" />
            <span className="agents-row-title">{thread.title?.trim() || 'Untitled agent'}</span>
            {unread && <span className="thread-list-indicator is-unread" aria-label="Unread" />}
          </span>
          <span className="agents-row-meta"><span>{status}</span><span>{thread.providerId}</span>{thread.branchName && <span>{thread.branchName}</span>}</span>
        </span>
      </button>
      <button type="button" className="icon-btn" aria-label={`Actions for ${thread.title?.trim() || 'Untitled agent'}`}
        aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)}>⋯</button>
    </div>
    {menu && <div role="group" aria-label="Thread actions" style={{ padding: '4px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" disabled={busy} onClick={() => void run(() => actions.setPinned(thread.id, thread.pinnedAt == null))}>{thread.pinnedAt == null ? 'Pin' : 'Unpin'}</button>
      <button type="button" disabled={busy} onClick={() => void run(() => actions.setRead(thread.id, unread))}>{unread ? 'Mark read' : 'Mark unread'}</button>
      <button type="button" disabled={busy} onClick={() => { setTitle(thread.title ?? ''); setRenaming(true); }}>Rename</button>
      {split.isAvailable && <button type="button" onClick={() => { split.openInSplit?.(); setMenu(false); }}>Open in split</button>}
      {working && <button type="button" disabled={busy} onClick={() => void run(() => actions.stop(thread.id))}>Stop</button>}
      <button type="button" disabled={busy} onClick={() => void run(() => actions.closeFollowup(thread.id))}>Close with follow-up</button>
      <button type="button" disabled={busy} onClick={() => void run(() => actions.archive(thread.id))}>Archive</button>
      <button type="button" onClick={() => setMenu(false)}>Cancel</button>
    </div>}
    {renaming && <form style={{ padding: 8, display: 'flex', gap: 4 }} onSubmit={event => {
      event.preventDefault();
      if (title.trim()) void run(() => actions.rename(thread.id, title.trim()));
    }}>
      <input aria-label="Thread name" value={title} maxLength={200} autoFocus onChange={event => setTitle(event.target.value)} style={{ minWidth: 0, flex: 1 }} />
      <button type="submit" disabled={busy || !title.trim()}>Save</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function ThreadList(props: PluginThreadListProps) {
  const state = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const [query, setQuery] = useState('');
  const groups = groupThreads(state.threads, state.projects, props.activeProjectId, props.searchQuery || query);
  return <section aria-label="Threads" data-testid="plugin-thread-list" style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', gap: 6, padding: '6px 10px' }}>
      <input type="search" aria-label="Search threads" placeholder="Search threads" value={query}
        onChange={event => setQuery(event.target.value)} style={{ minWidth: 0, flex: 1 }} />
      <button type="button" className="icon-btn" aria-label="New thread" onClick={() => {
        actions.openNewThread(props.activeProjectId ? { projectId: props.activeProjectId } : undefined);
        props.onNavigate();
      }}>+</button>
    </div>
    {groups.map(group => <div className="agents-group" key={group.id}>
      <div className="agents-group-label"><span>{group.name}</span><span className="agents-group-count">{group.threads.length}</span></div>
      {group.threads.map(thread => <ThreadRow key={thread.id} thread={thread} active={thread.id === props.activeThreadId} onNavigate={props.onNavigate} />)}
    </div>)}
    {!groups.length && <p style={{ padding: '4px 12px', color: 'var(--text-muted)' }}>
      {state.status === 'loading' ? 'Loading threads…' : state.status === 'error' ? 'Could not load threads.' : query || props.searchQuery ? 'No matching threads' : 'No threads yet'}
    </p>}
  </section>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadList({ id: 'main', title: 'Thread list', description: 'Threads grouped by project, with pins and search.', component: ThreadList });
});
