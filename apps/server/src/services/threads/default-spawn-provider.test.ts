import { describe, expect, it } from 'vitest';
import { defaultSpawnProviderId } from './default-spawn-provider.js';

const providers = [{ id: 'acp-afcode' }, { id: 'codex' }, { id: 'claude-code' }, { id: 'acp-cursor' }];

describe('defaultSpawnProviderId', () => {
  it('prefers the default harness over registration order', () => {
    expect(defaultSpawnProviderId(providers, 'claude')).toBe('claude-code');
    expect(defaultSpawnProviderId(providers, 'cursor')).toBe('acp-cursor');
    expect(defaultSpawnProviderId(providers, 'codex')).toBe('codex');
  });

  it('falls back to the first provider when the default is unset or not registered', () => {
    expect(defaultSpawnProviderId(providers, undefined)).toBe('acp-afcode');
    expect(defaultSpawnProviderId([{ id: 'codex' }], 'claude')).toBe('codex');
  });

  it('skips unavailable providers before falling back to registration order', () => {
    const rows = [{ id: 'acp-afcode', unavailableReason: 'host artifact missing' }, { id: 'codex' }, { id: 'claude-code', unavailableReason: 'x' }];
    expect(defaultSpawnProviderId(rows, 'claude')).toBe('codex');
    expect(defaultSpawnProviderId(rows, null)).toBe('codex');
    expect(defaultSpawnProviderId([{ id: 'pi', unavailableReason: 'x' }], null)).toBe('pi');
    expect(defaultSpawnProviderId([], 'claude')).toBeNull();
  });
});
