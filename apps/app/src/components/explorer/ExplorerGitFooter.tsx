import React from 'react';
import { GitBranch } from 'lucide-react';
import type { GitStatus } from '@zana-ai/zcc-domain/product';

interface ExplorerGitFooterProps {
  gitStatus: GitStatus;
  worktreeMenu: boolean;
  onToggleMenu: () => void;
  menu?: React.ReactNode;
}

export function ExplorerGitFooter({
  gitStatus,
  worktreeMenu,
  onToggleMenu,
  menu
}: ExplorerGitFooterProps) {
  const label = gitStatus.detached ? 'detached' : gitStatus.branch;
  if (!label) return null;

  const dirtyHint = gitStatus.dirty
    ? 'Working tree has uncommitted changes'
    : 'Working tree clean';

  return (
    <div className="explorer-git-footer">
      <button
        type="button"
        className={`explorer-git-footer-btn ${gitStatus.dirty ? 'dirty' : ''} ${worktreeMenu ? 'active' : ''}`}
        data-testid="explorer-git-footer"
        title={`${dirtyHint} · click to switch worktree / browse branches`}
        aria-haspopup="listbox"
        aria-expanded={worktreeMenu}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
      >
        <GitBranch size={12} />
        <span className="explorer-git-footer-branch">{label}</span>
        {gitStatus.ahead > 0 && (
          <span className="explorer-git-footer-ab">↑{gitStatus.ahead}</span>
        )}
        {gitStatus.behind > 0 && (
          <span className="explorer-git-footer-ab">↓{gitStatus.behind}</span>
        )}
        {gitStatus.dirty && (
          <span className="explorer-git-footer-dot" aria-hidden="true">●</span>
        )}
      </button>
      {menu}
    </div>
  );
}
