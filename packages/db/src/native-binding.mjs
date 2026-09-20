import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Same layout for preparation, Node servers and Electron utility processes. */
export function sqliteAbiCachePath(abi, { cacheRoot, packageVersion, platform = process.platform, arch = process.arch }) {
  return join(cacheRoot, 'better-sqlite3', packageVersion, `${platform}-${arch}`, `abi-${abi}.node`);
}

/** Resolve from this module's dependency search path, never the user's project cwd. */
export function sqliteNativeBinding(requireFrom = createRequire(import.meta.url), exists = existsSync, runtime = process) {
  const packageVersion = requireFrom('better-sqlite3/package.json').version;
  for (const modules of requireFrom.resolve.paths('better-sqlite3') ?? []) {
    const candidate = sqliteAbiCachePath(runtime.versions.modules, {
      cacheRoot: join(modules, '.cache', 'zcc-native-abi'),
      packageVersion,
      platform: runtime.platform,
      arch: runtime.arch
    });
    if (exists(candidate)) return candidate;
  }
  // Packaged installs use electron-builder's native addon in the app bundle.
  return undefined;
}
