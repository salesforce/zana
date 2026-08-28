import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRIVATE_IMPORT = /from\s+["']@zana-ai\/zcc-(?:domain|provider-bridge-protocol|host-daemon-contract)(?:\/[^"']*)?["']/u;

async function listProductionTs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listProductionTs(path)));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    files.push(path);
  }
  return files;
}

describe('ACP host SDK imports', () => {
  it('keeps production host-graph files on the public provider-bridge facade', async () => {
    const root = join(import.meta.dirname);
    const files = await listProductionTs(root);
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (PRIVATE_IMPORT.test(source)) offenders.push(file.slice(root.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
