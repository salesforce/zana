import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep in lockstep with packages/agent-runtime/src/shared/bridge-path.ts */
export const PACKED_BRIDGE_WORKER_FILE = 'bb-provider-bridge-worker.mjs';

/**
 * Directory that holds the packed join artifact's provider-bridge files.
 * Present next to `join.mjs` on a remote; absent when running from source.
 */
export function packedBridgeBundleDir(fromUrl: string = import.meta.url): string | undefined {
  const dir = dirname(fileURLToPath(fromUrl));
  return existsSync(join(dir, PACKED_BRIDGE_WORKER_FILE)) ? dir : undefined;
}
