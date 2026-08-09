import { describe, expect, it } from 'vitest';
import { harnessEnablePatch, unavailableDefaultMessage } from '../HarnessTab.js';

describe('HarnessTab unavailable default', () => {
  it('preserves configured intent and explains explicit recovery choices', () => {
    const patch = harnessEnablePatch('codex', false);

    expect(patch).toEqual({ harnessCodexEnabled: false });
    expect(patch).not.toHaveProperty('defaultHarness');
    expect(unavailableDefaultMessage('codex')).toBe(
      'Default harness codex is disabled or unavailable. Defaulted launches will block until you restore it, choose another default, or clear it.'
    );
  });
});
