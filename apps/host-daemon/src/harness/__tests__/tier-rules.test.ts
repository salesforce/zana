import { describe, expect, it } from 'vitest';
import { resolveTierFromRules } from '../tier-rules.js';

const live = [
  'gw/alpha-2-luna', 'gw/alpha-3-luna', 'gw/alpha-9-terra', 'gw/alpha-10-terra', 'gw/alpha-10-terrace', 'gw/beta-1-sol'
];

describe('resolveTierFromRules', () => {
  it('picks the highest version among whole-word matches, whatever the list order', () => {
    expect(resolveTierFromRules(['terra'], live)).toBe('gw/alpha-10-terra');
    expect(resolveTierFromRules(['terra'], [...live].reverse())).toBe('gw/alpha-10-terra');
  });

  it('does not match part of a word', () => {
    expect(resolveTierFromRules(['terr'], live)).toBeUndefined();
    expect(resolveTierFromRules(['terrace'], live)).toBe('gw/alpha-10-terrace');
  });

  it('prefers an exact model id over a term, then falls through rules in order', () => {
    expect(resolveTierFromRules(['gw/alpha-9-terra', 'terra'], live)).toBe('gw/alpha-9-terra');
    expect(resolveTierFromRules(['gone-model', 'sol'], live)).toBe('gw/beta-1-sol');
  });

  it('matches case-insensitively and escapes regex characters', () => {
    expect(resolveTierFromRules(['LUNA'], live)).toBe('gw/alpha-3-luna');
    expect(resolveTierFromRules(['.*'], live)).toBeUndefined();
  });

  it('ignores bad input: no rules, non-array, non-string, blank, oversized, empty inventory', () => {
    expect(resolveTierFromRules(undefined, live)).toBeUndefined();
    expect(resolveTierFromRules('terra', live)).toBeUndefined();
    expect(resolveTierFromRules([42, '  ', 'x'.repeat(129), 'sol'], live)).toBe('gw/beta-1-sol');
    expect(resolveTierFromRules(['terra'], [])).toBeUndefined();
  });

  it('reads only the first eight rules', () => {
    expect(resolveTierFromRules([...Array(8).fill('nope'), 'sol'], live)).toBeUndefined();
  });
});
