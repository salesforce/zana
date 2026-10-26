import { promises as fs, constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { HostInspectDirectoriesResult } from '@zana-ai/zcc-contracts/host-rpc';
import { HostCommandError } from './host-command-error.js';

/** Metadata only: never enumerate a checkout to check its availability. */
export async function inspectDirectories(paths: readonly string[]): Promise<HostInspectDirectoriesResult> {
  if (paths.length < 1 || paths.length > 100 || paths.some(path => !isAbsolute(path))) {
    throw new HostCommandError('invalid_path', 'Choose between 1 and 100 absolute folder paths');
  }
  const directories: HostInspectDirectoriesResult['directories'] = [];
  // Bound concurrent filesystem work even on slow network mounts.
  for (let offset = 0; offset < paths.length; offset += 8) {
    directories.push(...await Promise.all(paths.slice(offset, offset + 8).map(async requestedPath => {
      try {
        const path = await fs.realpath(requestedPath);
        if (!(await fs.stat(path)).isDirectory()) return { requestedPath, path: null, status: 'not-directory' as const };
        await fs.access(path, constants.R_OK | constants.X_OK);
        return { requestedPath, path, status: 'ready' as const };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { requestedPath, path: null, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' as const : 'inaccessible' as const };
      }
    })));
  }
  return { directories };
}
