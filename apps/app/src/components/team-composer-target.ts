import type { SquadExecutionTargetSelector, Worktree } from '@zana-ai/zcc-domain/product';
import { isSafeTargetBranch } from '@zana-ai/zcc-domain/product';

/** Picker value meaning "legacy behavior": no target selector is sent. */
export const NO_TARGET = '';
const PROJECT_ROOT = 'project-root';
const WORKTREE_PREFIX = 'worktree:';

export interface TargetOption {
  value: string;
  label: string;
}

/** Options for the optional target picker: legacy default, the Project root, and linked worktrees by branch. */
export function squadTargetOptions(worktrees: readonly Worktree[]): TargetOption[] {
  const seen = new Set<string>();
  const linked: TargetOption[] = [];
  for (const wt of worktrees) {
    if (wt.isMain || wt.bare || wt.detached || !wt.branch || !isSafeTargetBranch(wt.branch) || seen.has(wt.branch)) continue;
    seen.add(wt.branch);
    linked.push({ value: `${WORKTREE_PREFIX}${wt.branch}`, label: `Worktree: ${wt.branch}` });
  }
  return [
    { value: NO_TARGET, label: 'Default' },
    { value: PROJECT_ROOT, label: 'Project root' },
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
