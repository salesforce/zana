import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { FsEntry, GitFileCode } from '@zana-ai/zcc-domain/product';
import { FileIcon, FolderIcon } from '../FileIcon.js';
import { beginFsEntryDrag, consumeFsEntryDragClick, endFsEntryDrag } from '../../lib/fs-entry-drag.js';

interface TreeListProps {
  list: FsEntry[];
  depth: number;
  expanded: Map<string, boolean>;
  entries: Map<string, FsEntry[]>;
  loading: Set<string>;
  slow: Set<string>;
  errors: Map<string, string>;
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
  slow,
  errors,
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
              data-path={entry.path}
              aria-current={isActive ? 'true' : undefined}
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
                {isDir ? <FolderIcon open={isOpen} /> : <FileIcon name={entry.name} />}
              </span>
              <span className="tree-name" title={entry.name}>
                {entry.name}
              </span>
              {fileCode && <span className="tree-git-badge">{fileCode}</span>}
            </div>
            {isOpen && (
              children === undefined ? (
                errors.has(entry.path) ? (
                  <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                    <p role="alert">{errors.get(entry.path)}</p>
                  </div>
                ) : loading.has(entry.path) ? (
                  <div className="tree-loading" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
                    <span role="status">{slow.has(entry.path) ? 'Taking longer than expected' : 'Loading…'}</span>
                  </div>
                ) : null
              ) : (
                <TreeList
                  list={children}
                  depth={depth + 1}
                  expanded={expanded}
                  entries={entries}
                  loading={loading}
                  slow={slow}
                  errors={errors}
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
