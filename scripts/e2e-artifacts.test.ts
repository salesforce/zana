import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneCompletedRuns } from './e2e-artifacts.mjs';

it('bounds completed artifacts without removing active runs or unrelated files', () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-artifact-test-'));
  try {
    for (const name of ['old', 'recent', 'active']) mkdirSync(join(root, name));
    writeFileSync(join(root, 'file'), 'keep');
    for (const [index, name] of ['old', 'recent'].entries()) {
      const marker = join(root, name, '.zcc-complete');
      writeFileSync(marker, '');
      utimesSync(marker, index + 1, index + 1);
    }
    pruneCompletedRuns(root, 1);
    expect(readdirSync(root).sort()).toEqual(['active', 'file', 'recent']);
    expect(() => pruneCompletedRuns(join(root, 'missing'))).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
