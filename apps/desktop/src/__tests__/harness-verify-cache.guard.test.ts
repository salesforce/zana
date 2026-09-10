import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const configIpc = readFileSync(new URL('../ipc/config.ts', import.meta.url), 'utf8');

describe('harness verify cache invalidation', () => {
  it('busts the cache when any harness binary or enable flag changes, including Grok', () => {
    for (const token of [
      'patch.claudeBinary !== undefined',
      'patch.cursorBinary !== undefined',
      'patch.codexBinary !== undefined',
      'patch.piBinary !== undefined',
      'patch.opencodeBinary !== undefined',
      'patch.grokBinary !== undefined',
      'patch.harnessCursorEnabled !== undefined',
      'patch.harnessCodexEnabled !== undefined',
      'patch.harnessPiEnabled !== undefined',
      'patch.harnessOpenCodeEnabled !== undefined',
      'patch.harnessGrokEnabled !== undefined'
    ]) {
      expect(configIpc, token).toContain(token);
    }
  });
});
