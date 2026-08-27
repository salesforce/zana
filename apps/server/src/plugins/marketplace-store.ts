import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import { parseMarketplaceIndex, marketplaceInstallSpec, type MarketplaceIndex, type MarketplaceEntry } from './marketplace.js';
import { defaultFetchJson } from './plugin-process.js';
import {
  marketplaceSourceDisplay,
  materializeMarketplaceIndex,
  parseMarketplaceSource,
  type MarketplaceSourceKind
} from './marketplace-source.js';

export interface MarketplaceCatalogRow {
  source: string;
  sourceKind: MarketplaceSourceKind;
  name: string;
  displayName: string;
  addedAt: number;
  entryCount: number;
  lastRefreshAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  official: boolean;
  cachedIndex: MarketplaceIndex | null;
  /** @deprecated Use `source`. Kept so v1 HTTPS rows still round-trip. */
  url?: string;
}

interface MarketplaceFileV2 {
  version: 2;
  catalogs: MarketplaceCatalogRow[];
}

export interface MarketplaceStore {
  list(): MarketplaceCatalogRow[];
  add(source: string, index: MarketplaceIndex, opts?: { official?: boolean }): Promise<MarketplaceCatalogRow>;
  refresh(source: string, index: MarketplaceIndex): Promise<MarketplaceCatalogRow>;
  recordRefreshError(source: string, error: string): Promise<MarketplaceCatalogRow | null>;
  remove(source: string): Promise<boolean>;
}

export function marketplaceStorePath(dataDir: string): string {
  return join(dataDir, 'plugins', 'marketplaces.json');
}

function migrateCatalog(raw: Record<string, unknown>): MarketplaceCatalogRow | null {
  const source = typeof raw.source === 'string'
    ? raw.source
    : typeof raw.url === 'string'
      ? raw.url
      : null;
  if (!source) return null;
  let sourceKind: MarketplaceSourceKind = 'https';
  try {
    sourceKind = parseMarketplaceSource(source).kind;
  } catch {
    sourceKind = 'https';
  }
  const cachedIndex = raw.cachedIndex ? parseMarketplaceIndex(raw.cachedIndex) : null;
  return {
    source,
    sourceKind,
    name: typeof raw.name === 'string' ? raw.name : 'catalog',
    displayName: typeof raw.displayName === 'string' ? raw.displayName : 'Catalog',
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    entryCount: typeof raw.entryCount === 'number' ? raw.entryCount : cachedIndex?.plugins.length ?? 0,
    lastRefreshAt: typeof raw.lastRefreshAt === 'number' ? raw.lastRefreshAt : null,
    lastAttemptAt: typeof raw.lastAttemptAt === 'number' ? raw.lastAttemptAt : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    official: raw.official === true,
    cachedIndex,
    url: sourceKind === 'https' ? source : undefined
  };
}

export function createMarketplaceStore(opts: { file: string }): MarketplaceStore {
  const queue = createSerializedTransactionQueue();

  function read(): MarketplaceFileV2 {
    if (!existsSync(opts.file)) return { version: 2, catalogs: [] };
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as { version?: number; catalogs?: unknown[] };
      const catalogs = Array.isArray(parsed.catalogs)
        ? parsed.catalogs.flatMap((row) => {
          if (!row || typeof row !== 'object') return [];
          const migrated = migrateCatalog(row as Record<string, unknown>);
          return migrated ? [migrated] : [];
        })
        : [];
      return { version: 2, catalogs };
    } catch {
      return { version: 2, catalogs: [] };
    }
  }

  function write(catalogs: MarketplaceCatalogRow[]): void {
    mkdirSync(dirname(opts.file), { recursive: true });
    atomicDurableWrite(
      opts.file,
      Buffer.from(`${JSON.stringify({ version: 2, catalogs }, null, 2)}\n`, 'utf8')
    );
  }

  function upsert(file: MarketplaceFileV2, next: MarketplaceCatalogRow): MarketplaceCatalogRow[] {
    const catalogs = file.catalogs.filter((item) => item.source !== next.source);
    catalogs.push(next);
    return catalogs;
  }

  return {
    list: () => read().catalogs,
    add(source, index, extra) {
      return queue.run(async () => {
        const parsed = parseMarketplaceSource(source);
        const display = marketplaceSourceDisplay(parsed);
        const now = Date.now();
        const row: MarketplaceCatalogRow = {
          source: display,
          sourceKind: parsed.kind,
          name: index.name,
          displayName: index.displayName,
          addedAt: now,
          entryCount: index.plugins.length,
          lastRefreshAt: now,
          lastAttemptAt: now,
          lastError: null,
          official: extra?.official === true,
          cachedIndex: index,
          url: parsed.kind === 'https' ? display : undefined
        };
        const file = read();
        write(upsert(file, row));
        return row;
      });
    },
    refresh(source, index) {
      return queue.run(async () => {
        const file = read();
        const existing = file.catalogs.find((row) => row.source === source || row.url === source);
        const now = Date.now();
        const parsed = parseMarketplaceSource(source);
        const row: MarketplaceCatalogRow = {
          source: existing?.source ?? marketplaceSourceDisplay(parsed),
          sourceKind: parsed.kind,
          name: index.name,
          displayName: index.displayName,
          addedAt: existing?.addedAt ?? now,
          entryCount: index.plugins.length,
          lastRefreshAt: now,
          lastAttemptAt: now,
          lastError: null,
          official: existing?.official === true,
          cachedIndex: index,
          url: parsed.kind === 'https' ? marketplaceSourceDisplay(parsed) : undefined
        };
        write(upsert(file, row));
        return row;
      });
    },
    recordRefreshError(source, error) {
      return queue.run(async () => {
        const file = read();
        const existing = file.catalogs.find((row) => row.source === source || row.url === source);
        if (!existing) return null;
        const row: MarketplaceCatalogRow = {
          ...existing,
          lastAttemptAt: Date.now(),
          lastError: error
        };
        write(upsert(file, row));
        return row;
      });
    },
    remove(source) {
      return queue.run(async () => {
        const file = read();
        const existing = file.catalogs.find((row) => row.source === source || row.url === source);
        if (!existing) return false;
        if (existing.official) throw new Error('official marketplace catalogs cannot be removed');
        write(file.catalogs.filter((row) => row.source !== existing.source));
        return true;
      });
    }
  };
}

export async function fetchMarketplaceIndex(
  url: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson
): Promise<MarketplaceIndex> {
  return materializeMarketplaceIndex(parseMarketplaceSource(url), fetchJson);
}

export async function resolveCatalogEntry(
  marketplace: string,
  entryId: string,
  catalogs: MarketplaceCatalogRow[],
  fetchJson: (url: string) => Promise<unknown>
): Promise<MarketplaceEntry> {
  const matching = catalogs.filter(
    (row) => row.name === marketplace || row.source === marketplace || row.url === marketplace || row.displayName === marketplace
  );
  if (matching.length === 0) throw new Error(`unknown marketplace "${marketplace}"`);
  for (const catalog of matching) {
    const index = catalog.cachedIndex
      ?? await materializeMarketplaceIndex(parseMarketplaceSource(catalog.source), fetchJson);
    const entry = index.plugins.find((plugin) => plugin.id === entryId);
    if (entry) return entry;
  }
  throw new Error(`marketplace entry ${entryId}@${marketplace} not found`);
}

export async function resolveCatalogSource(
  marketplace: string,
  entryId: string,
  catalogs: MarketplaceCatalogRow[],
  fetchJson: (url: string) => Promise<unknown>
): Promise<string> {
  return marketplaceInstallSpec(
    await resolveCatalogEntry(marketplace, entryId, catalogs, fetchJson)
  );
}
