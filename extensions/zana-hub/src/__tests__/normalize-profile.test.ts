import { describe, it, expect } from 'vitest';
import { validateProfile, normalizeProfile } from '../main/normalize-profile.js';
import type { ZanaProfileTemplate } from '../shared/types.js';

const NOW = '2026-07-08T12:00:00.000Z';

function tmpl(over: Partial<ZanaProfileTemplate> = {}): ZanaProfileTemplate {
  return {
    displayName: 'Core Architect',
    allowedTools: ['Read', 'Grep'],
    disallowedTools: ['Write'],
    ...over
  };
}

describe('validateProfile', () => {
  it('accepts a valid template', () => {
    expect(validateProfile(tmpl())).toBeNull();
  });
  it('rejects empty display name', () => {
    expect(validateProfile(tmpl({ displayName: '  ' }))).toMatch(/name/i);
  });
  it('rejects non-array tool lists', () => {
    expect(validateProfile(tmpl({ allowedTools: undefined as never }))).toMatch(/tool/i);
    expect(validateProfile(tmpl({ disallowedTools: undefined as never }))).toMatch(/tool/i);
  });
});

describe('normalizeProfile', () => {
  it('writes the editable scalar fields', () => {
    const out = normalizeProfile(
      tmpl({
        icon: '🔍',
        description: 'desc',
        category: 'engineering',
        model: 'claude-opus-4-8',
        effortLevel: 'high',
        permissionMode: 'default',
        systemPrompt: 'You review code.'
      }),
      {},
      'p1',
      NOW
    );
    expect(out.displayName).toBe('Core Architect');
    expect(out.icon).toBe('🔍');
    expect(out.description).toBe('desc');
    expect(out.category).toBe('engineering');
    expect(out.model).toBe('claude-opus-4-8');
    expect(out.effortLevel).toBe('high');
    expect(out.permissionMode).toBe('default');
    expect(out.systemPrompt).toBe('You review code.');
  });
  it('cleans tool lists: trims, drops empties + duplicates, preserves order', () => {
    const out = normalizeProfile(
      tmpl({ allowedTools: [' Read ', 'Grep', '', 'Read', 'mcp__x__*'], disallowedTools: ['Write', 'Write'] }),
      {},
      'p1',
      NOW
    );
    expect(out.allowedTools).toEqual(['Read', 'Grep', 'mcp__x__*']);
    expect(out.disallowedTools).toEqual(['Write']);
  });
  it('preserves unknown/unedited keys round-trip', () => {
    const base = { someFutureKey: 'keep-me', nested: { a: 1 } };
    const out = normalizeProfile(tmpl(), base, 'p1', NOW);
    expect(out.someFutureKey).toBe('keep-me');
    expect(out.nested).toEqual({ a: 1 });
  });
  it('retains createdAt from base but always restamps updatedAt', () => {
    const out = normalizeProfile(tmpl(), { createdAt: '2020-01-01T00:00:00.000Z' }, 'p1', NOW);
    expect(out.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBe(NOW);
  });
  it('defaults createdAt to now when base has none', () => {
    const out = normalizeProfile(tmpl(), {}, 'p1', NOW);
    expect(out.createdAt).toBe(NOW);
  });
  it('preserves builtIn from the base, defaulting to false', () => {
    expect(normalizeProfile(tmpl(), { builtIn: true }, 'p1', NOW).builtIn).toBe(true);
    expect(normalizeProfile(tmpl(), {}, 'p1', NOW).builtIn).toBe(false);
  });
  it('stamps the resolved id', () => {
    expect(normalizeProfile(tmpl(), {}, 'resolved-id', NOW).id).toBe('resolved-id');
  });
});
