/** Public HTTPS feed seeded beside the Salesforce-internal git catalog. */
export const DEFAULT_OFFICIAL_MARKETPLACE_URL =
  'https://zcc-7808c5bc8f3d.herokuapp.com/marketplace/v1/marketplace.json';

/** Default Salesforce-internal catalog. Seeded fail-soft; VPN/SSO required. */
export const DEFAULT_INTERNAL_MARKETPLACE_SOURCE =
  'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace.git';

/** Cap on the background git clone so unreachable git.soma cannot stall boot. */
export const INTERNAL_MARKETPLACE_SEED_TIMEOUT_MS = 8_000;

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
 * Resolve the internal marketplace source for boot seeding.
 * Unset → default git.soma URL. `off` / `0` → skip. Any other value is used as-is.
 */
export function resolveInternalMarketplaceSource(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const flag = envFlag(env.ZCC_INTERNAL_MARKETPLACE_SOURCE);
  if (flag === 'off') return null;
  if (flag) return flag;
  return DEFAULT_INTERNAL_MARKETPLACE_SOURCE;
}
