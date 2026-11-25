import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { sep } from 'node:path';

/** A JSON object, or null for anything else (arrays, primitives, null). */
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Open a file the way an untrusted path deserves: no symlink follow, regular files only, and the real path
 * must sit under `root`. Returns null for anything else. Never throws.
 */
export async function openConfined(path: string, root: string) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) { await handle.close(); return null; }
    const [real, realRoot] = await Promise.all([realpath(path), realpath(root)]);
    if (!real.startsWith(realRoot + sep)) { await handle.close(); return null; }
    return { handle, size: stats.size };
  } catch {
    try { await handle?.close(); } catch { /* ignore */ }
    return null;
  }
}
