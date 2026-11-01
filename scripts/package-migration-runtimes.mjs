import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

/** Release-only compatibility artifacts. Fresh profiles never install these. */
export async function packageMigrationRuntimes(definitions, destination, version, prepareRuntime, readManifest) {
  for (const definition of definitions) {
    const staging = await mkdtemp(join(tmpdir(), 'zcc-migration-runtime-'));
    try {
      const checkout = join(staging, 'checkout');
      await promisify(execFile)('git', ['clone', '--depth', '1', '--single-branch', '--branch', definition.ref, '--', definition.url, checkout], {
        timeout: 120_000, maxBuffer: 1_048_576, windowsHide: true
      });
      if (readManifest(checkout).id !== definition.pluginId) throw new Error('Migration runtime identity mismatch');
      await prepareRuntime(checkout, resolve(destination, 'migration-runtimes', definition.name), version);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}
