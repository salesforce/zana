import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('useFileOperations clipboard', () => {
  it('copies paths through the desktop clipboard bridge', () => {
    const source = readFileSync(new URL('./useFileOperations.ts', import.meta.url), 'utf8');
    expect(source).toContain('await copyText(path)');
    expect(source).not.toContain('navigator.clipboard');
  });
});
