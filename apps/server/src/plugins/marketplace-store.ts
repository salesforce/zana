import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import { parseMarketplaceIndex, marketplaceInstallSpec, type MarketplaceIndex } from './marketplace.js';
import { defaultFetchJson } from './plugin-process.js';

export interface MarketplaceCatalogRow {
  url: string;
  name: string;
  displayName: string;
  addedAt: number;
}

interface MarketplaceFile {
  version: 1;
  catalogs: MarketplaceCatalogRow[];
}

export interface MarketplaceStore {
  list(): MarketplaceCatalogRow[];
  add(url: string, index: MarketplaceIndex): Promise<MarketplaceCatalogRow>;
}

export function marketplaceStorePath(dataDir: string): string {
  return join(dataDir, 'plugins', 'marketplaces.json');
}

export function createMarketplaceStore(opts: { file: string }): MarketplaceStore {
  const queue = createSerializedTransactionQueue();

  function read(): MarketplaceFile {
    if (!existsSync(opts.file)) return { version: 1, catalogs: [] };
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as MarketplaceFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.catalogs)) return { version: 1, catalogs: [] };
      return parsed;
    } catch {
      return { version: 1, catalogs: [] };
    }
  }

  return {
    list: () => read().catalogs,
    add(url, index) {
      return queue.run(async () => {
        const file = read();
        const row: MarketplaceCatalogRow = {
          url,
          name: index.name,
          displayName: index.displayName,
          addedAt: Date.now()
        };
        const catalogs = file.catalogs.filter((item) => item.url !== url);
        catalogs.push(row);
        mkdirSync(dirname(opts.file), { recursive: true });
        atomicDurableWrite(
          opts.file,
          Buffer.from(`${JSON.stringify({ version: 1, catalogs }, null, 2)}\n`, 'utf8')
        );
        return row;
      });
    }
  };
}

export async function fetchMarketplaceIndex(
  url: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson
): Promise<MarketplaceIndex> {
  return parseMarketplaceIndex(await fetchJson(url));
}

export async function resolveCatalogSource(
  marketplace: string,
  entryId: string,
  catalogs: MarketplaceCatalogRow[],
  fetchJson: (url: string) => Promise<unknown>
): Promise<string> {
  const matching = catalogs.filter(
    (row) => row.name === marketplace || row.url === marketplace || row.displayName === marketplace
  );
  if (matching.length === 0) throw new Error(`unknown marketplace "${marketplace}"`);
  for (const catalog of matching) {
    const index = await fetchMarketplaceIndex(catalog.url, fetchJson);
    const entry = index.plugins.find((plugin) => plugin.id === entryId);
    if (entry) return marketplaceInstallSpec(entry);
  }
  throw new Error(`marketplace entry ${entryId}@${marketplace} not found`);
}
