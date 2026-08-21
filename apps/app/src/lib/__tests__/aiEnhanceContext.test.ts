import { describe, it, expect } from 'vitest';
import { buildSurroundingContext } from '../aiEnhanceContext.js';

describe('buildSurroundingContext', () => {
  it('returns the full text unchanged when under the char budget', () => {
    const text = 'short file content';
    expect(buildSurroundingContext(text, 0, text.length)).toBe(text);
  });

  it('trims to a window around the selection and marks it, with ellipses when truncated on both sides', () => {
    const before = 'a'.repeat(50);
    const selection = 'SELECTED';
    const after = 'b'.repeat(50);
    const text = before + selection + after;
    const start = before.length;
    const end = start + selection.length;

    const out = buildSurroundingContext(text, start, end, 40);

    expect(out).toContain('[SELECTION]');
    expect(out.startsWith('…\n')).toBe(true);
    expect(out.endsWith('\n…')).toBe(true);
    expect(out.length).toBeLessThan(text.length);
  });

  it('omits the leading ellipsis when the window reaches the start of the file', () => {
    const text = 'x'.repeat(10) + 'y'.repeat(200);
    const out = buildSurroundingContext(text, 0, 10, 40);
    expect(out.startsWith('…')).toBe(false);
  });

  it('omits the trailing ellipsis when the window reaches the end of the file', () => {
    const text = 'x'.repeat(200) + 'y'.repeat(10);
    const out = buildSurroundingContext(text, 190, 200, 40);
    expect(out.endsWith('…')).toBe(false);
  });
});
