import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Never clear an active run's traces. Keep the most recent 20 finished runs. */
export function pruneCompletedRuns(root = fileURLToPath(new URL('../e2e/.artifacts/runs', import.meta.url)), keep = 20) {
  if (!existsSync(root)) return;
  const completed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    try {
      completed.push({ path, time: statSync(join(path, '.zcc-complete')).mtimeMs });
    } catch (error) {
      // Another finishing run may have removed this completed directory.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  completed.sort((a, b) => b.time - a.time);
  for (const { path } of completed.slice(keep)) rmSync(path, { recursive: true, force: true });
}
