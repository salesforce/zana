import { describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from './chart-spec.js';
import { createChart, drawSparkline, roundedRect } from './charts.js';
import type { KitWindow } from './dom.js';
import { page } from './test/window.js';

const never = () => Promise.reject(new Error('no files here'));

function chartPage(): { win: KitWindow; figure: HTMLElement } {
  const win = page('<figure id="c"></figure>');
  return { win, figure: win.document.querySelector<HTMLElement>('#c')! };
}

const all = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)];

function pointer(win: KitWindow, target: Element, type: string, clientX = 0, clientY = 0): void {
  target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, clientX, clientY }));
}

function key(win: KitWindow, target: Element, name: string): boolean {
  const event = new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function tooltip(win: KitWindow): { hidden: boolean; head: string; rows: string[][]; keys: string[] } {
  const element = win.document.querySelector<HTMLElement>('.kit-tooltip')!;
  return {
    hidden: element.hidden,
    head: element.querySelector('.head')?.textContent ?? '',
    rows: all(element, '.row').map((row) => [row.querySelector('.v')!.textContent!, row.querySelector('.k')!.textContent!]),
    keys: all(element, '.row').map((row) => (row as HTMLElement).style.getPropertyValue('--c'))
  };
}

describe('roundedRect', () => {
  it('rounds only the corners asked for', () => {
    expect(roundedRect(0, 0, 10, 20, 4, [true, true, false, false])).toBe('M4,0H6A4,4 0 0 1 10,4V20H0V4A4,4 0 0 1 4,0Z');
    expect(roundedRect(0, 0, 10, 20, 4, [false, false, false, false])).toBe('M0,0H10V20H0V0Z');
  });
});

describe('column charts', () => {
  it('draws one series with value labels, a caption, a table and a tooltip per bar', () => {
    const { win, figure } = chartPage();
    const chart = createChart(win, '#c', { type: 'bar', title: 'Pass rate', labels: ['Mon', 'Tue', 'Wed'], series: [{ name: 'Claude', values: [0.5, null, 0.75] }], format: 'percent' }, never);
    expect(chart.element).toBe(figure);
    expect(figure.classList.contains('chart')).toBe(true);
    expect(figure.querySelector('figcaption')!.textContent).toBe('Pass rate');
    expect(figure.querySelector('.chart-legend')).toBeNull();
    const svg = figure.querySelector('.chart-plot svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Pass rate. Column chart of Claude over 3 points; the data table follows.');
    expect(svg.getAttribute('width')).toBe('640');
    expect(all(svg, 'path.chart-mark.chart-s1')).toHaveLength(2);
    expect(all(svg, 'text.chart-value').map((text) => text.textContent)).toEqual(['50%', '75%']);
    expect(all(svg, 'text.chart-category').map((text) => text.textContent)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(all(svg, 'rect.chart-hit')).toHaveLength(3);
    expect(all(figure, 'details.chart-table tbody tr').map((row) => row.textContent)).toEqual(['Mon50%', 'Tue–', 'Wed75%']);
    expect(figure.querySelector('details.chart-table thead')!.textContent).toBe('Claude');

    const hit = svg.querySelector('rect.chart-hit[data-stop="2"]')!;
    pointer(win, hit, 'pointermove', 300, 120);
    expect(tooltip(win)).toEqual({ hidden: false, head: 'Wed', rows: [['75%', 'Claude']], keys: ['var(--series-1)'] });
    expect(all(svg, 'path.chart-mark')[1]!.classList.contains('on')).toBe(true);
    pointer(win, svg.querySelector('.chart-grid')!, 'pointermove');
    expect(tooltip(win).hidden).toBe(true);
    expect(all(svg, '.chart-mark.on')).toHaveLength(0);
    pointer(win, hit, 'pointermove');
    pointer(win, svg, 'pointerleave');
    expect(tooltip(win).hidden).toBe(true);
  });

  it('walks the bars with the keyboard and remembers where it was', () => {
    const { win, figure } = chartPage();
    createChart(win, figure, { type: 'bar', labels: ['A', 'B', 'C'], series: [{ name: 'S', values: [1, 2, 3] }] }, never);
    const svg = figure.querySelector('svg')!;
    svg.dispatchEvent(new win.FocusEvent('focus'));
    expect(tooltip(win).head).toBe('A');
    expect(key(win, svg, 'ArrowRight')).toBe(true);
    key(win, svg, 'ArrowDown');
    key(win, svg, 'ArrowDown');
    expect(tooltip(win).head).toBe('C');
    key(win, svg, 'ArrowLeft');
    expect(tooltip(win).head).toBe('B');
    key(win, svg, 'Escape');
    expect(tooltip(win).hidden).toBe(true);
    key(win, svg, 'ArrowUp');
    expect(tooltip(win).head).toBe('A');
    key(win, svg, 'End');
    expect(tooltip(win).head).toBe('C');
    key(win, svg, 'Home');
    expect(tooltip(win).head).toBe('A');
    expect(key(win, svg, 'x')).toBe(false);
    svg.dispatchEvent(new win.FocusEvent('blur'));
    expect(tooltip(win).hidden).toBe(true);
    svg.dispatchEvent(new win.FocusEvent('focus'));
    expect(tooltip(win).head).toBe('A');
  });

  it('groups series with a legend that hides one at a time but never all', () => {
    const { win, figure } = chartPage();
    createChart(
      win,
      figure,
      {
        type: 'bar',
        labels: ['fix', 'refactor', 'docs'],
        series: [
          { name: 'Claude', values: [3, -2, 4] },
          { name: 'Codex', values: [1, 2, null], slot: 3 }
        ],
        yMax: 10,
        yMin: -5
      },
      never
    );
    const legend = figure.querySelector('ul.chart-legend')!;
    expect(legend.classList.contains('lines')).toBe(false);
    const [claude, codex] = all(legend, 'button') as HTMLButtonElement[];
    expect([claude!.className, codex!.className]).toEqual(['chart-s1', 'chart-s3']);
    const svg = () => figure.querySelector('svg')!;
    expect(all(svg(), 'path.chart-mark')).toHaveLength(5);
    expect(all(svg(), 'text.chart-value')).toHaveLength(0);
    expect(all(svg(), 'rect.chart-hit')).toHaveLength(6);
    expect(svg().getAttribute('aria-label')).toBe('Column chart of 2 series over 3 points; the data table follows.');
    const ticks = all(svg(), 'text.chart-tick').map((text) => Number(text.textContent));
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-5);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(10);

    pointer(win, svg().querySelector('rect.chart-hit[data-stop="3"]')!, 'pointermove');
    expect(tooltip(win).rows).toEqual([['2', 'Codex']]);

    claude!.click();
    expect(claude!.getAttribute('aria-pressed')).toBe('false');
    expect(all(svg(), 'path.chart-mark.chart-s3')).toHaveLength(2);
    expect(all(svg(), 'path.chart-mark.chart-s1')).toHaveLength(0);
    expect(tooltip(win).hidden).toBe(true);
    codex!.click();
    expect(codex!.getAttribute('aria-pressed')).toBe('true');
    expect(all(svg(), 'path.chart-mark.chart-s3')).toHaveLength(2);
    claude!.click();
    expect(all(svg(), 'path.chart-mark')).toHaveLength(5);
    expect(figure.querySelector('details.chart-table thead')!.textContent).toBe('ClaudeCodex');
  });

  it('stacks segments with totals in labels and tooltips', () => {
    const { win, figure } = chartPage();
    createChart(
      win,
      figure,
      {
        type: 'bar',
        stacked: true,
        valueLabels: true,
        labels: ['W1', 'W2'],
        series: [
          { name: 'Pass', values: [6, 4] },
          { name: 'Fail', values: [2, -1] },
          { name: 'Skip', values: [0, null] }
        ],
        table: false
      },
      never
    );
    const svg = figure.querySelector('svg')!;
    expect(figure.querySelector('details.chart-table')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBe('Column chart of 3 series over 2 points.');
    expect(all(svg, 'path.chart-mark')).toHaveLength(4);
    expect(all(svg, 'text.chart-value').map((text) => text.textContent)).toEqual(['8', '4', '-1']);
    expect(all(svg, 'rect.chart-hit')).toHaveLength(4);
    pointer(win, svg.querySelector('rect.chart-hit[data-stop="1"]')!, 'pointermove');
    expect(tooltip(win)).toMatchObject({ head: 'W1', rows: [['2', 'Fail'], ['8', 'Total']], keys: ['var(--series-2)', ''] });
  });
});

describe('bar charts', () => {
  it('lays out horizontal bars with value labels after each bar', () => {
    const { win, figure } = chartPage();
    createChart(win, figure, { type: 'bar', horizontal: true, labels: ['Alpha', 'Beta'], series: [{ name: 'Score', values: [40, -10] }] }, never);
    const svg = figure.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Bar chart of Score over 2 points; the data table follows.');
    expect(svg.getAttribute('height')).toBe(String(4 + 26 + 34 * 2));
    const values = all(svg, 'text.chart-value');
    expect(values.map((text) => [text.textContent, text.getAttribute('text-anchor')])).toEqual([
      ['40', 'start'],
      ['-10', 'end']
    ]);
    pointer(win, svg.querySelector('rect.chart-hit[data-stop="1"]')!, 'pointermove', 100, 40);
    expect(tooltip(win).head).toBe('Beta');
  });

  it('groups and stacks horizontally, at a fixed height', () => {
    const { win, figure } = chartPage();
    const chart = createChart(
      win,
      figure,
      {
        type: 'bar',
        horizontal: true,
        height: 200,
        labels: ['A', 'B'],
        series: [
          { name: 'One', values: [5, 3] },
          { name: 'Two', values: [2, -4] },
          { name: 'Three', values: [1, 1] }
        ],
        valueLabels: true
      },
      never
    );
    let svg = figure.querySelector('svg')!;
    expect(svg.getAttribute('height')).toBe('200');
    expect(all(svg, 'path.chart-mark')).toHaveLength(6);
    expect(all(svg, 'text.chart-value')).toHaveLength(6);
    expect(all(svg, 'rect.chart-hit')).toHaveLength(6);

    return chart.update({ type: 'bar', horizontal: true, stacked: true, valueLabels: true, labels: ['A', 'B'], series: [{ name: 'One', values: [5, 3] }, { name: 'Two', values: [2, -4] }] }).then(() => {
      svg = figure.querySelector('svg')!;
      expect(all(svg, 'text.chart-value').map((text) => text.textContent)).toEqual(['7', '3', '-4']);
      pointer(win, svg.querySelector('rect.chart-hit[data-stop="3"]')!, 'pointermove');
      expect(tooltip(win).rows).toEqual([
        ['-4', 'Two'],
        ['-1', 'Total']
      ]);
    });
  });

  it('skips value labels that would not fit and shortens long categories', () => {
    const { win, figure } = chartPage();
    const labels = Array.from({ length: 12 }, (_, index) => `A very long category name for item ${index}`);
    createChart(win, figure, { type: 'bar', labels, series: [{ name: 'S', values: labels.map(() => 123_456_789) }] }, never);
    const svg = figure.querySelector('svg')!;
    expect(all(svg, 'text.chart-value')).toHaveLength(0);
    const categories = all(svg, 'text.chart-category');
    expect(categories.length).toBeLessThan(12);
    expect(categories.every((text) => text.textContent!.endsWith('…'))).toBe(true);
  });
});

describe('line charts', () => {
  const WEEKS = ['W1', 'W2', 'W3', 'W4'];

  it('draws lines with gaps, end dots, names at the ends and a crosshair', () => {
    const { win, figure } = chartPage();
    createChart(
      win,
      figure,
      {
        type: 'line',
        labels: WEEKS,
        series: [
          { name: 'Claude', values: [0.2, null, 0.6, 0.9] },
          { name: 'Codex', values: [0.1, 0.3, 0.2, 0.1] }
        ],
        format: 'percent',
        xLabel: 'Week'
      },
      never
    );
    expect(figure.querySelector('ul.chart-legend.lines')).not.toBeNull();
    const svg = figure.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Line chart of 2 series over 4 points; the data table follows.');
    const claude = svg.querySelector('path.chart-line.chart-s1')!.getAttribute('d')!;
    expect(claude.match(/M/g)).toHaveLength(2);
    expect(all(svg, 'circle.chart-dot')).toHaveLength(2);
    expect(all(svg, 'text.chart-series-label').map((text) => text.textContent)).toEqual(['Claude', 'Codex']);
    expect(all(svg, 'path.chart-area')).toHaveLength(0);
    expect(figure.querySelector('details.chart-table th')!.textContent).toBe('Week');
    const categories = all(svg, 'text.chart-category').map((text) => text.getAttribute('text-anchor'));
    expect(categories).toEqual(['start', 'middle', 'middle', 'end']);

    const overlay = svg.querySelector('rect.chart-overlay')!;
    const crosshair = svg.querySelector('line.chart-crosshair')!;
    const left = Number(crosshair.getAttribute('x1'));
    pointer(win, overlay, 'pointermove', 10_000, 50);
    expect(tooltip(win).head).toBe('W4');
    expect(tooltip(win).rows).toEqual([
      ['90%', 'Claude'],
      ['10%', 'Codex']
    ]);
    expect(crosshair.getAttribute('visibility')).toBe('visible');
    expect(Number(crosshair.getAttribute('x1'))).toBeGreaterThan(left);
    pointer(win, overlay, 'pointermove', -10_000, 50);
    expect(tooltip(win).head).toBe('W1');
    key(win, svg, 'ArrowRight');
    expect(tooltip(win)).toMatchObject({ head: 'W2', rows: [['30%', 'Codex'], ['–', 'Claude']] });
    expect(all(svg, 'g circle.chart-dot').length).toBeGreaterThan(2);
    pointer(win, svg, 'pointerleave');
    expect(crosshair.getAttribute('visibility')).toBe('hidden');
  });

  it('drops end names that would touch, and fills areas down to zero', () => {
    const { win, figure } = chartPage();
    createChart(
      win,
      figure,
      {
        type: 'line',
        area: true,
        labels: WEEKS,
        series: [
          { name: 'A', values: [5, 6, 7, 8] },
          { name: 'B', values: [4, 5, null, 8] }
        ]
      },
      never
    );
    const svg = figure.querySelector('svg')!;
    expect(all(svg, 'text.chart-series-label')).toHaveLength(0);
    expect(all(svg, 'path.chart-area')).toHaveLength(3);
    expect(all(svg, 'text.chart-tick')[0]!.textContent).toBe('0');
  });

  it('names no ends for a single series or one that stops early, and draws a single point', () => {
    const { win, figure } = chartPage();
    const chart = createChart(win, figure, { type: 'line', labels: WEEKS, series: [{ name: 'A', values: [1, 2, 3, null] }, { name: 'B', values: [1, 2, 3, 4] }], yMin: -10, yMax: 50 }, never);
    let svg = figure.querySelector('svg')!;
    expect(all(svg, 'text.chart-series-label')).toHaveLength(0);
    const baseline = svg.querySelector('line.chart-baseline')!;
    expect(Number(baseline.getAttribute('y1'))).toBeLessThan(250);
    return chart
      .update({ type: 'line', labels: ['Only'], series: [{ name: 'A', values: [3] }], yMin: 1 })
      .then(() => {
        svg = figure.querySelector('svg')!;
        expect(svg.querySelector('path.chart-line')!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
        expect(svg.querySelector('text.chart-category')!.getAttribute('text-anchor')).toBe('middle');
        pointer(win, svg.querySelector('rect.chart-overlay')!, 'pointermove', 5, 5);
        expect(tooltip(win).head).toBe('Only');
        return chart.update({ type: 'line', labels: ['a', 'b'], series: [{ name: 'Empty', values: [null, null] }] });
      })
      .then(() => {
        svg = figure.querySelector('svg')!;
        expect(svg.querySelector('path.chart-line')).toBeNull();
        expect(svg.querySelector('circle.chart-dot')).toBeNull();
        svg.dispatchEvent(new win.FocusEvent('focus'));
        expect(tooltip(win).rows).toEqual([['–', 'Empty']]);
      });
  });
});

describe('chart lifecycle', () => {
  it('fails an inline spec on the spot, with a note in the figure', () => {
    const { win, figure } = chartPage();
    expect(() => createChart(win, figure, { type: 'pie' } as unknown as ChartSpec, never)).toThrow(/type must be/);
    const note = figure.querySelector('p.callout.critical[role="alert"]')!;
    expect(note.textContent).toMatch(/^This chart could not be drawn\. Kit\.chart: type must be/);
    expect(() => createChart(win, '#missing', { type: 'bar', labels: [], series: [] } as ChartSpec, never)).toThrow('Kit: nothing matches #missing');
  });

  it('loads a data file, keeps the latest update, and reports a failed load', async () => {
    const { win, figure } = chartPage();
    const rows = [
      { week: 'W1', score: 1 },
      { week: 'W2', score: 2 }
    ];
    let release: (value: unknown) => void = () => {};
    const load = vi.fn((path: string) => {
      if (path === 'slow.csv') return new Promise((resolve) => (release = resolve));
      if (path === 'missing.csv') return Promise.reject(new Error('Kit.load: missing.csv answered 404'));
      return Promise.resolve(rows);
    });
    const chart = createChart(win, figure, { type: 'bar', data: 'runs.csv', x: 'week', y: 'score', title: 'Scores' }, load);
    expect(figure.querySelector('svg')).toBeNull();
    await chart.ready;
    expect(load).toHaveBeenCalledWith('runs.csv');
    expect(all(figure, 'path.chart-mark')).toHaveLength(2);

    const stale = chart.update({ type: 'bar', data: 'slow.csv', x: 'week', y: 'score' });
    await chart.update({ type: 'bar', labels: ['X'], series: [{ name: 'Now', values: [9] }] });
    release(rows);
    await stale;
    expect(figure.querySelector('details.chart-table thead')!.textContent).toBe('Now');

    await expect(chart.update({ type: 'bar', data: 'missing.csv', x: 'week', y: 'score' })).rejects.toThrow(/404/);
    expect(figure.querySelector('.callout.critical')!.textContent).toContain('missing.csv answered 404');
    expect(figure.querySelector('.chart-plot')).toBeNull();
    await expect(chart.update({ type: 'bar', labels: ['A'], series: [{ name: 'S', values: ['x'] }] } as unknown as ChartSpec)).rejects.toThrow(/not a number/);

    const late = chart.update({ type: 'bar', data: 'slow.csv', x: 'week', y: 'score' });
    chart.destroy();
    release(rows);
    await late;
    expect(figure.children).toHaveLength(0);
    const failing = createChart(win, figure, { type: 'bar', data: 'missing.csv', x: 'week', y: 'score' }, load);
    failing.destroy();
    await expect(failing.ready).rejects.toThrow(/404/);
    expect(figure.querySelector('.callout')).toBeNull();
  });

  it('keeps the page caption and an author title over the spec title', () => {
    const win = page('<figure id="c"><figcaption>From the page</figcaption></figure>');
    const figure = win.document.querySelector('#c')!;
    createChart(win, figure, { type: 'bar', title: 'From the spec', labels: ['A'], series: [{ name: 'S', values: [1] }] }, never);
    expect(all(figure, 'figcaption')).toHaveLength(1);
    expect(figure.querySelector('svg')!.getAttribute('aria-label')).toMatch(/^From the page\. /);
  });

  it('redraws when its width changes and forgets hidden series that went away', async () => {
    const observed: Array<() => void> = [];
    const { win, figure } = chartPage();
    class FakeObserver {
      constructor(callback: () => void) {
        observed.push(callback);
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(win, 'ResizeObserver', { value: FakeObserver, configurable: true });
    const chart = createChart(win, figure, { type: 'bar', labels: ['A'], series: [{ name: 'S', values: [1] }, { name: 'T', values: [2] }] }, never);
    const first = figure.querySelector('svg');
    observed[0]!();
    expect(figure.querySelector('svg')).toBe(first);
    Object.defineProperty(figure.querySelector('.chart-plot')!, 'clientWidth', { value: 400, configurable: true });
    observed[0]!();
    expect(figure.querySelector('svg')!.getAttribute('width')).toBe('400');

    (all(figure, '.chart-legend button')[1] as HTMLButtonElement).click();
    await chart.update({ type: 'bar', labels: ['A'], series: [{ name: 'S', values: [1] }] });
    expect(all(figure, 'path.chart-mark')).toHaveLength(1);
    await chart.update({ type: 'bar', labels: ['A'], series: [{ name: 'S', values: [1] }, { name: 'T', values: [2] }] });
    expect(all(figure, 'path.chart-mark')).toHaveLength(2);
    chart.destroy();
    observed[0]!();
  });
});

describe('tooltip placement', () => {
  it('flips left near the right edge and below near the top', () => {
    const { win, figure } = chartPage();
    createChart(win, figure, { type: 'bar', labels: ['A'], series: [{ name: 'S', values: [1] }] }, never);
    const svg = figure.querySelector('svg')!;
    pointer(win, svg.querySelector('rect.chart-hit')!, 'pointermove', 10, 10);
    const element = win.document.querySelector<HTMLElement>('.kit-tooltip')!;
    Object.defineProperty(element, 'offsetWidth', { value: 120, configurable: true });
    Object.defineProperty(element, 'offsetHeight', { value: 60, configurable: true });
    pointer(win, svg.querySelector('rect.chart-hit')!, 'pointermove', 1000, 10);
    expect(element.style.left).toBe(`${1000 - 14 - 120}px`);
    expect(element.style.top).toBe('26px');
    pointer(win, svg.querySelector('rect.chart-hit')!, 'pointermove', 100, 400);
    expect([element.style.left, element.style.top]).toEqual(['114px', '328px']);

    element.remove();
    pointer(win, svg.querySelector('rect.chart-hit')!, 'pointermove', 100, 400);
    expect(win.document.querySelectorAll('.kit-tooltip')).toHaveLength(1);
  });

  it('keeps a line tooltip beside the crosshair, inside the window', () => {
    const { win, figure } = chartPage();
    createChart(win, figure, { type: 'line', labels: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] }, never);
    const svg = figure.querySelector('svg')!;
    const overlay = svg.querySelector('rect.chart-overlay')!;
    pointer(win, overlay, 'pointermove', 0, 0);
    const element = win.document.querySelector<HTMLElement>('.kit-tooltip')!;
    Object.defineProperty(element, 'offsetHeight', { value: 100, configurable: true });
    pointer(win, overlay, 'pointermove', 0, 760);
    expect(element.style.top).toBe(`${768 - 100 - 8}px`);
    pointer(win, overlay, 'pointermove', 0, 0);
    expect(element.style.top).toBe('8px');
  });
});

describe('sparklines', () => {
  it('draws into a given svg with the latest point marked', () => {
    const win = page('<svg id="s"></svg>');
    const host = win.document.querySelector('#s')!;
    const root = drawSparkline(win, '#s', [3, null, 5, 4, Number.NaN], { format: 'integer', label: 'Runs' });
    expect(root).toBe(host);
    expect(root.getAttribute('viewBox')).toBe('0 0 120 28');
    expect(root.querySelector('path.chart-spark')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(Number(root.querySelector('circle.chart-spark-now')!.getAttribute('cx'))).toBeCloseTo(3 + (3 * 114) / 4);
    expect(root.getAttribute('aria-label')).toBe('Runs: 3 to 4');
  });

  it('appends an svg to another element, and copes with no data or one value', () => {
    const win = page('<span id="s">old</span>');
    const host = win.document.querySelector('#s')!;
    const root = drawSparkline(win, host, []);
    expect(host.firstElementChild).toBe(root);
    expect(host.textContent).toBe('');
    expect(root.getAttribute('aria-label')).toBe('Trend: no data');
    drawSparkline(win, host, [7]);
    const point = host.querySelector('circle.chart-spark-now')!;
    expect([point.getAttribute('cx'), point.getAttribute('cy')]).toEqual(['60', '14']);
    expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('Trend: 7 to 7');
  });
});
