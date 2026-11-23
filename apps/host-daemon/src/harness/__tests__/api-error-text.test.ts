import { describe, expect, it } from 'vitest';
import { MAX_API_ERROR_TEXT, sanitizeApiErrorText } from '../api-error-text.js';

describe('sanitizeApiErrorText', () => {
  it('returns empty for non-strings', () => {
    expect(sanitizeApiErrorText(undefined)).toBe('');
    expect(sanitizeApiErrorText(42)).toBe('');
  });
  it('strips ANSI and control characters and collapses whitespace', () => {
    expect(sanitizeApiErrorText('\u001b[31mred\u001b[0m  \u0000bad\u0007\n text\u009f')).toBe('red bad text');
    expect(sanitizeApiErrorText('a\u001b]0;title\u0007b')).toBe('a b');
  });
  it('caps without splitting a surrogate pair', () => {
    const text = `${'a'.repeat(9)}😀tail`;
    expect(sanitizeApiErrorText(text, 10)).toBe('a'.repeat(9));
    expect(sanitizeApiErrorText('x'.repeat(MAX_API_ERROR_TEXT + 50)).length).toBe(MAX_API_ERROR_TEXT);
  });
});
