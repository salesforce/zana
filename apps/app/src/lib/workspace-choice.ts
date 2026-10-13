/** Project setting takes precedence; global setting supplies default. */
export function effectiveWorktreeIsolation(
  projectOverride: boolean | undefined,
  globalDefault: boolean | undefined
): boolean {
  return projectOverride ?? globalDefault ?? false;
}
