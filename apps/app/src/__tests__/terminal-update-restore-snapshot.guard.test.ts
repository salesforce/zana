import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('terminal update restore snapshot guard', () => {
  it('persists main-created sessions received through terminal updates', () => {
    const source = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
    const listener = source.slice(
      source.indexOf('product.terminals.onUpdated((session) => {'),
      source.indexOf('// Live agent-state pushes', source.indexOf('product.terminals.onUpdated((session) => {'))
    );

    expect(listener).toContain('get().persistOpenSessions();');
  });
});
