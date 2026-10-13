import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('root discovery collects owned tests and excludes cached checkouts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-vitest-discovery-'));
  try {
    for (const path of ['src/owned.test.ts', '.pnpm-store/v11/files/cached.test.ts', 'nested/.pnpm-store/cached.test.ts', '.worktrees/branch/copied.test.ts']) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'import { it } from "vitest"; it("fixture", () => {});');
    }
    const { stdout } = await promisify(execFile)(process.execPath, [
      resolve('node_modules/vitest/vitest.mjs'), 'list', '--config', resolve('vitest.config.ts'), '--root', root, '--filesOnly'
    ], { timeout: 15_000 });
    expect(stdout).toContain('src/owned.test.ts');
    expect(stdout).not.toContain('cached.test.ts');
    expect(stdout).not.toContain('copied.test.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
