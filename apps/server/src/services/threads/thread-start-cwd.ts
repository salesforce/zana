import type { EnvironmentRow } from '@zana-ai/zcc-db';

/**
 * The environment, not the caller, decides where a new thread runs. Only an
 * unmanaged checkout honors a caller cwd (the checkout or a folder inside it).
 * A managed worktree or personal scratch runs at its provisioned root: the
 * caller's cwd names the source checkout, which the host rightly refuses as
 * outside the environment.
 */
export function threadStartCwd(
  environment: Pick<EnvironmentRow, 'path' | 'workspaceProvisionType'> | null | undefined,
  requestedCwd: string | undefined
): string | undefined {
  if (!environment || environment.workspaceProvisionType === 'unmanaged') return requestedCwd;
  return environment.path ?? undefined;
}
