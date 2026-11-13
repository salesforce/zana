import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS, isProjectColor, pickProjectColor } from './project-colors.js';

describe('pickProjectColor', () => {
  it('returns the first palette color when nothing is in use', () => {
    expect(pickProjectColor([])).toBe(PROJECT_COLORS[0]);
  });

  it('walks the palette in order for the first N distinct projects', () => {
    const inUse: string[] = [];
    for (const expected of PROJECT_COLORS) {
      const picked = pickProjectColor(inUse);
      expect(picked).toBe(expected);
      inUse.push(picked);
    }
  });

  it('wraps to the least-used color once every slot is taken', () => {
    // One of each, plus an extra of the first — the first is now the only
    // doubly-used color, so the next pick must avoid it and land on the second.
    const inUse = [...PROJECT_COLORS, PROJECT_COLORS[0]];
    expect(pickProjectColor(inUse)).toBe(PROJECT_COLORS[1]);
  });

  it('ignores colors outside the palette and nullish entries', () => {
    expect(pickProjectColor(['#123456', undefined, null, 'not-a-color'])).toBe(PROJECT_COLORS[0]);
  });

  it('always returns a palette member', () => {
    const picked = pickProjectColor(['#2f81f7', '#3fb950']);
    expect(PROJECT_COLORS).toContain(picked);
  });
});

describe('isProjectColor', () => {
  it('accepts every palette color', () => {
    for (const c of PROJECT_COLORS) expect(isProjectColor(c)).toBe(true);
  });

  it.each([undefined, null, 5, '', '#123456', '#2F81F7', 'blue'])('rejects %s', (v) => {
    expect(isProjectColor(v)).toBe(false);
  });
});
