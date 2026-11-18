/** Project setting takes precedence; global setting supplies default. */
export function effectiveWorktreeIsolation(
  projectOverride: boolean | undefined,
  globalDefault: boolean | undefined
): boolean {
  return projectOverride ?? globalDefault ?? false;
}

/**
 * Display-only split of the `default` launch source for worktree isolation:
 * the Project setting wins over the Global default. The resolver and persisted
 * `source` stay `default`.
 */
export function worktreeDefaultOrigin(projectOverride: boolean | undefined): 'Project' | 'Global' {
  return projectOverride === undefined ? 'Global' : 'Project';
}
