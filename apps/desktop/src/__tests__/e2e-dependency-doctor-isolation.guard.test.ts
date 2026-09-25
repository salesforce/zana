import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('E2E dependency-doctor isolation', () => {
  it('does not auto-run installed provider CLIs during isolated E2E startup', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'host.ts'), 'utf8');
    expect(source).toMatch(
      /if \(!E2E_LAUNCH\) \{\s*doctor\s*\.check\(\)\s*\.catch\(\(err\) => logMainError\('dependencyDoctor\.check', err\)\);\s*\}/
    );
  });
});
