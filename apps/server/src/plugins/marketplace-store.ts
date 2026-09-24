import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import { parseMarketplaceIndex, marketplaceInstallSpec, type MarketplaceIndex, type MarketplaceEntry } from './marketplace.js';
import { defaultFetchJson } from './plugin-process.js';
import {
  marketplaceSourceDisplay,
  marketplaceSourceKey,
  marketplaceSourcesEqual,
  materializeMarketplaceIndex,
  parseMarketplaceSource,
  resolveMarketplaceSource,
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

interface MarketplaceStoreDocument {
  catalogs: MarketplaceCatalogRow[];
  preservedCatalogRows: unknown[];
  writable: boolean;
  migrationNeeded: boolean;
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

/** Renderer/HTTP projection — never include `cachedIndex`. */
export function toPublicMarketplaceCatalog(row: MarketplaceCatalogRow) {
  return {
    source: row.source,
    sourceKind: row.sourceKind,
    name: row.name,
    displayName: row.displayName,
    addedAt: row.addedAt,
    entryCount: row.entryCount,
    lastRefreshAt: row.lastRefreshAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    official: row.official
  };
}

export function listPublicMarketplaceCatalogs(dataDir: string) {
  return createMarketplaceStore({ file: marketplaceStorePath(dataDir) })
    .list()
    .map(toPublicMarketplaceCatalog);
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function storedSource(source: ReturnType<typeof parseMarketplaceSource>): string {
  return source.kind === 'git' ? marketplaceSourceKey(source) : marketplaceSourceDisplay(source);
}

function migrateCatalog(raw: Record<string, unknown>): MarketplaceCatalogRow | null {
  const source = typeof raw.source === 'string'
    ? raw.source
    : typeof raw.url === 'string'
      ? raw.url
      : null;
  if (!source) return null;
  let parsedSource: ReturnType<typeof parseMarketplaceSource>;
  try {
    parsedSource = parseMarketplaceSource(source);
  } catch {
    return null;
  }
  let cachedIndex: MarketplaceIndex | null = null;
  try {
    cachedIndex = raw.cachedIndex ? parseMarketplaceIndex(raw.cachedIndex) : null;
  } catch {
    // A bad cache must not prevent its source row from being migrated.
  }
  const canonicalSource = storedSource(parsedSource);
  return {
    source: canonicalSource,
    sourceKind: parsedSource.kind,
    name: typeof raw.name === 'string' ? raw.name : 'catalog',
    displayName: typeof raw.displayName === 'string' ? raw.displayName : 'Catalog',
    addedAt: timestamp(raw.addedAt) ?? 0,
    entryCount: typeof raw.entryCount === 'number' && Number.isFinite(raw.entryCount)
      ? raw.entryCount
      : cachedIndex?.plugins.length ?? 0,
    lastRefreshAt: timestamp(raw.lastRefreshAt),
    lastAttemptAt: timestamp(raw.lastAttemptAt),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    official: raw.official === true,
    cachedIndex,
    url: parsedSource.kind === 'https' ? canonicalSource : undefined
  };
}

function newestCachedRow(rows: MarketplaceCatalogRow[]): MarketplaceCatalogRow | undefined {
  let newest: MarketplaceCatalogRow | undefined;
  let newestRefresh = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row.cachedIndex) continue;
    const refreshed = row.lastRefreshAt ?? Number.NEGATIVE_INFINITY;
    // Deliberately retain first row for tied timestamps: file order is tie-breaker.
    if (!newest || refreshed > newestRefresh) {
      newest = row;
      newestRefresh = refreshed;
    }
  }
  return newest;
}

function mergeCatalogs(rows: MarketplaceCatalogRow[]): MarketplaceCatalogRow[] {
  const groups: MarketplaceCatalogRow[][] = [];
  for (const row of rows) {
    const group = groups.find((candidate) => marketplaceSourcesEqual(candidate[0]!.source, row.source));
    if (group) group.push(row);
    else groups.push([row]);
  }
  return groups.map((group) => {
    const cached = newestCachedRow(group);
    const base = cached ?? group[0]!;
    const lastGood = cached?.lastRefreshAt ?? Number.NEGATIVE_INFINITY;
    let latestError: MarketplaceCatalogRow | undefined;
    let latestAttempt = Number.NEGATIVE_INFINITY;
    let lastAttemptAt: number | null = null;
    for (const row of group) {
      if (row.lastAttemptAt != null && (lastAttemptAt == null || row.lastAttemptAt > lastAttemptAt)) {
        lastAttemptAt = row.lastAttemptAt;
      }
      if (row.lastError != null && row.lastAttemptAt != null && row.lastAttemptAt > latestAttempt) {
        latestError = row;
        latestAttempt = row.lastAttemptAt;
      }
    }
    return {
      ...base,
      addedAt: Math.min(...group.map((row) => row.addedAt)),
      official: group.some((row) => row.official),
      cachedIndex: cached?.cachedIndex ?? null,
      entryCount: cached?.entryCount ?? base.entryCount,
      lastRefreshAt: cached?.lastRefreshAt ?? null,
      lastAttemptAt,
      lastError: latestError && latestAttempt > lastGood ? latestError.lastError : null
    };
  });
}

export function createMarketplaceStore(opts: { file: string }): MarketplaceStore {
  const queue = createSerializedTransactionQueue();

  function read(): MarketplaceStoreDocument {
    if (!existsSync(opts.file)) {
      return { catalogs: [], preservedCatalogRows: [], writable: true, migrationNeeded: false };
    }
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as { version?: number; catalogs?: unknown[] };
      if (!Array.isArray(parsed.catalogs)) {
        return { catalogs: [], preservedCatalogRows: [], writable: false, migrationNeeded: false };
      }
      const catalogs: MarketplaceCatalogRow[] = [];
      const preservedCatalogRows: unknown[] = [];
      for (const row of parsed.catalogs) {
        if (!row || typeof row !== 'object') {
          preservedCatalogRows.push(row);
          continue;
        }
        const migrated = migrateCatalog(row as Record<string, unknown>);
        if (migrated) catalogs.push(migrated);
        else preservedCatalogRows.push(row);
      }
      const merged = mergeCatalogs(catalogs);
      const canonicalized = parsed.catalogs.some((row) => (
        row != null
        && typeof row === 'object'
        && (() => {
          const migrated = migrateCatalog(row as Record<string, unknown>);
          return migrated != null && JSON.stringify(row) !== JSON.stringify(migrated);
        })()
      ));
      return {
        catalogs: merged,
        preservedCatalogRows,
        writable: true,
        migrationNeeded: parsed.version !== 3
          || canonicalized
          || JSON.stringify(catalogs) !== JSON.stringify(merged)
      };
    } catch {
      return { catalogs: [], preservedCatalogRows: [], writable: false, migrationNeeded: false };
    }
  }

  function write(document: MarketplaceStoreDocument): void {
    if (!document.writable) throw new Error('cannot write malformed marketplace store');
    mkdirSync(dirname(opts.file), { recursive: true });
    atomicDurableWrite(
      opts.file,
      Buffer.from(`${JSON.stringify({ version: 3, catalogs: [...document.catalogs, ...document.preservedCatalogRows] }, null, 2)}\n`, 'utf8')
    );
  }

  function upsert(document: MarketplaceStoreDocument, next: MarketplaceCatalogRow): MarketplaceCatalogRow[] {
    const catalogs = document.catalogs.filter((item) => !marketplaceSourcesEqual(item.source, next.source));
    catalogs.push(next);
    return mergeCatalogs(catalogs);
  }

  function findCatalog(catalogs: MarketplaceCatalogRow[], source: string): MarketplaceCatalogRow | undefined {
    const candidates = (() => {
      try {
        return resolveMarketplaceSource(parseMarketplaceSource(source)).map(marketplaceSourceDisplay);
      } catch {
        return [source];
      }
    })();
    return catalogs.find((row) => candidates.some((candidate) => (
      marketplaceSourcesEqual(row.source, candidate)
      || (row.url != null && marketplaceSourcesEqual(row.url, candidate))
    )));
  }

  let document = read();
  if (document.migrationNeeded) write(document);

  return {
    list: () => document.catalogs,
    add(source, index, extra) {
      return queue.run(async () => {
        const parsed = parseMarketplaceSource(source);
        const display = storedSource(parsed);
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
        const next = { ...document, catalogs: upsert(document, row), migrationNeeded: false };
        write(next);
        document = next;
        return row;
      });
    },
    refresh(source, index) {
      return queue.run(async () => {
        const existing = findCatalog(document.catalogs, source);
        const now = Date.now();
        const parsed = parseMarketplaceSource(source);
        const row: MarketplaceCatalogRow = {
          source: storedSource(parsed),
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
        const next = { ...document, catalogs: upsert(document, row), migrationNeeded: false };
        write(next);
        document = next;
        return row;
      });
    },
    recordRefreshError(source, error) {
      return queue.run(async () => {
        const existing = findCatalog(document.catalogs, source);
        if (!existing) return null;
        const row: MarketplaceCatalogRow = {
          ...existing,
          lastAttemptAt: Date.now(),
          lastError: error
        };
        const next = { ...document, catalogs: upsert(document, row), migrationNeeded: false };
        write(next);
        document = next;
        return row;
      });
    },
    remove(source) {
      return queue.run(async () => {
        const existing = findCatalog(document.catalogs, source);
        if (!existing) return false;
        if (existing.official) throw new Error('official marketplace catalogs cannot be removed');
        const next = {
          ...document,
          catalogs: document.catalogs.filter((row) => !marketplaceSourcesEqual(row.source, existing.source)),
          migrationNeeded: false
        };
        write(next);
        document = next;
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
