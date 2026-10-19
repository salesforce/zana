import {
  officialMarketplaceIndex,
  type OfficialMarketplaceIndex
} from './official-marketplace';

/**
 * Serve the official catalog from the repository's default branch so a merged
 * entry goes live without redeploying this app (which also restarts Connect).
 * The bundled copy is the cold-start and failure fallback.
 */
export const DEFAULT_MARKETPLACE_UPSTREAM_URL =
  'https://raw.githubusercontent.com/salesforce/zana/main/marketplace/marketplace.json';

export const MARKETPLACE_CACHE_TTL_MS = 5 * 60 * 1000;
export const MARKETPLACE_FETCH_TIMEOUT_MS = 5000;
export const MARKETPLACE_MAX_BYTES = 1024 * 1024;

const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `MARKETPLACE_UPSTREAM_URL` overrides the source; `off` / `0` serves the bundled copy only. */
export function resolveMarketplaceUpstreamUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_MARKETPLACE_UPSTREAM_URL;
  if (/^(off|0|false)$/i.test(trimmed)) return null;
  return /^https:\/\//i.test(trimmed) ? trimmed : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Structural check mirroring marketplace/scripts/build-lib.mjs; rejects anything clients could not install. */
export function parseOfficialMarketplaceIndex(value: unknown): OfficialMarketplaceIndex {
  if (!isObject(value)) throw new Error('catalog must be a JSON object');
  if (value.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (value.name !== 'official') throw new Error('name must be "official"');
  if (!nonEmptyString(value.displayName)) throw new Error('displayName is required');
  if (!Array.isArray(value.plugins)) throw new Error('plugins must be an array');
  const seen = new Set<string>();
  value.plugins.forEach((plugin, index) => {
    const at = `plugins[${index}]`;
    if (!isObject(plugin)) throw new Error(`${at} must be an object`);
    if (typeof plugin.id !== 'string' || !ENTRY_ID_PATTERN.test(plugin.id)) {
      throw new Error(`${at}.id is invalid`);
    }
    if (seen.has(plugin.id)) throw new Error(`${at}.id "${plugin.id}" is duplicated`);
    seen.add(plugin.id);
    if (!nonEmptyString(plugin.displayName)) throw new Error(`${at}.displayName is required`);
    if (!nonEmptyString(plugin.description)) throw new Error(`${at}.description is required`);
    if (!isObject(plugin.author) || !nonEmptyString(plugin.author.name)) {
      throw new Error(`${at}.author.name is required`);
    }
    const source = plugin.source;
    if (!isObject(source) || (!isObject(source.git) && !isObject(source.npm))) {
      throw new Error(`${at}.source must declare git or npm`);
    }
    if (isObject(source.git) && !nonEmptyString(source.git.url)) {
      throw new Error(`${at}.source.git.url is required`);
    }
    if (isObject(source.npm) && !nonEmptyString(source.npm.package)) {
      throw new Error(`${at}.source.npm.package is required`);
    }
  });
  return value as unknown as OfficialMarketplaceIndex;
}

async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`catalog exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`catalog exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchUpstreamMarketplace(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = MARKETPLACE_FETCH_TIMEOUT_MS
): Promise<OfficialMarketplaceIndex> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`upstream answered ${response.status}`);
    }
    return parseOfficialMarketplaceIndex(JSON.parse(await readCappedText(response, MARKETPLACE_MAX_BYTES)));
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveMarketplaceOptions {
  upstreamUrl?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  bundled?: () => OfficialMarketplaceIndex;
  onError?: (error: unknown) => void;
}

/**
 * Cached loader: one upstream request per TTL (single-flight), keeping the
 * last good catalog when GitHub fails or serves an invalid document.
 */
export function createLiveMarketplace(options: LiveMarketplaceOptions = {}) {
  const upstreamUrl =
    options.upstreamUrl === undefined
      ? resolveMarketplaceUpstreamUrl(process.env.MARKETPLACE_UPSTREAM_URL)
      : options.upstreamUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? MARKETPLACE_CACHE_TTL_MS;
  const bundled = options.bundled ?? officialMarketplaceIndex;
  const onError =
    options.onError ??
    ((error: unknown) =>
      console.warn(`marketplace: serving cached catalog (${error instanceof Error ? error.message : error})`));

  let lastGood: OfficialMarketplaceIndex | null = null;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<OfficialMarketplaceIndex> | null = null;

  return async function loadOfficialMarketplace(): Promise<OfficialMarketplaceIndex> {
    if (!upstreamUrl) return bundled();
    if (now() - checkedAt < ttlMs) return lastGood ?? bundled();
    if (!inFlight) {
      inFlight = fetchUpstreamMarketplace(upstreamUrl, fetchImpl, options.timeoutMs)
        .then((index) => {
          lastGood = index;
          return index;
        })
        .catch((error: unknown) => {
          onError(error);
          return lastGood ?? bundled();
        })
        .finally(() => {
          // A failure also waits a full TTL, so a GitHub outage is not hammered.
          checkedAt = now();
          inFlight = null;
        });
    }
    return inFlight;
  };
}

export const loadOfficialMarketplace = createLiveMarketplace();
