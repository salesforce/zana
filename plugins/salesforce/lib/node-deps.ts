import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      const staging = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(staging, content, { encoding: 'utf8', mode: 0o600 });
      renameSync(staging, path);
    },
    spawnContained: createContainedSpawner(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}
