import { useId, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronDown, FileText, FolderTree, Globe, Inbox, Puzzle, Search, Terminal } from 'lucide-react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { resolveIcon } from '../../../lib/resolveIcon.js';
import './thread-new-tab.css';
import { product } from '../../../lib/product-client.js';
import { hasDesktopBridge } from '../../../lib/app-surface.js';
import { useData } from '../../../store.js';
import { threadPanelActionMatchesScope, type PluginThreadPanelScope } from '@zana-ai/zcc-plugin-sdk';
import { listNewThreadPanelActions, listThreadPanelActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { applyIfCurrent, loadWalkedFiles, matchNewTabFiles, newTabFileTitle } from './threadSecondaryPanelLogic.js';
import {
  formatRecentRelativeTime,
  readThreadRecentItems,
  recentItemLabel,
  THREAD_RECENT_ITEMS_VISIBLE_LIMIT,
  type ThreadRecentItem
} from './threadRecentItems.js';

export type OpenPluginOptions = {
  actionId?: string;
  params?: JsonValue | null;
  layout?: 'padded' | 'flush';
};

function RecentItemIcon({ item }: { item: ThreadRecentItem }) {
  if (item.kind === 'browser') return <Globe size={14} />;
  if (item.kind === 'plugin') return <Puzzle size={14} />;
  return <FileText size={14} />;
}

export function ThreadNewTabView({
  query,
  onQueryChange,
  matches,
  desktop,
  actions,
  recents = [],
  onOpenFile,
  onOpenBrowser,
  onOpenExplorer,
  onOpenInbox,
  onStartTerminal,
  onOpenPlugin,
  onOpenRecent,
  allowSidecarTerminal = true,
  allowExplorer = true,
  allowInbox = true
}: {
  query: string;
  onQueryChange: (query: string) => void;
  matches: Array<{ path: string; rel?: string }>;
  desktop: boolean;
  actions: Array<{ pluginId: string; id: string; title: string; category?: string; icon?: string; layout?: 'padded' | 'flush' }>;
  recents?: readonly ThreadRecentItem[];
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onOpenExplorer?: () => void;
  onOpenInbox?: () => void;
  onStartTerminal?: () => void;
  onOpenPlugin: (moduleId: string, title: string, options?: OpenPluginOptions) => void;
  onOpenRecent?: (item: ThreadRecentItem) => void;
  allowSidecarTerminal?: boolean;
  allowExplorer?: boolean;
  allowInbox?: boolean;
}) {
  const now = Date.now();
  const categoryId = useId();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const search = query.trim().toLocaleLowerCase();
  const matchesSearch = (...terms: string[]) => !search ||
    search.split(/\s+/).every((term) => terms.some((value) => value.toLocaleLowerCase().includes(term)));
  const visibleRecents = recents.slice(0, THREAD_RECENT_ITEMS_VISIBLE_LIMIT);
  const essentials = [
    { id: 'browser', title: 'Open browser', icon: Globe, visible: desktop, run: onOpenBrowser },
    { id: 'explorer', title: 'Open Explorer', icon: FolderTree, visible: allowExplorer, run: onOpenExplorer },
    { id: 'inbox', title: 'Open Inbox', icon: Inbox, visible: allowInbox, run: onOpenInbox },
    { id: 'terminal', title: 'Start terminal', icon: Terminal, visible: allowSidecarTerminal, run: onStartTerminal }
  ].filter((action) => action.visible && matchesSearch(action.title, 'Essentials'));
  const categories = new Map<string, { title: string; actions: typeof actions }>();
  for (const action of actions) {
    const title = action.category?.trim() || 'Plugins';
    const key = title.toLocaleLowerCase();
    const group = categories.get(key) ?? { title, actions: [] };
    if (matchesSearch(action.title, title)) group.actions.push(action);
    categories.set(key, group);
  }
  for (const [key, group] of categories) {
    if (group.actions.length === 0) categories.delete(key);
  }
  const toggleCategory = (key: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <div className="thread-new-tab-page" data-testid="thread-new-tab-page">
      <label className="thread-new-tab-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search tools and files"
          aria-label="Search tools and files"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {!search && visibleRecents.length > 0 ? (
        <div className="thread-new-tab-recents" data-testid="thread-new-tab-recents">
          <h3>Recent</h3>
          <ul>
            {visibleRecents.map((item, index) => (
              <li key={`${item.kind}:${index}:${recentItemLabel(item)}`}>
                <button type="button" onClick={() => onOpenRecent?.(item)}>
                  <RecentItemIcon item={item} />
                  <span className="thread-info-truncate">{recentItemLabel(item)}</span>
                  <span className="thread-browser-recent-time">{formatRecentRelativeTime(item.openedAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {essentials.length > 0 ? (
        <section className="thread-new-tab-category" aria-label="Essentials">
          <h3 className="thread-new-tab-category-title">Essentials</h3>
          <div className="thread-new-tab-actions">
            {essentials.map(({ id, title, icon: Icon, run }) => (
              <button key={id} type="button" data-testid={`thread-new-tab-${id}`} onClick={run}>
                <Icon size={14} aria-hidden="true" />
                <span className="thread-info-truncate">{title}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {[...categories].map(([key, group], index) => {
        const expanded = Boolean(search) || !collapsed.has(key);
        const contentId = `${categoryId}-category-${index}`;
        return (
          <section className="thread-new-tab-category" aria-label={group.title} key={key}>
            <h3 className="thread-new-tab-category-title">
              <button
                type="button"
                className="thread-new-tab-category-toggle"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => toggleCategory(key)}
                disabled={Boolean(search)}
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span className="thread-info-truncate">{group.title}</span>
                <span className="thread-new-tab-category-count">{group.actions.length}</span>
              </button>
            </h3>
            <div id={contentId} className="thread-new-tab-actions" hidden={!expanded}>
              {group.actions.map((action) => {
                const Icon = action.icon ? resolveIcon(action.icon) : Puzzle;
                return (
                  <button
                    key={`${action.pluginId}/${action.id}`}
                    type="button"
                    data-testid={`thread-new-tab-plugin-${action.pluginId}-${action.id}`}
                    onClick={() => onOpenPlugin(action.pluginId, action.title, {
                      actionId: action.id,
                      layout: action.layout
                    })}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="thread-info-truncate">{action.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {search && matches.length > 0 ? (
        <section className="thread-new-tab-category" aria-label="Files">
          <h3 className="thread-new-tab-category-title">Files</h3>
          <ul className="thread-new-tab-files">
            {matches.map((file) => {
              const title = newTabFileTitle(file);
              return (
                <li key={file.path}>
                  <button type="button" onClick={() => onOpenFile(file.path, title)}>
                    <FileText size={14} aria-hidden="true" />
                    <span className="thread-info-truncate">{title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {search && matches.length === 0 && essentials.length === 0 && categories.size === 0 ? (
        <div className="thread-new-tab-empty" role="status">No matching tools or files</div>
      ) : null}
    </div>
  );
}

export function ThreadNewTabPage({
  projectId,
  cwd,
  threadId,
  onOpenFile,
  onOpenBrowser,
  onOpenExplorer,
  onOpenInbox,
  onStartTerminal,
  onOpenPlugin,
  onOpenRecent,
  allowSidecarTerminal = true,
  panelScope = 'thread'
}: {
  projectId: string | null;
  cwd: string | null;
  threadId?: string | null;
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onOpenExplorer?: () => void;
  onOpenInbox?: () => void;
  onStartTerminal?: () => void;
  onOpenPlugin: (moduleId: string, title: string, options?: OpenPluginOptions) => void;
  onOpenRecent?: (item: ThreadRecentItem) => void;
  allowSidecarTerminal?: boolean;
  panelScope?: PluginThreadPanelScope;
}) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  const threadActions = useSyncExternalStore(
    subscribePluginSlots,
    listThreadPanelActions,
    listThreadPanelActions
  );
  const composeActions = useSyncExternalStore(
    subscribePluginSlots,
    listNewThreadPanelActions,
    listNewThreadPanelActions
  );
  const actions = [
    ...threadActions.filter((action) => threadPanelActionMatchesScope(action, panelScope)),
    ...(panelScope === 'thread' ? composeActions : [])
  ];
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; rel?: string }>>([]);
  const desktop = hasDesktopBridge();
  const root = cwd || project?.path || null;
  const recents = threadId ? readThreadRecentItems(threadId) : [];

  useEffect(() => {
    let cancelled = false;
    void loadWalkedFiles(product.fs.walkFiles, root).then((list) => {
      applyIfCurrent(cancelled, list, setFiles);
    });
    return () => { cancelled = true; };
  }, [root]);

  const matches = useMemo(() => matchNewTabFiles(files, query), [files, query]);

  const handleOpenPlugin = (moduleId: string, title: string, options?: OpenPluginOptions) => {
    const actionId = options?.actionId;
    const threadAction = threadActions.find((row) => row.pluginId === moduleId && row.id === actionId);
    if (threadAction?.run) {
      void threadAction.run({
        threadId: threadId ?? '',
        openPanel: (openOptions) => {
          onOpenPlugin(moduleId, openOptions?.title ?? title, {
            actionId: threadAction.id,
            params: openOptions?.params ?? null,
            layout: threadAction.layout
          });
          return true;
        }
      });
      return;
    }
    const composeAction = composeActions.find((row) => row.pluginId === moduleId && row.id === actionId);
    if (composeAction?.run) {
      void composeAction.run({
        projectId,
        openPanel: (openOptions) => {
          onOpenPlugin(moduleId, openOptions?.title ?? title, {
            actionId: composeAction.id,
            params: openOptions?.params ?? null,
            layout: composeAction.layout
          });
          return true;
        }
      });
      return;
    }
    onOpenPlugin(moduleId, title, options);
  };

  return (
    <ThreadNewTabView
      query={query}
      onQueryChange={setQuery}
      matches={matches}
      desktop={desktop}
      recents={recents}
      actions={actions.map((action) => ({
        pluginId: action.pluginId,
        id: action.id,
        title: action.title,
        category: action.category,
        icon: action.icon,
        layout: action.layout
      }))}
      onOpenFile={onOpenFile}
      onOpenBrowser={onOpenBrowser}
      onOpenExplorer={onOpenExplorer}
      onOpenInbox={onOpenInbox}
      onStartTerminal={onStartTerminal}
      onOpenPlugin={handleOpenPlugin}
      onOpenRecent={onOpenRecent}
      allowSidecarTerminal={allowSidecarTerminal}
      allowExplorer={Boolean(projectId)}
      allowInbox={Boolean(projectId)}
    />
  );
}
