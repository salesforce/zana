import type { SquadLaunchLocation } from '@zana-ai/zcc-domain/launch-options';

interface LaunchLocationPreview {
  branch?: string | null | undefined;
  path?: string | undefined;
  location: SquadLaunchLocation;
}

/**
 * A checkout's branch for display. A Project checkout has no branch name when
 * HEAD is detached, so a missing or blank branch reads as HEAD instead of the
 * string "undefined".
 */
export function launchBranchLabel(branch: string | null | undefined): string {
  return branch?.trim() || 'HEAD';
}

/** The "Location:" text of a Squad launch preview. */
export function launchLocationLabel(preview: LaunchLocationPreview): string {
  const { location } = preview;
  switch (location.kind) {
    case 'new-worktree':
      return `New worktree from ${location.baseBranch} — isolation: ${location.isolationSource}; path assigned at launch`;
    case 'worktree':
      return `${launchBranchLabel(preview.branch)} — ${preview.path} (user-owned)`;
    case 'project-root':
      return `${launchBranchLabel(preview.branch)} — ${preview.path} (Project)`;
  }
}
