import type { SquadExecutionTargetSelector, Worktree } from '@zana-ai/zcc-domain/product';
import { isSafeTargetBranch } from '@zana-ai/zcc-domain/product';

/** Picker value meaning "legacy behavior": no target selector is sent. */
export const NO_TARGET = '';
export const NEW_WORKTREE = 'new-worktree';
const PROJECT_ROOT = 'project-root';
const WORKTREE_PREFIX = 'worktree:';

export interface TargetOption {
  value: string;
  label: string;
  compactLabel?: string;
  description?: string;
}

/** Choices are selectors or launch overrides. Full paths are only shown from the resolved preview. */
export function squadTargetOptions(
  worktrees: readonly Worktree[],
  projectBranch?: string,
  inheritedLocation?: string
): TargetOption[] {
  const seen = new Set<string>();
  const linked: TargetOption[] = [];
  for (const wt of worktrees) {
    if (wt.isMain || wt.bare || wt.detached || !wt.branch || !isSafeTargetBranch(wt.branch) || seen.has(wt.branch)) continue;
    seen.add(wt.branch);
    linked.push({ value: `${WORKTREE_PREFIX}${wt.branch}`, label: `Worktree · ${wt.branch}`, description: 'Use an existing checkout you own' });
  }
  return [
    { value: NO_TARGET, label: 'Use defaults', compactLabel: inheritedLocation, description: inheritedLocation },
    { value: PROJECT_ROOT, label: projectBranch ? `Project · ${projectBranch}` : 'Project checkout', description: 'Use the registered project checkout' },
    { value: NEW_WORKTREE, label: projectBranch ? `New worktree from ${projectBranch}` : 'New worktree', description: 'Create a separate checkout for this run' },
    ...linked
  ];
}

/** Serialize a picker value to the launch selector; unknown or empty values yield no selector. */
export function squadTargetSelector(value: string): SquadExecutionTargetSelector | undefined {
  if (value === PROJECT_ROOT) return { kind: 'project-root' };
  if (value.startsWith(WORKTREE_PREFIX)) {
    const branch = value.slice(WORKTREE_PREFIX.length);
    if (isSafeTargetBranch(branch)) return { kind: 'worktree', branch };
  }
  return undefined;
}
