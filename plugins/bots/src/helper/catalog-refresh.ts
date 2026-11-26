import type { PluginKvStorage } from '@zana-ai/zcc-plugin-sdk/server';
import { GUIDE_REPOSITORY, helpCatalog, type HelperGuide } from './catalog.js';

const CACHE_KEY = 'helper:guides';
const REFRESH_REF = 'main';
const SOURCE = `https://raw.githubusercontent.com/salesforce/zana/${REFRESH_REF}/plugins/bots/src/helper/catalog.generated.json`;
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_CATALOG_BYTES = 128 * 1_024;
const refreshPrefix = `${GUIDE_REPOSITORY}${REFRESH_REF}/`;

/** Messages are constructed locally and may be included in debug logs. */
class CatalogReadError extends Error {}

function isSection(value: unknown, taggedPrefix: string): value is HelperGuide {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 160
    && typeof row.guide === 'string' && row.guide.length > 0 && row.guide.length <= 160
    && typeof row.title === 'string' && row.title.length > 0 && row.title.length <= 160
    && typeof row.text === 'string' && row.text.length > 0 && row.text.length <= 10_000
    && typeof row.url === 'string' && row.url.startsWith(taggedPrefix) && row.url.length <= 500
    && new URL(row.url).href.startsWith(taggedPrefix);
}

function parseCatalog(value: unknown): HelperGuide[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { schemaVersion, version, entries } = value as Record<string, unknown>;
  if (schemaVersion !== helpCatalog.schemaVersion || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(version)) return null;
  if (!Array.isArray(entries) || !entries.length || entries.length > 150) return null;
  const taggedPrefix = `${GUIDE_REPOSITORY}v${version}/`;
  const guides = entries.filter((entry): entry is HelperGuide => isSection(entry, taggedPrefix));
  if (guides.length !== entries.length || new Set(guides.map(row => row.id)).size !== entries.length) return null;
  // The generator emits release links for bundled copies. A correction read
  // from main, including one saved by an older app, should link back to main.
  return guides.map(guide => ({ ...guide, url: refreshPrefix + new URL(guide.url).href.slice(taggedPrefix.length) }));
}

async function readCatalog(response: Response): Promise<unknown> {
  if (!response.ok) throw new CatalogReadError(`Guide catalog download returned HTTP ${response.status}.`);
  if (!response.body) throw new CatalogReadError('Guide catalog download had no body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_CATALOG_BYTES) throw new CatalogReadError('Guide catalog exceeds its size limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CatalogReadError('Guide catalog contains invalid JSON.');
  }
}

/** A compatible correction replaces the bundled catalog only after validation. */
export class HelperCatalog {
  private nextRefresh = 0;
  private refreshEnabled = false;
  private pending?: AbortController;
  private cache?: Promise<void>;
  private current = helpCatalog.entries;

  constructor(
    private readonly storage: PluginKvStorage,
    private readonly fetcher = fetch,
    private readonly changed = () => {},
    private readonly debug: (message: string) => void = () => {}
  ) {}

  setRefreshEnabled(enabled: boolean): void {
    if (enabled === this.refreshEnabled) return;
    this.refreshEnabled = enabled;
    if (enabled) this.nextRefresh = 0;
    else this.pending?.abort();
  }

  async entries(): Promise<HelperGuide[]> {
    this.cache ??= this.storage.get<unknown>(CACHE_KEY).then(value => {
      this.current = parseCatalog(value) ?? helpCatalog.entries;
    }).catch(() => { this.debug('Could not read the saved guide catalog.'); });
    await this.cache;
    if (this.refreshEnabled && !this.pending && Date.now() >= this.nextRefresh) {
      this.nextRefresh = Date.now() + REFRESH_INTERVAL_MS;
      this.pending = new AbortController();
      void this.refresh(AbortSignal.any([this.pending.signal, AbortSignal.timeout(1_500)]))
        .finally(() => { this.pending = undefined; });
    }
    return this.current;
  }

  private async refresh(signal: AbortSignal): Promise<void> {
    try {
      const response = await this.fetcher(SOURCE, { redirect: 'error', signal });
      try {
        const payload = await readCatalog(response);
        if (signal.aborted) return;
        const catalog = parseCatalog(payload);
        if (!catalog) {
          this.debug('Guide catalog rejected for an incompatible schema or invalid entries.');
          return;
        }
        this.current = catalog;
        try {
          await this.storage.set(CACHE_KEY, payload);
        } catch {
          this.debug('Could not save the updated guide catalog.');
        }
        this.changed();
      } finally {
        if (!response.bodyUsed) await response.body?.cancel();
      }
    } catch (error) {
      if (signal.reason?.name === 'TimeoutError') this.debug('Guide catalog download timed out.');
      else if (!signal.aborted) this.debug(error instanceof CatalogReadError ? error.message : 'Guide catalog refresh failed.');
    }
  }
}
