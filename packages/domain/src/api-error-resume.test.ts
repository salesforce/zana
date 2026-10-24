import { describe, it, expect } from 'vitest';
import {
  API_ERROR_RESUME_DEFAULTS as D,
  apiErrorResumeRuleKey,
  API_ERROR_RESUME_SUGGESTIONS,
  buildApiErrorMatchText,
  isValidResumePattern,
  normalizeApiErrorResume,
  sanitizeResumeMessage
} from './api-error-resume.js';

describe('sanitizeResumeMessage', () => {
  it('falls back for non-strings and empty results', () => {
    expect(sanitizeResumeMessage(42)).toBe('continue');
    expect(sanitizeResumeMessage(undefined)).toBe('continue');
    expect(sanitizeResumeMessage('  \u001b\u0007 ')).toBe('continue');
  });
  it('turns CR/LF/TAB into spaces and strips ESC, C0, DEL and C1', () => {
    expect(sanitizeResumeMessage('a\r\nb\tc')).toBe('a b c');
    expect(sanitizeResumeMessage('x\u001b[31my\u0000\u007f\u0085\u009fz')).toBe('x[31myz');
  });
  it('collapses spaces, trims and caps length', () => {
    expect(sanitizeResumeMessage('  go    on  ')).toBe('go on');
    const out = sanitizeResumeMessage('a'.repeat(500));
    expect(out).toHaveLength(D.maxMessageChars);
  });
});

describe('isValidResumePattern', () => {
  it('accepts valid and rejects invalid patterns', () => {
    expect(isValidResumePattern('foo.*bar')).toBe(true);
    expect(isValidResumePattern('(unclosed')).toBe(false);
  });
});

describe('apiErrorResumeRuleKey', () => {
  it('ignores case and outer spaces for contains, and only outer spaces for regex', () => {
    const k = apiErrorResumeRuleKey;
    expect(k({ match: ' Rate Limited ', matchMode: 'contains' })).toBe(k({ match: 'rate limited', matchMode: 'contains' }));
    expect(k({ match: 'Rate.*', matchMode: 'regex' })).not.toBe(k({ match: 'rate.*', matchMode: 'regex' }));
    expect(k({ match: ' rate.* ', matchMode: 'regex' })).toBe(k({ match: 'rate.*', matchMode: 'regex' }));
    expect(k({ match: 'rate.*', matchMode: 'regex' })).not.toBe(k({ match: 'rate.*', matchMode: 'contains' }));
  });
});

describe('normalizeApiErrorResume', () => {
  it('returns undefined for non-objects', () => {
    for (const v of [undefined, null, 'x', 5, [], true]) expect(normalizeApiErrorResume(v)).toBeUndefined();
  });
  it('defaults an empty object', () => {
    expect(normalizeApiErrorResume({})).toEqual({ enabled: false, rules: [], maxPerWindow: 3, windowMinutes: 15 });
  });
  it('enabled is true only for boolean true', () => {
    expect(normalizeApiErrorResume({ enabled: true })!.enabled).toBe(true);
    expect(normalizeApiErrorResume({ enabled: 'true' })!.enabled).toBe(false);
  });
  it('ignores non-array rules and non-object / bad-match rules', () => {
    expect(normalizeApiErrorResume({ rules: 'x' })!.rules).toEqual([]);
    const rules = normalizeApiErrorResume({
      rules: [null, 'x', {}, { match: 5 }, { match: 'abc' }, { match: 'a'.repeat(301) }, { match: '  ok match  ' }]
    })!.rules;
    expect(rules.map(r => r.match)).toEqual(['ok match']);
  });
  it('applies rule defaults', () => {
    const [r] = normalizeApiErrorResume({ rules: [{ match: 'overloaded' }] })!.rules;
    expect(r).toMatchObject({ matchMode: 'contains', message: 'continue', delaySeconds: 20, enabled: true });
    expect(r.caseSensitive).toBeUndefined();
  });
  it('drops invalid regex but keeps regex-looking contains text', () => {
    const rules = normalizeApiErrorResume({
      rules: [
        { match: '(unclosed', matchMode: 'regex' },
        { match: '(unclosed', matchMode: 'contains' },
        { match: 'err(or)?', matchMode: 'regex', caseSensitive: true },
        { match: 'other.*', matchMode: 'regex', caseSensitive: 'yes' }
      ]
    })!.rules;
    expect(rules.map(r => [r.matchMode, r.match, r.caseSensitive])).toEqual([
      ['contains', '(unclosed', undefined],
      ['regex', 'err(or)?', true],
      ['regex', 'other.*', undefined]
    ]);
  });
  it('keeps caseSensitive only on regex rules', () => {
    const [r] = normalizeApiErrorResume({ rules: [{ match: 'abcd', caseSensitive: true }] })!.rules;
    expect(r).not.toHaveProperty('caseSensitive');
  });
  it('clamps delay, perWindow and window', () => {
    const c = (rule: object, top: object = {}) => normalizeApiErrorResume({ rules: [{ match: 'abcd', ...rule }], ...top })!;
    expect(c({ delaySeconds: 1 }).rules[0].delaySeconds).toBe(5);
    expect(c({ delaySeconds: 9999 }).rules[0].delaySeconds).toBe(600);
    expect(c({ delaySeconds: 12.6 }).rules[0].delaySeconds).toBe(13);
    expect(c({ delaySeconds: NaN }).rules[0].delaySeconds).toBe(20);
    expect(c({ delaySeconds: '9' }).rules[0].delaySeconds).toBe(20);
    expect(c({}, { maxPerWindow: 0 }).maxPerWindow).toBe(1);
    expect(c({}, { maxPerWindow: 99 }).maxPerWindow).toBe(10);
    expect(c({}, { windowMinutes: 1 }).windowMinutes).toBe(5);
    expect(c({}, { windowMinutes: 1000 }).windowMinutes).toBe(120);
  });
  it('sanitises messages and honours enabled:false', () => {
    const [r] = normalizeApiErrorResume({ rules: [{ match: 'abcd', message: 'go\u001b on', enabled: false }] })!.rules;
    expect(r.message).toBe('go on');
    expect(r.enabled).toBe(false);
  });
  it('keeps good unique ids and regenerates bad or duplicate ones', () => {
    const rules = normalizeApiErrorResume({
      rules: [
        { id: 'good-1', match: 'aaaa' },
        { id: 'good-1', match: 'bbbb' },
        { id: 'bad id!', match: 'cccc' },
        { id: 7, match: 'dddd' }
      ]
    })!.rules;
    expect(rules[0].id).toBe('good-1');
    expect(rules[1].id).toMatch(/^r1-[0-9a-z]+$/);
    expect(rules[2].id).toMatch(/^r2-/);
    expect(rules[3].id).toMatch(/^r3-/);
    expect(new Set(rules.map(r => r.id)).size).toBe(4);
  });
  it('makes a generated id unique even when it collides', () => {
    const a = normalizeApiErrorResume({ rules: [{ id: 'r1-x', match: 'aaaa' }] })!.rules[0].id;
    expect(a).toBe('r1-x');
    const rules = normalizeApiErrorResume({ rules: [{ match: 'aaaa' }, { id: 'r1-' + 'x', match: 'bbbb' }] })!.rules;
    expect(new Set(rules.map(r => r.id)).size).toBe(2);
    // force a collision: the generated id for index 1 equals an earlier explicit id
    const probe = normalizeApiErrorResume({ rules: [{ match: 'zzzz' }, { match: 'yyyy' }] })!.rules[1].id;
    const clash = normalizeApiErrorResume({ rules: [{ id: probe, match: 'zzzz' }, { match: 'yyyy' }] })!.rules;
    expect(new Set(clash.map(r => r.id)).size).toBe(2);
  });
  it('dedupes contains case-insensitively and regex case-sensitively, keeping the first', () => {
    const rules = normalizeApiErrorResume({
      rules: [
        { match: 'Overloaded', message: 'one' },
        { match: 'overloaded', message: 'two' },
        { match: 'Over.*', matchMode: 'regex' },
        { match: 'over.*', matchMode: 'regex' },
        { match: 'Over.*', matchMode: 'regex' }
      ]
    })!.rules;
    expect(rules.map(r => r.match)).toEqual(['Overloaded', 'Over.*', 'over.*']);
    expect(rules[0].message).toBe('one');
  });
  it('caps rules at maxRules', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ match: `rule number ${i}` }));
    expect(normalizeApiErrorResume({ rules: many })!.rules).toHaveLength(D.maxRules);
  });
});

describe('suggestions', () => {
  it('are valid rules once normalised', () => {
    const out = normalizeApiErrorResume({ rules: API_ERROR_RESUME_SUGGESTIONS })!.rules;
    expect(out).toHaveLength(2);
  });
});

describe('buildApiErrorMatchText', () => {
  it('joins, collapses whitespace and trims', () => {
    expect(buildApiErrorMatchText(' a\n b ', '\t c  ')).toBe('a b c');
  });
  it('caps length', () => {
    expect(buildApiErrorMatchText('x'.repeat(5000), 'y')).toHaveLength(D.maxMatchTextChars);
  });
});
