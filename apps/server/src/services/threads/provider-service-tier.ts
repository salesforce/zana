import { serviceTierSchema } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { getThreadProvider } from './thread-provider-catalog.js';
export function authorizedServiceTier(ctx: Pick<ProductHttpContext,'config'>, providerId: string, value: unknown, options: { inherited?: boolean } = {}): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = serviceTierSchema.safeParse(value);
  if (!parsed.success) throw new ThreadCreateError(400,'invalid-service-tier','Invalid service tier');
  if (parsed.data === 'default') return 'default';
  if (ctx.config.getConfig().providerServiceTiersDisabled && options.inherited) return 'default';
  if (ctx.config.getConfig().providerServiceTiersDisabled) throw new ThreadCreateError(403,'service-tiers-disabled','Non-default service tiers are disabled for this instance');
  const provider = getThreadProvider(providerId);
  const tiers = provider?.serviceTiers ?? (provider?.capabilities.supportsServiceTier ? [{id:'fast'}] : []);
  if (options.inherited && parsed.data === 'fast') return 'fast';
  if (!tiers.some(tier => tier.id === parsed.data)) throw new ThreadCreateError(400,'invalid-service-tier','This service tier is not offered by the provider');
  return parsed.data;
}
