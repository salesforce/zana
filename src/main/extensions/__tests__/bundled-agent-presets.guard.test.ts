import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

describe('bundled framework extensions', () => {
  it('does not ship Consensus in the bundled catalog', () => {
    expect(existsSync(join(repoRoot, 'bundled-extensions', 'consensus'))).toBe(false);
  });
});
