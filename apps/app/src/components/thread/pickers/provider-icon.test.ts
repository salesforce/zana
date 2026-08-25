import { describe, expect, it } from 'vitest';
import { providerIconForId } from './provider-icon.js';

describe('providerIconForId', () => {
  it('resolves brand marks for the built-in harnesses', () => {
    expect(providerIconForId('claude-code')).not.toBeNull();
    expect(providerIconForId('codex')).not.toBeNull();
    expect(providerIconForId('pi')).not.toBeNull();
    expect(providerIconForId('acp-cursor')).not.toBeNull();
    expect(providerIconForId('acp-opencode')).not.toBeNull();
  });

  it('returns null for unknown ids so the picker can fall back to a letter', () => {
    expect(providerIconForId('fake')).toBeNull();
    expect(providerIconForId('unknown-plugin')).toBeNull();
  });
});
