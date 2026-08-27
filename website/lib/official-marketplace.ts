import officialIndex from '../content/marketplace/marketplace.json';

export const OFFICIAL_MARKETPLACE_FEED_PATH = '/marketplace/v1/marketplace.json';

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
