import { readFileSync, statSync } from 'node:fs';

/** Optional plugin-owned release asset; no vendor-specific credential logic in core. */
export function readReleaseDefaults(file = new URL('./release-defaults/config.json', import.meta.url)) {
  try {
    if (statSync(file).size > 1024) return {};
    const values = JSON.parse(readFileSync(file, 'utf8'));
    if (!values || typeof values !== 'object'
      || typeof values.measurementId !== 'string' || !/^G-[A-Z0-9]+$/.test(values.measurementId)
      || typeof values.apiSecret !== 'string' || !values.apiSecret || values.apiSecret.length > 256) return {};
    return { measurementId: values.measurementId, apiSecret: values.apiSecret };
  } catch { return {}; }
}
