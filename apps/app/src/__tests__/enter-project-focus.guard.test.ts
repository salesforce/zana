import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('enterProjectFocus', () => {
  it('resets the workspace to the Agents board', () => {
    const source = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
    const start = source.indexOf('enterProjectFocus: (id) => {');
    const next = source.indexOf('exitProjectFocus:', start);
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    const body = source.slice(start, next);
    expect(body).toContain("get().setWorkspaceMode(id, 'agents')");
  });
});
