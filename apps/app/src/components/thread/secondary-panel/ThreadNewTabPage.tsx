import { useEffect, useMemo, useState } from 'react';
import { FileText, Globe, Puzzle, Search, Terminal } from 'lucide-react';
import { product } from '../../../lib/product-client.js';
import { hasDesktopBridge } from '../../../lib/app-surface.js';
import { useProjectTabModules } from '../../../modules/index.js';
import { useData } from '../../../store.js';
import { applyIfCurrent, loadWalkedFiles, matchNewTabFiles, newTabFileTitle } from './threadSecondaryPanelLogic.js';

export function ThreadNewTabView({
  query,
  onQueryChange,
  matches,
  desktop,
  modules,
  onOpenFile,
  onOpenBrowser,
  onStartTerminal,
  onOpenPlugin
}: {
  query: string;
  onQueryChange: (query: string) => void;
  matches: Array<{ path: string; rel?: string }>;
  desktop: boolean;
  modules: Array<{ id: string; title: string; projectTab?: { label?: string } }>;
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onStartTerminal: () => void;
  onOpenPlugin: (moduleId: string, title: string) => void;
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
          <button type="button" data-testid="thread-new-tab-terminal" onClick={onStartTerminal}>
            <Terminal size={14} /> Start terminal
          </button>
          {modules.map((mod) => (
            <button
              key={mod.id}
              type="button"
              onClick={() => onOpenPlugin(mod.id, mod.projectTab?.label ?? mod.title)}
            >
              <Puzzle size={14} /> {mod.projectTab?.label ?? mod.title}
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
  onStartTerminal,
  onOpenPlugin
}: {
  projectId: string | null;
  cwd: string | null;
  onOpenFile: (path: string, title: string) => void;
  onOpenBrowser: () => void;
  onStartTerminal: () => void;
  onOpenPlugin: (moduleId: string, title: string) => void;
}) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  const modules = useProjectTabModules();
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
      modules={modules}
      onOpenFile={onOpenFile}
      onOpenBrowser={onOpenBrowser}
      onStartTerminal={onStartTerminal}
      onOpenPlugin={onOpenPlugin}
    />
  );
}
