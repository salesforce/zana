import type { DefaultBranchRelation } from '@zana-ai/zcc-domain';

/**
 * Prefer the origin default when the local default is equal or behind.
 * Stay on the local default when it is ahead or diverged.
 */
export function resolveDefaultWorktreeBaseBranch(args: {
  localDefault: string | null;
  originDefault: string | null;
  relation: DefaultBranchRelation | null;
}): string | null {
  if (args.originDefault && (args.relation === 'equal' || args.relation === 'local-behind' || args.relation === null)) {
    return args.originDefault;
  }
  return args.localDefault ?? args.originDefault;
}
