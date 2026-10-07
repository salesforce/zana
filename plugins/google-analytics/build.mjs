import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Called by the existing generic first-party plugin build/package loop. */
export function writeReleaseDefaults(root, env = process.env) {
  const measurementId = env.ZCC_GA4_MEASUREMENT_ID?.trim() || '';
  const apiSecret = env.ZCC_GA4_API_SECRET?.trim() || '';
  if ((measurementId || apiSecret) && (!/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret || apiSecret.length > 256)) {
    throw new Error('Google Analytics release defaults require a GA4 Measurement ID and an API secret.');
  }
  const directory = join(root, 'release-defaults');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ measurementId, apiSecret }), { mode: 0o600 });
    renameSync(temporary, join(directory, 'config.json'));
  } finally { rmSync(temporary, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeReleaseDefaults(dirname(fileURLToPath(import.meta.url)));
}
