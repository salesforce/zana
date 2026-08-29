import { marketplaceCardsFromIndex, officialMarketplaceIndex } from './official-marketplace';
import type { CatalogEntry } from './registry';

/** Fallback when the live `/marketplace/v1/marketplace.json` feed cannot be fetched. */
export const SAMPLE_CATALOG: CatalogEntry[] = marketplaceCardsFromIndex(officialMarketplaceIndex()).map(
  (card) => ({
    id: card.id,
    version: card.version,
    title: card.title,
    description: card.description,
    author: card.author,
    icon: card.icon,
    permissions: [],
    versions: [card.version]
  })
);
