import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanDist } from './clean-dist.mjs';

describe('clean-dist', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('removes an existing dist directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-clean-dist-'));
    roots.push(dir);
    mkdirSync(join(dir, 'mac-arm64'), { recursive: true });
    writeFileSync(join(dir, 'Zana-Command-Center-2.0.0-arm64.dmg'), 'old');
    expect(cleanDist(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('is a no-op when dist is already gone', () => {
    const dir = join(tmpdir(), `zcc-clean-dist-missing-${process.pid}`);
    expect(existsSync(dir)).toBe(false);
    expect(cleanDist(dir)).toBe(false);
  });
});
