import React from 'react';
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-react';
import type { FsEntry, GitFileCode } from '@zana-ai/zcc-domain/product';
import { beginFsEntryDrag, consumeFsEntryDragClick, endFsEntryDrag } from '../../lib/fs-entry-drag.js';

interface TreeListProps {
  list: FsEntry[];
  depth: number;
  expanded: Map<string, boolean>;
  entries: Map<string, FsEntry[]>;
  loading: Set<string>;
  activeFile: string | undefined;
  gitFiles: Record<string, GitFileCode> | undefined;
  dirtyDirs: Set<string>;
  onToggleDir: (entry: FsEntry) => void;
  onFileClick: (entry: FsEntry) => void;
  onContext: (e: React.MouseEvent, entry: FsEntry) => void;
}

const GIT_TITLES: Record<GitFileCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  '?': 'Untracked',
  C: 'Conflict'
};

export const TreeList = React.memo(function TreeList({
  list,
  depth,
  expanded,
  entries,
  loading,
  activeFile,
  gitFiles,
  dirtyDirs,
  onToggleDir,
  onFileClick,
  onContext
}: TreeListProps) {
  return (
    <>
      {list.map((entry) => {
        const isDir = entry.kind === 'dir';
        const isOpen = isDir && expanded.get(entry.path) === true;
        const children = isOpen ? entries.get(entry.path) : undefined;
        const isActive = !isDir && activeFile === entry.path;
        const fileCode = !isDir && gitFiles ? gitFiles[entry.path] : undefined;
        const dirHasChanges = isDir && dirtyDirs.has(entry.path);
        const gitClass = fileCode
          ? `git-${fileCode === '?' ? 'untracked' : fileCode.toLowerCase()}`
          : dirHasChanges
            ? 'git-dir-dirty'
            : '';
        const gitTitle = fileCode
          ? GIT_TITLES[fileCode]
          : dirHasChanges
            ? 'Contains changes'
            : '';
        return (
          <div key={entry.path}>
            <div
              className={`tree-row ${isDir ? 'dir' : 'file'} ${isActive ? 'active' : ''} ${gitClass}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => {
                if (consumeFsEntryDragClick()) return;
                if (isDir) onToggleDir(entry);
                else onFileClick(entry);
              }}
              onContextMenu={(e) => onContext(e, entry)}
              draggable
              onDragStart={(e) => beginFsEntryDrag(e.dataTransfer, {
                path: entry.path,
                kind: entry.kind
              })}
              onDragEnd={endFsEntryDrag}
              title={gitTitle || undefined}
            >
              <span className={`tree-chevron ${isDir ? '' : 'empty'}`}>
                {isDir && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              </span>
              <span className="tree-icon">
                {isDir ? <Folder size={13} /> : <FileText size={13} />}
              </span>
              <span className="tree-name" title={entry.name}>
                {entry.name}
              </span>
              {fileCode && <span className="tree-git-badge">{fileCode}</span>}
            </div>
            {isOpen && (
              children === undefined ? (
                loading.has(entry.path) ? (
                  <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                    Loading…
                  </div>
                ) : null
              ) : (
                <TreeList
                  list={children}
                  depth={depth + 1}
                  expanded={expanded}
                  entries={entries}
                  loading={loading}
                  activeFile={activeFile}
                  gitFiles={gitFiles}
                  dirtyDirs={dirtyDirs}
                  onToggleDir={onToggleDir}
                  onFileClick={onFileClick}
                  onContext={onContext}
                />
              )
            )}
          </div>
        );
      })}
    </>
  );
});
