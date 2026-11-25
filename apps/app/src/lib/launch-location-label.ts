interface LaunchLocationPreview {
  branch?: string | null | undefined;
  path?: string | undefined;
  location: { kind: string; baseBranch?: string | undefined; isolationSource?: string | undefined };
}

/**
 * The "Location:" text of a Squad launch preview. A Project checkout with no
 * branch name (detached HEAD, or no git data) reads as HEAD instead of the
 * string "undefined".
 */
export function launchLocationLabel(preview: LaunchLocationPreview): string {
  if (preview.location.kind === 'new-worktree') {
    return `New worktree from ${preview.location.baseBranch} — isolation: ${preview.location.isolationSource}; path assigned at launch`;
  }
  const owner = preview.location.kind === 'worktree' ? ' (user-owned)' : ' (Project)';
  return `${preview.branch ?? 'HEAD'} — ${preview.path}${owner}`;
}
