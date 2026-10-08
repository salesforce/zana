import { describe, expect, it } from 'vitest';
import { fromRows, MAX_POINTS, resolveSpec } from './chart-spec.js';

const BAR = { type: 'bar', labels: ['A', 'B'], series: [{ name: 'One', values: [1, 2] }] };

describe('resolveSpec', () => {
  it('fills in the defaults', () => {
    expect(resolveSpec(BAR)).toEqual({
      type: 'bar',
      labels: ['A', 'B'],
      series: [{ name: 'One', values: [1, 2], slot: 1 }],
      title: null,
      stacked: false,
      horizontal: false,
      area: false,
      format: 'number',
      yMin: null,
      yMax: null,
      height: null,
      valueLabels: null,
      table: true,
      xLabel: ''
    });
  });

  it('keeps what the page asked for', () => {
    const spec = resolveSpec({
      type: 'line',
      labels: [2024, 2025],
      series: [
        { name: ' Cost ', values: ['1.5', null], slot: 4 },
        { name: 'Plan', values: [2, ''] }
      ],
      title: ' Spend ',
      area: true,
      format: { style: 'currency', currency: 'EUR' },
      yMin: 0,
      yMax: 5,
      height: 300,
      valueLabels: false,
      table: false,
      xLabel: 'Year'
    });
    expect(spec).toMatchObject({ labels: ['2024', '2025'], title: 'Spend', area: true, yMin: 0, yMax: 5, height: 300, valueLabels: false, table: false, xLabel: 'Year' });
    expect(spec.series).toEqual([
      { name: 'Cost', values: [1.5, null], slot: 4 },
      { name: 'Plan', values: [2, null], slot: 2 }
    ]);
  });

  it('takes series from rows', () => {
    const rows = [
      { week: 'W1', a: 1, b: '2' },
      { week: 'W2', a: null, b: 3 }
    ];
    const spec = resolveSpec({ type: 'bar', data: rows, x: 'week', y: ['a', { column: 'b', name: 'Bee', slot: 3 }] });
    expect(spec.labels).toEqual(['W1', 'W2']);
    expect(spec.series).toEqual([
      { name: 'a', values: [1, null], slot: 1 },
      { name: 'Bee', values: [2, 3], slot: 3 }
    ]);
    expect(spec.xLabel).toBe('week');
    expect(fromRows([{ x: undefined, v: 1 }], 'x', 'v')).toEqual({ labels: [''], series: [{ name: 'v', values: [1] }] });
    expect(fromRows([{ x: 'a', v: 1 }], 'x', [{ column: 'v', name: '' }]).series[0]!.name).toBe('v');
  });

  it('says how to fix a bad spec', () => {
    const bad = (patch: Record<string, unknown>, message: RegExp) => expect(() => resolveSpec({ ...BAR, ...patch })).toThrow(message);
    expect(() => resolveSpec(null)).toThrow(/must be an object/);
    expect(() => resolveSpec([])).toThrow(/must be an object/);
    bad({ type: 'pie' }, /type must be "bar" or "line"/);
    bad({ labels: 'A,B' }, /labels must be an array/);
    bad({ labels: Array.from({ length: MAX_POINTS + 1 }, String) }, /at most 2000 points/);
    bad({ series: [] }, /non-empty array/);
    bad({ series: Array.from({ length: 9 }, (_, index) => ({ name: `s${index}`, values: [1, 2] })) }, /9 series is more than 8.*"Other"/);
    bad({ series: ['x'] }, /series\[0\] must be an object/);
    bad({ series: [{ values: [1, 2] }] }, /series\[0\] needs a name/);
    bad({ series: [{ name: 'S', values: 3 }] }, /values must be an array/);
    bad({ series: [{ name: 'S', values: [1] }] }, /"S" has 1 values for 2 labels; use null for a gap/);
    bad({ series: [{ name: 'S', values: [1, 'many'] }] }, /value 2 is "many", not a number/);
    bad({ series: [{ name: 'S', values: [1, 2], slot: 9 }] }, /slot must be 1 to 8/);
    bad({ series: [{ name: 'S', values: [1, 2], slot: 2 }, { name: 'T', values: [1, 2] }] }, /"S" and "T" both use color slot 2/);
    bad({ format: 'money' }, /format must be/);
    bad({ format: 3 }, /format must be/);
    bad({ height: 20 }, /height must be 80 to 2000/);
    bad({ height: '300' }, /height must be a number/);
    bad({ stacked: 'yes' }, /stacked must be true or false/);
    bad({ type: 'line', stacked: true }, /for bar charts/);
    bad({ area: true }, /area is for line charts/);
    bad({ yMin: 5, yMax: 5 }, /yMin must be below yMax/);
    bad({ data: 'data/runs.csv' }, /has not loaded yet/);
    bad({ data: { a: 1 } }, /data must be rows/);
    bad({ data: [{ a: 1 }] }, /x must name the column/);
    bad({ data: [{ a: 1 }], x: 'a', y: [5] }, /y\[0\] must name a value column/);
    bad({ data: [{ a: 1 }], x: 'a', y: [] }, /at least one value column/);
    bad({ data: [3], x: 'a', y: 'b' }, /data\[0\] is not an object/);
    bad({ data: [{ a: 1, b: {} }], x: 'a', y: 'b' }, /data\[0\]\.b is \{\}/);
  });
});
