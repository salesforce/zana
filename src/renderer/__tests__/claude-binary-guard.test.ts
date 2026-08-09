import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SETTINGS_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'components', 'settings');

describe('claudeBinary Settings Editor Guard', () => {
  it('proves config.claudeBinary has exactly one settings editor', () => {
    const offenders: string[] = [];
    const files = readdirSync(SETTINGS_DIR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

    for (const name of files) {
      const fullPath = join(SETTINGS_DIR, name);
      const content = readFileSync(fullPath, 'utf8');
      if (content.includes('claudeBinary')) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual(['HarnessTab.tsx']);
  });
});
