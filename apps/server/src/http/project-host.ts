import { getPrimaryHost } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from './product-context.js';
import { HostUnavailableError } from './host-hub.js';

/** A legacy project with no host ID belongs to the primary machine. Its path
 * must never migrate to whichever other daemon happens to remain connected. */
export function resolveProjectHost(ctx: Pick<ProductHttpContext, 'db' | 'hostHub'>, explicit?: string): string {
  const hostId = explicit ?? getPrimaryHost(ctx.db)?.id;
  if (!hostId) throw new HostUnavailableError('The primary machine is not registered');
  return ctx.hostHub.resolveHostId(hostId);
}
