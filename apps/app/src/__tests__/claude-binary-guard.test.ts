import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SETTINGS_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'views', 'settings');

describe('claudeBinary Settings Editor Guard', () => {
  it('proves config.claudeBinary has exactly one settings editor', () => {
    const offenders: string[] = [];
    const files = readdirSync(SETTINGS_DIR).filter(
      (f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.test.')
    );

    for (const name of files) {
      const fullPath = join(SETTINGS_DIR, name);
      const content = readFileSync(fullPath, 'utf8');
      if (content.includes('claudeBinary')) {
        offenders.push(name);
      }
    }

    // The key table moved out of the view (so the search index can share it
    // without importing the view). The view must still be the ONLY editor: it
    // consumes the shared table, and no other settings file names the key.
    expect(offenders).toEqual([]);
    expect(readFileSync(join(SETTINGS_DIR, 'HarnessView.tsx'), 'utf8')).toContain('HARNESS_BINARY_KEY');
    const owner = readFileSync(join(SETTINGS_DIR, '..', '..', 'lib', 'settings-search', 'providers', 'harness.ts'), 'utf8');
    expect(owner).toContain("claude: 'claudeBinary'");
  });
});
