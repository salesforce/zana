import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const bundledBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin', 'zcc.js');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bundled zcc bin', () => {
  it('loads plugin ls under plain Node without walking TypeScript sources', async () => {
    expect(existsSync(bundledBin)).toBe(true);
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-bundled-plugin-ls-'));
    dirs.push(dataDir);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      bundledBin,
      'plugin',
      'ls',
      '--data-dir',
      dataDir
    ]);
    expect(stderr).not.toMatch(/plugin-id\.js/);
    expect(stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(stdout).toMatch(/No plugins installed/);
  });
});
