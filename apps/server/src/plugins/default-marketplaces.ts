/** Public HTTPS feed for bundled first-party plugins. */
export const DEFAULT_OFFICIAL_MARKETPLACE_URL =
  'https://zcc-7808c5bc8f3d.herokuapp.com/marketplace/v1/marketplace.json';

/** Public community catalog, seeded without requiring corporate Git access. */
export const DEFAULT_COMMUNITY_MARKETPLACE_SOURCE =
  'git:https://github.com/salesforce/zana-marketplace.git';

/** Salesforce employee catalog; Git access remains controlled by Salesforce. */
export const DEFAULT_INTERNAL_MARKETPLACE_SOURCE =
  'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace.git';

/** Cap on the background Git clone so discovery cannot stall boot. */
export const DEFAULT_MARKETPLACE_SEED_TIMEOUT_MS = 8_000;

function envFlag(raw: string | undefined): 'off' | string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed === 'off' || trimmed === '0') return 'off';
  return trimmed;
}

/**
 * Resolve the public official marketplace URL for boot seeding.
 * Unset → default public feed. `off` / `0` → skip. Any other https URL is used as-is.
 */
export function resolveOfficialMarketplaceUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const flag = envFlag(env.ZCC_OFFICIAL_MARKETPLACE_URL);
  if (flag === 'off') return null;
  if (flag) return flag.startsWith('https://') ? flag : null;
  return DEFAULT_OFFICIAL_MARKETPLACE_URL;
}

/**
 * Resolve the community marketplace source for boot seeding.
 * Unset → public GitHub catalog. `off` / `0` → skip. Other values are used as-is.
 */
export function resolveCommunityMarketplaceSource(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const flag = envFlag(env.ZCC_COMMUNITY_MARKETPLACE_SOURCE);
  if (flag === 'off') return null;
  if (flag) return flag;
  return DEFAULT_COMMUNITY_MARKETPLACE_SOURCE;
}

/** Resolve the independent Salesforce-internal catalog, preserving deployment overrides. */
export function resolveInternalMarketplaceSource(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const flag = envFlag(env.ZCC_INTERNAL_MARKETPLACE_SOURCE);
  if (flag === 'off') return null;
  return flag ?? DEFAULT_INTERNAL_MARKETPLACE_SOURCE;
}
