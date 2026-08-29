import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best-effort local complete when the product HTTP archive route is missing
 * or stale. Uses the sqlite3 CLI so Electron main does not have to load the
 * better-sqlite3 native addon (ABI mismatches would crash host startup).
 */
export function completeThreadAtDataDir(dataDir: string, threadId: string): boolean {
  if (!THREAD_ID.test(threadId)) return false;
  const file = join(dataDir, 'zcc.sqlite');
  if (!existsSync(file)) return false;
  const now = Date.now();
  try {
    const out = execFileSync('sqlite3', [
      file,
      `UPDATE legacy_agent_sessions SET status='completed', updated_at=${now} WHERE id='${threadId}' AND status IN ('starting','running'); SELECT COALESCE((SELECT status FROM legacy_agent_sessions WHERE id='${threadId}'), '');`
    ], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true
    }).trim();
    return out === 'completed' || out === 'failed';
  } catch {
    return false;
  }
}
