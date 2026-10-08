/**
 * Bar and line charts drawn as SVG. Thin marks, a 2px surface gap between
 * touching marks, a legend for two or more series, a tooltip on hover and
 * focus, and the numbers in a table underneath.
 */
import { resolveSpec, type ChartSpec, type ResolvedSeries, type ResolvedSpec } from './chart-spec.js';
import { html, lastIndex, resolve, svg, type KitWindow } from './dom.js';
import { tooltipFor, type TooltipRow } from './tooltip.js';
import { fitText, formatNumber, linearScale, niceTicks, textWidth, type NumberFormat } from './util.js';

const GAP = 2;
const MAX_BAR = 24;
const RADIUS = 4;
export const FALLBACK_WIDTH = 640;
const PART = 'data-kit-part';
const TICK_SIZE = 12;
const LABEL_SIZE = 12.5;

export interface ChartHandle {
  readonly element: Element;
  /** Settles once the chart is drawn; rejects with why it could not be. */
  readonly ready: Promise<void>;
  update(spec: ChartSpec): Promise<void>;
  destroy(): void;
}

/** A place the tooltip can stop: each bar or segment, or each x of a line chart. */
interface Stop {
  x: number;
  y: number;
  head: string;
  rows: TooltipRow[];
  enter(): void;
  leave(): void;
}

interface Scene {
  svg: SVGElement;
  stops: Stop[];
  /** Line charts: the stop nearest an x inside the plot. */
  nearest?: (x: number) => number;
  overlay?: SVGElement;
}

interface Axis {
  ticks: number[];
  min: number;
  max: number;
  text: string[];
}

function valueAxis(lo: number, hi: number, length: number, spacing: number, format: NumberFormat): Axis {
  const { ticks, min, max } = niceTicks(lo, hi, Math.max(2, Math.round(length / spacing)));
  return { ticks, min, max, text: ticks.map((tick) => formatNumber(tick, format)) };
}

const widest = (texts: string[], size: number) => texts.reduce((most, text) => Math.max(most, textWidth(text, size)), 0);

/** A rectangle with rounded corners only where asked: [top-left, top-right, bottom-right, bottom-left]. */
export function roundedRect(x: number, y: number, w: number, h: number, r: number, corners: [boolean, boolean, boolean, boolean]): string {
  const n = (value: number) => Math.round(value * 100) / 100;
  const [tl, tr, br, bl] = corners.map((on) => (on ? r : 0)) as [number, number, number, number];
  const arc = (radius: number, toX: number, toY: number) => (radius ? `A${n(radius)},${n(radius)} 0 0 1 ${n(toX)},${n(toY)}` : '');
  return (
    `M${n(x + tl)},${n(y)}H${n(x + w - tr)}${arc(tr, x + w, y + tr)}` +
    `V${n(y + h - br)}${arc(br, x + w - br, y + h)}` +
    `H${n(x + bl)}${arc(bl, x, y + h - bl)}` +
    `V${n(y + tl)}${arc(tl, x + tl, y)}Z`
  );
}

function rootSvg(doc: Document, width: number, height: number): SVGElement {
  return svg(doc, 'svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: 0 });
}

function gridLines(doc: Document, axis: Axis, line: (tick: number) => Record<string, number>): SVGElement {
  const group = svg(doc, 'g', { class: 'chart-grid', 'aria-hidden': 'true' });
  for (const tick of axis.ticks) if (tick !== 0) group.append(svg(doc, 'line', line(tick)));
  return group;
}

function row(series: ResolvedSeries, value: number | null, format: NumberFormat): TooltipRow {
  return { value: formatNumber(value, format), name: series.name, slot: series.slot };
}

const markClass = (series: ResolvedSeries) => `chart-mark chart-s${series.slot}`;

function toggleOn(marks: Element[], on: boolean): void {
  for (const mark of marks) mark.classList.toggle('on', on);
}

/** Bars and columns, single, grouped or stacked, always from a zero baseline. */
export function drawBars(doc: Document, spec: ResolvedSpec, shown: ResolvedSeries[], width: number): Scene {
  const count = spec.labels.length;
  const grouped = !spec.stacked && shown.length > 1;
  const perGroup = grouped ? shown.length : 1;
  const format = spec.format;
  let lo = 0;
  let hi = 0;
  for (let index = 0; index < count; index += 1) {
    let up = 0;
    let down = 0;
    for (const series of shown) {
      const value = series.values[index];
      if (value === null || value === undefined) continue;
      if (spec.stacked) {
        if (value > 0) up += value;
        else down += value;
      } else {
        hi = Math.max(hi, value);
        lo = Math.min(lo, value);
      }
    }
    hi = Math.max(hi, up);
    lo = Math.min(lo, down);
  }
  // yMin and yMax widen the axis; the data always fits.
  if (spec.yMax !== null) hi = Math.max(hi, spec.yMax);
  if (spec.yMin !== null) lo = Math.min(lo, spec.yMin);
  const labelled = spec.valueLabels ?? (shown.length === 1 && !spec.stacked && count <= (spec.horizontal ? 20 : 12));
  const total = (index: number, sign: 1 | -1) =>
    shown.reduce((sum, series) => {
      const value = series.values[index] ?? 0;
      return sign > 0 ? sum + Math.max(0, value) : sum + Math.min(0, value);
    }, 0);
  const valueText: Array<{ index: number; series: ResolvedSeries | null; value: number }> = [];
  if (labelled) {
    for (let index = 0; index < count; index += 1) {
      if (spec.stacked) {
        const up = total(index, 1);
        const down = total(index, -1);
        if (up) valueText.push({ index, series: null, value: up });
        if (down) valueText.push({ index, series: null, value: down });
      } else for (const series of shown) if (series.values[index] !== null) valueText.push({ index, series, value: series.values[index]! });
    }
  }
  return spec.horizontal
    ? horizontalBars(doc, spec, shown, width, { lo, hi, perGroup, labelled, valueText })
    : verticalBars(doc, spec, shown, width, { lo, hi, perGroup, labelled, valueText });
}

interface BarPlan {
  lo: number;
  hi: number;
  perGroup: number;
  labelled: boolean;
  valueText: Array<{ index: number; series: ResolvedSeries | null; value: number }>;
}

/** One category's marks: where each starts and ends along the value axis, in drawing order. */
function segments(spec: ResolvedSpec, shown: ResolvedSeries[], index: number) {
  const out: Array<{ series: ResolvedSeries; slotIndex: number; from: number; to: number; value: number | null; outer: boolean; inner: boolean }> = [];
  if (!spec.stacked) {
    shown.forEach((series, slotIndex) => {
      const value = series.values[index] ?? null;
      out.push({ series, slotIndex, from: 0, to: value ?? 0, value, outer: true, inner: false });
    });
    return out;
  }
  let up = 0;
  let down = 0;
  for (const series of shown) {
    const value = series.values[index] ?? null;
    if (!value) continue;
    const from = value > 0 ? up : down;
    const to = from + value;
    // Inner: a segment sits on another, so it gives up the 2px gap.
    out.push({ series, slotIndex: 0, from, to, value, outer: false, inner: from !== 0 });
    if (value > 0) up = to;
    else down = to;
  }
  const lastUp = out[lastIndex(out, (segment) => segment.to > 0)];
  const lastDown = out[lastIndex(out, (segment) => segment.to < 0)];
  if (lastUp) lastUp.outer = true;
  if (lastDown) lastDown.outer = true;
  return out;
}

function verticalBars(doc: Document, spec: ResolvedSpec, shown: ResolvedSeries[], width: number, plan: BarPlan): Scene {
  const count = Math.max(1, spec.labels.length);
  const height = spec.height ?? 260;
  const top = plan.labelled ? 22 : 10;
  const bottom = 28;
  const plotHeight = height - top - bottom;
  const axis = valueAxis(plan.lo, plan.hi, plotHeight, 56, spec.format);
  const left = Math.ceil(widest(axis.text, TICK_SIZE)) + 12;
  const right = 8;
  const plotWidth = Math.max(40, width - left - right);
  const y = linearScale([axis.min, axis.max], [top + plotHeight, top]);
  const band = plotWidth / count;
  const thick = Math.max(1, Math.min(MAX_BAR, (band * 0.72 - GAP * (plan.perGroup - 1)) / plan.perGroup));
  const groupWidth = thick * plan.perGroup + GAP * (plan.perGroup - 1);
  const root = rootSvg(doc, width, height);
  root.append(gridLines(doc, axis, (tick) => ({ x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) })));
  const ticks = svg(doc, 'g', { 'aria-hidden': 'true' });
  axis.ticks.forEach((tick, index) => ticks.append(svg(doc, 'text', { class: 'chart-tick', x: left - 8, y: y(tick), dy: '0.32em', 'text-anchor': 'end' }, axis.text[index])));
  root.append(ticks);

  const categories = svg(doc, 'g', { 'aria-hidden': 'true' });
  const step = Math.max(1, Math.ceil((Math.min(widest(spec.labels, LABEL_SIZE), 140) + 8) / band));
  spec.labels.forEach((label, index) => {
    if (index % step) return;
    categories.append(
      svg(doc, 'text', { class: 'chart-category', x: left + band * (index + 0.5), y: top + plotHeight + 18, 'text-anchor': 'middle' }, fitText(label, band * step - 6, LABEL_SIZE))
    );
  });
  root.append(categories);

  const marks = svg(doc, 'g');
  const hits = svg(doc, 'g');
  const stops: Stop[] = [];
  spec.labels.forEach((label, index) => {
    const start = left + band * index + (band - groupWidth) / 2;
    for (const segment of segments(spec, shown, index)) {
      const x = spec.stacked ? start : start + segment.slotIndex * (thick + GAP);
      let high = y(Math.max(segment.from, segment.to));
      let low = y(Math.min(segment.from, segment.to));
      if (segment.inner) {
        if (segment.to > 0) low -= GAP;
        else high += GAP;
      }
      const drawn: Element[] = [];
      if (segment.value && low - high > 0.5) {
        const r = segment.outer ? Math.min(RADIUS, thick / 2, low - high) : 0;
        const up = segment.to > 0;
        drawn.push(svg(doc, 'path', { class: markClass(segment.series), d: roundedRect(x, high, thick, low - high, r, [up, up, !up, !up]) }));
        marks.append(...drawn);
      }
      if (spec.stacked && !segment.value) continue;
      // The hit area takes the whole column (or the segment's slice of it), gaps included.
      // Grouped: each bar's slot, the outer two reaching the band's edges.
      const whole = spec.stacked || shown.length === 1;
      const bandStart = left + band * index;
      const slotStart = whole || segment.slotIndex === 0 ? bandStart : x - GAP / 2;
      const slotEnd = whole || segment.slotIndex === shown.length - 1 ? bandStart + band : x + thick + GAP / 2;
      const hitX = slotStart;
      const hitWidth = slotEnd - slotStart;
      const hitTop = Math.max(top, spec.stacked ? (segment.outer && segment.to > 0 ? high - 24 : high - GAP / 2) : top);
      const hitLow = Math.min(top + plotHeight, spec.stacked ? (segment.outer && segment.to < 0 ? low + 24 : low + GAP / 2) : top + plotHeight);
      const stopIndex = stops.length;
      hits.append(svg(doc, 'rect', { class: 'chart-hit', 'data-stop': stopIndex, x: hitX, width: hitWidth, y: hitTop, height: Math.max(1, hitLow - hitTop) }));
      const rows = [row(segment.series, segment.value, spec.format)];
      if (spec.stacked) rows.push({ value: formatNumber(segmentsTotal(shown, index), spec.format), name: 'Total', slot: null });
      stops.push({
        x: x + thick / 2,
        y: segment.to >= 0 ? high : low,
        head: label,
        rows,
        enter: () => toggleOn(drawn, true),
        leave: () => toggleOn(drawn, false)
      });
    }
  });
  root.append(marks);
  root.append(svg(doc, 'line', { class: 'chart-baseline', x1: left, x2: left + plotWidth, y1: y(0), y2: y(0), 'aria-hidden': 'true' }));

  const values = svg(doc, 'g', { 'aria-hidden': 'true' });
  for (const { index, series, value } of plan.valueText) {
    const text = formatNumber(value, spec.format);
    const room = series === null || plan.perGroup === 1 ? band - 2 : thick + GAP + 6;
    if (textWidth(text, TICK_SIZE) > room) continue;
    const slotIndex = series === null ? 0 : shown.indexOf(series);
    const x = left + band * index + (band - groupWidth) / 2 + (spec.stacked ? 0 : slotIndex * (thick + GAP)) + thick / 2;
    values.append(svg(doc, 'text', { class: 'chart-value', x, y: value >= 0 ? y(value) - 6 : y(value) + 14, 'text-anchor': 'middle' }, text));
  }
  root.append(values, hits);
  return { svg: root, stops };
}

function segmentsTotal(shown: ResolvedSeries[], index: number): number {
  return shown.reduce((sum, series) => sum + (series.values[index] ?? 0), 0);
}

function horizontalBars(doc: Document, spec: ResolvedSpec, shown: ResolvedSeries[], width: number, plan: BarPlan): Scene {
  const count = Math.max(1, spec.labels.length);
  const top = 4;
  const bottom = 26;
  const fixedThick = plan.perGroup === 1 ? 20 : Math.max(6, Math.min(16, 44 / plan.perGroup));
  let band = fixedThick * plan.perGroup + GAP * (plan.perGroup - 1) + 14;
  const height = spec.height ?? top + bottom + band * count;
  if (spec.height !== null) band = (height - top - bottom) / count;
  const thick = spec.height === null ? fixedThick : Math.max(1, Math.min(MAX_BAR, (band * 0.72 - GAP * (plan.perGroup - 1)) / plan.perGroup));
  const groupHeight = thick * plan.perGroup + GAP * (plan.perGroup - 1);
  const labelWidth = Math.min(widest(spec.labels, LABEL_SIZE), width * 0.35);
  const left = Math.ceil(labelWidth) + 12;
  const valueWidth = plan.labelled ? widest(plan.valueText.map(({ value }) => formatNumber(value, spec.format)), TICK_SIZE) + 10 : 0;
  const plotWidthGuess = Math.max(40, width - left - 12 - valueWidth);
  const axis = valueAxis(plan.lo, plan.hi, plotWidthGuess, 90, spec.format);
  const right = Math.max(12, valueWidth, textWidth(axis.text.at(-1) ?? '', TICK_SIZE) / 2 + 2);
  const plotWidth = Math.max(40, width - left - right);
  const plotHeight = height - top - bottom;
  const x = linearScale([axis.min, axis.max], [left, left + plotWidth]);
  const root = rootSvg(doc, width, height);
  root.append(gridLines(doc, axis, (tick) => ({ x1: x(tick), x2: x(tick), y1: top, y2: top + plotHeight })));
  const ticks = svg(doc, 'g', { 'aria-hidden': 'true' });
  axis.ticks.forEach((tick, index) => ticks.append(svg(doc, 'text', { class: 'chart-tick', x: x(tick), y: top + plotHeight + 17, 'text-anchor': 'middle' }, axis.text[index])));
  root.append(ticks);

  const categories = svg(doc, 'g', { 'aria-hidden': 'true' });
  spec.labels.forEach((label, index) => {
    categories.append(
      svg(doc, 'text', { class: 'chart-category', x: left - 10, y: top + band * (index + 0.5), dy: '0.32em', 'text-anchor': 'end' }, fitText(label, labelWidth, LABEL_SIZE))
    );
  });
  root.append(categories);

  const marks = svg(doc, 'g');
  const hits = svg(doc, 'g');
  const stops: Stop[] = [];
  spec.labels.forEach((label, index) => {
    const start = top + band * index + (band - groupHeight) / 2;
    for (const segment of segments(spec, shown, index)) {
      const y = spec.stacked ? start : start + segment.slotIndex * (thick + GAP);
      let low = x(Math.min(segment.from, segment.to));
      let high = x(Math.max(segment.from, segment.to));
      if (segment.inner) {
        if (segment.to > 0) low += GAP;
        else high -= GAP;
      }
      const drawn: Element[] = [];
      if (segment.value && high - low > 0.5) {
        const r = segment.outer ? Math.min(RADIUS, thick / 2, high - low) : 0;
        const rightward = segment.to > 0;
        drawn.push(svg(doc, 'path', { class: markClass(segment.series), d: roundedRect(low, y, high - low, thick, r, [!rightward, rightward, rightward, !rightward]) }));
        marks.append(...drawn);
      }
      if (spec.stacked && !segment.value) continue;
      const whole = spec.stacked || shown.length === 1;
      const bandStart = top + band * index;
      const slotStart = whole || segment.slotIndex === 0 ? bandStart : y - GAP / 2;
      const slotEnd = whole || segment.slotIndex === shown.length - 1 ? bandStart + band : y + thick + GAP / 2;
      const hitY = slotStart;
      const hitHeight = slotEnd - slotStart;
      const hitLow = Math.max(left, spec.stacked ? (segment.outer && segment.to < 0 ? low - 24 : low - GAP / 2) : left);
      const hitHigh = Math.min(left + plotWidth, spec.stacked ? (segment.outer && segment.to > 0 ? high + 24 : high + GAP / 2) : left + plotWidth);
      const stopIndex = stops.length;
      hits.append(svg(doc, 'rect', { class: 'chart-hit', 'data-stop': stopIndex, x: hitLow, width: Math.max(1, hitHigh - hitLow), y: hitY, height: hitHeight }));
      const rows = [row(segment.series, segment.value, spec.format)];
      if (spec.stacked) rows.push({ value: formatNumber(segmentsTotal(shown, index), spec.format), name: 'Total', slot: null });
      stops.push({ x: segment.to >= 0 ? high : low, y: y + thick / 2, head: label, rows, enter: () => toggleOn(drawn, true), leave: () => toggleOn(drawn, false) });
    }
  });
  root.append(marks);
  root.append(svg(doc, 'line', { class: 'chart-baseline', x1: x(0), x2: x(0), y1: top, y2: top + plotHeight, 'aria-hidden': 'true' }));

  const values = svg(doc, 'g', { 'aria-hidden': 'true' });
  for (const { index, series, value } of plan.valueText) {
    const slotIndex = series === null ? 0 : shown.indexOf(series);
    if (series !== null && plan.perGroup > 1 && thick < 11) continue;
    const y = top + band * index + (band - groupHeight) / 2 + (spec.stacked ? 0 : slotIndex * (thick + GAP)) + thick / 2;
    const end = x(value);
    values.append(
      svg(doc, 'text', { class: 'chart-value', x: value >= 0 ? end + 6 : end - 6, y, dy: '0.32em', 'text-anchor': value >= 0 ? 'start' : 'end' }, formatNumber(value, spec.format))
    );
  }
  root.append(values, hits);
  return { svg: root, stops };
}

/** Lines over an x of labels, with an optional wash, end dots and, for 2–4 series, names at the ends. */
export function drawLines(doc: Document, spec: ResolvedSpec, shown: ResolvedSeries[], width: number): Scene {
  const count = spec.labels.length;
  const height = spec.height ?? 260;
  const all = shown.flatMap((series) => series.values.filter((value): value is number => value !== null));
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (spec.area) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (spec.yMin !== null) lo = Math.min(lo, spec.yMin);
  if (spec.yMax !== null) hi = Math.max(hi, spec.yMax);
  const top = 10;
  const bottom = 28;
  const plotHeight = height - top - bottom;
  const axis = valueAxis(lo, hi, plotHeight, 56, spec.format);
  const left = Math.ceil(widest(axis.text, TICK_SIZE)) + 12;
  const lastOf = (series: ResolvedSeries) => lastIndex(series.values, (value) => value !== null);
  const direct = shown.length >= 2 && shown.length <= 4 && shown.every((series) => lastOf(series) === count - 1);
  const right = direct ? Math.min(widest(shown.map((series) => series.name), LABEL_SIZE), width * 0.25) + 16 : 10;
  const plotWidth = Math.max(40, width - left - right);
  const spacing = count > 1 ? plotWidth / (count - 1) : plotWidth;
  const xAt = (index: number) => (count > 1 ? left + index * spacing : left + plotWidth / 2);
  const y = linearScale([axis.min, axis.max], [top + plotHeight, top]);
  const base = axis.min <= 0 && axis.max >= 0 ? 0 : axis.min;
  const root = rootSvg(doc, width, height);
  root.append(gridLines(doc, axis, (tick) => ({ x1: left, x2: left + plotWidth, y1: y(tick), y2: y(tick) })));
  const ticks = svg(doc, 'g', { 'aria-hidden': 'true' });
  axis.ticks.forEach((tick, index) => ticks.append(svg(doc, 'text', { class: 'chart-tick', x: left - 8, y: y(tick), dy: '0.32em', 'text-anchor': 'end' }, axis.text[index])));
  root.append(ticks, svg(doc, 'line', { class: 'chart-baseline', x1: left, x2: left + plotWidth, y1: y(base), y2: y(base), 'aria-hidden': 'true' }));

  const categories = svg(doc, 'g', { 'aria-hidden': 'true' });
  const step = Math.max(1, Math.ceil((Math.min(widest(spec.labels, LABEL_SIZE), 140) + 16) / spacing));
  spec.labels.forEach((label, index) => {
    if (index % step) return;
    const anchor = count > 1 && index === 0 ? 'start' : count > 1 && index === count - 1 ? 'end' : 'middle';
    categories.append(svg(doc, 'text', { class: 'chart-category', x: xAt(index), y: top + plotHeight + 18, 'text-anchor': anchor }, fitText(label, spacing * step - 8, LABEL_SIZE)));
  });
  root.append(categories);

  // Runs of points between gaps (nulls break the line).
  const runs = (series: ResolvedSeries) => {
    const out: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    series.values.forEach((value, index) => {
      if (value === null) {
        if (current.length) out.push(current);
        current = [];
      } else current.push([xAt(index), y(value)]);
    });
    if (current.length) out.push(current);
    return out;
  };
  const n = (value: number) => Math.round(value * 100) / 100;
  const path = (points: Array<[number, number]>) => points.map(([px, py], index) => `${index ? 'L' : 'M'}${n(px)},${n(py)}`).join('') + (points.length === 1 ? `L${n(points[0]![0])},${n(points[0]![1])}` : '');
  const marks = svg(doc, 'g');
  if (spec.area) {
    for (const series of shown) {
      for (const run of runs(series)) {
        const d = `${path(run)}L${n(run.at(-1)![0])},${n(y(base))}L${n(run[0]![0])},${n(y(base))}Z`;
        marks.append(svg(doc, 'path', { class: `chart-area chart-s${series.slot}`, d }));
      }
    }
  }
  for (const series of shown) {
    const d = runs(series).map(path).join('');
    if (d) marks.append(svg(doc, 'path', { class: `chart-line chart-s${series.slot}`, d }));
  }
  const ends: Array<{ series: ResolvedSeries; y: number }> = [];
  for (const series of shown) {
    const last = lastOf(series);
    if (last < 0) continue;
    const endY = y(series.values[last]!);
    ends.push({ series, y: endY });
    marks.append(svg(doc, 'circle', { class: `chart-dot chart-s${series.slot}`, cx: xAt(last), cy: endY, r: 4 }));
  }
  root.append(marks);

  if (direct) {
    // Names at the line ends, unless two would touch: then the legend and tooltip carry them.
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    const clear = sorted.every((end, index) => index === 0 || end.y - sorted[index - 1]!.y >= 14);
    if (clear) {
      const labels = svg(doc, 'g', { 'aria-hidden': 'true' });
      for (const end of ends) {
        labels.append(svg(doc, 'text', { class: 'chart-series-label', x: left + plotWidth + 10, y: end.y, dy: '0.32em' }, fitText(end.series.name, right - 14, LABEL_SIZE)));
      }
      root.append(labels);
    }
  }

  const crosshair = svg(doc, 'line', { class: 'chart-crosshair', y1: top, y2: top + plotHeight, x1: left, x2: left, visibility: 'hidden', 'aria-hidden': 'true' });
  const hover = svg(doc, 'g', { 'aria-hidden': 'true' });
  const overlay = svg(doc, 'rect', { class: 'chart-overlay', x: left - Math.min(spacing / 2, left), y: top, width: plotWidth + Math.min(spacing, left + right), height: plotHeight });
  root.append(crosshair, hover, overlay);

  const stops: Stop[] = spec.labels.map((label, index) => {
    const at = shown.map((series) => ({ series, value: series.values[index] ?? null }));
    const known = at.filter((entry) => entry.value !== null);
    return {
      x: xAt(index),
      y: known.length ? Math.min(...known.map((entry) => y(entry.value!))) : top,
      head: label,
      // Highest first, the way the lines stack at this x.
      rows: [...known.sort((a, b) => b.value! - a.value!), ...at.filter((entry) => entry.value === null)].map((entry) => row(entry.series, entry.value, spec.format)),
      enter: () => {
        crosshair.setAttribute('x1', String(n(xAt(index))));
        crosshair.setAttribute('x2', String(n(xAt(index))));
        crosshair.setAttribute('visibility', 'visible');
        hover.replaceChildren(...known.map((entry) => svg(doc, 'circle', { class: `chart-dot chart-s${entry.series.slot}`, cx: xAt(index), cy: y(entry.value!), r: 4 })));
      },
      leave: () => {
        crosshair.setAttribute('visibility', 'hidden');
        hover.replaceChildren();
      }
    };
  });
  const nearest = (px: number) => (count > 1 ? Math.min(count - 1, Math.max(0, Math.round((px - left) / spacing))) : 0);
  return { svg: root, stops, nearest, overlay };
}

/** Tooltip on hover and focus; arrow keys walk the stops. */
function wire(win: KitWindow, scene: Scene): () => void {
  // Looked up each time: the page may have dropped the old one.
  const tooltip = () => tooltipFor(win);
  const root = scene.svg;
  let current = -1;
  let last = 0;
  const show = (index: number, client?: { x: number; y: number }) => {
    const stop = scene.stops[index];
    if (!stop) return;
    if (index !== current) {
      scene.stops[current]?.leave();
      current = index;
      last = index;
      stop.enter();
    }
    const box = root.getBoundingClientRect();
    // A crosshair's tooltip sits beside the snapped x, so it never covers the points it reads out.
    if (scene.nearest) tooltip().show(stop.head, stop.rows, { x: box.left + stop.x, y: client?.y ?? box.top + stop.y }, 'side');
    else tooltip().show(stop.head, stop.rows, client ?? { x: box.left + stop.x, y: box.top + stop.y });
  };
  const hide = () => {
    scene.stops[current]?.leave();
    current = -1;
    tooltip().hide();
  };
  root.addEventListener('pointermove', (event) => {
    const target = event.target as Element;
    const hit = target.closest?.('[data-stop]');
    let index = -1;
    if (hit) index = Number(hit.getAttribute('data-stop'));
    else if (scene.nearest && target === scene.overlay) index = scene.nearest(event.clientX - root.getBoundingClientRect().left);
    if (index < 0) hide();
    else show(index, { x: event.clientX, y: event.clientY });
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focus', () => show(last));
  root.addEventListener('blur', hide);
  root.addEventListener('keydown', (event) => {
    const end = scene.stops.length - 1;
    const from = current < 0 ? last : current;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(end, from + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, from - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? end
      : null;
    if (event.key === 'Escape') hide();
    if (next === null) return;
    event.preventDefault();
    show(next);
  });
  return hide;
}

function describe(spec: ResolvedSpec, shown: ResolvedSeries[], name: string): string {
  const kind = spec.type === 'line' ? 'Line chart' : spec.horizontal ? 'Bar chart' : 'Column chart';
  const of = shown.length === 1 ? shown[0]!.name : `${shown.length} series`;
  const tail = spec.table ? '; the data table follows' : '';
  return `${name ? `${name}. ` : ''}${kind} of ${of} over ${spec.labels.length} ${spec.labels.length === 1 ? 'point' : 'points'}${tail}.`;
}

function dataTable(doc: Document, spec: ResolvedSpec): HTMLElement {
  const head = html(doc, 'tr', {}, [
    html(doc, 'th', { scope: 'col' }, [spec.xLabel]),
    ...spec.series.map((series) => html(doc, 'th', { scope: 'col', class: 'num' }, [series.name]))
  ]);
  const body = spec.labels.map((label, index) =>
    html(doc, 'tr', {}, [
      html(doc, 'th', { scope: 'row' }, [label]),
      ...spec.series.map((series) => html(doc, 'td', { class: 'num' }, [formatNumber(series.values[index], spec.format)]))
    ])
  );
  return html(doc, 'details', { class: 'chart-table', [PART]: true }, [
    html(doc, 'summary', {}, ['Data table']),
    html(doc, 'div', { class: 'table-wrap' }, [html(doc, 'table', {}, [html(doc, 'thead', {}, [head]), html(doc, 'tbody', {}, body)])])
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createChart(win: KitWindow, target: Element | string, spec: ChartSpec, load: (path: string) => Promise<unknown>): ChartHandle {
  const doc = win.document;
  const figure = resolve(doc, target);
  figure.classList.add('chart');
  const hidden = new Set<number>();
  let resolved: ResolvedSpec | null = null;
  let plot: HTMLElement | null = null;
  let lastWidth = 0;
  let generation = 0;
  let destroyed = false;
  let hideTooltip = () => {};
  const Observer = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = Observer
    ? new Observer(() => {
        if (plot && Math.abs(measure() - lastWidth) >= 1) drawPlot();
      })
    : null;

  const clear = () => {
    for (const part of [...figure.children]) if (part.hasAttribute(PART)) part.remove();
  };
  const measure = () => Math.floor(plot?.clientWidth || figure.clientWidth || FALLBACK_WIDTH);
  const caption = () => figure.querySelector(':scope > figcaption, :scope > .title')?.textContent?.trim() ?? '';

  function drawPlot(): void {
    if (!plot || !resolved) return;
    hideTooltip();
    const width = Math.max(160, measure());
    lastWidth = width;
    const shown = resolved.series.filter((series) => !hidden.has(series.slot));
    const scene = resolved.type === 'line' ? drawLines(doc, resolved, shown, width) : drawBars(doc, resolved, shown, width);
    scene.svg.setAttribute('aria-label', describe(resolved, shown, caption() || resolved.title || ''));
    plot.replaceChildren(scene.svg);
    hideTooltip = wire(win, scene);
  }

  function render(next: ResolvedSpec): void {
    resolved = next;
    for (const slot of [...hidden]) if (!next.series.some((series) => series.slot === slot)) hidden.delete(slot);
    if (hidden.size >= next.series.length) hidden.clear();
    clear();
    if (next.title && !caption()) figure.prepend(html(doc, 'figcaption', { [PART]: true }, [next.title]));
    if (next.series.length >= 2) {
      const legend = html(doc, 'ul', { class: next.type === 'line' ? 'chart-legend lines' : 'chart-legend', [PART]: true, 'aria-label': 'Series' });
      for (const series of next.series) {
        const button = html(doc, 'button', { type: 'button', class: `chart-s${series.slot}`, 'aria-pressed': String(!hidden.has(series.slot)) }, [series.name]);
        button.addEventListener('click', () => {
          const showing = !hidden.has(series.slot);
          // Keep one series on screen.
          if (showing && hidden.size >= next.series.length - 1) return;
          if (showing) hidden.add(series.slot);
          else hidden.delete(series.slot);
          button.setAttribute('aria-pressed', String(!showing));
          drawPlot();
        });
        legend.append(html(doc, 'li', {}, [button]));
      }
      figure.append(legend);
    }
    plot = html(doc, 'div', { class: 'chart-plot', [PART]: true });
    figure.append(plot);
    if (next.table) figure.append(dataTable(doc, next));
    observer?.disconnect();
    observer?.observe(plot);
    drawPlot();
  }

  function fail(error: unknown): void {
    clear();
    resolved = null;
    plot = null;
    const message = error instanceof Error ? error.message : String(error);
    figure.append(html(doc, 'p', { class: 'callout critical', [PART]: true, role: 'alert' }, [`This chart could not be drawn. ${message}`]));
  }

  const attempt = (next: unknown) => {
    try {
      render(resolveSpec(next));
    } catch (error) {
      fail(error);
      throw error;
    }
  };

  function update(next: ChartSpec): Promise<void> {
    const mine = (generation += 1);
    if (isRecord(next) && typeof next.data === 'string') {
      const path = next.data;
      return load(path).then(
        (rows) => {
          if (mine !== generation || destroyed) return;
          attempt({ ...next, data: rows });
        },
        (error: unknown) => {
          if (mine === generation && !destroyed) fail(error);
          throw error;
        }
      );
    }
    try {
      attempt(next);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // An inline spec that is wrong fails right here, where the page called Kit.chart.
  let ready: Promise<void>;
  if (isRecord(spec) && typeof spec.data === 'string') ready = update(spec);
  else {
    generation += 1;
    attempt(spec);
    ready = Promise.resolve();
  }

  return {
    element: figure,
    ready,
    update,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      hideTooltip();
      clear();
    }
  };
}

export interface SparklineOptions {
  format?: NumberFormat;
  /** What the line shows, for screen readers. */
  label?: string;
}

/** A small trend line in the de-emphasis ink with the latest point in the accent. */
export function drawSparkline(win: KitWindow, target: Element | string, raw: ReadonlyArray<number | null>, options: SparklineOptions = {}): SVGElement {
  const doc = win.document;
  const host = resolve(doc, target);
  const values = raw.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null));
  const width = Math.floor(host.clientWidth || 120);
  const height = Math.floor(host.clientHeight || 28);
  const root: SVGElement = host instanceof win.SVGSVGElement ? host : svg(doc, 'svg');
  for (const [name, value] of Object.entries({ width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' })) root.setAttribute(name, String(value));
  root.replaceChildren();
  const known = values.filter((value): value is number => value !== null);
  const format = options.format ?? 'number';
  const what = options.label ?? 'Trend';
  if (!known.length) root.setAttribute('aria-label', `${what}: no data`);
  else {
    const pad = 3;
    const lo = Math.min(...known);
    const hi = Math.max(...known);
    const x = (index: number) => (values.length > 1 ? pad + (index * (width - pad * 2)) / (values.length - 1) : width / 2);
    const y = lo === hi ? () => height / 2 : linearScale([lo, hi], [height - pad, pad]);
    let d = '';
    let drawing = false;
    values.forEach((value, index) => {
      if (value === null) {
        drawing = false;
        return;
      }
      d += `${drawing ? 'L' : 'M'}${Math.round(x(index) * 100) / 100},${Math.round(y(value) * 100) / 100}`;
      drawing = true;
    });
    const latest = lastIndex(values, (value) => value !== null);
    root.append(svg(doc, 'path', { class: 'chart-spark', d }), svg(doc, 'circle', { class: 'chart-spark-now', cx: x(latest), cy: y(values[latest]!), r: 2.5 }));
    root.setAttribute('aria-label', `${what}: ${formatNumber(known[0], format)} to ${formatNumber(known.at(-1), format)}`);
  }
  if (root !== host) host.replaceChildren(root);
  return root;
}
