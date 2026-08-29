const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'origin',
  'content-length'
]);

/**
 * @param {import('node:http').IncomingHttpHeaders | Record<string, string | string[] | undefined>} headers
 * @returns {Array<[string, string]>}
 */
export function headersToPairs(headers) {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([name, item]);
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

/**
 * @param {Array<[string, string]>} pairs
 * @returns {Record<string, string>}
 */
export function pairsToObject(pairs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of pairs ?? []) {
    if (!name || HOP_BY_HOP.has(name.toLowerCase())) continue;
    const existing = out[name];
    out[name] = existing ? `${existing}, ${value}` : value;
  }
  return out;
}

export function isHopByHop(name) {
  return HOP_BY_HOP.has(String(name).toLowerCase());
}
