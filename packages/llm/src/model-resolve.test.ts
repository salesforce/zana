import { describe, it, expect } from 'vitest';
import { resolveModelAlias } from './model-resolve.js';

describe('resolveModelAlias', () => {
  it('passes through a non-alias string unchanged', () => {
    expect(resolveModelAlias('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(resolveModelAlias('us.anthropic.claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8');
    expect(resolveModelAlias('global.anthropic.claude-opus-4-6-v1')).toBe('global.anthropic.claude-opus-4-6-v1');
  });

  it('passes through "default" unchanged (not a family alias)', () => {
    expect(resolveModelAlias('default')).toBe('default');
  });

  it('resolves a bare family alias to a string containing that family name', () => {
    // On this machine settings.json has "model": "us.anthropic.claude-opus-4-8",
    // so 'opus' resolves to that. On a machine with no settings, it passes through.
    const result = resolveModelAlias('opus');
    expect(/opus/i.test(result)).toBe(true);
  });

  it('handles mixed case alias (Opus, OPUS)', () => {
    const r1 = resolveModelAlias('Opus');
    const r2 = resolveModelAlias('OPUS');
    expect(/opus/i.test(r1)).toBe(true);
    expect(/opus/i.test(r2)).toBe(true);
  });
});
