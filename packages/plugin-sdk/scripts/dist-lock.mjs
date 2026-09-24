import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lockDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.dist-pack-lock');

/** Serialize build-runtime's `rm dist` with any `npm pack` of this package. */
export async function withPluginSdkDistLock(fn) {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error('timed out waiting for the plugin-sdk dist lock');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
