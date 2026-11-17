import { getHost } from '@zana-ai/zcc-db';
import { readHostAuth } from '@zana-ai/zcc-host-daemon/machine-auth';
import { DesktopHostEnrollmentSchema, type DesktopHostEnrollment } from '@zana-ai/zcc-contracts/runtime';
import type { ProductHttpContext } from './http/product-context.js';

/** Called only by the authenticated Electron parent channel, never by HTTP or a renderer. */
export function desktopHostEnrollment(
  ctx: Pick<ProductHttpContext, 'db' | 'dataDir' | 'productInstanceId'>,
  serverUrl: string
): DesktopHostEnrollment {
  const auth = readHostAuth(ctx.dataDir);
  const host = auth ? getHost(ctx.db, auth.hostId) : null;
  return DesktopHostEnrollmentSchema.parse({
    serverInstanceId: ctx.productInstanceId,
    serverUrl,
    host: host && !host.destroyedAt && host.enrollmentCapability === 'execution'
      ? { hostId: host.id, hostKeyHash: host.hostKeyHash } : null
  });
}
