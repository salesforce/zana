import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readPersistedHostId } from '@zana-ai/zcc-host-daemon/identity';

export function createPersistedHostIdDeps(resolveDataDir: () => string): {
  readPersistedHostId: () => string | null;
  statHostIdFile: () => string | null;
} {
  return {
    readPersistedHostId: () => readPersistedHostId(resolveDataDir()),
    statHostIdFile: () => statHostIdFileToken(resolveDataDir())
  };
}

/**
 * Cheap revision token for the daemon's persisted `host.id` file, or null when
 * the file is missing/unreadable. Includes ino and size alongside mtimeMs so an
 * atomic tmp+rename replacement is detected. Residual risk: a same-size rewrite
 * on a filesystem with coarse timestamps that reuses the inode within one tick
 * is indistinguishable; host ids are uuid-length, so this is accepted.
 */
export function statHostIdFileToken(dataDir: string): string | null {
  try {
    const s = statSync(join(dataDir, 'host.id'));
    return `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch {
    return null;
  }
}

/**
 * The machine this desktop main process runs on. A packaged/production app
 * learns it from its own enrolled utility daemon. A dev-attach app
 * (`ELECTRON_RENDERER_URL`, no supervisor) talks to a separately launched
 * daemon sharing the same data dir, so read the daemon's persisted `host.id`.
 * Without either, stay undefined: host guards then refuse explicit machines.
 *
 * On dev attach the persisted id is re-read only when `statHostIdFile`'s token
 * changes, so a restarted daemon that re-enrolls is picked up. Without a stat
 * function the first non-null read is cached.
 */
export function createLocalHostIdResolver(deps: {
  supervisorHostId: () => string | undefined;
  devAttach: () => boolean;
  readPersistedHostId: () => string | null;
  statHostIdFile?: () => string | null;
}): () => string | undefined {
  let cached: string | undefined;
  let cachedToken: string | null | undefined;
  return () => {
    const enrolled = deps.supervisorHostId();
    if (enrolled) return enrolled;
    if (!deps.devAttach()) return undefined;
    if (!deps.statHostIdFile) {
      cached ??= deps.readPersistedHostId() ?? undefined;
      return cached;
    }
    let token: string | null;
    try { token = deps.statHostIdFile(); } catch { token = null; }
    if (token === null) {
      cached = undefined;
      cachedToken = undefined;
      return undefined;
    }
    if (cached !== undefined && token === cachedToken) return cached;
    let id: string | null;
    try { id = deps.readPersistedHostId(); } catch { id = null; }
    if (id) {
      cached = id;
      cachedToken = token;
      return cached;
    }
    // Failed/empty read: never cache, so the next call retries.
    cached = undefined;
    cachedToken = undefined;
    return undefined;
  };
}
