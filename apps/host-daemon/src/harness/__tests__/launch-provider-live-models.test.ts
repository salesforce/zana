import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLiveModelTargets,
  launchScopedProvider,
  liveModelTargetsFor,
  recordLiveModelTargets,
  withLiveModelTargets,
  type LaunchProvider
} from '../launch-provider.js';
import { OpenCodeProvider } from '../opencode/provider.js';
import { providerFor } from '../registry.js';

describe('launch-scoped live model inventory', () => {
  afterEach(() => {
    clearLiveModelTargets();
    vi.useRealTimers();
  });

  it('keys records per (adapter, cwd) and copies the recorded ids', () => {
    const ids = ['x/one'];
    recordLiveModelTargets('opencode', '/a', ids);
    recordLiveModelTargets('codex', '/a', ['y/two']);
    ids.push('x/mutated');
    expect(liveModelTargetsFor('opencode', '/a')).toEqual(['x/one']);
    expect(liveModelTargetsFor('codex', '/a')).toEqual(['y/two']);
    expect(liveModelTargetsFor('opencode', '/b')).toBeUndefined();
  });

  it('an unavailable or empty probe discards only its own key', () => {
    recordLiveModelTargets('opencode', '/a', ['x/one']);
    recordLiveModelTargets('opencode', '/b', ['x/two']);
    recordLiveModelTargets('opencode', '/a', undefined);
    expect(liveModelTargetsFor('opencode', '/a')).toBeUndefined();
    recordLiveModelTargets('opencode', '/b', []);
    expect(liveModelTargetsFor('opencode', '/b')).toBeUndefined();
  });

  it('expires records after the TTL', () => {
    vi.useFakeTimers();
    recordLiveModelTargets('opencode', '/a', ['x/one']);
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(liveModelTargetsFor('opencode', '/a')).toEqual(['x/one']);
    vi.advanceTimersByTime(1);
    expect(liveModelTargetsFor('opencode', '/a')).toBeUndefined();
  });

  it('warns loudly when a recorded inventory expires before its spawn, not when none was recorded', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(liveModelTargetsFor('opencode', '/never')).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      recordLiveModelTargets('opencode', '/a', ['x/one']);
      vi.advanceTimersByTime(5 * 60_000);
      expect(liveModelTargetsFor('opencode', '/a')).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('expired before spawn');
    } finally {
      warn.mockRestore();
    }
  });

  it('is bounded: the oldest record is evicted past 64 entries', () => {
    for (let index = 0; index <= 64; index += 1) recordLiveModelTargets('opencode', `/p${index}`, ['x/one']);
    expect(liveModelTargetsFor('opencode', '/p0')).toBeUndefined();
    expect(liveModelTargetsFor('opencode', '/p1')).toEqual(['x/one']);
    expect(liveModelTargetsFor('opencode', '/p64')).toEqual(['x/one']);
  });

  it('clears one adapter or all adapters', () => {
    recordLiveModelTargets('opencode', '/a', ['x/one']);
    recordLiveModelTargets('codex', '/a', ['y/two']);
    clearLiveModelTargets('opencode');
    expect(liveModelTargetsFor('opencode', '/a')).toBeUndefined();
    expect(liveModelTargetsFor('codex', '/a')).toEqual(['y/two']);
    clearLiveModelTargets();
    expect(liveModelTargetsFor('codex', '/a')).toBeUndefined();
  });

  it('launchScopedProvider returns the shared provider without a cwd, a record, or live-model support', () => {
    const shared = new OpenCodeProvider();
    recordLiveModelTargets('opencode', '/a', ['llmgw/gpt-7-luna']);
    expect(launchScopedProvider(shared, undefined)).toBe(shared);
    expect(launchScopedProvider(shared, '/b')).toBe(shared);
    expect(launchScopedProvider(shared, '/a').adapter.descriptor.targets?.modelLevelMapping.low).toBe('llmgw/gpt-7-luna');
    const plain = providerFor('claude');
    recordLiveModelTargets(plain.adapter.descriptor.id, '/a', ['x/one']);
    expect(launchScopedProvider(plain, '/a')).toBe(plain);
    expect(withLiveModelTargets(plain as LaunchProvider, ['x/one'])).toBe(plain);
  });
});
