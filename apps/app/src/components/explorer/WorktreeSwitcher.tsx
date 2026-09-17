import React from 'react';
import { GitBranch, Check, Trash2 } from 'lucide-react';
import type { Project, Worktree, GitBranch as GitBranchInfo } from '@zana-ai/zcc-domain/product';

export interface WorktreeMenuProps {
  project: Project;
  worktrees: Worktree[];
  branches: GitBranchInfo[];
  viewRoot: string;
  worktreeByBranch: Map<string, Worktree>;
  onSelectWorktree: (path: string) => void;
  onRemoveWorktree: (wt: Worktree) => void;
  /** Footer trigger opens the list upward so it isn't clipped by the tree. */
  placement?: 'below' | 'above';
}

export function WorktreeMenu({
  project,
  worktrees,
  branches,
  viewRoot,
  worktreeByBranch,
  onSelectWorktree,
  onRemoveWorktree,
  placement = 'below'
}: WorktreeMenuProps) {
  return (
    <div
      className={`explorer-worktree-menu ${placement === 'above' ? 'is-above' : ''}`}
      role="listbox"
      data-testid="explorer-worktree-menu"
      onClick={(e) => e.stopPropagation()}
    >
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
  );
}
