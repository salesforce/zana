import type { PluginKvStorage } from '@zana-ai/zcc-plugin-sdk/server';
import { helpCatalog, type HelperGuide } from './catalog.js';

const CACHE_KEY = 'helper:guides';
const SOURCE = 'https://raw.githubusercontent.com/salesforce/zana/main/plugins/bots/src/helper/catalog.generated.json';
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_CATALOG_BYTES = 128 * 1_024;
const sourcePrefix = `https://github.com/salesforce/zana/blob/v${helpCatalog.version}/`;

function isSection(value: unknown): value is HelperGuide {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 160
    && typeof row.guide === 'string' && row.guide.length > 0 && row.guide.length <= 160
    && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 160
    && typeof row.text === 'string' && row.text.length > 0 && row.text.length <= 10_000
    && typeof row.url === 'string' && row.url.startsWith(sourcePrefix) && row.url.length <= 500;
}

function parseCatalog(value: unknown): HelperGuide[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, entries } = value as Record<string, unknown>;
  if (version !== helpCatalog.version || !Array.isArray(entries) || !entries.length || entries.length > 150) return null;
  if (!entries.every(isSection) || new Set(entries.map(row => row.id)).size !== entries.length) return null;
  return entries;
}

async function readCatalog(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error('Guide download failed');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_CATALOG_BYTES) throw new Error('Guide catalog exceeds its size limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** A compatible correction replaces the bundled catalog only after validation. */
export class HelperCatalog {
  private nextRefresh = 0;
  private pending?: Promise<void>;
  private cache?: Promise<HelperGuide[] | null>;
  private current = helpCatalog.entries;

  constructor(private readonly storage: PluginKvStorage, private readonly fetcher = fetch) {}

  async entries(): Promise<HelperGuide[]> {
    this.cache ??= this.storage.get<unknown>(CACHE_KEY).then(parseCatalog).catch(() => null);
    const saved = await this.cache;
    if (saved && this.current === helpCatalog.entries) this.current = saved;
    if (this.pending) await this.pending;
    else if (Date.now() >= this.nextRefresh) {
      this.nextRefresh = Date.now() + REFRESH_INTERVAL_MS;
      this.pending = this.refresh().finally(() => { this.pending = undefined; });
      await this.pending;
    }
    return this.current;
  }

  private async refresh(): Promise<void> {
    try {
      const response = await this.fetcher(SOURCE, { redirect: 'error', signal: AbortSignal.timeout(1_500) });
      try {
        const payload = await readCatalog(response);
        const catalog = parseCatalog(payload);
        if (!catalog) return;
        this.current = catalog;
        await this.storage.set(CACHE_KEY, payload);
      } finally {
        if (!response.bodyUsed) await response.body?.cancel();
      }
    } catch {
      // An unavailable or incompatible download leaves the last compatible guides usable.
    }
  }
}
