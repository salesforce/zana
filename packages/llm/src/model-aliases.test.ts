import { describe, it, expect } from 'vitest';
import { resolveModelAlias, isKnownModel } from './model-aliases.js';

describe('resolveModelAlias', () => {
  it('maps Claude tier aliases to OpenAI ids', () => {
    expect(resolveModelAlias('openai', 'haiku')).toBe('gpt-4o-mini');
    expect(resolveModelAlias('openai', 'sonnet')).toBe('gpt-4o');
    expect(resolveModelAlias('openai', 'opus')).toBe('gpt-4o');
  });

  it('maps Claude tier aliases to Gemini ids', () => {
    expect(resolveModelAlias('gemini', 'haiku')).toBe('gemini-2.0-flash');
    expect(resolveModelAlias('gemini', 'opus')).toBe('gemini-1.5-pro');
  });

  it('passes a provider-native id through unchanged', () => {
    expect(resolveModelAlias('openai', 'gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(resolveModelAlias('gemini', 'gemini-1.5-flash')).toBe('gemini-1.5-flash');
  });

  it('leaves claude-cli aliases untouched (no map)', () => {
    expect(resolveModelAlias('claude-cli', 'haiku')).toBe('haiku');
  });

  it('returns undefined for empty / whitespace / undefined', () => {
    expect(resolveModelAlias('openai', undefined)).toBeUndefined();
    expect(resolveModelAlias('openai', '   ')).toBeUndefined();
  });

  it('trims surrounding whitespace before mapping', () => {
    expect(resolveModelAlias('openai', '  haiku ')).toBe('gpt-4o-mini');
  });
});

describe('isKnownModel', () => {
  it('accepts undefined (provider default applies)', () => {
    expect(isKnownModel('openai', undefined)).toBe(true);
  });

  it('accepts Claude tier aliases for any provider', () => {
    expect(isKnownModel('openai', 'haiku')).toBe(true);
    expect(isKnownModel('gemini', 'sonnet')).toBe(true);
  });

  it('accepts plausible provider-native ids', () => {
    expect(isKnownModel('openai', 'gpt-4o')).toBe(true);
  });

  it('rejects an empty / whitespace string', () => {
    expect(isKnownModel('openai', '')).toBe(false);
    expect(isKnownModel('openai', '   ')).toBe(false);
  });

  it("rejects a typo'd alias for a tier-map provider", () => {
    expect(isKnownModel('openai', 'haiky')).toBe(false);
    expect(isKnownModel('gemini', 'sonet')).toBe(false);
  });

  it('rejects clear garbage for a tier-map provider', () => {
    expect(isKnownModel('openai', 'not a model')).toBe(false);
    expect(isKnownModel('openai', 'garbage')).toBe(false);
    expect(isKnownModel('openai', 'GPT 4')).toBe(false);
  });

  it('accepts every mapped native id for its provider', () => {
    expect(isKnownModel('openai', 'gpt-4o')).toBe(true);
    expect(isKnownModel('openai', 'gpt-4o-mini')).toBe(true);
    expect(isKnownModel('gemini', 'gemini-2.0-flash')).toBe(true);
    expect(isKnownModel('gemini', 'gemini-1.5-pro')).toBe(true);
  });

  it('accepts any non-empty string for a provider without a tier map', () => {
    expect(isKnownModel('claude-cli', 'anything')).toBe(true);
  });
});
