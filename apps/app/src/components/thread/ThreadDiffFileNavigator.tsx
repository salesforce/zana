import { useMemo, useState, type ReactNode } from 'react';
import { Atom, Braces, ChevronRight, FileCode2, FileText, Hash, List, FolderTree, Search } from 'lucide-react';
import { formatDiffCount } from '@zana-ai/zcc-thread-view';
import { changeKindLetter, formatDiffCardLabel, type DiffChangeKind } from './thread-diff.js';

type NavigatorFile = {
  path: string;
  previousPath?: string | null;
  changeKind: DiffChangeKind;
  additions: number;
  deletions: number;
};

type Directory = { path: string; name: string; directories: Map<string, Directory>; files: NavigatorFile[] };

function buildDirectories(files: NavigatorFile[]): Directory {
  const root: Directory = { path: '', name: '', directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let directory = root;
    for (const name of parts.slice(0, -1)) {
      let child = directory.directories.get(name);
      if (!child) {
        child = { path: `${directory.path}${name}/`, name, directories: new Map(), files: [] };
        directory.directories.set(name, child);
      }
      directory = child;
    }
    directory.files.push(file);
  }
  return root;
}

export function DiffFileIcon({ path }: { path: string }) {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'tsx' || extension === 'jsx') return <Atom className="thread-diff-file-icon is-react" size={15} aria-hidden="true" />;
  if (extension === 'ts' || extension === 'js') return <span className="thread-diff-file-icon is-script" aria-hidden="true">{extension.toUpperCase()}</span>;
  if (extension === 'css' || extension === 'scss') return <Hash className="thread-diff-file-icon is-style" size={15} aria-hidden="true" />;
  if (extension === 'json') return <Braces className="thread-diff-file-icon is-data" size={15} aria-hidden="true" />;
  const Icon = extension === 'md' || extension === 'txt' ? FileText : FileCode2;
  return <Icon className="thread-diff-file-icon" size={15} aria-hidden="true" />;
}

export function ThreadDiffFileNavigator({ files, total, truncated, query, onQueryChange, activePath, onSelect }: {
  files: NavigatorFile[];
  total: number;
  truncated: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const [list, setList] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildDirectories(files), [files]);

  const fileRow = (file: NavigatorFile, depth: number) => (
    <li key={file.path}>
      <button type="button" className={`thread-diff-nav-file${activePath === file.path ? ' is-active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }} title={formatDiffCardLabel(file)}
        aria-label={`View diff for ${file.path}`} aria-current={activePath === file.path ? 'true' : undefined}
        onClick={() => onSelect(file.path)}>
        <DiffFileIcon path={file.path} />
        <span className="thread-diff-nav-name">{list ? file.path : file.path.split('/').pop()}</span>
        <span className="thread-diff-stat">
          {file.additions > 0 && <span className="is-add">+{formatDiffCount(file.additions)}</span>}
          {file.deletions > 0 && <span className="is-del">-{formatDiffCount(file.deletions)}</span>}
        </span>
        <span className={`thread-diff-nav-status is-${file.changeKind}`} title={file.changeKind.replace('_', ' ')}>{changeKindLetter(file.changeKind)}</span>
      </button>
    </li>
  );

  const directoryRows = (directory: Directory, depth: number): ReactNode => (
    <>
      {[...directory.directories.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => {
        let compact = child;
        let label = child.name;
        while (compact.directories.size === 1 && compact.files.length === 0) {
          compact = [...compact.directories.values()][0]!;
          label += ` / ${compact.name}`;
        }
        const directoryPath = compact.path;
        const open = !!query.trim() || !collapsed.has(directoryPath);
        return (
          <li key={directoryPath}>
            <button type="button" className="thread-diff-nav-directory" style={{ paddingLeft: 10 + depth * 14 }}
              aria-expanded={open} title={directoryPath} onClick={() => setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(directoryPath)) next.delete(directoryPath); else next.add(directoryPath);
                return next;
              })}>
              <ChevronRight size={14} className={open ? 'is-open' : ''} aria-hidden="true" />
              <span className="thread-diff-nav-name">{label}</span>
            </button>
            {open && <ul>{directoryRows(compact, depth + 1)}</ul>}
          </li>
        );
      })}
      {[...directory.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => fileRow(file, depth))}
    </>
  );

  return (
    <nav className="thread-diff-navigator" aria-label="Changed files" data-testid="thread-diff-navigator">
      <div className="thread-diff-nav-tools">
        <label className="thread-diff-toolbar-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files" aria-label="Search changed files" />
        </label>
        <button type="button" className="thread-diff-toolbar-btn" title={list ? 'View as tree' : 'View as list'}
          aria-label={list ? 'View as tree' : 'View as list'} onClick={() => setList(!list)}>
          {list ? <FolderTree size={16} /> : <List size={16} />}
        </button>
      </div>
      <p className="thread-diff-nav-count">{query.trim() ? `${files.length} of ` : ''}{total}{truncated ? '+' : ''} {total === 1 ? 'file' : 'files'} changed</p>
      {files.length ? <ul className="thread-diff-nav-entries">{list ? files.map((file) => fileRow(file, 0)) : directoryRows(tree, 0)}</ul>
        : <p className="thread-diff-nav-count">No matching files.</p>}
    </nav>
  );
}
