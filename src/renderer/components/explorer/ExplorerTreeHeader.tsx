import React from 'react';
import { RefreshCw, GitBranch, ListTree, FilePlus, FolderPlus } from 'lucide-react';
import type { Project } from '@shared/types';

interface ExplorerTreeHeaderProps {
  project: Project;
  isRemote: boolean;
  treeMode: 'files' | 'changes';
  changedFilesCount: number;
  onTreeModeToggle: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}

export function ExplorerTreeHeader({
  project,
  isRemote,
  treeMode,
  changedFilesCount,
  onTreeModeToggle,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  children
}: ExplorerTreeHeaderProps) {
  return (
    <div className="explorer-tree-header">
      {children ?? (
        <span className="explorer-tree-title" title={project.path}>
          {project.name}
        </span>
      )}
      {/* The git changes/diff toggle is local-only (no local git for a
          remote project). Create affordances work over ssh too. */}
      {!isRemote && (
        <button
          type="button"
          className={`opener-btn ${treeMode === 'changes' ? 'active' : ''}`}
          title={
            treeMode === 'changes'
              ? 'Show all files'
              : changedFilesCount > 0
                ? `Show changes (${changedFilesCount})`
                : 'No changes'
          }
          aria-pressed={treeMode === 'changes'}
          onClick={onTreeModeToggle}
        >
          {treeMode === 'changes' ? <ListTree size={13} /> : <GitBranch size={13} />}
          {treeMode !== 'changes' && changedFilesCount > 0 && (
            <span className="opener-btn-badge">{changedFilesCount}</span>
          )}
        </button>
      )}
      <button
        type="button"
        className="opener-btn"
        title="New file in project root"
        onClick={onCreateFile}
      >
        <FilePlus size={13} />
      </button>
      <button
        type="button"
        className="opener-btn"
        title="New folder in project root"
        onClick={onCreateFolder}
      >
        <FolderPlus size={13} />
      </button>
      <button type="button" className="opener-btn" title="Refresh" onClick={onRefresh}>
        <RefreshCw size={13} />
      </button>
    </div>
  );
}
