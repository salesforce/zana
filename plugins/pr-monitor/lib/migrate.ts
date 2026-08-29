import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PluginKvStorage } from '@zana-ai/zcc-plugin-sdk/server';

const LEGACY_MODULE_ID = 'pr-monitor';

export function defaultPrMonitorDataDir(): string {
  return process.env.ZCC_DATA_DIR?.trim() || process.env.ZCC_CENTER_DIR?.trim() || join(homedir(), '.zcc');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One-time copy of `~/.zcc/modules/pr-monitor.json` into plugin KV when the
 * plugin store is empty. Never overwrites a non-empty plugin store.
 */
export async function migrateLegacyKv(
  kv: PluginKvStorage,
  dataDir = defaultPrMonitorDataDir()
): Promise<boolean> {
  const keys = await kv.list();
  if (keys.length > 0) return false;
  const legacyPath = join(dataDir, 'modules', `${LEGACY_MODULE_ID}.json`);
  if (!existsSync(legacyPath)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(legacyPath, 'utf8'));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return false;
  for (const [key, value] of entries) {
    await kv.set(key, value);
  }
  return true;
}
