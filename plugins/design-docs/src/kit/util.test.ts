import { describe, expect, it } from 'vitest';
import { fitText, formatNumber, linearScale, niceTicks, parseCsv, textWidth, toNumber } from './util.js';

describe('formatNumber', () => {
  it('writes numbers by preset or Intl options', () => {
    expect(formatNumber(1234.567, 'number', 'en-US')).toBe('1,234.57');
    expect(formatNumber(1234.567, 'integer', 'en-US')).toBe('1,235');
    expect(formatNumber(0.6234, 'percent', 'en-US')).toBe('62.3%');
    expect(formatNumber(1_520_000, 'compact', 'en-US')).toBe('1.5M');
    expect(formatNumber(4.2, { style: 'currency', currency: 'USD' }, 'en-US')).toBe('$4.20');
    expect(formatNumber(3, 'nonsense' as never, 'en-US')).toBe('3');
  });

  it('writes a dash for anything that is not a finite number', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatNumber(value)).toBe('–');
  });

  it('keeps formatting right past its formatter cache', () => {
    for (let digits = 0; digits < 60; digits += 1) {
      expect(formatNumber(1, { minimumFractionDigits: digits % 20, maximumFractionDigits: 20, minimumIntegerDigits: 1 + Math.floor(digits / 20) }, 'en-US')).toMatch(/^0*1/);
    }
  });
});

describe('niceTicks', () => {
  it('rounds the axis out to clean steps', () => {
    expect(niceTicks(0, 87)).toEqual({ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceTicks(0.41, 0.69, 3)).toEqual({ min: 0.4, max: 0.7, ticks: [0.4, 0.5, 0.6, 0.7] });
    expect(niceTicks(-4, 25, 4)).toEqual({ min: -10, max: 30, ticks: [-10, 0, 10, 20, 30] });
    expect(niceTicks(0, 7, 1).ticks).toEqual([0, 10]);
    expect(niceTicks(0, 3, 1).ticks).toEqual([0, 5]);
  });

  it('copes with flat, reversed and broken ranges', () => {
    expect(niceTicks(0, 0)).toMatchObject({ min: 0, max: 1 });
    expect(niceTicks(5, 5)).toMatchObject({ min: 4.4, max: 5.6 });
    expect(niceTicks(0.05, 0.05)).toMatchObject({ min: 0.045, max: 0.06 });
    expect(niceTicks(-5, -5)).toMatchObject({ min: -5.6, max: -4.4 });
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
    expect(niceTicks(Number.NaN, 4)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });
});

describe('scales and text', () => {
  it('maps a domain onto a range', () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(25)).toBe(150);
    expect(linearScale([3, 3], [0, 10])(3)).toBe(0);
  });

  it('estimates text width and shortens what does not fit', () => {
    expect(textWidth('iii')).toBeLessThan(textWidth('MMM'));
    expect(textWidth('Ab1', 10)).toBeCloseTo(18.5);
    expect(fitText('Short', 200)).toBe('Short');
    const cut = fitText('A rather long category name', 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut)).toBeLessThanOrEqual(60);
    expect(fitText('Wide', 1)).toBe('W…');
  });
});

describe('toNumber', () => {
  it('reads table cells as numbers', () => {
    expect(toNumber(' 1,234 ')).toBe(1234);
    expect(toNumber('62%')).toBe(62);
    expect(toNumber('$4.20')).toBe(4.2);
    expect(toNumber('−3')).toBe(-3);
    expect(toNumber('1e3')).toBe(1000);
    expect(toNumber('.5')).toBe(0.5);
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber('')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('reads rows keyed by the header, numbers as numbers', () => {
    const csv = '﻿week,Claude,note\r\nW1,0.52,"a, b"\nW2,,"say ""hi"""\n\nW3,0.6,"two\nlines"\nW4,1e2\n';
    expect(parseCsv(csv)).toEqual([
      { week: 'W1', Claude: 0.52, note: 'a, b' },
      { week: 'W2', Claude: '', note: 'say "hi"' },
      { week: 'W3', Claude: 0.6, note: 'two\nlines' },
      { week: 'W4', Claude: 100, note: '' }
    ]);
  });

  it('reads a last line without a newline, and nothing from nothing', () => {
    expect(parseCsv('a,b\n1,x')).toEqual([{ a: 1, b: 'x' }]);
    expect(parseCsv('a,b\n1,')).toEqual([{ a: 1, b: '' }]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});
