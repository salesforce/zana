import { describe, expect, it } from 'vitest';
import {
  isHostToPlayground,
  isPlaygroundToHost,
  PLAYGROUND_ASSET_SRC,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme
} from './playground-bridge.js';

describe('playground bridge', () => {
  it('accepts typed host and playground messages', () => {
    expect(PLAYGROUND_ASSET_SRC).toContain('/plugins/salesforce/assets/playground/');
    expect(
      isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' })
    ).toBe(true);
    expect(
      isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'persist', path: 'a.agent', content: 'x' })
    ).toBe(true);
    expect(isPlaygroundToHost({ source: 'other', type: 'ready' })).toBe(false);
    expect(
      isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave' })
    ).toBe(true);
    expect(
      isHostToPlayground({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setDialect', dialect: 'agentscript' })
    ).toBe(true);
    expect(isHostToPlayground({ type: 'flushSave' })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty' })).toBe(false);
    expect(isPlaygroundToHost({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty', dirty: true })).toBe(true);
  });

  it('reads light and dark document themes', () => {
    const scope = globalThis as { document?: { documentElement: { getAttribute(name: string): string | null } } };
    const previous = scope.document;
    scope.document = { documentElement: { getAttribute: () => 'light' } };
    expect(readDocumentTheme()).toBe('light');
    scope.document = { documentElement: { getAttribute: () => 'dark' } };
    expect(readDocumentTheme()).toBe('dark');
    scope.document = previous;
  });
});
