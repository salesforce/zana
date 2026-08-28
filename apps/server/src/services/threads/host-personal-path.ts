import type { ProductHttpContext } from '../../http/product-context.js';
import {
  HOST_DATA_DIR_PROBE_SLUG,
  resolvePersonalTargetPathFromCloneDefault
} from './worktree-paths.js';

/** Ask the execution host for its data dir, then place a personal workspace there. */
export async function resolvePersonalTargetPathOnHost(
  ctx: ProductHttpContext,
  hostId: string,
  environmentId: string
): Promise<string> {
  const result = await ctx.hostHub.callHostOnlineRpc<{ path: string }>({
    hostId,
    command: { type: 'project.clone_default_path', projectSlug: HOST_DATA_DIR_PROBE_SLUG }
  });
  return resolvePersonalTargetPathFromCloneDefault(result.path, environmentId);
}
