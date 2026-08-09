import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('remote tmux startup grace', () => {
  it('uses restore grace for both persistent tmux scopes', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).toContain("store.getConfig().tmuxScope === 'off' ? 0 : TMUX_REAP_GRACE_MS");
  });
});
