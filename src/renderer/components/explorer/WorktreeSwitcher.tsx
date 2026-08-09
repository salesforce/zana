import React from 'react';
import { ChevronDown, GitFork, GitBranch, Check, Trash2 } from 'lucide-react';
import type { Project, Worktree, GitBranch as GitBranchInfo } from '@shared/types';

interface WorktreeSwitcherProps {
  project: Project;
  activeWorktreeLabel: string;
  worktreeMenu: boolean;
  worktrees: Worktree[];
  branches: GitBranchInfo[];
  viewRoot: string;
  worktreeByBranch: Map<string, Worktree>;
  onToggleMenu: () => void;
  onSelectWorktree: (path: string) => void;
  onRemoveWorktree: (wt: Worktree) => void;
}

export function WorktreeSwitcher({
  project,
  activeWorktreeLabel,
  worktreeMenu,
  worktrees,
  branches,
  viewRoot,
  worktreeByBranch,
  onToggleMenu,
  onSelectWorktree,
  onRemoveWorktree
}: WorktreeSwitcherProps) {
  return (
    <div className="explorer-worktree-switch">
      <button
        type="button"
        className={`explorer-tree-title explorer-worktree-btn ${worktreeMenu ? 'active' : ''}`}
        title={`${activeWorktreeLabel} · click to switch worktree / browse branches`}
        aria-haspopup="listbox"
        aria-expanded={worktreeMenu}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
      >
        <GitFork size={12} />
        <span className="explorer-worktree-name">{project.name}</span>
        <span className="explorer-worktree-tag">{activeWorktreeLabel}</span>
        <ChevronDown size={11} />
      </button>
      {worktreeMenu && (
        <div className="explorer-worktree-menu" role="listbox" onClick={(e) => e.stopPropagation()}>
          {worktrees.length > 1 && (
            <div className="explorer-worktree-section-label">Worktrees</div>
          )}
          {worktrees.length > 1 && worktrees.map((wt) => {
            const active = wt.path === viewRoot;
            const label = wt.isMain
              ? `${project.name} (main)`
              : wt.branch ?? (wt.detached ? 'detached' : wt.path.split('/').pop() ?? wt.path);
            return (
              <div key={wt.path} className={`explorer-worktree-row ${active ? 'active' : ''}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className="explorer-worktree-item"
                  title={wt.path}
                  onClick={() => { onSelectWorktree(wt.path); }}
                >
                  <span className="explorer-worktree-check">{active && <Check size={12} />}</span>
                  <span className="explorer-worktree-item-label">{label}</span>
                  {wt.branch && !wt.isMain && (
                    <span className="explorer-worktree-item-branch">{wt.branch}</span>
                  )}
                </button>
                {/* Manual prune — main only honors it for a checkout under
                    the app-managed worktree root, so offering it on the
                    main checkout would always fail; hide it there. */}
                {!wt.isMain && (
                  <button
                    type="button"
                    className="explorer-worktree-remove"
                    title="Remove this worktree"
                    aria-label={`Remove worktree ${wt.branch ?? wt.path}`}
                    onClick={(e) => { e.stopPropagation(); void onRemoveWorktree(wt); }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {branches.length > 0 && (
            <div className="explorer-worktree-section-label">Branches</div>
          )}
          {branches.map((br) => {
            const wt = worktreeByBranch.get(br.name);
            // A branch is "active" when we're viewing its worktree.
            const active = !!wt && wt.path === viewRoot;
            return (
              <button
                key={`br:${br.name}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`explorer-worktree-item ${active ? 'active' : ''}`}
                // Switch to the branch's worktree if it has one; a
                // branch without a checkout is display-only (no path to
                // browse) — clicking it just closes the menu.
                title={wt ? wt.path : `${br.name} · no worktree`}
                onClick={() => { if (wt) onSelectWorktree(wt.path); }}
                disabled={!wt}
              >
                <span className="explorer-worktree-check">{active && <Check size={12} />}</span>
                <span className="explorer-worktree-item-label">
                  <GitBranch size={11} style={{ verticalAlign: '-1px', marginRight: 4, opacity: 0.6 }} />
                  {br.name}
                </span>
                {wt ? (
                  <span className="explorer-worktree-item-branch" title={wt.path}>
                    {wt.isMain ? 'main worktree' : (wt.path.split('/').pop() ?? 'worktree')}
                  </span>
                ) : (
                  <span className="explorer-worktree-item-branch explorer-worktree-item-nowt">no worktree</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
