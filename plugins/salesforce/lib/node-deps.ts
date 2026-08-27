import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type { SalesforceDeps } from './types.js';
import { createContainedSpawner, createExecSf, salesforceRestRequest } from './sf-cli.js';

export function createNodeDeps(): SalesforceDeps {
  return {
    execSf: createExecSf(),
    request: salesforceRestRequest,
    now: () => Date.now(),
    exists: (path) => existsSync(path),
    stat: (path) => {
      try {
        const info = statSync(path);
        if (info.isDirectory()) return 'dir';
        if (info.isFile()) return 'file';
        return 'missing';
      } catch {
        return 'missing';
      }
    },
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    readdir: (path) => readdirSync(path),
    realpath: (path) => realpathSync(path),
    spawnContained: createContainedSpawner()
  };
}
