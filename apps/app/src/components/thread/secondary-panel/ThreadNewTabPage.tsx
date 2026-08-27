import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { FileText, FolderTree, Globe, Puzzle, Search, Terminal } from 'lucide-react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { hasDesktopBridge } from '../../../lib/app-surface.js';
import { useData } from '../../../store.js';
import { listNewThreadPanelActions, listThreadPanelActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { applyIfCurrent, loadWalkedFiles, matchNewTabFiles, newTabFileTitle } from './threadSecondaryPanelLogic.js';

export type OpenPluginOptions = {
  actionId?: string;
  params?: JsonValue | null;
  layout?: 'padded' | 'flush';
};

export function ThreadNewTabView({
  query,
  onQueryChange,
  matches,
  desktop,
  actions,
  onOpenFile,
  onOpenBrowser,
  onOpenExplorer,
  onStartTerminal,
  onOpenPlugin,
  allowSidecarTerminal = true,
  allowExplorer = true
}: {
  query: string;
  onQueryChange: (query: string) => void;
  matches: Array<{ path: string; rel?: string }>;
  desktop: boolean;
  actions: Array<{ pluginId: string; id: string; title: string; layout?: 'padded' | 'flush' }>;
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onOpenExplorer?: () => void;
  onStartTerminal?: () => void;
  onOpenPlugin: (moduleId: string, title: string, options?: OpenPluginOptions) => void;
  allowSidecarTerminal?: boolean;
  allowExplorer?: boolean;
}) {
  return (
    <div className="thread-new-tab-page" data-testid="thread-new-tab-page">
      <label className="thread-new-tab-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Search files"
          aria-label="Search files"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {query.trim() ? (
        <ul className="thread-new-tab-files">
          {matches.map((file) => {
            const title = newTabFileTitle(file);
            return (
              <li key={file.path}>
                <button type="button" onClick={() => onOpenFile(file.path, title)}>
                  <FileText size={14} />
                  <span className="thread-info-truncate">{title}</span>
                </button>
              </li>
            );
          })}
          {matches.length === 0 ? <li className="thread-new-tab-empty">No matching files</li> : null}
        </ul>
      ) : (
        <div className="thread-new-tab-actions">
          {desktop ? (
            <button type="button" data-testid="thread-new-tab-browser" onClick={onOpenBrowser}>
              <Globe size={14} /> Open browser
            </button>
          ) : null}
          {allowExplorer ? (
            <button type="button" data-testid="thread-new-tab-explorer" onClick={onOpenExplorer}>
              <FolderTree size={14} /> Open Explorer
            </button>
          ) : null}
          {allowSidecarTerminal ? (
            <button type="button" data-testid="thread-new-tab-terminal" onClick={onStartTerminal}>
              <Terminal size={14} /> Start terminal
            </button>
          ) : null}
          {actions.map((action) => (
            <button
              key={`${action.pluginId}/${action.id}`}
              type="button"
              data-testid={`thread-new-tab-plugin-${action.pluginId}-${action.id}`}
              onClick={() =>
                onOpenPlugin(action.pluginId, action.title, {
                  actionId: action.id,
                  layout: action.layout
                })
              }
            >
              <Puzzle size={14} /> {action.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThreadNewTabPage({
  projectId,
  cwd,
  onOpenFile,
  onOpenBrowser,
  onOpenExplorer,
  onStartTerminal,
  onOpenPlugin,
  allowSidecarTerminal = true
}: {
  projectId: string | null;
  cwd: string | null;
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onOpenExplorer?: () => void;
  onStartTerminal?: () => void;
  onOpenPlugin: (moduleId: string, title: string, options?: OpenPluginOptions) => void;
  allowSidecarTerminal?: boolean;
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
  const actions = [...threadActions, ...composeActions];
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; rel?: string }>>([]);
  const desktop = hasDesktopBridge();
  const root = cwd || project?.path || null;

  useEffect(() => {
    let cancelled = false;
    void loadWalkedFiles(product.fs.walkFiles, root).then((list) => {
      applyIfCurrent(cancelled, list, setFiles);
    });
    return () => { cancelled = true; };
  }, [root]);

  const matches = useMemo(() => matchNewTabFiles(files, query), [files, query]);

  return (
    <ThreadNewTabView
      query={query}
      onQueryChange={setQuery}
      matches={matches}
      desktop={desktop}
      actions={actions.map((action) => ({
        pluginId: action.pluginId,
        id: action.id,
        title: action.title,
        layout: action.layout
      }))}
      onOpenFile={onOpenFile}
      onOpenBrowser={onOpenBrowser}
      onOpenExplorer={onOpenExplorer}
      onStartTerminal={onStartTerminal}
      onOpenPlugin={onOpenPlugin}
      allowSidecarTerminal={allowSidecarTerminal}
      allowExplorer={Boolean(projectId)}
    />
  );
}
