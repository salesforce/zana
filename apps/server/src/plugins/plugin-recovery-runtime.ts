import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { scanPluginFiles } from './plugin-file-scan.js';

const MAX_BYTES = 64 * 1024 * 1024;

/** Restore only from the host-owned app bundle, never an installed override. */
export async function copyBundledPluginRuntime(args: {
  dataDir: string; bundledRoot: string; name: string; signal: AbortSignal;
}): Promise<string> {
  try {
    args.signal.throwIfAborted();
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(args.name)) throw new Error('Invalid bundled plugin name');
    const base = await realpath(args.bundledRoot);
    const source = await realpath(join(base, args.name));
    if (!isWithin(source, base) || source === base) throw new Error('Bundled plugin escapes the app bundle');
    return await copyRuntime(args.dataDir, source, 'runtime', false, args.signal);
  } catch (error) {
    args.signal.throwIfAborted();
    throw new Error(`Cannot restore bundled plugin "${args.name}": ${error instanceof Error ? error.message : String(error)}. Reinstall Zana if its bundled files are missing or damaged.`);
  }
}

/** Keep rollback code inside managed storage, including for an app-owned bundle. */
export async function copyRecoveryRollbackRuntime(dataDir: string, source: string): Promise<string> {
  return copyRuntime(dataDir, source, 'rollback', true);
}

async function copyRuntime(dataDir: string, source: string, leaf: string, allowMissing: boolean, signal?: AbortSignal): Promise<string> {
  const generation = join(dataDir, 'plugins', 'generations', randomUUID());
  const root = join(generation, leaf);
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const exists = await stat(source).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw error;
    });
    let size = 0;
    for (const file of exists ? await scanPluginFiles(source, 10_000) : []) {
      signal?.throwIfAborted();
      const original = join(source, file);
      const info = await stat(original);
      size += info.size;
      if (!info.isFile() || size > MAX_BYTES) throw new Error('Plugin runtime exceeds the file or size limit');
      await mkdir(dirname(join(root, file)), { recursive: true, mode: 0o700 });
      await copyFile(original, join(root, file));
    }
    signal?.throwIfAborted();
    return root;
  } catch (error) { await rm(generation, { recursive: true, force: true }); throw error; }
}
