import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vite product proxy', () => {
  it('forwards /api and /ws to the loopback product server', () => {
    const source = readFileSync(new URL('../../vite.dev.config.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/['"]\/api['"]/);
    expect(source).toMatch(/['"]\/ws['"]/);
    expect(source).toMatch(/ws:\s*true/);
    expect(source).toMatch(/serverPortFromEnv/);
  });
});
