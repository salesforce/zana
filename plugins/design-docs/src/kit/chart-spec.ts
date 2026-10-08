/**
 * What a page asks a chart to draw. Specs are often written by agents as JSON,
 * so every field is checked and a bad one fails with a message that says how
 * to fix it.
 */
import type { NumberFormat } from './util.js';

export const MAX_SERIES = 8;
export const MAX_POINTS = 2000;

export interface ChartSeries {
  name: string;
  values: Array<number | null>;
  /** The color slot, 1–8. Pin it so a series keeps its color across charts. */
  slot?: number;
}

/** Take series from rows: `x` names the label column, `y` the value columns. */
export interface ChartRows {
  data: string | Array<Record<string, unknown>>;
  x: string;
  y: string | Array<string | { column: string; name?: string; slot?: number }>;
}

export interface ChartSpec {
  type: 'bar' | 'line';
  labels?: Array<string | number>;
  series?: ChartSeries[];
  data?: ChartRows['data'];
  x?: string;
  y?: ChartRows['y'];
  /** The chart's name for screen readers when its figure has no caption. */
  title?: string;
  stacked?: boolean;
  horizontal?: boolean;
  area?: boolean;
  format?: NumberFormat;
  yMin?: number;
  yMax?: number;
  height?: number;
  /** Values at the bar ends; on by default for one series of up to 12 bars. */
  valueLabels?: boolean;
  /** The data table under the chart; on by default. */
  table?: boolean;
  /** The header of the label column in the data table. */
  xLabel?: string;
}

export interface ResolvedSeries {
  name: string;
  values: Array<number | null>;
  slot: number;
}

export interface ResolvedSpec {
  type: 'bar' | 'line';
  labels: string[];
  series: ResolvedSeries[];
  title: string | null;
  stacked: boolean;
  horizontal: boolean;
  area: boolean;
  format: NumberFormat;
  yMin: number | null;
  yMax: number | null;
  height: number | null;
  valueLabels: boolean | null;
  table: boolean;
  xLabel: string;
}

function fail(message: string): never {
  throw new Error(`Kit.chart: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(spec: Record<string, unknown>, key: string): number | null {
  const value = spec[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a number`);
  return value;
}

function optionalBoolean(spec: Record<string, unknown>, key: string): boolean | null {
  const value = spec[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') fail(`${key} must be true or false`);
  return value;
}

function toValue(value: unknown, where: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fail(`${where} is ${JSON.stringify(value)}, not a number (use null for a gap)`);
}

const FORMATS = new Set(['number', 'integer', 'percent', 'compact']);

/** Series from rows of a data file or an inline array. */
export function fromRows(rows: unknown, x: unknown, y: unknown): { labels: string[]; series: ChartSeries[] } {
  if (!Array.isArray(rows)) fail('data must be rows: an array of objects, or the path of a JSON or CSV file');
  if (typeof x !== 'string' || !x) fail('x must name the column that labels each point');
  const columns = (Array.isArray(y) ? y : [y]).map((entry, index) => {
    if (typeof entry === 'string' && entry) return { column: entry, name: entry };
    if (isRecord(entry) && typeof entry.column === 'string' && entry.column) {
      return { column: entry.column, name: typeof entry.name === 'string' && entry.name ? entry.name : entry.column, slot: entry.slot };
    }
    return fail(`y[${index}] must name a value column`);
  });
  if (!columns.length) fail('y must name at least one value column');
  const objects = rows.map((row, index) => (isRecord(row) ? row : fail(`data[${index}] is not an object`)));
  return {
    labels: objects.map((row) => String(row[x] ?? '')),
    series: columns.map(({ column, name, slot }) => ({
      name,
      values: objects.map((row, index) => toValue(row[column], `data[${index}].${column}`)),
      ...(slot === undefined ? {} : { slot: slot as number })
    }))
  };
}

export function resolveSpec(raw: unknown): ResolvedSpec {
  if (!isRecord(raw)) fail('the spec must be an object');
  const type = raw.type;
  if (type !== 'bar' && type !== 'line') fail(`type must be "bar" or "line", not ${JSON.stringify(type)}`);
  let labels = raw.labels;
  let series = raw.series;
  if (raw.data !== undefined) {
    if (typeof raw.data === 'string') fail(`data names ${raw.data}, which has not loaded yet`);
    ({ labels, series } = fromRows(raw.data, raw.x, raw.y));
  }
  if (!Array.isArray(labels)) fail('labels must be an array (or give data, x and y)');
  if (labels.length > MAX_POINTS) fail(`at most ${MAX_POINTS} points; aggregate the data first`);
  if (!Array.isArray(series) || !series.length) fail('series must be a non-empty array');
  if (series.length > MAX_SERIES) {
    fail(`${series.length} series is more than ${MAX_SERIES} colors can tell apart; fold the smallest into "Other" or split into small multiples`);
  }
  const used = new Map<number, string>();
  const resolved = series.map((entry, index): ResolvedSeries => {
    if (!isRecord(entry)) fail(`series[${index}] must be an object with name and values`);
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) fail(`series[${index}] needs a name`);
    if (!Array.isArray(entry.values)) fail(`series[${index}].values must be an array`);
    if (entry.values.length !== labels.length) {
      fail(`series "${name}" has ${entry.values.length} values for ${labels.length} labels; use null for a gap`);
    }
    const slot = entry.slot ?? index + 1;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > MAX_SERIES) fail(`series "${name}" slot must be 1 to ${MAX_SERIES}`);
    const taken = used.get(slot);
    if (taken !== undefined) fail(`series "${taken}" and "${name}" both use color slot ${slot}`);
    used.set(slot, name);
    return { name, slot, values: entry.values.map((value, point) => toValue(value, `series "${name}" value ${point + 1}`)) };
  });
  const format = raw.format ?? 'number';
  if (!(typeof format === 'string' ? FORMATS.has(format) : isRecord(format))) {
    fail('format must be "number", "integer", "percent", "compact" or Intl.NumberFormat options');
  }
  const height = optionalNumber(raw, 'height');
  if (height !== null && (height < 80 || height > 2000)) fail('height must be 80 to 2000 pixels');
  const stacked = optionalBoolean(raw, 'stacked') ?? false;
  const horizontal = optionalBoolean(raw, 'horizontal') ?? false;
  const area = optionalBoolean(raw, 'area') ?? false;
  if (type === 'line' && (stacked || horizontal)) fail('stacked and horizontal are for bar charts');
  if (type === 'bar' && area) fail('area is for line charts');
  const yMin = optionalNumber(raw, 'yMin');
  const yMax = optionalNumber(raw, 'yMax');
  if (yMin !== null && yMax !== null && yMin >= yMax) fail('yMin must be below yMax');
  return {
    type,
    labels: labels.map((label) => String(label ?? '')),
    series: resolved,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null,
    stacked,
    horizontal,
    area,
    format: format as NumberFormat,
    yMin,
    yMax,
    height,
    valueLabels: optionalBoolean(raw, 'valueLabels'),
    table: optionalBoolean(raw, 'table') ?? true,
    xLabel: typeof raw.xLabel === 'string' ? raw.xLabel : typeof raw.x === 'string' ? raw.x : ''
  };
}
