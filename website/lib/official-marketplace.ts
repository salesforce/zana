import officialIndex from '../content/marketplace/marketplace.json';

export const OFFICIAL_MARKETPLACE_FEED_PATH = '/marketplace/v1/marketplace.json';

/**
 * Public origin used when `PUBLIC_BASE_URL` is unset or still localhost.
 * Override with `PUBLIC_BASE_URL` (no code change) when the site moves.
 */
export const FALLBACK_PUBLIC_MARKETPLACE_ORIGIN = 'https://zcc-7808c5bc8f3d.herokuapp.com';

export function resolveMarketplacePublicBaseUrl(publicBaseUrl: string): string {
  const trimmed = publicBaseUrl.replace(/\/+$/, '');
  if (!trimmed || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
    return FALLBACK_PUBLIC_MARKETPLACE_ORIGIN;
  }
  return trimmed;
}

/** Absolute catalog URL for `zcc marketplace add`. `publicBaseUrl` is `PUBLIC_BASE_URL`. */
export function officialMarketplaceFeedUrl(publicBaseUrl: string): string {
  return `${resolveMarketplacePublicBaseUrl(publicBaseUrl)}${OFFICIAL_MARKETPLACE_FEED_PATH}`;
}

export function officialMarketplaceAddCommand(publicBaseUrl: string): string {
  return `zcc marketplace add ${officialMarketplaceFeedUrl(publicBaseUrl)}`;
}

export const MARKETPLACE_JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=0, must-revalidate'
};

export interface OfficialMarketplacePlugin {
  id: string;
  displayName: string;
  description: string;
  icon?: { lucide?: string; url?: string };
  tags?: string[];
  author: { name: string; github?: string; url?: string };
  source: {
    npm?: { package: string; range: string };
    git?: { url: string; subdir?: string; ref?: string; range?: string };
  };
}

export interface OfficialMarketplaceIndex {
  schemaVersion: 1;
  name: string;
  displayName: string;
  description?: string;
  plugins: OfficialMarketplacePlugin[];
}

export function officialMarketplaceIndex(): OfficialMarketplaceIndex {
  return officialIndex as OfficialMarketplaceIndex;
}

export interface MarketplaceCard {
  id: string;
  version: string;
  title: string;
  description: string;
  author: string;
  icon?: string;
  tags: string[];
}

export function marketplaceCardsFromIndex(index: OfficialMarketplaceIndex): MarketplaceCard[] {
  return index.plugins.map((plugin) => ({
    id: plugin.id,
    version: plugin.source.npm?.range ?? plugin.source.git?.ref ?? plugin.source.git?.range ?? 'latest',
    title: plugin.displayName,
    description: plugin.description,
    author: plugin.author.name,
    icon: plugin.icon?.lucide,
    tags: plugin.tags ?? []
  }));
}
