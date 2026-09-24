import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
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
    readFileBounded: (path, maxBytes) => {
      const fd = openSync(path, 'r');
      try {
        if (fstatSync(fd).size > maxBytes) throw Error('This source exceeds the preview size limit.');
        const bytes = Buffer.alloc(maxBytes + 1);
        let count = 0;
        while (count <= maxBytes) {
          const read = readSync(fd, bytes, count, bytes.length - count, null);
          if (!read) break;
          count += read;
        }
        if (count > maxBytes) throw Error('This source exceeds the preview size limit.');
        return bytes.subarray(0, count).toString('utf8');
      } finally { closeSync(fd); }
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
    createFile: (path, content) => {
      const staging = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
      const fd = openSync(staging, 'wx', 0o600);
      try {
        writeFileSync(fd, content, 'utf8');
        linkSync(staging, path);
      } finally {
        try { closeSync(fd); } finally { unlinkSync(staging); }
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}
