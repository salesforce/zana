import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { ProductHttpContext } from './product-context.js';
import { asControlResult, callControlAsProductServer, productServerHasDesktopCredential } from './cli-agent-ops.js';

/** Desktop main owns normalization and live effects for both config write surfaces. */
export async function setProductConfig(ctx: Pick<ProductHttpContext, 'dataDir' | 'config'>, patch: Partial<AppConfig>): Promise<AppConfig> {
  if (!productServerHasDesktopCredential()) return ctx.config.setConfig(patch);
  const result = asControlResult<AppConfig>(await callControlAsProductServer(ctx.dataDir, 'product.invoke', {
    method: 'config.set', args: [patch]
  }));
  if (!result.ok) throw new Error(result.message ?? 'Desktop config update failed');
  return result.value;
}
